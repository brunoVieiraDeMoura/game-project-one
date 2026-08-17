import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { vfxManager } from "../core/manager";
import { useWorldStore } from "../../net/worldStore";
import { spawnMultiHitShards, clearPendingMultiHitShards, GENERIC_HIT_SHARD_ID, shardColorForElement } from "./multiHitShardImpact";
import type { VfxInstanceRuntime, VfxWorldContext } from "../core/types";
import type { VfxRenderer } from "../core/renderers/rendererTypes";

// mesmo stub de `manager.test.ts`/`multiHitDeathDespawn.test.ts` — célula
// (x,y) vira mundo (x,0,y), determinístico, sem precisar de GameMap real.
vi.mock("../../net/legacyCells", () => ({
  cellToWorld: (_map: unknown, _mapping: unknown, x: number, y: number) => ({ x, y: 0, z: y }),
}));

const world = {} as VfxWorldContext; // sem câmera = culling desligado

function mockRenderer(
  kind: string,
): VfxRenderer & { created: { id: number; position: { x: number; y: number; z: number }; scale?: number; color?: unknown }[] } {
  const created: { id: number; position: { x: number; y: number; z: number }; scale?: number; color?: unknown }[] = [];
  return {
    kind,
    created,
    onInstanceCreate(instance: VfxInstanceRuntime) {
      created.push({ id: instance.instanceId, position: { ...instance.position }, scale: instance.spawnOptions.scale, color: instance.spawnOptions.payload?.color });
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
 * "Generic Hit VFX" (2026-08-19) — `spawnMultiHitShards` toca sempre a
 * MESMA `VfxDefinition` compartilhada (`GENERIC_HIT_SHARD_ID`), registrada
 * UMA VEZ no import estático deste módulo (`defineVfx` de topo de
 * arquivo) — por isso este teste NÃO chama `resetVfxRegistry()` (isso
 * apagaria esse registro pro resto do arquivo); só `vfxManager.reset()`
 * entre testes, que limpa instâncias vivas sem tocar no registro de
 * definições. Cor vem de `payload.color` por CHAMADA — não mais uma
 * `VfxDefinition` nova por skill.
 */
describe("vfx/mage/multiHitShardImpact — Generic Hit VFX, fragmento por hit real", () => {
  let sprite: ReturnType<typeof mockRenderer>;

  beforeEach(() => {
    useWorldStore.setState({ entities: {}, gids: [], target: null });
    vfxManager.reset();
    sprite = mockRenderer("sprite");
    vfxManager.setWorldContext(world);
    vfxManager.registerRenderer(sprite);
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearPendingMultiHitShards();
    vfxManager.unregisterRenderer("sprite");
    vi.useRealTimers();
  });

  it("GENERIC_HIT_SHARD_ID é o id compartilhado — mesma definição pra qualquer skill", () => {
    expect(GENERIC_HIT_SHARD_ID).toBe("generic_hit_shard");
  });

  it("shardColorForElement: elemento real vira cor; desconhecido cai no fallback neutro", () => {
    expect(shardColorForElement("Water")).toBe("#c9f3ff");
    expect(shardColorForElement("fire")).toBe("#ff9d3a");
    expect(shardColorForElement(undefined)).toBe("#e8e8e8");
    expect(shardColorForElement("holy")).toBe("#e8e8e8"); // ainda não coberto, fallback seguro
  });

  it("hits=1: exatamente 1 fragmento, nenhum timer agendado depois", () => {
    useWorldStore.getState().spawn({ gid: 1, kind: "mob", job: 1002, x: 2, y: 2, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 1, hits: 1, staggerMs: 140, color: "#c9f3ff" });
    expect(sprite.created.length).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(sprite.created.length).toBe(1);
  });

  it("hits=3 (poucos hits): 3 fragmentos, espaçados por staggerMs — nenhum antes da hora", () => {
    useWorldStore.getState().spawn({ gid: 2, kind: "mob", job: 1002, x: 5, y: 5, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 2, hits: 3, staggerMs: 100, color: "#ff9d3a" });
    expect(sprite.created.length).toBe(1);
    vi.advanceTimersByTime(99);
    expect(sprite.created.length).toBe(1);
    vi.advanceTimersByTime(2);
    expect(sprite.created.length).toBe(2);
    vi.advanceTimersByTime(100);
    expect(sprite.created.length).toBe(3);
  });

  it("hits=2: exatamente 2 fragmentos", () => {
    useWorldStore.getState().spawn({ gid: 30, kind: "mob", job: 1002, x: 8, y: 8, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 30, hits: 2, staggerMs: 100, color: "#c9f3ff" });
    vi.advanceTimersByTime(200);
    expect(sprite.created.length).toBe(2);
  });

  it("hits=10 (muitos hits, teto REAL do skill_db pra Cold Bolt/Fire Lance/Thunder Storm/Light Bolt nível 10): 10 fragmentos — o VFX não decide/limita a quantidade, só o `hits` recebido", () => {
    useWorldStore.getState().spawn({ gid: 3, kind: "mob", job: 1002, x: 1, y: 1, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 3, hits: 10, staggerMs: 50, color: "#c9f3ff" });
    vi.advanceTimersByTime(50 * 10);
    expect(sprite.created.length).toBe(10);
  });

  it("hits=50 (muito acima de qualquer skill real hoje): fica DENTRO do teto visual (VISUAL_SHARD_CAP=20) — REAL COMBAT COUNT ≠ VISUAL INSTANCE COUNT, nunca cria 50 instâncias", () => {
    useWorldStore.getState().spawn({ gid: 31, kind: "mob", job: 1002, x: 4, y: 9, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 31, hits: 50, staggerMs: 10, color: "#c9f3ff" });
    vi.advanceTimersByTime(10 * 50);
    expect(sprite.created.length).toBe(20);
  });

  it("crítico: todos os fragmentos ficam maiores (CRITICAL_SCALE_MULTIPLIER), não crítico fica no tamanho normal", () => {
    useWorldStore.getState().spawn({ gid: 20, kind: "mob", job: 1002, x: 0, y: 0, dir: 0, speed: 150 });
    useWorldStore.getState().spawn({ gid: 21, kind: "mob", job: 1002, x: 3, y: 3, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 20, hits: 2, staggerMs: 100, color: "#fff", critical: true });
    spawnMultiHitShards({ targetGid: 21, hits: 2, staggerMs: 100, color: "#fff", critical: false });
    vi.advanceTimersByTime(200);
    const critScales = sprite.created.filter((c) => c.position.x === 0).map((c) => c.scale);
    const normalScales = sprite.created.filter((c) => c.position.x === 3).map((c) => c.scale);
    for (const s of critScales) expect(s).toBeGreaterThan(1);
    for (const s of normalScales) expect(s).toBe(1);
  });

  it("cor vem do payload — dois casts com cores diferentes não vazam cor entre si", () => {
    useWorldStore.getState().spawn({ gid: 22, kind: "mob", job: 1002, x: 10, y: 10, dir: 0, speed: 150 });
    useWorldStore.getState().spawn({ gid: 23, kind: "mob", job: 1002, x: 11, y: 11, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 22, hits: 2, staggerMs: 100, color: "#ff9d3a" });
    spawnMultiHitShards({ targetGid: 23, hits: 2, staggerMs: 100, color: "#c9f3ff" });
    vi.advanceTimersByTime(200);
    const fireColors = sprite.created.filter((c) => c.position.x === 10).map((c) => c.color);
    const iceColors = sprite.created.filter((c) => c.position.x === 11).map((c) => c.color);
    for (const c of fireColors) expect(c).toBe("#ff9d3a");
    for (const c of iceColors) expect(c).toBe("#c9f3ff");
  });

  it("hit que mata o mob: fragmentos seguintes pousam na MESMA posição do 1º, nunca no sentinela {0,-999,0}", () => {
    useWorldStore.getState().spawn({ gid: 4, kind: "mob", job: 1002, x: 7, y: 3, dir: 0, speed: 150, hp: 100, maxHp: 100 });
    spawnMultiHitShards({ targetGid: 4, hits: 5, staggerMs: 100, color: "#c9f3ff" });
    const posicaoDoHit1 = sprite.created[0]!.position;
    expect(posicaoDoHit1).toEqual({ x: 7, y: 0, z: 3 });

    // o próprio hit 1 já matou o mob (dano já foi todo resolvido pelo
    // servidor num único instante) — morte/despawn acontecem ANTES dos
    // fragmentos 2-5 ainda tocarem.
    useWorldStore.getState().setHp(4, 0, 100);
    useWorldStore.getState().vanish(4);

    vi.advanceTimersByTime(500);
    expect(sprite.created.length).toBe(5);
    for (const c of sprite.created) {
      expect(c.position).toEqual(posicaoDoHit1);
      expect(c.position).not.toEqual({ x: 0, y: -999, z: 0 });
    }
  });

  it("respawn do gid entre hits: fragmentos antigos NUNCA saltam pro mob novo", () => {
    useWorldStore.getState().spawn({ gid: 7, kind: "mob", job: 1002, x: 2, y: 2, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 7, hits: 3, staggerMs: 100, color: "#c9f3ff" });
    const posOriginal = sprite.created[0]!.position;

    useWorldStore.getState().vanish(7);
    // respawn: MESMO gid, monstro NOVO, célula bem diferente
    useWorldStore.getState().spawn({ gid: 7, kind: "mob", job: 1002, x: 20, y: 20, dir: 0, speed: 150 });

    vi.advanceTimersByTime(300);
    expect(sprite.created.length).toBe(3);
    for (const c of sprite.created) {
      expect(c.position).toEqual(posOriginal);
      expect(c.position).not.toEqual({ x: 20, y: 0, z: 20 });
    }
  });

  it("vários monstros simultâneos: fragmentos de um cast não vazam pra posição do outro", () => {
    useWorldStore.getState().spawn({ gid: 5, kind: "mob", job: 1002, x: 1, y: 1, dir: 0, speed: 150 });
    useWorldStore.getState().spawn({ gid: 6, kind: "mob", job: 1002, x: 9, y: 9, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 5, hits: 3, staggerMs: 100, color: "#c9f3ff" });
    spawnMultiHitShards({ targetGid: 6, hits: 3, staggerMs: 100, color: "#ff9d3a" });

    vi.advanceTimersByTime(300);
    expect(sprite.created.length).toBe(6);
    const posicoes = sprite.created.map((c) => c.position);
    expect(posicoes.filter((p) => p.x === 1 && p.z === 1).length).toBe(3);
    expect(posicoes.filter((p) => p.x === 9 && p.z === 9).length).toBe(3);
  });

  it("clearPendingMultiHitShards cancela fragmentos ainda não disparados (troca de mapa/reset de sessão)", () => {
    useWorldStore.getState().spawn({ gid: 8, kind: "mob", job: 1002, x: 4, y: 4, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 8, hits: 5, staggerMs: 100, color: "#c9f3ff" });
    expect(sprite.created.length).toBe(1);

    clearPendingMultiHitShards();
    vi.advanceTimersByTime(1000);
    expect(sprite.created.length).toBe(1); // os outros 4 nunca dispararam
  });

  it("cada fragmento é uma instância PRÓPRIA — nenhuma renderização duplicada/compartilhada entre hits", () => {
    useWorldStore.getState().spawn({ gid: 9, kind: "mob", job: 1002, x: 3, y: 6, dir: 0, speed: 150 });
    spawnMultiHitShards({ targetGid: 9, hits: 4, staggerMs: 80, color: "#c9f3ff" });
    vi.advanceTimersByTime(80 * 4);
    const ids = sprite.created.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // todo id é único, nenhum reaproveitado entre hits
  });
});
