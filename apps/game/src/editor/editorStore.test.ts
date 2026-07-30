import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameMap, MapSpawn } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { hexToWorld, setHexScale } from "../hex/hexGrid";
import { NEIGHBOR_BY_EDGE } from "../hex/hexTiles";
import { propSpread } from "../props/registry";

/**
 * Comportamentos do gerador que o usuário pediu explicitamente:
 *  • arrastar um nó de estrada RELIGA o traçado (não recria a rede inteira);
 *  • nenhum asset auto-gerado nasce em cima de outro (área real, não 1 hex);
 *  • água nunca é atravessada: a estrada para na margem (sem vau nem ponte);
 *  • peça de chão da paleta substitui o tile, em vez de virar prop em cima.
 */

function blankMap(w = 40, h = 40): GameMap {
  const n = w * h;
  return {
    id: "t",
    name: "t",
    size: { width: w, height: h },
    cellSize: 1,
    terrainMode: "blocks",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
    ramps: [],
    props: [],
    spawns: [],
    triggers: [],
  } as unknown as GameMap;
}

function roadNode(id: string, col: number, row: number): MapSpawn {
  const { x, z } = hexToWorld(col, row);
  return { id, kind: "road_node", position: [x, 0, z] } as MapSpawn;
}

/** células viradas estrada, como chave estável pra comparar traçados */
const roadSet = () => new Set(useEditorStore.getState().roadCells);

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ roadCells: [], riverCells: [], fordCells: [], past: [], future: [] });
});

describe("generateRoads — arrastar nó religa em vez de recriar", () => {
  it("gerar duas vezes sem mexer em nada dá exatamente o mesmo traçado", () => {
    const map = blankMap();
    map.spawns = [roadNode("a", 4, 4), roadNode("b", 30, 8), roadNode("c", 12, 32)];
    const s = useEditorStore.getState();
    s.init(map);
    s.generateRoads();
    const first = roadSet();
    useEditorStore.getState().generateRoads();
    expect(roadSet()).toEqual(first);
    expect(first.size).toBeGreaterThan(10);
  });

  it("mover um nó preserva o trecho que NÃO toca nele", () => {
    const map = blankMap();
    // a—b e a—c: mover c não pode mexer no traçado a—b
    map.spawns = [roadNode("a", 4, 4), roadNode("b", 34, 6), roadNode("c", 8, 34)];
    const s = useEditorStore.getState();
    s.init(map);
    s.generateRoads();
    const before = roadSet();

    // arrasta o nó "c" (mesmo caminho do editor: updateSpawn + generateRoads)
    const st = useEditorStore.getState();
    const idx = st.map!.spawns.findIndex((sp) => sp.id === "c");
    const dest = hexToWorld(20, 34);
    st.updateSpawn(idx, { position: [dest.x, 0, dest.z] });
    useEditorStore.getState().generateRoads();
    const after = roadSet();

    // o traçado mudou (o nó saiu do lugar)...
    expect(after).not.toEqual(before);
    // ...mas o miolo do trecho a—b (longe de c, nas duas versões) sobreviveu:
    // sem seed estável, TODO trecho re-serpenteava e a interseção despencava.
    const kept = [...before].filter((c) => after.has(c)).length;
    expect(kept / before.size).toBeGreaterThan(0.5);
  });

  it("o ♻ (reroll) SORTEIA outra rede — o botão normal repete a mesma", () => {
    const map = blankMap();
    const s = useEditorStore.getState();
    s.init(map);
    s.generateRoads();
    const primeiro = roadSet();
    useEditorStore.getState().generateRoads(); // gerar de novo: idêntico
    expect(roadSet()).toEqual(primeiro);
    useEditorStore.getState().generateRoads(true); // ♻: rede diferente
    const depois = roadSet();
    expect(depois).not.toEqual(primeiro);
    expect(depois.size).toBeGreaterThan(5);
  });

  it("o ♻ não deixa nó automático órfão pra trás", () => {
    const map = blankMap();
    const s = useEditorStore.getState();
    s.init(map);
    s.generateRoads();
    const antes = useEditorStore.getState().map!.spawns.filter((sp) => sp.id.startsWith("autoroad_"));
    useEditorStore.getState().generateRoads(true);
    const depois = useEditorStore.getState().map!.spawns.filter((sp) => sp.id.startsWith("autoroad_"));
    expect(depois.length).toBeGreaterThanOrEqual(2);
    expect(depois.length).toBeLessThanOrEqual(antes.length + 1); // trocados, não somados
    expect(depois.map((sp) => sp.id)).not.toEqual(antes.map((sp) => sp.id));
  });

  it("nós automáticos persistem entre gerações (não são re-sorteados)", () => {
    const map = blankMap();
    const s = useEditorStore.getState();
    s.init(map);
    s.generateRoads(); // sem nós manuais → cria os "autoroad_"
    const auto1 = useEditorStore.getState().map!.spawns.filter((sp) => sp.id.startsWith("autoroad_"));
    expect(auto1.length).toBeGreaterThanOrEqual(2);
    useEditorStore.getState().generateRoads();
    const auto2 = useEditorStore.getState().map!.spawns.filter((sp) => sp.id.startsWith("autoroad_"));
    expect(auto2.map((sp) => sp.id)).toEqual(auto1.map((sp) => sp.id));
    expect(auto2.map((sp) => sp.position)).toEqual(auto1.map((sp) => sp.position));
  });
});

describe("generateRoads — água nunca é atravessada", () => {
  it("a estrada para na margem do rio: sem vau, sem ponte", () => {
    const map = blankMap();
    // rio vertical atravessando o mapa na coluna 20
    for (let row = 0; row < map.size.height; row++) {
      const i = row * map.size.width + 20;
      map.surface[i] = "river";
      map.collision[i] = "water";
    }
    map.spawns = [roadNode("a", 4, 20), roadNode("b", 36, 20)]; // nós em margens opostas
    const s = useEditorStore.getState();
    s.init(map);
    s.generateRoads();
    const st = useEditorStore.getState();
    const m = st.map!;
    expect(st.fordCells).toHaveLength(0);
    expect(m.props.filter((p) => p.tags?.[1] === "bridge")).toHaveLength(0);
    // nenhuma célula de rio virou estrada nem ficou andável
    for (let row = 0; row < m.size.height; row++) {
      const i = row * m.size.width + 20;
      expect(m.surface[i]).toBe("river");
      expect(m.collision[i]).toBe("water");
    }
    // e a estrada existe dos DOIS lados (o traçado só foi cortado pela água)
    const cols = st.roadCells.map((i) => i % m.size.width);
    expect(Math.min(...cols)).toBeLessThan(20);
    expect(Math.max(...cols)).toBeGreaterThan(20);
  });

  it("lago no caminho também corta a estrada", () => {
    const map = blankMap();
    for (let row = 8; row < 32; row++)
      for (let col = 18; col < 23; col++) {
        const i = row * map.size.width + col;
        map.surface[i] = "water";
        map.collision[i] = "water";
      }
    map.spawns = [roadNode("a", 4, 20), roadNode("b", 36, 20)];
    const s = useEditorStore.getState();
    s.init(map);
    s.generateRoads();
    const m = useEditorStore.getState().map!;
    for (const i of useEditorStore.getState().roadCells) expect(m.surface[i]).toBe("dirt");
    for (let row = 8; row < 32; row++)
      for (let col = 18; col < 23; col++) expect(m.surface[row * m.size.width + col]).toBe("water");
  });
});

describe("generateRoads — rampa em morro", () => {
  it("toda rampa cai num trecho RETO do traçado (a peça é uma estrada reta)", () => {
    const map = blankMap(24, 24);
    // degrau de 1 nível no meio do mapa; a estrada tem que subir por ele
    for (let row = 0; row < map.size.height; row++)
      for (let col = 0; col < map.size.width; col++)
        map.heightmap[row * map.size.width + col] = col >= 12 ? 1 : 0;
    map.spawns = [roadNode("a", 2, 12), roadNode("b", 21, 12)];
    const s = useEditorStore.getState();
    s.init(map);
    s.generateRoads();
    const m = useEditorStore.getState().map!;
    const W = m.size.width;
    expect(m.ramps.length).toBeGreaterThan(0);
    for (let i = 0; i + 1 < m.ramps.length; i += 2) {
      const cell = m.ramps[i]!, down = m.ramps[i + 1]!;
      const col = cell % W, row = Math.floor(cell / W);
      const lvl = m.heightmap[cell] ?? 0;
      // o lado ALTO (oposto ao de descida) tem que estar exatamente 1 acima...
      const ring = NEIGHBOR_BY_EDGE[row & 1]!;
      const up = ring[(down + 3) % 6]!;
      const upIdx = (row + up[1]) * W + (col + up[0]);
      expect(m.heightmap[upIdx]).toBe(lvl + 1);
      // ...e o lado de DESCIDA no mesmo nível, senão a peça fica no ar
      const dn = ring[down]!;
      const dnIdx = (row + dn[1]) * W + (col + dn[0]);
      expect(m.heightmap[dnIdx]).toBe(lvl);
      // os dois lados são estrada: a faixa da peça continua o traçado
      expect(m.surface[upIdx]).toBe("dirt");
      expect(m.surface[dnIdx]).toBe("dirt");
    }
  });
});

describe("peça de chão colocada à mão", () => {
  it("estrada da paleta vira SUPERFÍCIE (não sobra grama por baixo)", () => {
    const map = blankMap(12, 12);
    const s = useEditorStore.getState();
    s.init(map);
    useEditorStore.getState().placeTileAsset(5, 5, "hex_road_a");
    const m = useEditorStore.getState().map!;
    const i = 5 * m.size.width + 5;
    expect(m.surface[i]).toBe("dirt");
    expect(m.collision[i]).toBe("walkable");
    expect(m.props).toHaveLength(0); // nada de objeto solto em cima do tile
  });

  it("rio da paleta pinta água e bloqueia", () => {
    const map = blankMap(12, 12);
    const s = useEditorStore.getState();
    s.init(map);
    useEditorStore.getState().placeTileAsset(3, 4, "hex_river_a");
    const m = useEditorStore.getState().map!;
    const i = 4 * m.size.width + 3;
    expect(m.surface[i]).toBe("river");
    expect(m.collision[i]).toBe("water");
  });

  it("a peça engole os props que estavam na célula", () => {
    const map = blankMap(12, 12);
    const { x, z } = hexToWorld(5, 5);
    map.props = [{ id: "t1", assetId: "hex_tree_single_a", position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1], colliderType: "hull" }] as GameMap["props"];
    const s = useEditorStore.getState();
    s.init(map);
    useEditorStore.getState().placeTileAsset(5, 5, "hex_road_a");
    expect(useEditorStore.getState().map!.props).toHaveLength(0);
  });

  it("rampa da paleta grava a borda de descida pro vizinho mais alto", () => {
    const map = blankMap(12, 12);
    // vizinho leste (borda 0 na linha par) um nível acima
    map.heightmap[6 * map.size.width + 6] = 1;
    const s = useEditorStore.getState();
    s.init(map);
    useEditorStore.getState().placeTileAsset(5, 6, "hex_grass_sloped_high");
    const m = useEditorStore.getState().map!;
    const cell = 6 * m.size.width + 5;
    const flat = m.ramps;
    const at = flat.indexOf(cell);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(flat[at + 1]).toBe(3); // desce pela oposta à borda 0 (o lado alto)
  });
});

describe("geração procedural — nada nasce em cima de nada", () => {
  it("assets de categorias diferentes não se sobrepõem", () => {
    setHexScale(1);
    const map = blankMap(60, 60);
    const s = useEditorStore.getState();
    s.init(map);
    // liga todas as espécies das duas categorias e enche o mapa
    useEditorStore.setState({ procDisabled: {} });
    useEditorStore.getState().setCategoryAmount("tree", 100);
    useEditorStore.getState().setCategoryAmount("mountain", 100);
    const props = useEditorStore.getState().map!.props;
    expect(props.length).toBeGreaterThan(5);
    for (let i = 0; i < props.length; i++)
      for (let j = i + 1; j < props.length; j++) {
        const a = props[i]!, b = props[j]!;
        const d = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
        const rr = propSpread(a.assetId, a.scale[0]!) + propSpread(b.assetId, b.scale[0]!);
        expect(d).toBeGreaterThanOrEqual(rr);
      }
  });

  it("não gera em cima de rio/estrada nem do spawn do jogador", () => {
    setHexScale(1);
    const map = blankMap(40, 40);
    const start = hexToWorld(20, 20);
    map.spawns = [{ id: "p", kind: "player_start", position: [start.x, 0, start.z] } as MapSpawn];
    for (let row = 0; row < map.size.height; row++) {
      const i = row * map.size.width + 10;
      map.surface[i] = "river";
      map.collision[i] = "water";
    }
    const s = useEditorStore.getState();
    s.init(map);
    useEditorStore.setState({ procDisabled: {} });
    useEditorStore.getState().setCategoryAmount("tree", 100);
    const props = useEditorStore.getState().map!.props;
    for (const p of props) {
      expect(Math.hypot(p.position[0] - start.x, p.position[2] - start.z)).toBeGreaterThan(1);
      const col = Math.round(p.position[0] / (Math.sqrt(3) * (2 / Math.sqrt(3))));
      expect(col).not.toBe(10); // coluna do rio
    }
  });
});
