import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { vfxManager } from "../../core/manager";
import { defineVfx, resetVfxRegistry } from "../../core/registry";
import { spawnGhostDomeBlock } from "./ghostDomeBlockReaction";
import { GHOST_DOME_BLOCK_GPU_DEF, GHOST_DOME_BLOCK_VFX_ID } from "./ghostDomeBlockVfxDefGpu";
import type { VfxInstanceRuntime, VfxWorldContext } from "../../core/types";
import type { VfxRenderer } from "../../core/renderers/rendererTypes";

const world = { cellSize: 2 } as VfxWorldContext;

interface Created {
  id: number;
  vfxId: string;
  sourceGid?: number;
  targetGid?: number;
  scale?: number;
}

function mockRenderer(kind: string): VfxRenderer & { created: Created[] } {
  const created: Created[] = [];
  return {
    kind,
    created,
    onInstanceCreate(instance: VfxInstanceRuntime) {
      created.push({
        id: instance.instanceId,
        vfxId: instance.vfxId,
        sourceGid: instance.spawnOptions.sourceGid,
        targetGid: instance.spawnOptions.targetGid,
        scale: instance.spawnOptions.scale,
      });
    },
    onInstanceUpdate() {},
    onInstancePulse() {},
    onInstanceDestroy() {},
    setActive() {},
    flush() {},
    dispose() {},
  };
}

/**
 * Cúpula Fantasma — reação de bloqueio (2026-08-20, arquitetura final).
 *
 * `spawnGhostDomeBlock` reage exclusivamente ao evento AUTORITATIVO do
 * servidor (`ghost-dome-block`, `rathena-patches/0001` —
 * `battle_calc_weapon_attack()` decrementa a carga e notifica ANTES do
 * hit/miss ser decidido, então HIT e MISS consomem igual). Não existe mais
 * heurística "miss + célula" no client — a suíte antiga que testava isso
 * (`trackGhostDomeUnit`/`cellHasActiveWall`/`spawnGhostDomeBlockIfInside`)
 * foi removida junto com o código que testava, não só desativada.
 *
 * O contador de cargas é responsabilidade do SERVIDOR — por isso nenhum
 * teste aqui verifica "quantas cargas restam"; `remainingHits` do evento é
 * só log/diagnóstico (ver doc de `spawnGhostDomeBlock`), nunca decide nada
 * client-side.
 */
describe("ghost-dome/ghostDomeBlockReaction — spawnGhostDomeBlock (evento autoritativo)", () => {
  let sprite: ReturnType<typeof mockRenderer>;

  beforeEach(() => {
    resetVfxRegistry();
    // `ghostDomeBlockReaction.ts` já registrou isto no module-load (import
    // side-effect, uma vez só) — `resetVfxRegistry()` apaga o catálogo
    // inteiro a cada teste, então precisa re-registrar aqui (mesmo padrão
    // de `fireLanceMultiHit.test.ts: defineVfx(fireLanceProjectileGpuDef)`).
    defineVfx(GHOST_DOME_BLOCK_GPU_DEF);
    vfxManager.reset();
    sprite = mockRenderer("sprite");
    vfxManager.setWorldContext(world);
    vfxManager.registerRenderer(sprite);
  });

  afterEach(() => {
    vfxManager.unregisterRenderer("sprite");
  });

  function countCreated(): number {
    return sprite.created.filter((c) => c.vfxId === GHOST_DOME_BLOCK_VFX_ID).length;
  }

  // `GHOST_DOME_BLOCK_GPU_DEF` desenha em 2 sprite layers (flash + rim,
  // `ghostDomeBlockVfxDefGpu.tsx`) — cada `vfxManager.play()` cria 1
  // instância POR LAYER (arte, não um bug de disparo duplicado). Medido do
  // próprio manager em vez de cravar "2" aqui, pra não quebrar se a arte
  // ganhar/perder uma layer no futuro. "1 evento = 1 VFX" nos testes abaixo
  // significa "1 evento = instancesPerEvent instâncias" (1 efeito visual
  // composto de N layers, não N efeitos independentes).
  let instancesPerEvent = 0;

  beforeEach(() => {
    spawnGhostDomeBlock({ sourceGid: -999, targetGid: -998, remainingHits: 0, wasHit: false });
    instancesPerEvent = countCreated();
    sprite.created.length = 0;
  });

  it("1 evento ghost-dome-block → exatamente 1 VFX (nunca dobra por chamada extra)", () => {
    spawnGhostDomeBlock({ sourceGid: -1, targetGid: 1, remainingHits: 10, wasHit: false });
    expect(countCreated()).toBe(instancesPerEvent);
  });

  it("sourceGid/targetGid do evento chegam corretos em TODAS as instâncias criadas", () => {
    spawnGhostDomeBlock({ sourceGid: -7, targetGid: 42, remainingHits: 3, wasHit: false });
    const created = sprite.created.filter((c) => c.vfxId === GHOST_DOME_BLOCK_VFX_ID);
    expect(created.length).toBeGreaterThan(0);
    for (const c of created) {
      expect(c.sourceGid).toBe(-7);
      expect(c.targetGid).toBe(42);
    }
  });

  it("11 eventos → 11 VFX (HIT ou MISS não importa aqui — o servidor já decidiu)", () => {
    for (let i = 10; i >= 0; i--) {
      spawnGhostDomeBlock({ sourceGid: -1, targetGid: 1, remainingHits: i, wasHit: i % 2 === 0 });
    }
    expect(countCreated()).toBe(11 * instancesPerEvent);
  });

  it("não existe verificação de célula/parede — o evento sozinho já basta", () => {
    // nenhuma célula rastreada em lugar nenhum deste teste — mesmo assim dispara.
    spawnGhostDomeBlock({ sourceGid: -2, targetGid: 5, remainingHits: 0, wasHit: false });
    expect(countCreated()).toBe(instancesPerEvent);
  });

  it("wasHit:true escala o VFX MAIOR que wasHit:false ('mais visibilidade pra defesa do impacto')", () => {
    spawnGhostDomeBlock({ sourceGid: -3, targetGid: 6, remainingHits: 5, wasHit: false });
    const missScale = sprite.created.find((c) => c.vfxId === GHOST_DOME_BLOCK_VFX_ID)?.scale;
    sprite.created.length = 0;

    spawnGhostDomeBlock({ sourceGid: -3, targetGid: 6, remainingHits: 4, wasHit: true });
    const hitScale = sprite.created.find((c) => c.vfxId === GHOST_DOME_BLOCK_VFX_ID)?.scale;

    expect(missScale).toBe(1);
    expect(hitScale).toBeGreaterThan(missScale!);
  });
});
