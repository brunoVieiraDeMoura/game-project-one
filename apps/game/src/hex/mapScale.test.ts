import { describe, expect, it } from "vitest";
import type { GameMap, MapProp, MapSpawn } from "@ragnarok/map-format";
import { scaleMapPositions } from "./mapScale";

/**
 * O terreno cresce sozinho com o hexScale (é desenhado por col/row), mas
 * props/spawns guardam coordenada de MUNDO. Sem reescalar, um mapa autorado em
 * escala 1 aberto com hexScale 10 põe o player na quina do mapa, olhando pra
 * fora, e amontoa os monstros em cima dele.
 */

function mapWith(authored: number): GameMap {
  const n = 4 * 4;
  return {
    id: "t",
    name: "t",
    size: { width: 4, height: 4 },
    cellSize: 1,
    terrainMode: "blocks",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
    ramps: [],
    authoredHexScale: authored,
    props: [
      { id: "p1", assetId: "hex_tree_single_a", position: [10, 2, 20], rotation: [0, 0, 0], scale: [5, 5, 5], colliderType: "hull" } as MapProp,
    ],
    spawns: [
      { id: "s1", kind: "player_start", position: [29, 0, 1.73] } as MapSpawn,
      {
        id: "s2",
        kind: "npc",
        refId: "knight",
        position: [4, 0, 4],
        radius: 8,
        path: { points: [[6, 0, 6] as [number, number, number]], mode: "loop", speed: 3 },
      } as MapSpawn,
    ],
    triggers: [],
  } as unknown as GameMap;
}

describe("scaleMapPositions", () => {
  it("mesma escala: devolve o mapa intacto (sem cópia à toa)", () => {
    const m = mapWith(10);
    expect(scaleMapPositions(m, 10)).toBe(m);
  });

  it("mapa autorado em 1, aberto em 10: posições ×10", () => {
    const out = scaleMapPositions(mapWith(1), 10);
    expect(out.props[0]!.position).toEqual([100, 20, 200]);
    expect(out.spawns[0]!.position[0]).toBeCloseTo(290, 5);
    expect(out.authoredHexScale).toBe(10);
  });

  it("o TAMANHO do prop acompanha (senão a árvore vira mato no bloco grande)", () => {
    const out = scaleMapPositions(mapWith(1), 10);
    expect(out.props[0]!.scale).toEqual([50, 50, 50]);
  });

  it("raio de spawn e rota de patrulha acompanham (são distância de mundo)", () => {
    const out = scaleMapPositions(mapWith(1), 4);
    const npc = out.spawns[1]!;
    expect(npc.radius).toBe(32);
    expect(npc.path!.points[0]).toEqual([24, 0, 24]);
    expect(npc.path!.speed).toBe(12);
  });

  it("também reduz (mapa autorado grande aberto pequeno)", () => {
    const out = scaleMapPositions(mapWith(10), 1);
    expect(out.props[0]!.position).toEqual([1, 0.2, 2]);
  });

  it("mapa sem o campo é tratado como escala nativa (1)", () => {
    const { authoredHexScale: _drop, ...semCampo } = mapWith(1);
    const out = scaleMapPositions(semCampo as GameMap, 3);
    expect(out.props[0]!.position).toEqual([30, 6, 60]);
  });
});
