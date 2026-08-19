import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { vfxManager } from "../core/manager";
import { useWorldStore } from "../../net/worldStore";
import { COMBAT_HIT_VFX_ID, spawnCombatHitVfx, spawnCombatHitImpacts, BASIC_ATTACK_MULTI_STAGGER_MS } from "./combatHitVfx";
import { clearPendingMultiHitShards, shardColorForElement } from "../mage/multiHitShardImpact";
import { classifyHit } from "../core/hitVfxResolver";
import type { VfxInstanceRuntime, VfxWorldContext } from "../core/types";
import type { VfxRenderer } from "../core/renderers/rendererTypes";

// mesmo stub de `multiHitShardImpact.test.ts`/`manager.test.ts` — célula
// (x,y) vira mundo (x,0,y), determinístico, sem GameMap real.
vi.mock("../../net/legacyCells", () => ({
  cellToWorld: (_map: unknown, _mapping: unknown, x: number, y: number) => ({ x, y: 0, z: y }),
}));

const world = {} as VfxWorldContext; // sem câmera = culling desligado

interface Created {
  id: number;
  kind: string;
  position: { x: number; y: number; z: number };
  scale?: number;
  color?: unknown;
  particleCount?: unknown;
}

function mockRenderer(kind: string): VfxRenderer & { created: Created[] } {
  const created: Created[] = [];
  return {
    kind,
    created,
    onInstanceCreate(instance: VfxInstanceRuntime) {
      created.push({
        id: instance.instanceId,
        kind,
        position: { ...instance.position },
        scale: instance.spawnOptions.scale,
        color: instance.spawnOptions.payload?.color,
        particleCount: instance.spawnOptions.payload?.particleCount,
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
 * Combat Hit VFX genérico (auditoria "fechar Normal/Single/Critical",
 * 2026-08-19) — mesma técnica de teste de `multiHitShardImpact.test.ts`:
 * `defineVfx(COMBAT_HIT_VFX_ID,...)` já rodou no import estático do
 * módulo, os testes só registram renderers-espião (`sprite`/`particle`) e
 * verificam o que CADA CAMADA recebeu.
 */
describe("vfx/combat/combatHitVfx — Combat Hit VFX genérico (ataque básico)", () => {
  let sprite: ReturnType<typeof mockRenderer>;
  let particle: ReturnType<typeof mockRenderer>;

  beforeEach(() => {
    useWorldStore.setState({ entities: {}, gids: [], target: null });
    vfxManager.reset();
    sprite = mockRenderer("sprite");
    particle = mockRenderer("particle");
    vfxManager.setWorldContext(world);
    vfxManager.registerRenderer(sprite);
    vfxManager.registerRenderer(particle);
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearPendingMultiHitShards();
    vfxManager.unregisterRenderer("sprite");
    vfxManager.unregisterRenderer("particle");
    vi.useRealTimers();
  });

  it("COMBAT_HIT_VFX_ID é um id próprio, nunca o losango de Cold Bolt/Fire Lance", () => {
    expect(COMBAT_HIT_VFX_ID).toBe("combat_hit_vfx");
    expect(COMBAT_HIT_VFX_ID).not.toBe("generic_hit_shard");
  });

  it("NORMAL (não crítico): 1 sprite, escala neutra, ZERO partículas — custo mínimo", () => {
    useWorldStore.getState().spawn({ gid: 1, kind: "mob", job: 1002, x: 2, y: 2, dir: 0, speed: 150 });
    spawnCombatHitVfx({ targetGid: 1, color: shardColorForElement(undefined), critical: false });
    expect(sprite.created.length).toBe(1);
    expect(sprite.created[0]!.scale).toBe(1);
    // camada particle SEMPRE cria a instância-layer (mesmo def, 2 camadas),
    // mas com particleCount=0 — custo real fica com `ParticleRenderer` (0
    // specs = 0 slots), não com este mock (que só registra o payload).
    expect(particle.created.length).toBe(1);
    expect(particle.created[0]!.particleCount).toBe(0);
  });

  it("SINGLE_HIT (skill hipotética sem receita própria, count=1): mesmo mecanismo do NORMAL", () => {
    useWorldStore.getState().spawn({ gid: 2, kind: "mob", job: 1002, x: 5, y: 5, dir: 0, speed: 150 });
    const c = classifyHit(1, 1, false);
    expect(c.multiplicity).toBe("single");
    spawnCombatHitVfx({ targetGid: 2, color: shardColorForElement("fire"), critical: false });
    expect(sprite.created.length).toBe(1);
    expect(sprite.created[0]!.color).toBe("#ff9d3a");
  });

  it("CRITICAL: mesma def, escala maior + burst de partículas (nunca uma composição nova)", () => {
    useWorldStore.getState().spawn({ gid: 3, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnCombatHitVfx({ targetGid: 3, color: "#fff", critical: true });
    expect(sprite.created.length).toBe(1);
    expect(sprite.created[0]!.scale).toBeGreaterThan(1);
    expect(particle.created[0]!.particleCount).toBeGreaterThan(0);
  });

  it("MULTI_HIT count=2: 2 impactos, espaçados por BASIC_ATTACK_MULTI_STAGGER_MS", () => {
    useWorldStore.getState().spawn({ gid: 4, kind: "mob", job: 1002, x: 1, y: 1, dir: 0, speed: 150 });
    spawnCombatHitImpacts({ targetGid: 4, hits: 2, color: "#fff", critical: false });
    expect(sprite.created.length).toBe(1);
    vi.advanceTimersByTime(BASIC_ATTACK_MULTI_STAGGER_MS);
    expect(sprite.created.length).toBe(2);
  });

  it("MULTI_HIT count=5: exatamente 5 impactos", () => {
    useWorldStore.getState().spawn({ gid: 5, kind: "mob", job: 1002, x: 3, y: 3, dir: 0, speed: 150 });
    spawnCombatHitImpacts({ targetGid: 5, hits: 5, color: "#fff", critical: false });
    vi.advanceTimersByTime(BASIC_ATTACK_MULTI_STAGGER_MS * 5);
    expect(sprite.created.length).toBe(5);
  });

  it("MULTI_HIT count=10: exatamente 10 impactos, todos o mesmo vfxId de combate", () => {
    useWorldStore.getState().spawn({ gid: 6, kind: "mob", job: 1002, x: 4, y: 4, dir: 0, speed: 150 });
    spawnCombatHitImpacts({ targetGid: 6, hits: 10, color: "#fff", critical: false });
    vi.advanceTimersByTime(BASIC_ATTACK_MULTI_STAGGER_MS * 10);
    expect(sprite.created.length).toBe(10);
  });

  it("MULTI_HIT_CRITICAL: multiplicidade E variante crítica coexistem — todos os impactos escalam", () => {
    useWorldStore.getState().spawn({ gid: 7, kind: "mob", job: 1002, x: 6, y: 6, dir: 0, speed: 150 });
    spawnCombatHitImpacts({ targetGid: 7, hits: 3, color: "#fff", critical: true });
    vi.advanceTimersByTime(BASIC_ATTACK_MULTI_STAGGER_MS * 3);
    expect(sprite.created.length).toBe(3);
    for (const c of sprite.created) expect(c.scale).toBeGreaterThan(1);
  });

  it("count inválido — `classifyHit` cai no fallback (nível 1 = 1 hit), nunca quebra", () => {
    const c = classifyHit(0, 1, false);
    expect(c.hits).toBe(1);
    expect(c.multiplicity).toBe("single");
  });

  it("count extremo — teto visual é responsabilidade de `spawnHitImpacts` (VISUAL_SHARD_CAP=20), não deste módulo nem do resolver", () => {
    useWorldStore.getState().spawn({ gid: 8, kind: "mob", job: 1002, x: 9, y: 9, dir: 0, speed: 150 });
    spawnCombatHitImpacts({ targetGid: 8, hits: 500, color: "#fff", critical: false });
    vi.advanceTimersByTime(BASIC_ATTACK_MULTI_STAGGER_MS * 500);
    expect(sprite.created.length).toBe(20);
  });

  it("nunca compartilha VfxDefinition com o losango mágico — vfxId de cada spawn continua o de combate", () => {
    useWorldStore.getState().spawn({ gid: 9, kind: "mob", job: 1002, x: 1, y: 2, dir: 0, speed: 150 });
    const playSpy = vi.spyOn(vfxManager, "play");
    spawnCombatHitImpacts({ targetGid: 9, hits: 3, color: "#fff", critical: false });
    vi.advanceTimersByTime(BASIC_ATTACK_MULTI_STAGGER_MS * 3);
    for (const call of playSpy.mock.calls) expect(call[0]).toBe(COMBAT_HIT_VFX_ID);
    playSpy.mockRestore();
  });
});
