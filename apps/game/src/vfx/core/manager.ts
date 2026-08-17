import * as THREE from "three";
import { getVfxDefinition } from "./registry";
import { resolveAnchor } from "./anchor";
import { markInstanceCancelled, markInstanceEnd, markInstancePulse, markInstanceStart } from "./lifecycle";
import { useWorldStore } from "../../net/worldStore";
import { DEFAULT_LOD_THRESHOLDS, lodTierFor, type VfxLodThresholds } from "./lod";
import {
  DEFAULT_BUDGET_LIMITS,
  priorityFor,
  selectExcludedByWeight,
  selectExcludedGrouped,
  type VfxBudgetLimits,
  type WeightedBudgetCandidate,
} from "./budget";
import { DEFAULT_PARTICLE_COUNT } from "./renderers/ParticleRenderer";
import type { Vec3, VfxDefinition, VfxHandle, VfxInstanceRuntime, VfxLayer, VfxSpawnOptions, VfxWorldContext } from "./types";
import type { VfxRenderer } from "./renderers/rendererTypes";

/**
 * `layerInstanceId = instanceId * LAYER_ID_MULTIPLIER + layerIndex` — o
 * jeito de dar a cada CAMADA de uma instância composta (Fase 5, item 7) um
 * id próprio no renderer que a desenha, sem mudar nenhum dos 5 renderers
 * (eles já indexam tudo por `instance.instanceId`, um número). 64 é uma
 * margem generosa — a composição mais rica planejada (Oráculo) usa 4
 * camadas; nenhuma skill real chega perto de 64.
 *
 * A CAMADA 0 é exceção de propósito: mantém o `instanceId` ORIGINAL, sem
 * multiplicar. As 20 famílias de hoje (5 migradas + 15 legadas) nunca usam
 * `def.layers` — `layersFor()` sempre devolve exatamente 1 camada — e
 * qualquer coisa fora do manager que correlaciona id (`vfxProbe.ts`,
 * `getInstance()`, os testes de `manager.test.ts`) espera ver o MESMO id
 * que `play()` devolveu. Só camadas 1+ (que só existem em composições
 * novas, Etapa 7 em diante) precisam de um id sintético — e o espaço
 * multiplicado (≥64_000_000_000) nunca alcança o espaço de ids crus
 * (`INSTANCE_ID_OFFSET` cresce 1 por `play()`, nunca chega nem perto).
 */
const LAYER_ID_MULTIPLIER = 64;

function layerInstanceId(instanceId: number, layerIndex: number): number {
  return layerIndex === 0 ? instanceId : instanceId * LAYER_ID_MULTIPLIER + layerIndex;
}

/** `def.layers` explícito vence; sem ele, o `renderer`/`atlas`/`animation`/
 * `scale`/`blend`/`dom` do nível top da `VfxDefinition` são a ÚNICA camada
 * — é assim que as 5 defs migradas na Fase 3 e as 15 famílias legadas
 * continuam funcionando sem tocar uma linha. */
function layersFor(def: VfxDefinition): VfxLayer[] {
  if (def.layers && def.layers.length > 0) return def.layers;
  return [{ renderer: def.renderer, atlas: def.atlas, animation: def.animation, scale: def.scale, blend: def.blend, dom: def.dom }];
}

interface LayerEntry {
  layer: VfxLayer;
  runtime: VfxInstanceRuntime;
}

/** posição base + offset local do layer, em espaço de MUNDO (documentado
 * em `types.ts: VfxLayer.offset` — não rotaciona com o alvo). Cria um `Vec3`
 * NOVO só na criação da camada; `applyOffsetInto` (abaixo) reusa esse mesmo
 * objeto a cada quadro, sem alocar. */
function applyOffset(base: Vec3, offset?: readonly [number, number, number]): Vec3 {
  if (!offset) return { x: base.x, y: base.y, z: base.z };
  return { x: base.x + offset[0], y: base.y + offset[1], z: base.z + offset[2] };
}

/** mesma conta de `applyOffset`, mas escreve DENTRO de um `Vec3` já
 * existente — usada todo quadro em `update()` pra nunca alocar por camada
 * por frame (mesmo princípio de "zero alocação em estado estável" do
 * relatório da Fase 4, seção F). */
function applyOffsetInto(target: Vec3, base: Vec3, offset?: readonly [number, number, number]): void {
  target.x = base.x + (offset?.[0] ?? 0);
  target.y = base.y + (offset?.[1] ?? 0);
  target.z = base.z + (offset?.[2] ?? 0);
}

/**
 * Frustum culling por instância (Fase 5, item 11 do pedido). Objetos
 * `THREE.*` REUSADOS a nível de módulo — 1 `Frustum`/`Matrix4`/`Sphere`
 * pro jogo inteiro, nunca alocado por instância nem por quadro (mesmo
 * princípio de "zero alocação em estado estável" do relatório da Fase 4).
 *
 * Raio da esfera é uma aproximação DELIBERADAMENTE generosa — o Core não
 * conhece a extensão visual real de cada VFX (isso variaria por primitive/
 * asset, que ainda não existe). `payload.radius` (já usado por Ring/área)
 * quando presente, senão um raio base que cobre confortavelmente qualquer
 * efeito de skill hoje. Prefere NUNCA cular algo visível a cular de menos
 * — o pedido é "instância fora da câmera não deve custar o mesmo que uma
 * visível", não "cortar no talo".
 */
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _distVec = new THREE.Vector3();
const CULL_RADIUS_BASE = 3;

function instanceBoundingRadius(instance: VfxInstanceRuntime): number {
  const payloadRadius = instance.spawnOptions.payload?.radius;
  const base = typeof payloadRadius === "number" ? Math.max(payloadRadius, CULL_RADIUS_BASE) : CULL_RADIUS_BASE;
  return base * Math.max(1, instance.targetScale);
}

function updateFrustum(camera: THREE.Camera): void {
  // força recálculo de `matrixWorldInverse` a partir da posição/rotação
  // ATUAL da câmera — sem isto, `matrixWorldInverse` refletiria o quadro
  // ANTERIOR (só é recomputado dentro do traversal de `renderer.render()`,
  // que roda DEPOIS de todo `useFrame`, incluindo o do `VfxRoot`).
  camera.updateMatrixWorld();
  _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);
}

/** exige `updateFrustum()` já ter rodado neste quadro (`update()` chama
 * uma vez, antes do laço de instâncias). */
function passesFrustum(instance: VfxInstanceRuntime): boolean {
  _sphere.center.set(instance.position.x, instance.position.y, instance.position.z);
  _sphere.radius = instanceBoundingRadius(instance);
  return _frustum.intersectsSphere(_sphere);
}

/**
 * `instanceId` do manager nunca pode colidir com o `id` de `vfx/vfxStore.ts`
 * — os dois populam o MESMO `Map` global em `core/diagnostics/vfxProbe.ts:
 * ativos`, que não tem namespace por origem. `vfxStore` conta casts numa
 * sessão real (nunca chega nem perto de mil); este offset garante os dois
 * espaços nunca se tocarem, documentado em vez de coincidência.
 */
const INSTANCE_ID_OFFSET = 1_000_000_000;

/**
 * Runtime central do VFX Core (item 2 do pedido: "VFXManager — spawn,
 * atualização, animação, posição, escala, rotação, duração, pooling,
 * lifecycle, cleanup").
 *
 * `VFXManager` NUNCA sabe desenhar nada — só decide QUANDO uma instância
 * nasce/morre/pulsa e ONDE ela está (via `anchor.ts`), e delega o desenho
 * pro `VfxRenderer` registrado para `def.renderer` (`VfxRoot.tsx` é quem
 * registra, porque só ele tem acesso à cena R3F).
 */
export class VFXManager {
  private readonly instances = new Map<number, VfxInstanceRuntime>();
  private readonly coalesceIndex = new Map<string, number>();
  private readonly renderers = new Map<string, VfxRenderer>();
  /** camadas de CADA instância — a instância "lógica" em `instances` nunca
   * é ela mesma passada a um renderer quando `def.layers` existe; cada
   * `LayerEntry.runtime` é a view por camada que o renderer recebe. */
  private readonly layerEntries = new Map<number, LayerEntry[]>();
  private world: VfxWorldContext | null = null;
  private nextId = INSTANCE_ID_OFFSET;

  // Fase 5, itens 9/10/12/13 — LOD e budget são infra EXPOSTA, com números
  // padrão que nunca mudam comportamento (`Infinity` = sempre "full"/sem
  // limite) até alguém calibrar por benchmark real (pedido explícito do
  // usuário, 2026-08-16: "não quero reduzir visual arbitrariamente nem
  // calibrar números no chute"). `nearDistance` só importa quando
  // `budgetLimits.maxActiveInstances` deixar de ser `Infinity`.
  private lodThresholds: VfxLodThresholds = DEFAULT_LOD_THRESHOLDS;
  private budgetLimits: VfxBudgetLimits = DEFAULT_BUDGET_LIMITS;
  private localPlayerGid: number | undefined;
  private nearDistance = Infinity; // TBD — calibrar (sem dado de distância medido ainda)

  // Fase 5, "ligar o budget de verdade" — `budgetExcludedIds` é o
  // resultado JÁ APLICADO (instâncias que `update()` está pulando agora),
  // recalculado só a cada `BUDGET_RECOMPUTE_INTERVAL_FRAMES` quadros em vez
  // de todo quadro. Isso É a histerese: o gargalo de "flapping" descrito no
  // docblock de `computeBudgetPressure()` é oscilação quadro-a-quadro perto
  // do limite — espaçar a decisão no tempo (~4x/s a 60fps) impede isso sem
  // precisar de uma banda de dois limiares. Estado separado de `culled` —
  // nunca reusa o mesmo flag (esse era o risco real: duas razões de
  // exclusão brigando pela mesma instância).
  private budgetExcludedIds = new Set<number>();
  private budgetTick = 0;
  private static readonly BUDGET_RECOMPUTE_INTERVAL_FRAMES = 15;

  setLodThresholds(thresholds: VfxLodThresholds): void {
    this.lodThresholds = thresholds;
  }

  /** aceita um subconjunto dos 5 limites — quem chama (bench/teste/UI
   * futura) raramente quer setar os 5 de uma vez; os ausentes mantêm o
   * valor JÁ ativo (nunca voltam a `Infinity` por engano ao setar só um). */
  setBudgetLimits(limits: Partial<VfxBudgetLimits>): void {
    this.budgetLimits = { ...this.budgetLimits, ...limits };
  }

  setLocalPlayerGid(gid: number | undefined): void {
    this.localPlayerGid = gid;
  }

  setNearDistance(distance: number): void {
    this.nearDistance = distance;
  }

  private buildLayerRuntime(instance: VfxInstanceRuntime, layer: VfxLayer, layerIndex: number): VfxInstanceRuntime {
    return {
      instanceId: layerInstanceId(instance.instanceId, layerIndex),
      vfxId: instance.vfxId,
      def: {
        ...instance.def,
        renderer: layer.renderer,
        atlas: layer.atlas ?? instance.def.atlas,
        animation: layer.animation ?? instance.def.animation,
        scale: layer.scale ?? instance.def.scale,
        blend: layer.blend ?? instance.def.blend,
        dom: layer.dom ?? (instance.def.layers ? undefined : instance.def.dom),
      },
      spawnOptions: layer.params ? { ...instance.spawnOptions, payload: { ...instance.spawnOptions.payload, ...layer.params } } : instance.spawnOptions,
      bornAt: instance.bornAt,
      expiresAt: instance.expiresAt,
      pulseCount: instance.pulseCount,
      lastPulseAt: instance.lastPulseAt,
      coalesceKey: undefined,
      position: applyOffset(instance.position, layer.offset),
      casterOffset: instance.casterOffset,
      targetScale: instance.targetScale,
    };
  }

  /**
   * `VFXManager` é um singleton de MÓDULO (sobrevive a qualquer remonte de
   * `VfxRoot`), mas os RENDERERS são criados dentro do `useEffect` de
   * `VfxRoot` — e React (StrictMode em dev, Fast Refresh, ou um remonte
   * real da `<Canvas>` em produção) pode desmontar e remontar esse efeito
   * a qualquer momento, trocando a instância do renderer por uma nova e
   * VAZIA. Sem isto, uma instância já viva (ex.: Safety Wall com
   * `expiresAt: Infinity`) sobrevive no `manager` mas nunca mais aparece na
   * tela — o renderer novo nunca soube que ela existia. Mesma categoria do
   * bug "StrictMode desligando o pathfinder" documentado em
   * `docs/claude-context/04-netcode-prediction-reconciliation.md`: React
   * remonta em dev, e código que não é resiliente a isso quebra calado.
   */
  registerRenderer(renderer: VfxRenderer): void {
    this.renderers.set(renderer.kind, renderer);
    if (!this.world) return;
    for (const entries of this.layerEntries.values()) {
      for (const entry of entries) {
        if (entry.runtime.def.renderer === renderer.kind) renderer.onInstanceCreate(entry.runtime, this.world);
      }
    }
  }

  unregisterRenderer(kind: string): void {
    this.renderers.delete(kind);
  }

  setWorldContext(world: VfxWorldContext): void {
    this.world = world;
  }

  private coalesceKeyFor(def: VfxDefinition, opts: VfxSpawnOptions): string | undefined {
    if (!def.coalesce) return undefined;
    if (def.coalesce.by === "target") {
      if (opts.targetGid === undefined) return undefined;
      return `${def.id}|target:${opts.targetGid}`;
    }
    if (!opts.cell) return undefined;
    return `${def.id}|cell:${opts.cell.x},${opts.cell.y}`;
  }

  /**
   * `play()` — nasce uma instância nova, OU (havendo `coalesce` e uma
   * instância viva na mesma chave, dentro da janela) alimenta a existente.
   * Item 14 do pedido: nunca N instâncias completas pro mesmo alvo/célula.
   */
  play(vfxId: string, opts: VfxSpawnOptions): VfxHandle | undefined {
    const def = getVfxDefinition(vfxId);
    if (!def || !this.world) return undefined;

    const coalesceKey = this.coalesceKeyFor(def, opts);
    if (coalesceKey) {
      const existingId = this.coalesceIndex.get(coalesceKey);
      const existing = existingId !== undefined ? this.instances.get(existingId) : undefined;
      if (existing && (existing.expiresAt === null || performance.now() < existing.expiresAt + def.coalesce!.windowMs)) {
        this.pulse({ instanceId: existing.instanceId, vfxId: existing.vfxId }, opts.payload);
        return { instanceId: existing.instanceId, vfxId: existing.vfxId };
      }
    }

    const instanceId = this.nextId++;
    const now = performance.now();
    const anchor = resolveAnchor(this.world, def.anchor, opts);
    const lifetimeMs = opts.durationMs ?? def.lifetimeMs;

    const instance: VfxInstanceRuntime = {
      instanceId,
      vfxId,
      def,
      spawnOptions: opts,
      bornAt: now,
      expiresAt: lifetimeMs !== undefined ? now + lifetimeMs : null,
      pulseCount: 1,
      lastPulseAt: now,
      coalesceKey,
      position: anchor.position,
      casterOffset: anchor.casterOffset,
      targetScale: anchor.targetScale,
    };

    this.instances.set(instanceId, instance);
    if (coalesceKey) this.coalesceIndex.set(coalesceKey, instanceId);
    markInstanceStart(instance);

    const entries: LayerEntry[] = layersFor(def).map((layer, i) => ({ layer, runtime: this.buildLayerRuntime(instance, layer, i) }));
    this.layerEntries.set(instanceId, entries);
    for (const entry of entries) this.renderers.get(entry.runtime.def.renderer)?.onInstanceCreate(entry.runtime, this.world);

    return { instanceId, vfxId };
  }

  /** hit adicional numa instância coalescida viva — estende a vida (se a
   * definição tiver `lifetimeMs`) e repassa o payload novo pra CADA camada
   * (`entry.layer.params` continua vencendo por cima do payload novo, mesma
   * regra de `buildLayerRuntime`). */
  pulse(handle: VfxHandle, payload?: VfxSpawnOptions["payload"]): void {
    const instance = this.instances.get(handle.instanceId);
    if (!instance || !this.world) return;
    const now = performance.now();
    instance.pulseCount++;
    instance.lastPulseAt = now;
    if (payload) instance.spawnOptions = { ...instance.spawnOptions, payload };
    if (instance.def.lifetimeMs !== undefined) instance.expiresAt = now + instance.def.lifetimeMs;
    markInstancePulse(instance);

    const entries = this.layerEntries.get(handle.instanceId);
    if (!entries) return;
    for (const entry of entries) {
      entry.runtime.pulseCount = instance.pulseCount;
      entry.runtime.lastPulseAt = instance.lastPulseAt;
      entry.runtime.expiresAt = instance.expiresAt;
      if (payload) entry.runtime.spawnOptions = entry.layer.params ? { ...instance.spawnOptions, payload: { ...payload, ...entry.layer.params } } : instance.spawnOptions;
      this.renderers.get(entry.runtime.def.renderer)?.onInstancePulse?.(entry.runtime, this.world);
    }
  }

  /** parada explícita (área do servidor mandando sumir — `skill:ground-gone`,
   * ou buff recastado antes do fim natural) — CANCELADA, não fim natural
   * (mesma distinção que `vfxStore.reset()`/recast de buff já fazem pro
   * caminho legado: `marcarVfxCancel`, não `marcarVfxEnd`). */
  stop(handle: VfxHandle, motivo = "stop"): void {
    this.destroy(handle.instanceId, "cancel", motivo);
  }

  private destroy(instanceId: number, reason: "natural" | "cancel" = "natural", motivo?: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    const entries = this.layerEntries.get(instanceId);
    if (entries) {
      for (const entry of entries) this.renderers.get(entry.runtime.def.renderer)?.onInstanceDestroy(entry.runtime);
      this.layerEntries.delete(instanceId);
    }
    if (reason === "cancel") markInstanceCancelled(instance, motivo ?? "stop");
    else markInstanceEnd(instance);
    this.instances.delete(instanceId);
    if (instance.coalesceKey && this.coalesceIndex.get(instance.coalesceKey) === instanceId) {
      this.coalesceIndex.delete(instance.coalesceKey);
    }
  }

  /** um `useFrame` por sessão (`VfxRoot`) chama isto — reposiciona quem
   * segue entidade/arma, poda quem expirou, e manda cada renderer ativo
   * fazer o flush do próprio quadro. */
  update(dt: number): void {
    if (!this.world) return;
    const now = performance.now();
    const toDestroy: number[] = [];
    const activeRendererKinds = new Set<string>();
    // `world.camera` ausente (testes com `{} as VfxWorldContext`) = culling
    // desligado, tudo sempre "visível" — nunca muda o comportamento de
    // quem não tem câmera de verdade pra testar contra.
    const cullingEnabled = Boolean(this.world.camera);
    if (cullingEnabled) updateFrustum(this.world.camera);

    // Budget (Fase 5, item 13) — recomputa só a cada N quadros (histerese
    // por espaçamento no tempo, ver docblock de `budgetExcludedIds` acima).
    // `budgetLimits.maxActiveInstances = Infinity` (padrão) faz
    // `selectExcluded` devolver sempre vazio — no-op até alguém calibrar.
    this.budgetTick++;
    if (this.budgetTick >= VFXManager.BUDGET_RECOMPUTE_INTERVAL_FRAMES) {
      this.budgetTick = 0;
      this.budgetExcludedIds = this.computeExcluded(this.buildBudgetCandidates());
    }

    // Instrumentação interna (Fase 5, rodada "decomposição do update" —
    // autorizada explicitamente pelo usuário, 2026-08-16). Cada bloco
    // cronometrado é um passo REAL do código abaixo, não um nome
    // inventado: `anchorMs` é exatamente a chamada a `resolveAnchor()`,
    // `cullingMs` é exatamente o teste de frustum + transição de
    // `setActive`, `domUpdateMs` é exatamente o laço que chama
    // `onInstanceUpdate` por camada. `iterationMs` é o que sobra do tempo
    // total do laço depois de subtrair os três — bookkeeping/iteração do
    // `Map`, não medido em separado (não força uma decomposição que o
    // código não tem). `performance.now()` extra por instância é o único
    // custo que esta instrumentação ADICIONA — pedido explícito desta
    // rodada, aceito como ruído desprezível frente ao que se mede.
    const loopStart = performance.now();
    let anchorMs = 0;
    let cullingMs = 0;
    let domUpdateMs = 0;

    for (const instance of this.instances.values()) {
      if (instance.expiresAt !== null && now >= instance.expiresAt) {
        toDestroy.push(instance.instanceId);
        continue;
      }
      if (instance.def.anchor === "entity" || instance.def.anchor === "caster-tip" || instance.def.anchor === "caster-to-target") {
        const freezeMs = instance.def.freezeAnchorAfterMs;
        const frozen = freezeMs !== undefined && now - instance.bornAt >= freezeMs;
        if (!frozen) {
          const anchorStart = performance.now();
          const resolved = resolveAnchor(this.world, instance.def.anchor, instance.spawnOptions);
          instance.position = resolved.position;
          // `caster-to-target` só resolve o offset UMA VEZ, no spawn (o caster
          // já lançou; o offset é fixo pro resto do voo) — nunca sobrescrever
          // aqui, senão o projétil "esquece" de onde partiu a cada quadro.
          if (instance.def.anchor !== "caster-to-target") instance.casterOffset = resolved.casterOffset;
          anchorMs += performance.now() - anchorStart;
        }
      }

      const entries = this.layerEntries.get(instance.instanceId);
      if (!entries) continue;

      // Frustum culling (Fase 5, item 11) — SÓ na TRANSIÇÃO (entrou/saiu da
      // câmera) chama `renderer.setActive?.()`; enquanto continuar fora,
      // `onInstanceUpdate` nem é chamado (o `continue` abaixo) — é assim
      // que o custo de CPU/raster some junto com o desenho, não só o
      // desenho (ver docblock de `setActive` em `rendererTypes.ts`).
      const cullStart = performance.now();
      const nowCulled = cullingEnabled && !passesFrustum(instance);
      if (nowCulled !== Boolean(instance.culled)) {
        for (const entry of entries) this.renderers.get(entry.runtime.def.renderer)?.setActive?.(entry.runtime, !nowCulled);
        instance.culled = nowCulled;
      }
      cullingMs += performance.now() - cullStart;
      if (nowCulled) continue;

      // Budget (item 13) — mesma forma da checagem de frustum acima, só
      // que a decisão em si (`budgetExcludedIds`) já veio pronta do
      // recompute periódico de cima; aqui só aplica a TRANSIÇÃO, com
      // estado PRÓPRIO (`instance.budgetExcluded`, nunca `instance.culled`).
      const nowBudgetExcluded = this.budgetExcludedIds.has(instance.instanceId);
      if (nowBudgetExcluded !== Boolean(instance.budgetExcluded)) {
        for (const entry of entries) this.renderers.get(entry.runtime.def.renderer)?.setActive?.(entry.runtime, !nowBudgetExcluded);
        instance.budgetExcluded = nowBudgetExcluded;
      }
      if (nowBudgetExcluded) continue;

      // Distance LOD (item 12) — classificação PURA, recomputada todo
      // quadro pra quem está visível; nenhum renderer lê isto ainda
      // (thresholds padrão = sempre "full", ver `lod.ts`).
      if (cullingEnabled) {
        _distVec.set(instance.position.x, instance.position.y, instance.position.z);
        instance.lod = lodTierFor(this.world.camera.position.distanceTo(_distVec), this.lodThresholds);
      }

      const elapsedMs = now - instance.bornAt;
      const domStart = performance.now();
      for (const entry of entries) {
        applyOffsetInto(entry.runtime.position, instance.position, entry.layer.offset);
        entry.runtime.casterOffset = instance.casterOffset;
        entry.runtime.targetScale = instance.targetScale;
        entry.runtime.lod = instance.lod;
        activeRendererKinds.add(entry.runtime.def.renderer);
        this.renderers.get(entry.runtime.def.renderer)?.onInstanceUpdate(entry.runtime, elapsedMs, this.world);
      }
      domUpdateMs += performance.now() - domStart;
    }
    const loopTotalMs = performance.now() - loopStart;
    const iterationMs = Math.max(0, loopTotalMs - anchorMs - cullingMs - domUpdateMs);

    for (const id of toDestroy) this.destroy(id);

    const flushStart = performance.now();
    for (const kind of activeRendererKinds) this.renderers.get(kind)?.flush(dt, this.world);
    // renderers sem instância ativa neste quadro ainda podem ter flush
    // pendente de um quadro anterior (ex.: transição de saída) — deixa cada
    // renderer decidir se tem o que fazer; custo de chamar flush(0 instâncias)
    // é o mesmo custo que `SkillVfx.tsx: prune()` já pagava todo quadro.
    for (const [kind, renderer] of this.renderers) {
      if (!activeRendererKinds.has(kind)) renderer.flush(dt, this.world);
    }
    const flushMs = performance.now() - flushStart;

    this.updateProfile.iterationMs += iterationMs;
    this.updateProfile.anchorMs += anchorMs;
    this.updateProfile.cullingMs += cullingMs;
    this.updateProfile.domUpdateMs += domUpdateMs;
    this.updateProfile.flushMs += flushMs;
    this.updateProfile.frames++;
  }

  /** acumulador da instrumentação interna acima — zerado por
   * `resetUpdateProfile()`, lido por `getUpdateProfile()`. Diagnóstico
   * puro: nunca influencia nenhuma decisão de renderização. */
  private updateProfile = { iterationMs: 0, anchorMs: 0, cullingMs: 0, domUpdateMs: 0, flushMs: 0, frames: 0 };

  resetUpdateProfile(): void {
    this.updateProfile = { iterationMs: 0, anchorMs: 0, cullingMs: 0, domUpdateMs: 0, flushMs: 0, frames: 0 };
  }

  getUpdateProfile(): { iterationMs: number; anchorMs: number; cullingMs: number; domUpdateMs: number; flushMs: number; frames: number } {
    return { ...this.updateProfile };
  }

  /** diagnóstico puro — repassa pro `DomRenderer` se ele estiver
   * registrado (`setDocumentAttached`, ver `rendererTypes.ts`). Sem-op nos
   * outros renderers, sem-op se `dom` não estiver registrado ainda. */
  setDomDocumentAttached(attached: boolean): void {
    this.renderers.get("dom")?.setDocumentAttached?.(attached);
  }

  /** quantas instâncias vivas agora — usado pelo benchmark/orçamento. */
  get activeCount(): number {
    return this.instances.size;
  }

  /** quantas instâncias vivas estão FORA do frustum agora (Fase 5, item 7
   * do pedido de escala: "comprovar que o frustum culling reduz trabalho
   * real, não só altera um contador interno" — este número é a evidência,
   * lido pelo benchmark antes/depois de mover câmera/espalhar players). */
  get culledCount(): number {
    let n = 0;
    for (const instance of this.instances.values()) if (instance.culled) n++;
    return n;
  }

  /** quantas instâncias vivas o budget está excluindo AGORA (aplicado, não
   * a leitura diagnóstica de `computeBudgetPressure()`) — mesmo espírito de
   * `culledCount`, pro benchmark provar que a exclusão é real. */
  get budgetExcludedCount(): number {
    return this.budgetExcludedIds.size;
  }

  getInstance(instanceId: number): VfxInstanceRuntime | undefined {
    return this.instances.get(instanceId);
  }

  listInstances(): readonly VfxInstanceRuntime[] {
    return [...this.instances.values()];
  }

  /** candidatos pra `selectExcluded()` — compartilhado entre o recompute
   * periódico de `update()` e `computeBudgetPressure()` (diagnóstico/teste),
   * mesma fonte de verdade pras duas chamadas. */
  /** soma `particleCount` de toda camada `particle` da definição (payload
   * do LAYER vence, senão o payload da instância, senão o default do
   * próprio renderer — MESMA cadeia de resolução que `ParticleRenderer.
   * onInstanceCreate` já usa, nunca uma segunda regra) + se alguma camada
   * é `renderer:"dom"`. Calculado a partir de `def`, não das camadas JÁ
   * expandidas em `layerEntries` — os dois têm a mesma contagem, mas isto
   * evita depender de `layerEntries` existir (candidatos são construídos
   * ANTES do laço principal do quadro). */
  private static shapeOf(def: VfxDefinition, payload: Record<string, unknown> | undefined): { particleCount: number; isDom: boolean } {
    let particleCount = 0;
    let isDom = false;
    for (const layer of layersFor(def)) {
      if (layer.renderer === "particle") {
        const raw = layer.params?.particleCount ?? payload?.particleCount;
        particleCount += typeof raw === "number" ? raw : DEFAULT_PARTICLE_COUNT;
      }
      if (layer.renderer === "dom") isDom = true;
    }
    return { particleCount, isDom };
  }

  private buildBudgetCandidates(): WeightedBudgetCandidate[] {
    const candidates: WeightedBudgetCandidate[] = [];
    if (!this.world?.camera) return candidates;
    for (const instance of this.instances.values()) {
      const sourceGid = instance.spawnOptions.sourceGid;
      const entity = sourceGid !== undefined ? useWorldStore.getState().entities[sourceGid] : undefined;
      _distVec.set(instance.position.x, instance.position.y, instance.position.z);
      const { particleCount, isDom } = VFXManager.shapeOf(instance.def, instance.spawnOptions.payload);
      candidates.push({
        instanceId: instance.instanceId,
        priority: priorityFor({
          sourceGid,
          localPlayerGid: this.localPlayerGid,
          sourceIsPlayer: entity?.kind === "player",
          distanceToCamera: this.world.camera.position.distanceTo(_distVec),
          nearDistance: this.nearDistance,
        }),
        vfxId: instance.vfxId,
        sourceGid,
        particleCount,
        isDom,
      });
    }
    return candidates;
  }

  /** aplica os 5 limites (Directive B: instâncias/partículas/DOM globais +
   * partículas por skill/por jogador) sobre os MESMOS candidatos — cada
   * limite decide sua própria exclusão (pior prioridade primeiro, `own`
   * nunca cai primeiro), o resultado final é a UNIÃO das 5 decisões. Um
   * limite em `Infinity` (padrão) nunca exclui ninguém — 100% no-op até
   * alguém calibrar por benchmark real, mesma regra que `maxActiveInstances`
   * já seguia sozinho. */
  private computeExcluded(candidates: readonly WeightedBudgetCandidate[]): Set<number> {
    const limits = this.budgetLimits;
    const excluded = new Set<number>();
    for (const id of selectExcludedByWeight(candidates, limits.maxActiveInstances, () => 1)) excluded.add(id);
    for (const id of selectExcludedByWeight(candidates, limits.maxActiveParticles, (c) => c.particleCount)) excluded.add(id);
    for (const id of selectExcludedByWeight(
      candidates.filter((c) => c.isDom),
      limits.maxDomInstances,
      () => 1,
    )) {
      excluded.add(id);
    }
    for (const id of selectExcludedGrouped(candidates, limits.maxParticlesPerSkill, (c) => c.particleCount, (c) => c.vfxId)) excluded.add(id);
    for (const id of selectExcludedGrouped(candidates, limits.maxParticlesPerPlayer, (c) => c.particleCount, (c) => c.sourceGid)) excluded.add(id);
    return excluded;
  }

  /**
   * Budget (Fase 5, item 13; Directive B, limites granulares) — leitura
   * DIAGNÓSTICA (benchmark/teste): "quem sairia agora". A decisão de
   * verdade, aplicada em `update()`, é `budgetExcludedIds` (recomputada a
   * cada `BUDGET_RECOMPUTE_INTERVAL_FRAMES` quadros, não a cada chamada) —
   * chamar isto não afeta o que está sendo desenhado.
   */
  computeBudgetPressure(): { excluded: Set<number>; totalActive: number } {
    const candidates = this.buildBudgetCandidates();
    return { excluded: this.computeExcluded(candidates), totalActive: candidates.length };
  }

  /** sessão/mapa trocou (mesmo evento que `vfxStore.reset()` reage) —
   * CANCELADA pra toda instância viva, nenhuma termina por conta própria. */
  reset(): void {
    for (const instance of this.instances.values()) {
      const entries = this.layerEntries.get(instance.instanceId);
      if (entries) for (const entry of entries) this.renderers.get(entry.runtime.def.renderer)?.onInstanceDestroy(entry.runtime);
      markInstanceCancelled(instance, "reset");
    }
    this.instances.clear();
    this.layerEntries.clear();
    this.coalesceIndex.clear();
    this.budgetExcludedIds.clear();
    this.budgetTick = 0;
  }
}

/** instância única do módulo — mesmo padrão dos outros stores do jogo
 * (`useVfxStore`, `useWorldStore`): um manager por sessão de cliente. */
export const vfxManager = new VFXManager();
