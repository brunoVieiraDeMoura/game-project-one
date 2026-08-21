import type * as THREE from "three";
import type { VfxInstanceRuntime, VfxWorldContext } from "../types";

/**
 * Interface comum a TODO renderer do Core (item 9 do pedido:
 * `VFXManager.play/stop/update/destroy` do lado de fora; do lado de dentro,
 * cada renderer só implementa este contrato). `SpriteRenderer`,
 * `ParticleRenderer`, `BeamRenderer`, `RingRenderer` e `DomRenderer`
 * implementam o MESMO shape — o manager nunca sabe qual é qual além de
 * rotear pela `def.renderer`.
 */
export interface VfxRenderer {
  readonly kind: string;
  /** instância nova entrou em cena — aloca/associa o slot (índice de
   * `InstancedMesh`, nó DOM...) via `pool.ts`. */
  onInstanceCreate(instance: VfxInstanceRuntime, world: VfxWorldContext): void;
  /** posição/estado já recalculados pelo manager para este quadro — o
   * renderer só ESCREVE o resultado no seu próprio buffer/DOM. */
  onInstanceUpdate(instance: VfxInstanceRuntime, elapsedMs: number, world: VfxWorldContext): void;
  /** pulso de coalescência (`manager.pulse()`) — hit adicional na MESMA
   * instância (item 14: Thunder Storm, 1 raio, N pulsos). */
  onInstancePulse?(instance: VfxInstanceRuntime, world: VfxWorldContext): void;
  /**
   * Frustum culling por instância (Fase 5, item 11 do pedido) — chamado
   * pelo `manager` SÓ na transição (entrou/saiu da câmera), nunca todo
   * quadro. `active:false`: renderer esconde a instância pelo jeito mais
   * barato que tiver (scale=0 num slot de `InstancedMesh`, `mesh.visible
   * = false`, `display:none` num nó DOM) — NUNCA chama `onInstanceUpdate`
   * enquanto inativa, então o custo de CPU (React/JS/raster no caso do
   * `DomRenderer`) também some, não só o desenho. `active:true`: só
   * precisa religar a visibilidade — o próximo `onInstanceUpdate` (que o
   * manager volta a chamar normalmente) reescreve o estado real. Opcional:
   * um renderer sem isto simplesmente continua desenhando o último estado
   * escrito enquanto culled (`onInstanceUpdate` parado economiza CPU, mas
   * não o desenho) — melhor que nada, não é erro não implementar.
   */
  setActive?(instance: VfxInstanceRuntime, active: boolean): void;
  /** instância saiu de cena — libera o slot de volta pro pool. */
  onInstanceDestroy(instance: VfxInstanceRuntime): void;
  /** uma vez por quadro, DEPOIS de todo `onInstanceUpdate` — flush de
   * buffers (`needsUpdate` do `InstancedMesh`, projeção do `DomRenderer`). */
  flush(dt: number, world: VfxWorldContext): void;
  dispose(): void;
  /**
   * Garante que mesh/material do renderer já existam na cena ANTES do
   * primeiro `onInstanceCreate` real — só precisa disto quem constrói o
   * pool sob demanda (`Ring`/`Cage`: `acquire()` só monta o primeiro
   * `buildEntry()` no primeiro cast de verdade). `Sprite`/`Particle`/
   * `Trail`/`Beam` já criam mesh+material no PRÓPRIO construtor
   * (`ensureCapacity(initialCapacity)`), então não implementam isto.
   *
   * Chamado pelo `VfxRoot` uma vez por geração de renderer, ANTES de
   * `gl.compileAsync()` — é o que garante que o pool tenha pelo menos 1
   * entrada real (mesh no grupo) pro `compileAsync` encontrar via
   * `scene.traverse()`. Não ativa nada visível — o entry criado aqui só
   * existe INVISÍVEL no `pool`, disponível pro primeiro `onInstanceCreate`
   * de verdade reusar (mesmo caminho de `acquire()` de sempre).
   */
  warm?(): void;
  /** diagnóstico puro (Fase 5, "React/DOM persistent tree isolation") —
   * só `DomRenderer` implementa; desconecta/reconecta a árvore do
   * `document` sem desmontar React, pra o benchmark isolar custo de
   * layout/paint de uma árvore conectada vs só manter JS/React rodando.
   * Nunca chamado fora de `/vfx-bench`. */
  setDocumentAttached?(attached: boolean): void;
}

/** contexto opcional que renderers que tocam a cena R3F recebem do
 * `VfxRoot` na construção (scene/camera/gl/size) — `SpriteRenderer` etc.
 * usam pra montar `InstancedMesh`; `DomRenderer` usa pra projetar pixel. */
export interface VfxRendererContext {
  scene: THREE.Scene;
  camera: THREE.Camera;
  size: { width: number; height: number };
}
