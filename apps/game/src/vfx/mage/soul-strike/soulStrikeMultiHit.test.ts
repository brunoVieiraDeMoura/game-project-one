import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { vfxManager } from "../../core/manager";
import { defineVfx, resetVfxRegistry } from "../../core/registry";
import { useWorldStore } from "../../../net/worldStore";
import { spawnSoulStrikeHits, clearPendingSoulStrikeHits } from "./soulStrikeMultiHit";
import { soulStrikeProjectileGpuDef, soulStrikeImpactBurstGpuDef, curveAmountFor } from "./soulStrikeVfxDefGpu";
import { SOUL_FLIGHT_MS, SOUL_STRIKE_STAGGER_MS } from "./SoulStrikeImpact";
import type { VfxInstanceRuntime, VfxWorldContext } from "../../core/types";
import type { VfxRenderer } from "../../core/renderers/rendererTypes";

vi.mock("../../../net/legacyCells", () => ({
  cellToWorld: (_map: unknown, _mapping: unknown, x: number, y: number) => ({ x, y: 0, z: y }),
}));

// `cellSize` REAL (não `{}` como Fire Lance) — `anchor:"caster-to-target"`
// divide por ele pra montar `casterOffset`; sem isto o cálculo vira NaN.
const world = { cellSize: 2 } as VfxWorldContext;

interface Created {
  id: number;
  vfxId: string;
  position: { x: number; y: number; z: number };
  curveLateral: number | undefined;
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
        position: { ...instance.position },
        curveLateral: instance.spawnOptions.payload?.curveLateral as number | undefined,
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
 * Esferas Espirituais/Soul Strike (reconstrução 2026-08-19-z) — MESMO
 * tracking/correção de `fire-lance/fireLanceMultiHit.test.ts` (ver
 * docblock lá, não duplicado aqui), aplicado à identidade própria: esfera
 * VOA do caster até o alvo (`anchor:"caster-to-target"`, não cai de cima),
 * com curva lateral própria por índice (`curveOffset.ts`, novo).
 */
describe("soul-strike/soulStrikeMultiHit — voo curvo caster→alvo + tracking", () => {
  let sprite: ReturnType<typeof mockRenderer>;
  let trail: ReturnType<typeof mockRenderer>;
  let particle: ReturnType<typeof mockRenderer>;

  beforeEach(() => {
    resetVfxRegistry();
    defineVfx(soulStrikeProjectileGpuDef("low"));
    defineVfx(soulStrikeImpactBurstGpuDef("low"));
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
    clearPendingSoulStrikeHits();
    vfxManager.unregisterRenderer("sprite");
    vfxManager.unregisterRenderer("trail");
    vfxManager.unregisterRenderer("particle");
    vi.useRealTimers();
  });

  /** layer 0 do projétil é sempre `trail` (`buildProjectileLayers`, igual
   * Fire Lance) — `trail.created[i].id` é o handle real do i-ésimo hit. */
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

  function spawnCasterAndTarget(casterGid: number, targetGid: number, targetX: number, targetY: number, casterX: number, casterY: number): void {
    useWorldStore.getState().spawn({ gid: casterGid, kind: "player", job: 1, x: casterX, y: casterY, dir: 0, speed: 150 });
    useWorldStore.getState().spawn({ gid: targetGid, kind: "mob", job: 1002, x: targetX, y: targetY, dir: 0, speed: 150 });
  }

  it("alvo parado: esfera chega EXATAMENTE no alvo (curva zera nas duas pontas)", () => {
    spawnCasterAndTarget(-1, 1, 5, 5, 5, 0);
    spawnSoulStrikeHits({ sourceGid: -1, targetGid: 1, hits: 1, tier: "low" });

    vi.advanceTimersByTime(SOUL_FLIGHT_MS);
    const impact = sprite.created.find((c) => c.vfxId === "soul_strike_impact_burst_low");
    expect(impact?.position.x).toBeCloseTo(5, 5);
    expect(impact?.position.z).toBeCloseTo(5, 5);
  });

  it("alvo anda durante o voo: esfera rastreia, impacto nasce na posição NOVA", () => {
    spawnCasterAndTarget(-2, 2, 0, 0, 0, -5);
    spawnSoulStrikeHits({ sourceGid: -2, targetGid: 2, hits: 1, tier: "low" });

    move(2, 12, 0);
    vfxManager.update(0.016);
    // ainda em voo (freezeAnchorAfterMs não passou de verdade — fake timers
    // não avançam performance.now()) — a posição do alvo já reflete o novo X.
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position.x).toBeCloseTo(12, 5);

    vi.advanceTimersByTime(SOUL_FLIGHT_MS);
    const impact = sprite.created.find((c) => c.vfxId === "soul_strike_impact_burst_low");
    expect(impact?.position.x).toBeCloseTo(12, 5);
  });

  it("alvo morre/some no meio do voo: trava na última posição válida, nunca o sentinela, impacto nasce sem erro", () => {
    spawnCasterAndTarget(-3, 3, 3, 3, 3, -2);
    useWorldStore.getState().setHp(3, 100, 100);
    spawnSoulStrikeHits({ sourceGid: -3, targetGid: 3, hits: 1, tier: "low" });

    move(3, 9, 3);
    vfxManager.update(0.016);
    useWorldStore.getState().setHp(3, 0, 100);
    useWorldStore.getState().vanish(3);
    vfxManager.update(0.016);
    vfxManager.update(0.016);

    const pos = vfxManager.getInstance(projectileIdOfHit(0))!.position;
    expect(pos).not.toEqual({ x: 0, y: -999, z: 0 });

    expect(() => vi.advanceTimersByTime(SOUL_FLIGHT_MS)).not.toThrow();
    const impact = sprite.created.find((c) => c.vfxId === "soul_strike_impact_burst_low");
    expect(impact?.position).not.toEqual({ x: 0, y: -999, z: 0 });
  });

  it("3 hits: normalizedIndex distribui esquerda/centro/direita — item 15 do pedido, funciona pra QUALQUER count", () => {
    spawnCasterAndTarget(-4, 4, 0, 0, 0, -5);
    spawnSoulStrikeHits({ sourceGid: -4, targetGid: 4, hits: 3, tier: "low" });
    vi.advanceTimersByTime(2 * SOUL_STRIKE_STAGGER_MS); // dispara os 3

    const amount = curveAmountFor("low");
    expect(amount).toBeGreaterThan(0);
    // hit 0 → normalizedIndex=-1 → curveLateral=-amount (esquerda)
    // hit 1 → normalizedIndex=0  → curveLateral=0       (centro, sem curva)
    // hit 2 → normalizedIndex=+1 → curveLateral=+amount (direita, lado OPOSTO ao hit 0)
    expect(trail.created[0]!.curveLateral).toBeCloseTo(-amount, 6);
    expect(trail.created[1]!.curveLateral).toBeCloseTo(0, 6);
    expect(trail.created[2]!.curveLateral).toBeCloseTo(amount, 6);
  });

  it("5 hits: normalizedIndex varre -1..+1 uniformemente, nunca uma tabela hardcoded por quantidade", () => {
    spawnCasterAndTarget(-7, 7, 0, 0, 0, -5);
    spawnSoulStrikeHits({ sourceGid: -7, targetGid: 7, hits: 5, tier: "low" });
    vi.advanceTimersByTime(4 * SOUL_STRIKE_STAGGER_MS);

    const amount = curveAmountFor("low");
    const expected = [-1, -0.5, 0, 0.5, 1].map((n) => n * amount);
    for (let i = 0; i < 5; i++) {
      expect(trail.created[i]!.curveLateral).toBeCloseTo(expected[i]!, 6);
    }
  });

  it("multi-hit (5 hits): dispara 5 instâncias independentes, todas convergem pro MESMO alvo", () => {
    spawnCasterAndTarget(-5, 5, 8, 8, 8, 3);
    spawnSoulStrikeHits({ sourceGid: -5, targetGid: 5, hits: 5, tier: "low" });

    vi.advanceTimersByTime(4 * SOUL_STRIKE_STAGGER_MS + SOUL_FLIGHT_MS);
    // burst LOW tem 2 camadas `sprite` (flash+ripple, `buildImpactBurstLayers`)
    // — `sprite.created` ganha 2 entradas por instância de impacto real.
    const IMPACT_SPRITE_LAYERS_LOW = 2;
    const impacts = sprite.created.filter((c) => c.vfxId === "soul_strike_impact_burst_low");
    expect(impacts.length).toBe(5 * IMPACT_SPRITE_LAYERS_LOW);
    for (const impact of impacts) {
      expect(impact.position.x).toBeCloseTo(8, 5);
      expect(impact.position.z).toBeCloseTo(8, 5);
    }
  });

  it("1 hit: funciona sozinho (normalizedIndex=0, sem curva)", () => {
    spawnCasterAndTarget(-6, 6, 4, 4, 4, 0);
    spawnSoulStrikeHits({ sourceGid: -6, targetGid: 6, hits: 1, tier: "low" });
    expect(trail.created.length).toBe(1);

    vi.advanceTimersByTime(SOUL_FLIGHT_MS);
    const IMPACT_SPRITE_LAYERS_LOW = 2; // flash + ripple, ver teste dos 5 hits
    const impacts = sprite.created.filter((c) => c.vfxId === "soul_strike_impact_burst_low");
    expect(impacts.length).toBe(IMPACT_SPRITE_LAYERS_LOW);
    expect(impacts[0]!.position.x).toBeCloseTo(4, 5);
    expect(impacts[0]!.position.z).toBeCloseTo(4, 5);
  });
});
