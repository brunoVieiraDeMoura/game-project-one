import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { vfxManager } from "../../core/manager";
import { useWorldStore } from "../../../net/worldStore";
import { FREEZE_BODY_GPU_ID, FREEZE_SHATTER_GPU_ID } from "./freezeBodyVfxDefGpu";
import type { VfxInstanceRuntime, VfxWorldContext } from "../../core/types";
import type { VfxRenderer } from "../../core/renderers/rendererTypes";

// mesmo stub de `multiHitShardImpact.test.ts`/`manager.test.ts` — célula
// (x,y) vira mundo (x,0,y), determinístico, sem GameMap real.
vi.mock("../../../net/legacyCells", () => ({
  cellToWorld: (_map: unknown, _mapping: unknown, x: number, y: number) => ({ x, y: 0, z: y }),
}));

const world = {} as VfxWorldContext;

function mockRenderer(kind: string): VfxRenderer & { created: number[]; destroyed: number[] } {
  const created: number[] = [];
  const destroyed: number[] = [];
  return {
    kind,
    created,
    destroyed,
    onInstanceCreate(instance: VfxInstanceRuntime) {
      created.push(instance.instanceId);
    },
    onInstanceUpdate() {},
    onInstancePulse() {},
    onInstanceDestroy(instance: VfxInstanceRuntime) {
      destroyed.push(instance.instanceId);
    },
    setActive() {},
    flush() {},
    dispose() {},
  };
}

/**
 * Congelar persistente em GPU (auditoria "fechar o arco de VFX",
 * 2026-08-19) — prova que o mecanismo imperativo `play()`/`stop()` que
 * `FreezeBodyVfx.tsx` usa funciona: instância nasce sem `lifetimeMs`
 * (persiste até `stop()` explícito, nunca expira sozinha), nenhum
 * renderer `dom` é necessário (só sprite/particle/ring), e o burst de
 * estilhaçar é um disparo curto e separado.
 */
describe("vfx/mage/frost-diver/freezeBodyVfxDefGpu — Congelar persistente em GPU", () => {
  let sprite: ReturnType<typeof mockRenderer>;
  let particle: ReturnType<typeof mockRenderer>;
  let ring: ReturnType<typeof mockRenderer>;

  beforeEach(() => {
    useWorldStore.setState({ entities: {}, gids: [], target: null });
    vfxManager.reset();
    sprite = mockRenderer("sprite");
    particle = mockRenderer("particle");
    ring = mockRenderer("ring");
    vfxManager.setWorldContext(world);
    vfxManager.registerRenderer(sprite);
    vfxManager.registerRenderer(particle);
    vfxManager.registerRenderer(ring);
  });

  afterEach(() => {
    vfxManager.unregisterRenderer("sprite");
    vfxManager.unregisterRenderer("particle");
    vfxManager.unregisterRenderer("ring");
  });

  it("play() nasce SEM expirar sozinho — persiste até stop() explícito", () => {
    useWorldStore.getState().spawn({ gid: 40, kind: "mob", job: 1002, x: 1, y: 1, dir: 0, speed: 150 });
    const handle = vfxManager.play(FREEZE_BODY_GPU_ID, { targetGid: 40 });
    expect(handle).toBeDefined();
    const instance = vfxManager.getInstance(handle!.instanceId);
    expect(instance?.expiresAt).toBeNull();
  });

  it("stop() remove a instância imediatamente — nenhum renderer dom envolvido", () => {
    useWorldStore.getState().spawn({ gid: 41, kind: "mob", job: 1002, x: 2, y: 2, dir: 0, speed: 150 });
    const handle = vfxManager.play(FREEZE_BODY_GPU_ID, { targetGid: 41 })!;
    expect(sprite.created.length).toBeGreaterThan(0);
    expect(ring.created.length).toBe(1);
    vfxManager.stop(handle, "unfreeze");
    expect(sprite.destroyed.length + particle.destroyed.length + ring.destroyed.length).toBeGreaterThan(0);
  });

  it("burst de estilhaçar é um id PRÓPRIO, curto, independente da instância persistente", () => {
    useWorldStore.getState().spawn({ gid: 42, kind: "mob", job: 1002, x: 3, y: 3, dir: 0, speed: 150 });
    const shard = vfxManager.play(FREEZE_SHATTER_GPU_ID, { targetGid: 42 })!;
    expect(shard.vfxId).toBe(FREEZE_SHATTER_GPU_ID);
    expect(shard.vfxId).not.toBe(FREEZE_BODY_GPU_ID);
    const instance = vfxManager.getInstance(shard.instanceId);
    expect(instance?.expiresAt).not.toBeNull(); // ao contrário do corpo persistente, este expira sozinho
  });

  it("dois congelamentos simultâneos (dois alvos) não se cruzam", () => {
    useWorldStore.getState().spawn({ gid: 43, kind: "mob", job: 1002, x: 5, y: 5, dir: 0, speed: 150 });
    useWorldStore.getState().spawn({ gid: 44, kind: "mob", job: 1002, x: 9, y: 9, dir: 0, speed: 150 });
    const h1 = vfxManager.play(FREEZE_BODY_GPU_ID, { targetGid: 43 })!;
    const h2 = vfxManager.play(FREEZE_BODY_GPU_ID, { targetGid: 44 })!;
    expect(h1.instanceId).not.toBe(h2.instanceId);
    vfxManager.stop(h1, "unfreeze");
    // instância 2 continua viva — stop() de uma não derruba a outra
    expect(vfxManager.getInstance(h2.instanceId)).toBeDefined();
  });
});
