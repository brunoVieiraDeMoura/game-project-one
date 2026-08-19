import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { vfxManager } from "../../core/manager";
import { defineVfx, resetVfxRegistry } from "../../core/registry";
import { useWorldStore } from "../../../net/worldStore";
import { spawnLightBoltHits, clearPendingLightBoltHits } from "./lightBoltMultiHit";
import {
  lightBoltProjectileGpuDef,
  lightBoltImpactBurstGpuDef,
  LIGHTNING_FALL_MS,
  LIGHT_BOLT_FRAME_COUNT,
} from "./lightBoltVfxDefGpu";
import { LIGHT_BOLT_STAGGER_MS } from "./LightBoltImpact";
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
 * Eletrocutar/Light Bolt (reconstrução 2026-08-19-f) — MESMO
 * tracking/correção de `fire-lance/fireLanceMultiHit.test.ts`/
 * `cold-bolt/coldBoltMultiHit.test.ts` (ver docblock lá, não duplicado
 * aqui), aplicado à identidade própria: 10 raios caindo RÁPIDO
 * (`LIGHTNING_FALL_MS`) na CABEÇA do alvo.
 */
describe("light-bolt/lightBoltMultiHit — tracking de alvo + acerto na cabeça", () => {
  let sprite: ReturnType<typeof mockRenderer>;
  let particle: ReturnType<typeof mockRenderer>;

  beforeEach(() => {
    resetVfxRegistry();
    // 2026-08-19-r: o driver sorteia 1 dos N quadros do atlas por hit —
    // registra TODOS pro tier "low" (senão `vfxManager.play()` de um
    // quadro não-registrado devolveria `undefined` silenciosamente).
    for (let f = 0; f < LIGHT_BOLT_FRAME_COUNT; f++) defineVfx(lightBoltProjectileGpuDef("low", f));
    defineVfx(lightBoltImpactBurstGpuDef("low"));
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
    clearPendingLightBoltHits();
    vfxManager.unregisterRenderer("sprite");
    vfxManager.unregisterRenderer("particle");
    vi.useRealTimers();
  });

  /** LOW tem 1 camada `sprite` só por raio (sem glow secundário — só HIGH
   * tem). Filtra por PREFIXO `light_bolt_bolt_low_f` (qualquer quadro)
   * ANTES de indexar: o impacto do hit 0 (`LIGHTNING_FALL_MS`=260ms depois
   * do spawn) nasce ANTES do stagger cumulativo (170ms/hit) terminar de
   * disparar os 10 projéteis — os `vfxId` de projétil e impacto se
   * INTERCALAM no mesmo `sprite.created` (ambos `renderer:"sprite"`),
   * então indexar sem filtrar pegaria o hit errado a partir do meio da
   * cascata. */
  const LOW_SEGMENTS_PER_HIT = 1;
  function projectileIdOfHit(index: number): number {
    const bolts = sprite.created.filter((c) => c.vfxId.startsWith("light_bolt_bolt_low_f"));
    return bolts[index * LOW_SEGMENTS_PER_HIT]!.id;
  }

  function move(gid: number, x: number, y: number): void {
    const e = useWorldStore.getState().entities[gid]!;
    e.x = x;
    e.toX = x;
    e.y = y;
    e.toY = y;
  }

  it("alvo parado: raio e impacto pousam sobre a posição do cast (X/Z)", () => {
    useWorldStore.getState().spawn({ gid: 1, kind: "mob", job: 1002, x: 5, y: 5, dir: 0, speed: 150 });
    spawnLightBoltHits({ targetGid: 1, hits: 1, tier: "low" });

    const inst = vfxManager.getInstance(projectileIdOfHit(0))!;
    expect(inst.position.x).toBe(5);
    expect(inst.position.z).toBe(5);

    vi.advanceTimersByTime(LIGHTNING_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "light_bolt_impact_burst_low");
    expect(impact?.position.x).toBe(5);
    expect(impact?.position.z).toBe(5);
  });

  it("alvo anda lateralmente durante a queda: raio rastreia, impacto nasce na posição NOVA", () => {
    useWorldStore.getState().spawn({ gid: 2, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnLightBoltHits({ targetGid: 2, hits: 1, tier: "low" });

    move(2, 0, 6);
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position.z).toBe(6);

    vi.advanceTimersByTime(LIGHTNING_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "light_bolt_impact_burst_low");
    expect(impact?.position.z).toBe(6);
  });

  it("alvo anda RÁPIDO (salto grande) durante a queda: impacto acompanha, não fica no meio do caminho", () => {
    useWorldStore.getState().spawn({ gid: 3, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 400 });
    spawnLightBoltHits({ targetGid: 3, hits: 1, tier: "low" });

    move(3, 40, 0); // deslocamento grande — mob correndo rápido
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position.x).toBe(40);

    vi.advanceTimersByTime(LIGHTNING_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "light_bolt_impact_burst_low");
    expect(impact?.position.x).toBe(40);
  });

  it("alvo muda de direção no meio da queda: impacto usa a posição MAIS RECENTE", () => {
    useWorldStore.getState().spawn({ gid: 4, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnLightBoltHits({ targetGid: 4, hits: 1, tier: "low" });

    move(4, 8, 0);
    vfxManager.update(0.016);
    move(4, 8, -5);
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 8, y: 0, z: -5 });

    vi.advanceTimersByTime(LIGHTNING_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "light_bolt_impact_burst_low");
    expect(impact?.position).toEqual({ x: 8, y: 0, z: -5 });
  });

  it("alvo morre/some no meio da queda: trava na última posição válida, impacto ainda nasce sem erro", () => {
    useWorldStore.getState().spawn({ gid: 5, kind: "mob", job: 1002, x: 3, y: 3, dir: 0, speed: 150, hp: 100, maxHp: 100 });
    spawnLightBoltHits({ targetGid: 5, hits: 1, tier: "low" });

    move(5, 9, 3);
    vfxManager.update(0.016);
    useWorldStore.getState().setHp(5, 0, 100);
    useWorldStore.getState().vanish(5);
    vfxManager.update(0.016);
    vfxManager.update(0.016);

    const pos = vfxManager.getInstance(projectileIdOfHit(0))!.position;
    expect(pos.x).toBe(9);
    expect(pos.z).toBe(3);
    expect(pos).not.toEqual({ x: 0, y: -999, z: 0 });

    expect(() => vi.advanceTimersByTime(LIGHTNING_FALL_MS)).not.toThrow();
    const impact = sprite.created.find((c) => c.vfxId === "light_bolt_impact_burst_low");
    expect(impact?.position.x).toBe(9);
    expect(impact?.position).not.toEqual({ x: 0, y: -999, z: 0 });
  });

  it("multi-hit (10 hits): 10 raios, 10 impactos, cada um rastreando de forma independente", () => {
    useWorldStore.getState().spawn({ gid: 6, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnLightBoltHits({ targetGid: 6, hits: 10, tier: "low" });

    vi.advanceTimersByTime(9 * LIGHT_BOLT_STAGGER_MS);
    move(6, 20, 0);
    vfxManager.update(0.016);

    const hit9 = vfxManager.getInstance(projectileIdOfHit(9));
    expect(hit9).toBeDefined();
    expect(hit9!.position.x).toBeGreaterThan(20 - 0.2);
    expect(hit9!.position.x).toBeLessThan(20 + 0.2);

    vi.advanceTimersByTime(LIGHTNING_FALL_MS);
    const impacts = sprite.created.filter((c) => c.vfxId === "light_bolt_impact_burst_low");
    expect(impacts.length).toBe(10);
  });
});
