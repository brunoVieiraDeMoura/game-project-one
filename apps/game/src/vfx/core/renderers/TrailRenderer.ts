import * as THREE from "three";
import type { VfxInstanceRuntime, VfxWorldContext } from "../types";
import { InstancedBillboardBase } from "./instancedBillboardBase";
import { computeFlightOffset } from "./flightOffset";
import { computeCurveOffset } from "./curveOffset";
import { computeOrbitOffset } from "./orbitOffset";
import { computeDropOffset } from "./dropOffset";
import { createSeededRng } from "../particleMath";

/**
 * `renderer:"trail"` — rastro atrás de uma instância em movimento, N slots
 * do MESMO `InstancedMesh` compartilhado (Fase 5, rodada "reestruturar VFX
 * pra escala", leia1.txt item 9: "conseguimos reproduzir o rastro atual com
 * instâncias GPU sem criar DOM por segmento?"). Reusa `InstancedBillboardBase`
 * — a mesma base de `SpriteRenderer`/`ParticleRenderer` — em vez de um
 * sistema próprio: um trail é, na prática, N partículas cuja posição segue
 * uma HISTÓRIA de onde a instância esteve, não uma distribuição radial.
 *
 * Equivalente GPU de `core/primitives/trailDom.tsx: TrailEchoes` (que hoje
 * cria N `<Html>`/`<svg>` — um por eco, DOM real). Aqui não existe nó DOM
 * nenhum por segmento: a "história" é um array JS de posições por
 * instância, os slots são buffer de `InstancedMesh`.
 *
 * Culling/budget já chegam até a simulação de graça: `manager.update()` só
 * chama `onInstanceUpdate` (onde a história avança) pra instância NÃO
 * culled/NÃO excluída por budget (ver `manager.ts`) — instância fora da
 * câmera ou cortada por orçamento simplesmente para de empurrar história
 * nova, sem precisar de nenhuma lógica extra aqui. LOD (`instance.lod`,
 * escrito pelo manager pra quem está visível) reduz quantos dos slots
 * alocados ficam ATIVOS — os slots em excesso continuam existindo (mesma
 * contagem alocada na criação, nunca realoca em runtime) só ficam
 * `writeInactiveSlot`.
 */
interface TrailPoint {
  x: number;
  y: number;
  z: number;
}

const DEFAULT_TRAIL_LENGTH = 8;
/** quantos pontos crus de posição guardar antes de descartar o mais velho
 * — maior que `trailLength` de propósito, pra decimar (amostrar uniforme)
 * em vez de só pegar os N mais recentes (rastro mais suave a baixo fps). */
const HISTORY_CAP = 32;

const _color = new THREE.Color();

export class TrailRenderer extends InstancedBillboardBase {
  readonly kind = "trail";
  private readonly slots = new Map<number, number[]>();
  private readonly history = new Map<number, TrailPoint[]>();

  constructor(group: THREE.Group) {
    super(group);
  }

  onInstanceCreate(instance: VfxInstanceRuntime): void {
    const length = Math.max(1, Number(instance.spawnOptions.payload?.trailLength ?? DEFAULT_TRAIL_LENGTH));
    const indices = Array.from({ length }, () => this.acquireSlot().index);
    this.slots.set(instance.instanceId, indices);
    this.history.set(instance.instanceId, []);
    this.trySyncAtlas(instance.def);
    this.writeFromInstance(instance, 0);
  }

  // REVERTIDO (rodada "Fire Ball saindo estranho"/"Soul Strike sumiu"): a
  // gravação em intervalo FIXO (tentativa de deixar o trail do Oráculo mais
  // uniforme) trocava 1-ponto-por-quadro por 1-ponto-por-~16,7ms — em
  // qualquer client rodando ACIMA de 60fps isso reduz a resolução real da
  // história (menos pontos gravados que quadros renderizados), lendo como
  // rastro mais picado/pobre pra QUALQUER skill com `trail` (Fire Ball, Fire
  // Lance, Cold Bolt, Soul Strike) — risco genérico grande demais pro
  // benefício, que já foi resolvido pro Oráculo de outro jeito (Hz/fase
  // diferente por caveira). Volta a gravar 1 ponto por CHAMADA, como sempre.
  onInstanceUpdate(instance: VfxInstanceRuntime, elapsedMs: number, world: VfxWorldContext): void {
    const hist = this.history.get(instance.instanceId);
    if (!hist) return;
    // "voo" (Fire Ball etc.) desloca a posição LOCAL sem mexer na âncora —
    // a história tem que seguir a bola voando, não o ponto fixo do alvo
    // (mesmo helper genérico que Sprite/Particle usam, ver `flightOffset.ts`).
    const flight = computeFlightOffset(instance, elapsedMs);
    const curve = computeCurveOffset(instance, elapsedMs);
    const orbit = computeOrbitOffset(instance, elapsedMs, world);
    const drop = computeDropOffset(instance, elapsedMs);
    hist.push({
      x: instance.position.x + flight.x + curve.x + orbit.x + drop.x,
      y: instance.position.y + flight.y + curve.y + orbit.y + drop.y,
      z: instance.position.z + flight.z + curve.z + orbit.z + drop.z,
    });
    if (hist.length > HISTORY_CAP) hist.shift();
    this.writeFromInstance(instance, elapsedMs);
  }

  onInstanceDestroy(instance: VfxInstanceRuntime): void {
    const indices = this.slots.get(instance.instanceId);
    if (indices) for (const index of indices) this.releaseSlot({ index });
    this.slots.delete(instance.instanceId);
    this.history.delete(instance.instanceId);
  }

  setActive(instance: VfxInstanceRuntime, active: boolean): void {
    if (active) return; // religa sozinho no próximo onInstanceUpdate
    const indices = this.slots.get(instance.instanceId);
    if (!indices) return;
    for (const index of indices) this.writeInactiveSlot(index);
  }

  /** slots ALOCADOS nunca mudam (fixados na criação); só quantos ficam
   * ATIVOS varia com LOD — mesmo espírito de reduzir partícula/frequência
   * por tier sem realocar buffer (item 12 do pedido original). Thresholds
   * de LOD continuam `Infinity` (nunca calibrados nesta investigação — ver
   * `lod.ts`), então isto é um no-op hoje; fica pronto pra quando alguém
   * calibrar. */
  private activeCountFor(instance: VfxInstanceRuntime, allocated: number): number {
    if (instance.lod === "core") return Math.max(2, Math.round(allocated / 4));
    if (instance.lod === "reduced") return Math.max(2, Math.round(allocated / 2));
    return allocated;
  }

  /** `payload.trailNoiseAmt` (Oracle, pedido "ruído melhor") — pequena
   * variação de escala/opacidade POR SEGMENTO, seedada por
   * `instance.instanceId` + índice do segmento (determinística, mesmo
   * princípio de `ParticleRenderer`/`idleFlicker.ts`) e animada devagar por
   * `elapsedMs` — cada bolinha de rastro "cintila" um pouco em vez de
   * parecer um arco geométrico perfeitamente liso. `0`/ausente = sem ruído
   * nenhum, mesmo comportamento de sempre (Fire Ball/Fire Lance/Cold Bolt
   * nunca passam este campo). */
  private noiseMulFor(instance: VfxInstanceRuntime, i: number, elapsedMs: number): number {
    const amt = Number(instance.spawnOptions.payload?.trailNoiseAmt ?? 0);
    if (amt <= 0) return 1;
    const rnd = createSeededRng(instance.instanceId * 733 + i * 131 + 1);
    const phase = rnd() * Math.PI * 2;
    const hz = 1.4 + rnd() * 0.9;
    const wave = Math.sin((elapsedMs / 1000) * Math.PI * 2 * hz + phase);
    return 1 + wave * amt;
  }

  private writeFromInstance(instance: VfxInstanceRuntime, elapsedMs: number): void {
    const indices = this.slots.get(instance.instanceId);
    const hist = this.history.get(instance.instanceId);
    if (!indices || !hist) return;

    const scaleSpec = instance.def.scale;
    const baseScale = typeof scaleSpec === "number" ? scaleSpec : (scaleSpec?.base ?? 0.3);
    const colorHex = instance.spawnOptions.payload?.color;
    let color: readonly [number, number, number] | undefined;
    if (typeof colorHex === "string") {
      _color.set(colorHex);
      color = [_color.r, _color.g, _color.b];
    }

    const activeCount = this.activeCountFor(instance, indices.length);
    // "crítico = maior", mesmo campo universal que `SpriteRenderer`/
    // `ParticleRenderer` já leem (auditoria "Hit VFX genérico" 2026-08-19).
    const critScale = instance.spawnOptions.scale ?? 1;

    for (let i = 0; i < indices.length; i++) {
      const index = indices[i]!;
      if (i >= activeCount || hist.length === 0) {
        this.writeInactiveSlot(index);
        continue;
      }
      // amostra a história do ponto mais RECENTE (i=0, cabeça do rastro)
      // pro mais ANTIGO (i=activeCount-1, cauda) — decimando uniformemente
      // quando a história tem mais pontos crus do que slots pra desenhar
      // (mesmo princípio de `TrailEchoes`/`ECHO_LAG`, agora sem DOM).
      const t = activeCount <= 1 ? 0 : i / (activeCount - 1);
      const histIndex = Math.max(0, hist.length - 1 - Math.round(t * (hist.length - 1)));
      const p = hist[histIndex]!;
      const fade = 1 - t;
      const noiseMul = this.noiseMulFor(instance, i, elapsedMs);
      this.writeSlot(index, {
        position: [p.x, p.y, p.z],
        scale: baseScale * (0.4 + 0.6 * fade) * critScale * noiseMul,
        opacity: fade * Math.max(0, noiseMul),
        color,
      });
    }
  }
}
