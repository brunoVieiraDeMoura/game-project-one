import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { vfxManager } from "../../core/manager";
import { defineVfx, resetVfxRegistry } from "../../core/registry";
import { useWorldStore } from "../../../net/worldStore";
import { spawnFireLanceHits, clearPendingFireLanceHits } from "./fireLanceMultiHit";
import { fireLanceProjectileGpuDef, fireLanceImpactBurstGpuDef } from "./fireLanceVfxDefGpu";
import { FIRE_LANCE_FALL_MS, FIRE_LANCE_STAGGER_MS } from "./FireLanceImpact";
import type { VfxInstanceRuntime, VfxWorldContext } from "../../core/types";
import type { VfxRenderer } from "../../core/renderers/rendererTypes";

// mesmo stub de `manager.test.ts`/`multiHitShardImpact.test.ts` — célula
// (x,y) vira mundo (x,0,y), determinístico, sem precisar de GameMap real.
vi.mock("../../../net/legacyCells", () => ({
  cellToWorld: (_map: unknown, _mapping: unknown, x: number, y: number) => ({ x, y: 0, z: y }),
}));

const world = {} as VfxWorldContext; // sem câmera = culling desligado

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
 * Correção 2026-08-19-e ("a lança tem que acompanhar o alvo durante a
 * queda, não cair num ponto fixo do cast") — cobre o bug real
 * (`freezeAnchorAfterMs:0` congelava a âncora NO SPAWN, então mover o
 * alvo depois de castar não tinha efeito nenhum na trajetória) e a
 * correção (`freezeAnchorAfterMs:FIRE_LANCE_FALL_MS` + `targetGid`/
 * `trackTargetSafely` em vez de uma `position` congelada).
 *
 * `vfxManager.update()` é quem aplica o tracking a cada quadro — este
 * teste chama diretamente (a "câmera"/`useFrame` de produção não existe
 * aqui), mesma técnica de `manager.test.ts: freezeAnchorAfterMs`. Timers
 * fake controlam o `setTimeout` do driver (stagger entre hits, agendamento
 * do impacto); `performance.now()` real fica parado (fake timers não
 * avançam relógio de verdade) — irrelevante aqui: o teste nunca depende do
 * INSTANTE em que a âncora congela, só de que ela RASTREIA enquanto o
 * `setTimeout` lógico ainda não disparou o impacto.
 */
describe("fire-lance/fireLanceMultiHit — tracking de alvo durante a queda", () => {
  let sprite: ReturnType<typeof mockRenderer>;
  let trail: ReturnType<typeof mockRenderer>;
  let particle: ReturnType<typeof mockRenderer>;

  beforeEach(() => {
    resetVfxRegistry();
    defineVfx(fireLanceProjectileGpuDef("low"));
    defineVfx(fireLanceImpactBurstGpuDef("low"));
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
    clearPendingFireLanceHits();
    vfxManager.unregisterRenderer("sprite");
    vfxManager.unregisterRenderer("trail");
    vfxManager.unregisterRenderer("particle");
    vi.useRealTimers();
  });

  /** camada 0 do projétil (LOW tier) é sempre o `trail` (`buildProjectileLayers`:
   * trail entra ANTES do sprite externo quando `trailLength>0`) — layer 0
   * carrega o `instanceId` CRU do driver (`manager.ts: layerInstanceId`),
   * então `trail.created[i].id` é o handle real do i-ésimo hit disparado. */
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

  it("alvo parado: projétil e impacto pousam na posição do cast (comportamento preservado)", () => {
    useWorldStore.getState().spawn({ gid: 1, kind: "mob", job: 1002, x: 5, y: 5, dir: 0, speed: 150 });
    spawnFireLanceHits({ targetGid: 1, hits: 1, tier: "low" });

    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 5, y: 0, z: 5 });

    vi.advanceTimersByTime(FIRE_LANCE_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "fire_lance_impact_burst_low");
    expect(impact?.position).toEqual({ x: 5, y: 0, z: 5 });
  });

  it("alvo anda em X durante a queda: projétil rastreia, impacto nasce na posição NOVA", () => {
    useWorldStore.getState().spawn({ gid: 2, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnFireLanceHits({ targetGid: 2, hits: 1, tier: "low" });
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 0, y: 0, z: 0 });

    // andou no meio da queda — ainda não passou FIRE_LANCE_FALL_MS, então a
    // âncora ainda NÃO congelou (freezeAnchorAfterMs é medido por
    // `performance.now()` real, que fake timers não avança — a âncora
    // continua "em voo" pelo resto deste teste, exatamente o que queremos
    // verificar).
    move(2, 12, 0);
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 12, y: 0, z: 0 });

    vi.advanceTimersByTime(FIRE_LANCE_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "fire_lance_impact_burst_low");
    expect(impact?.position).toEqual({ x: 12, y: 0, z: 0 }); // NUNCA a posição antiga (0,0,0)
  });

  it("alvo anda em Z (lateral) durante a queda: mesmo tracking", () => {
    useWorldStore.getState().spawn({ gid: 3, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnFireLanceHits({ targetGid: 3, hits: 1, tier: "low" });

    move(3, 0, 8);
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 0, y: 0, z: 8 });

    vi.advanceTimersByTime(FIRE_LANCE_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "fire_lance_impact_burst_low");
    expect(impact?.position).toEqual({ x: 0, y: 0, z: 8 });
  });

  it("alvo muda de direção no meio da queda: impacto usa a posição MAIS RECENTE, não a intermediária", () => {
    useWorldStore.getState().spawn({ gid: 4, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnFireLanceHits({ targetGid: 4, hits: 1, tier: "low" });

    move(4, 10, 0);
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 10, y: 0, z: 0 });

    move(4, 10, -6); // muda de direção (agora anda em Z)
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 10, y: 0, z: -6 });

    vi.advanceTimersByTime(FIRE_LANCE_FALL_MS);
    const impact = sprite.created.find((c) => c.vfxId === "fire_lance_impact_burst_low");
    expect(impact?.position).toEqual({ x: 10, y: 0, z: -6 });
  });

  it("alvo morre/some no meio da queda: posição trava na ÚLTIMA válida, nunca o sentinela {0,-999,0}, impacto ainda nasce sem erro", () => {
    useWorldStore.getState().spawn({ gid: 5, kind: "mob", job: 1002, x: 3, y: 3, dir: 0, speed: 150, hp: 100, maxHp: 100 });
    spawnFireLanceHits({ targetGid: 5, hits: 1, tier: "low" });

    move(5, 7, 3);
    vfxManager.update(0.016);
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toEqual({ x: 7, y: 0, z: 3 });

    useWorldStore.getState().setHp(5, 0, 100);
    useWorldStore.getState().vanish(5);
    vfxManager.update(0.016);
    vfxManager.update(0.016);

    const posAposMorrer = vfxManager.getInstance(projectileIdOfHit(0))!.position;
    expect(posAposMorrer).toEqual({ x: 7, y: 0, z: 3 }); // trava na última boa
    expect(posAposMorrer).not.toEqual({ x: 0, y: -999, z: 0 });

    expect(() => vi.advanceTimersByTime(FIRE_LANCE_FALL_MS)).not.toThrow();
    const impact = sprite.created.find((c) => c.vfxId === "fire_lance_impact_burst_low");
    expect(impact?.position).toEqual({ x: 7, y: 0, z: 3 });
    expect(impact?.position).not.toEqual({ x: 0, y: -999, z: 0 });
  });

  it("multi-hit (10 hits): cada lança rastreia o alvo de forma independente — hit tardio usa a posição atual, não a do primeiro hit", () => {
    useWorldStore.getState().spawn({ gid: 6, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    spawnFireLanceHits({ targetGid: 6, hits: 10, tier: "low" });

    // hit 0 nasceu na hora, na posição original
    expect(vfxManager.getInstance(projectileIdOfHit(0))!.position).toMatchObject({ x: 0, z: 0 });

    // avança até o último hit dos 10 nascer (stagger cumulativo do hit 9 é
    // `9 * FIRE_LANCE_STAGGER_MS`), DEPOIS move o alvo — `move()` logo
    // antes do `update()` (não antes do `advanceTimersByTime`, que executa
    // os 9 callbacks agendados de verdade e consome alguns ms REAIS de
    // CPU; `interpolatedCell` usa `performance.now()` REAL pra simular a
    // interpolação em andamento, então um `move()` cedo demais deixaria o
    // alvo "quase lá" em vez de exatamente na posição nova no instante do
    // `update()` — artefato de teste, não do tracking em si).
    vi.advanceTimersByTime(9 * FIRE_LANCE_STAGGER_MS);
    move(6, 25, 0);
    vfxManager.update(0.016);

    const hit9 = vfxManager.getInstance(projectileIdOfHit(9));
    expect(hit9).toBeDefined();
    // acompanhou o alvo (x≈25, não ficou preso em x=0) — hits índice>0 têm
    // pequeno jitter horizontal AO VIVO (`HIT_SPREAD_RADIUS=0.35`,
    // aplicado em cima da posição atual do alvo, ver docblock do driver),
    // então não é exatamente 25.
    expect(hit9!.position.x).toBeGreaterThan(25 - 0.35);
    expect(hit9!.position.x).toBeLessThan(25 + 0.35);

    vi.advanceTimersByTime(FIRE_LANCE_FALL_MS);
    const impacts = sprite.created.filter((c) => c.vfxId === "fire_lance_impact_burst_low");
    expect(impacts.length).toBe(10);
  });
});
