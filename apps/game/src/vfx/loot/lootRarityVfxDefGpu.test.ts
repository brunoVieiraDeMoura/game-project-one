import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { vfxManager } from "../core/manager";
import { getVfxDefinition } from "../core/registry";
import { lootRarityVfxId } from "./lootRarityVfxDefGpu";
import type { LootRarityTier } from "./lootRarityTiers";
import type { VfxInstanceRuntime, VfxWorldContext } from "../core/types";
import type { VfxRenderer } from "../core/renderers/rendererTypes";

const world = {} as VfxWorldContext;

function mockRenderer(kind: string): VfxRenderer & { created: number[] } {
  const created: number[] = [];
  return {
    kind,
    created,
    onInstanceCreate(instance: VfxInstanceRuntime) {
      created.push(instance.instanceId);
    },
    onInstanceUpdate() {},
    onInstanceDestroy() {},
    setActive() {},
    flush() {},
    dispose() {},
  };
}

const TIER_ORDER: LootRarityTier[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

/**
 * As 6 auras de raridade de drop — prova o essencial: registram sem erro,
 * nascem PERSISTENTES (sem `lifetimeMs`) numa posição explícita (item no
 * chão não é entidade do `worldStore`), e a progressão de complexidade
 * visual é REAL (mais camadas a cada tier), não só troca de cor — regra
 * explícita do pedido do usuário.
 */
describe("vfx/loot/lootRarityVfxDefGpu — auras de raridade de drop", () => {
  let sprite: ReturnType<typeof mockRenderer>;
  let particle: ReturnType<typeof mockRenderer>;
  let ring: ReturnType<typeof mockRenderer>;
  let beam: ReturnType<typeof mockRenderer>;

  beforeEach(() => {
    vfxManager.reset();
    sprite = mockRenderer("sprite");
    particle = mockRenderer("particle");
    ring = mockRenderer("ring");
    beam = mockRenderer("beam");
    vfxManager.setWorldContext(world);
    vfxManager.registerRenderer(sprite);
    vfxManager.registerRenderer(particle);
    vfxManager.registerRenderer(ring);
    vfxManager.registerRenderer(beam);
  });

  afterEach(() => {
    vfxManager.unregisterRenderer("sprite");
    vfxManager.unregisterRenderer("particle");
    vfxManager.unregisterRenderer("ring");
    vfxManager.unregisterRenderer("beam");
  });

  it.each(TIER_ORDER)("%s: registrado e nasce persistente numa posição explícita", (tier) => {
    const def = getVfxDefinition(lootRarityVfxId(tier));
    expect(def).toBeDefined();
    expect(def!.anchor).toBe("cell");

    const handle = vfxManager.play(lootRarityVfxId(tier), { position: { x: 3, y: 0, z: 5 } });
    expect(handle).toBeDefined();
    const instance = vfxManager.getInstance(handle!.instanceId);
    expect(instance?.expiresAt).toBeNull();
    expect(instance?.position).toEqual({ x: 3, y: 0, z: 5 });
  });

  it("progressão real: número de camadas nunca DIMINUI de um tier pro próximo", () => {
    // legendário e mítico empatam em contagem de camada (7 — o fio virou 1
    // camada só em todo tier, decisão do usuário 2026-08-21), mas nunca cai;
    // a intensidade de mítico > legendário é provada por partícula/tamanho
    // no teste abaixo, não pela contagem crua de camadas.
    const counts = TIER_ORDER.map((tier) => getVfxDefinition(lootRarityVfxId(tier))!.layers!.length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
  });

  it("mítico é mais intenso que lendário mesmo com a mesma contagem de camada (partículas/fio maiores)", () => {
    const particleCount = (tier: LootRarityTier) =>
      getVfxDefinition(lootRarityVfxId(tier))!
        .layers!.filter((l) => l.renderer === "particle")
        .reduce((sum, l) => sum + Number((l.params as Record<string, unknown>)?.particleCount ?? 0), 0);
    const beamWidth = (tier: LootRarityTier) =>
      Number((getVfxDefinition(lootRarityVfxId(tier))!.layers!.find((l) => l.renderer === "beam")!.params as Record<string, unknown>).width);

    expect(particleCount("mythic")).toBeGreaterThan(particleCount("legendary"));
    expect(beamWidth("mythic")).toBeGreaterThan(beamWidth("legendary"));
  });

  it("comum e incomum não pagam ring/beam (regra de custo: são a maioria dos drops de campo)", () => {
    for (const tier of ["common", "uncommon"] as const) {
      const kinds = getVfxDefinition(lootRarityVfxId(tier))!.layers!.map((l) => l.renderer);
      expect(kinds).not.toContain("ring");
      expect(kinds).not.toContain("beam");
    }
  });

  it("raro em diante ganha coluna vertical (beam) — perceptível como drop especial", () => {
    for (const tier of ["rare", "epic", "legendary", "mythic"] as const) {
      const kinds = getVfxDefinition(lootRarityVfxId(tier))!.layers!.map((l) => l.renderer);
      expect(kinds).toContain("beam");
    }
  });

  it("mítico usa TODOS os 4 renderers da composição (o mais elaborado)", () => {
    const kinds = new Set(getVfxDefinition(lootRarityVfxId("mythic"))!.layers!.map((l) => l.renderer));
    expect(kinds).toEqual(new Set(["sprite", "particle", "beam", "ring"]));
  });

  it("stop() remove a instância imediatamente, em qualquer tier", () => {
    const handle = vfxManager.play(lootRarityVfxId("epic"), { position: { x: 0, y: 0, z: 0 } })!;
    expect(sprite.created.length).toBeGreaterThan(0);
    vfxManager.stop(handle, "picked-up");
    expect(vfxManager.getInstance(handle.instanceId)).toBeUndefined();
  });
});
