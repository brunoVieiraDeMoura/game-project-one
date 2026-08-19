import type * as THREE from "three";
import type { TerrainQuery } from "@ragnarok/engine-core";
import type { VfxLodTier } from "./lod";

/**
 * Contrato central do VFX Core (leia1.txt — padronização Skills/VFX).
 *
 * Uma `VfxDefinition` é a ÚNICA coisa que uma skill precisa registrar para
 * ter efeito visual. Ela nunca sabe COMO é desenhada (isso é o `renderer`);
 * o renderer nunca sabe QUAL skill está desenhando (recebe só a definição +
 * o payload da instância). Ver docblock de `manager.ts` para o fluxo
 * completo spawn → coalesce → renderer.
 */

/** quem sabe desenhar uma `VfxDefinition` — cada um é um módulo próprio em `renderers/*`.
 * `"cage"` (2026-08-19-x) — 6º renderer, gaiola 3D de arestas ao redor de uma
 * célula (ver `renderers/CageRenderer.ts` pro raciocínio completo: nenhum
 * dos outros 5 desenha forma 3D real, só billboards/decal de chão). */
export type VfxRendererKind = "sprite" | "particle" | "beam" | "ring" | "trail" | "cage" | "dom";

/** onde a instância nasce/segue — resolvido por `anchor.ts`, nunca pelo renderer. */
export type VfxAnchorKind =
  /** célula do servidor (`skill:ground`/cast no chão) — fixo, não segue entidade */
  | "cell"
  /** entidade viva (`gid`) — impacto no alvo, buff no caster, interpolado todo quadro */
  | "entity"
  /** ponta da arma equipada (`entities/weaponAnchors.anchorDeArma`), com fallback pro
   * centro da célula do caster enquanto a ponta real não resolve */
  | "caster-tip"
  /** offset local pré-calculado caster→alvo (mesma técnica de `casterOffset` em
   * `vfx/SkillVfx.tsx` hoje) — para projéteis que voam de um pro outro */
  | "caster-to-target";

export type VfxAnimationMode = "once" | "loop" | "pingpong";

/**
 * Playback de frames — usada pelo `renderer:"sprite"`/`"particle"` quando o
 * atlas existir (`assets/manifest.ts`). Enquanto não existe atlas nenhum
 * registrado para esta definição, `animation` fica documentado mas não tem
 * efeito (o `SpriteRenderer` cai no material placeholder de validação).
 */
export interface VfxAnimation {
  /** nomes de frame dentro do atlas (`assets/atlasTypes.ts: AtlasMetadata.frames`) */
  frames: string[];
  fps: number;
  mode: VfxAnimationMode;
}

/** janela + chave de coalescência — item 14 do pedido ("1 raio por mob
 * acertado", nunca N instâncias completas pro mesmo hit). */
export interface VfxCoalesceRule {
  by: "target" | "cell";
  /** pacote repetido dentro desta janela (ms) alimenta a instância viva em
   * vez de criar outra — ver `manager.ts: play()`. */
  windowMs: number;
}

/** o que uma definição pode emitir para FORA do próprio VFX — hoje só
 * números de dano, que saem do render de skill e vão para a camada DOM
 * compartilhada (`net/damageFeed`), preservando timing por hit. */
export interface VfxEmits {
  damageNumbers?: boolean;
}

/**
 * Arte DOM transitória (só para `renderer:"dom"`) — `art` é a chave
 * registrada em `vfx/css/legacyVfxArt.ts`. Renderer nunca importa CSS/JSX de
 * skill nenhuma diretamente: só pede pro registro "me dá o conteúdo pra este
 * `art`", o mesmo desacoplamento que o atlas terá quando existir.
 */
export interface VfxDomSpec {
  art: string;
}

export interface VfxScaleSpec {
  base: number;
  /** multiplica pelo `targetScale` resolvido em `anchor.ts` (tamanho visual
   * do alvo/caster, mesmo catálogo que `mobModel`/`classModelFor` já usam) */
  byTarget?: boolean;
}

/**
 * Fase 5 (leia1.txt item 7: "primitives genéricas, skill é composição, não
 * `OraclePrimitive`/`FireWallPrimitive`"). Uma `VfxDefinition` com `layers`
 * vira N sub-desenhos (ex.: Oracle = Ring + ParticleCloud + Sprite + Glow),
 * cada um roteado pro renderer de `layers[i].renderer` — o próprio renderer
 * nunca sabe que está desenhando "uma camada de uma skill composta", só
 * recebe o `VfxInstanceRuntime` de sempre (`manager.ts` monta uma view por
 * layer, os 5 renderers não mudam nada pra suportar isto).
 */
export interface VfxLayer {
  renderer: VfxRendererKind;
  /** sobrescreve o campo de mesmo nome da `VfxDefinition` pai só para este
   * layer — ausente = herda do pai (ex.: `blend` compartilhado entre todas
   * as camadas por padrão, sobrescrito só na que precisar). */
  atlas?: string;
  animation?: VfxAnimation;
  scale?: number | VfxScaleSpec;
  blend?: "additive" | "normal";
  /** obrigatório quando `renderer === "dom"`, ausente nos outros — mesma
   * regra do campo `dom` no nível de `VfxDefinition`. */
  dom?: VfxDomSpec;
  /** somado à posição resolvida da instância, em espaço de MUNDO (não
   * rotaciona com o alvo) — suficiente pro piloto da Fase 5, nenhuma das 3
   * composições precisa de offset local rotacionado. */
  offset?: readonly [number, number, number];
  /** mesclado por cima de `VfxSpawnOptions.payload` só para este layer —
   * cada renderer já lê parâmetros do payload (radius/particleCount/color/
   * mode/width/height...), nenhum campo novo no Core precisa nascer aqui. */
  params?: Record<string, unknown>;
}

export interface VfxDefinition {
  id: string;
  renderer: VfxRendererKind;
  /** chave em `assets/manifest.ts` — ausente enquanto não há atlas definitivo
   * pra este VFX (ver invariante leia1.txt: nunca inventar caminho). */
  atlas?: string;
  animation?: VfxAnimation;
  /** ausente = vive até `manager.stop()` explícito (área do servidor, buff) */
  lifetimeMs?: number;
  blend?: "additive" | "normal";
  billboard?: boolean;
  scale?: number | VfxScaleSpec;
  anchor: VfxAnchorKind;
  /** só para `anchor:"entity"`/`"caster-to-target"` — passado esse tanto de
   * ms desde `bornAt`, o manager PARA de re-resolver `position`/
   * `casterOffset` a cada quadro (fica congelado no último valor
   * resolvido). `0` = congela já no spawn (efeito nasce em cima do alvo,
   * sem fase de voo). Ausente = comportamento de sempre, resolve todo
   * quadro pra sempre. Existe pra desacoplar um efeito de dano do
   * lifecycle do alvo DEPOIS que o hit aconteceu (auditoria multi-hit
   * 2026-08-17): se o mob morrer/sumir/respawnar no meio da animação, o
   * efeito já congelado não segue o sentinela `{0,-999,0}` de
   * `anchor.ts` nem salta pra uma entidade nova que reuse o gid. */
  freezeAnchorAfterMs?: number;
  offset?: readonly [number, number, number];
  followTerrain?: boolean;
  coalesce?: VfxCoalesceRule;
  emits?: VfxEmits;
  /** obrigatório quando `renderer === "dom"`, ausente nos outros */
  dom?: VfxDomSpec;
  /** composição multi-renderer (Fase 5) — ausente/vazio = comportamento de
   * sempre, `renderer`/`atlas`/`animation`/`scale`/`blend`/`dom` do nível
   * top são a ÚNICA camada (as 5 defs migradas na Fase 3 e as 15 famílias
   * legadas não mudam nenhuma linha por causa deste campo). */
  layers?: VfxLayer[];
}

/** o que quem dispara um VFX passa — nunca a definição inteira, só o que
 * varia por CAST (posição/alvo/payload de gameplay). */
export interface VfxSpawnOptions {
  position?: { x: number; y: number; z: number };
  targetGid?: number;
  sourceGid?: number;
  cell?: { x: number; y: number };
  scale?: number;
  rotation?: number;
  durationMs?: number;
  /** skillId de rede que disparou este VFX — só pra INSTRUMENTAÇÃO
   * (`core/diagnostics/vfxProbe.ts`, resolve nome/aegis do catálogo); o
   * Core nunca usa isto pra decidir renderização, só pra relatório. */
  skillId?: number;
  /** dados de gameplay que o renderer/emits precisa (dano, crit, hits...) —
   * opaco para o Core, cada `VfxDefinition` documenta o formato esperado. */
  payload?: Record<string, unknown>;
}

/** contexto de mundo que `anchor.ts` precisa para resolver qualquer posição
 * — injetado pelo `VfxRoot` a cada frame (o mesmo que `SkillVfx.tsx` recebia
 * via props: `map`/`mapping`/`cellSize`/`terrain`). */
export interface VfxWorldContext {
  map: import("@ragnarok/map-format").GameMap;
  mapping: import("../../net/legacyCells").LegacyMapping;
  cellSize: number;
  terrain: TerrainQuery;
  /** câmera ativa — Fase 5 (frustum culling por instância, item 11 do
   * pedido: culling tem que viver no `manager`, nunca dentro de um
   * renderer). `VfxRoot.tsx` já tinha acesso via `useThree`, só não
   * repassava pra cá antes. */
  camera: THREE.Camera;
}

/** handle opaco devolvido por `manager.play()` — quem chama só usa para
 * `stop()`/`pulse()`, nunca inspeciona o conteúdo. */
export interface VfxHandle {
  readonly instanceId: number;
  readonly vfxId: string;
}

/** ponto de mundo — tipo compartilhado entre `types.ts`/`anchor.ts`/
 * `manager.ts` (evita ciclo de import: `anchor.ts` reexporta este como
 * `WorldPoint` pra quem já usava esse nome). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** estado runtime de UMA instância viva — interno ao manager; exportado
 * para os renderers lerem (nunca escrevem, exceto campos do próprio renderer). */
export interface VfxInstanceRuntime {
  instanceId: number;
  vfxId: string;
  def: VfxDefinition;
  spawnOptions: VfxSpawnOptions;
  bornAt: number;
  expiresAt: number | null;
  /** incrementado a cada `pulse()` — quem desenha (ex.: Thunder Storm) usa
   * para saber quantos hits já chegaram nesta instância coalescida */
  pulseCount: number;
  lastPulseAt: number;
  /** chave de coalescência já resolvida (`vfxId|target:<gid>` ou
   * `vfxId|cell:<x>,<y>`) — `undefined` quando a definição não coalesce */
  coalesceKey?: string;
  /** posição de mundo resolvida — fixa no spawn para `anchor:"cell"`,
   * recalculada todo quadro pelo manager para os outros três tipos */
  position: Vec3;
  /** offset local caster→alvo, resolvido uma vez no spawn — só para
   * `anchor:"caster-to-target"`; `null` nos demais/sem dado de caster */
  casterOffset: Vec3 | null;
  targetScale: number;
  /** slot que o renderer responsável usa para escrever atributos por
   * instância (índice no InstancedMesh, nó DOM, etc.) — opaco ao manager */
  rendererSlot?: unknown;
  /** frustum culling (Fase 5, item 11) — SÓ o `manager` escreve isto, e só
   * na transição; `renderer.setActive?.()` já foi chamado quando este flag
   * mudou. `undefined`/`false` = visível. */
  culled?: boolean;
  /** distance LOD (Fase 5, item 12, `lod.ts`) — recomputado TODO quadro,
   * sem custo condicional (é só uma classificação, não liga/desliga nada).
   * Nenhum renderer consome isto ainda (thresholds padrão = sempre "full",
   * ver `lod.ts` docblock) — campo pronto pra uma migração futura ler. */
  lod?: VfxLodTier;
  /** budget (Fase 5, item 13, `budget.ts`) — estado PRÓPRIO, separado de
   * `culled`, de propósito: as duas razões de "não desenhar agora" nunca
   * podem brigar sobre reativar a mesma instância no mesmo quadro (risco
   * de flapping documentado em `manager.ts: computeBudgetPressure()`).
   * `undefined`/`false` = dentro do orçamento. Só o `manager` escreve. */
  budgetExcluded?: boolean;
}
