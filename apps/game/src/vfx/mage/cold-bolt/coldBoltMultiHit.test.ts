import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { vfxManager } from "../../core/manager";
import { defineVfx, resetVfxRegistry } from "../../core/registry";
import { useWorldStore } from "../../../net/worldStore";
import { spawnColdBoltHits, clearPendingColdBoltHits } from "./coldBoltMultiHit";
import { coldBoltProjectileGpuDef, coldBoltImpactBurstGpuDef } from "./coldBoltVfxDefGpu";
import { ICICLE_FALL_MS, ICICLE_STAGGER_MS } from "./ColdBoltImpact";
import type { VfxInstanceRuntime, VfxWorldContext } from "../../core/types";
import type { VfxRenderer } from "../../core/renderers/rendererTypes";

vi.mock("../../../net/legacyCells", () => ({
  cellToWorld: (_map: unknown, _mapping: unknown, x: number, y: number) => ({ x, y: 0, z: y }),
}));

const world = {} as VfxWorldContext;

interface Created {
  id: number;
  vfxId: string;
  position: { x: number; y: number; z: number };
}

function mockRenderer(kind: string): VfxRenderer & { created: Created[] } {
  const created: Created[] = [];
  return {
    kind,
    created,
    onInstanceCreate(instance: VfxInstanceRuntime) {
      created.push({ id: instance.instanceId, vfxId: instance.vfxId, position: { ...instance.position } });
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
 * Correção 2026-08-19-e ("Fire Lance/Cold Lance") — MESMO bug/correção de
 * `fire-lance/fireLanceMultiHit.test.ts` (ver docblock lá pro raciocínio
 * completo, não duplicado aqui): `freezeAnchorAfterMs:0` congelava a
 * âncora NO SPAWN; agora rastreia o alvo ao vivo até `ICICLE_FALL_MS`.
 */
describe("cold-bolt/coldBoltMultiHit — tracking de alvo durante a queda", () => {
  let sprite: ReturnType<typeof mockRenderer>;
  let trail: ReturnType<typeof mockRenderer>;
  let particle: ReturnType<typeof mockRenderer>;

  beforeEach(() => {
    resetVfxRegistry();
    defineVfx(coldBoltProjectileGpuDef("low"));
    defineVfx(coldBoltImpactBurstGpuDef("low"));
    useWorldStore.setState({ entities: {}, gids: [], target: null });
    vfxManager.reset();
    sprite = mockRenderer("sprite");
    trail = mockRenderer("trail");
    particle = mockRenderer("particle");
    vfxManager.setWorldContext(world);
    vfxManager.registerRenderer(sprite);
    vfxManager.registerRenderer(trail);
    vfxManager.registerRenderer(particle);
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearPendingColdBoltHits();
    vfxManager.unregisterRenderer("sprite");
    vfxManager.unregisterRenderer("trail");
    vfxManager.unregisterRenderer("particle");
    vi.useRealTimers();
  });

  function projectileIdOfHit(index: number): number {
    return trail.created[index]!.id;
  }

  function move(gid: number, x: number, y: number): void {
    const e = useWorldStore.getState().entities[gid]!;
    e.x = x;
    e.toX = x;
    e.y = y;
    e.toY = y;
  }

  it("alvo parado: projétil e impacto pousam na posição do cast", () => {
    useWorldStore.getState().spawn({ gid: 1, kind: "mob", job: 1002, x: 5, y: 5, dir: 0, speed: 150 });
    spawnColdBoltHits({ targetGid: 1, hits: 1, tier: "low" });

    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 5, y: 0, z: 5 });

    vi.advanceTimersByTime(ICICLE_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "cold_bolt_impact_burst_low");
    expect(impact?.position).toEqual({ x: 5, y: 0, z: 5 });
  });

  it("alvo anda em X durante a queda: projétil rastreia, impacto nasce na posição NOVA", () => {
    useWorldStore.getState().spawn({ gid: 2, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnColdBoltHits({ targetGid: 2, hits: 1, tier: "low" });
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 0, y: 0, z: 0 });

    move(2, 12, 0);
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 12, y: 0, z: 0 });

    vi.advanceTimersByTime(ICICLE_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "cold_bolt_impact_burst_low");
    expect(impact?.position).toEqual({ x: 12, y: 0, z: 0 });
  });

  it("alvo anda em Z (lateral) durante a queda: mesmo tracking", () => {
    useWorldStore.getState().spawn({ gid: 3, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnColdBoltHits({ targetGid: 3, hits: 1, tier: "low" });

    move(3, 0, 8);
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 0, y: 0, z: 8 });

    vi.advanceTimersByTime(ICICLE_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "cold_bolt_impact_burst_low");
    expect(impact?.position).toEqual({ x: 0, y: 0, z: 8 });
  });

  it("alvo muda de direção no meio da queda: impacto usa a posição MAIS RECENTE", () => {
    useWorldStore.getState().spawn({ gid: 4, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnColdBoltHits({ targetGid: 4, hits: 1, tier: "low" });

    move(4, 10, 0);
    vfxManager.update(0.016);
    move(4, 10, -6);
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 10, y: 0, z: -6 });

    vi.advanceTimersByTime(ICICLE_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "cold_bolt_impact_burst_low");
    expect(impact?.position).toEqual({ x: 10, y: 0, z: -6 });
  });

  it("alvo morre/some no meio da queda: posição trava na ÚLTIMA válida, nunca o sentinela, impacto ainda nasce sem erro", () => {
    useWorldStore.getState().spawn({ gid: 5, kind: "mob", job: 1002, x: 3, y: 3, dir: 0, speed: 150, hp: 100, maxHp: 100 });
    spawnColdBoltHits({ targetGid: 5, hits: 1, tier: "low" });

    move(5, 7, 3);
    vfxManager.update(0.016);
    useWorldStore.getState().setHp(5, 0, 100);
    useWorldStore.getState().vanish(5);
    vfxManager.update(0.016);
    vfxManager.update(0.016);

    const pos = vfxManager.getInstance(projectileIdOfHit(0))!.position;
    expect(pos).toEqual({ x: 7, y: 0, z: 3 });
    expect(pos).not.toEqual({ x: 0, y: -999, z: 0 });

    expect(() => vi.advanceTimersByTime(ICICLE_FALL_MS)).not.toThrow();
    const impact = sprite.created.find((c) => c.vfxId === "cold_bolt_impact_burst_low");
    expect(impact?.position).toEqual({ x: 7, y: 0, z: 3 });
  });

  it("multi-hit (10 hits): cada lança rastreia o alvo de forma independente", () => {
    useWorldStore.getState().spawn({ gid: 6, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnColdBoltHits({ targetGid: 6, hits: 10, tier: "low" });

    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toMatchObject({ x: 0, z: 0 });

    vi.advanceTimersByTime(9 * ICICLE_STAGGER_MS);
    move(6, 25, 0);
    vfxManager.update(0.016);

    const hit9 = vfxManager.getInstance(projectileIdOfHit(9));
    expect(hit9).toBeDefined();
    expect(hit9!.position.x).toBeGreaterThan(25 - 0.35);
    expect(hit9!.position.x).toBeLessThan(25 + 0.35);

    vi.advanceTimersByTime(ICICLE_FALL_MS);
    const impacts = sprite.created.filter((c) => c.vfxId === "cold_bolt_impact_burst_low");
    expect(impacts.length).toBe(10);
  });
});
