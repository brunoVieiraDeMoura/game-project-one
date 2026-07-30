import { describe, expect, it } from "vitest";
import type { GameMap, MapProp } from "@ragnarok/map-format";
import { createHexTerrainQuery } from "./hexTerrainQuery";
import { propDeck } from "../props/registry";
import { hexToWorld, levelToY, setHexScale } from "./hexGrid";
import { colliderForAsset, propHull, propRadius } from "../props/registry";

/**
 * Colisão dos props: o movimento (player/monstro/NPC) roda pelo
 * MovementController, que só enxerga TerrainQuery — então o bloqueio TEM que
 * sair daqui, na FORMA real do modelo (hull da base medido do glTF) × a escala
 * do prop, não num círculo grosseiro.
 */

function blankMap(w = 8, h = 8): GameMap {
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

function prop(assetId: string, col: number, row: number, scale: number, ry = 0): MapProp {
  const { x, z } = hexToWorld(col, row);
  return {
    id: `${assetId}_${col}_${row}`,
    assetId,
    position: [x, 0, z],
    rotation: [0, ry, 0],
    scale: [scale, scale, scale],
    colliderType: "hull",
  } as MapProp;
}

/** mapa com um único prop, pronto pra sondar */
function withProp(assetId: string, scale: number, ry = 0) {
  setHexScale(1);
  const map = blankMap(12, 12);
  map.props = [prop(assetId, 5, 5, scale, ry)];
  return { q: createHexTerrainQuery(map), c: hexToWorld(5, 5) };
}

describe("createHexTerrainQuery — bloco de colisão pela forma do modelo", () => {
  it("o centro de um prop sólido bloqueia e longe dele anda", () => {
    const { q, c } = withProp("hex_building_castle_blue", 1);
    const r = propRadius("hex_building_castle_blue", 1);
    expect(q.isWalkable(c.x, c.z)).toBe(false);
    expect(q.isWalkable(c.x + r + 2, c.z)).toBe(true);
  });

  it("segue a PLANTA, não um círculo: há ponto livre dentro do raio envolvente", () => {
    const asset = "hex_building_castle_blue";
    const { q, c } = withProp(asset, 5); // escala real do catálogo
    const hull = propHull(asset)!;
    const r = propRadius(asset, 5);
    expect(hull.length).toBeGreaterThanOrEqual(3);
    // varre o anel do raio envolvente: um círculo bloquearia tudo; a planta não
    let livres = 0;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      if (q.isWalkable(c.x + Math.cos(a) * r * 0.98, c.z + Math.sin(a) * r * 0.98)) livres++;
    }
    expect(livres).toBeGreaterThan(0);
  });

  it("cada vértice do hull bloqueia (não dá pra entrar pela parede)", () => {
    const asset = "hex_building_castle_blue";
    const { q, c } = withProp(asset, 1);
    for (const [hx, hz] of propHull(asset)!) {
      // um tico PRA DENTRO do vértice: tem que estar bloqueado
      expect(q.isWalkable(c.x + hx * 0.9, c.z + hz * 0.9)).toBe(false);
    }
  });

  it("árvore bloqueia pelo TRONCO, não pela copa", () => {
    const asset = "hex_tree_single_a";
    const { q, c } = withProp(asset, 5);
    const r = propRadius(asset, 5); // tronco já escalado
    expect(q.isWalkable(c.x, c.z)).toBe(false); // no tronco, não passa
    // o tronco tem que ser bem mais estreito que o hexágono (apótema 1.0):
    // com o footprint pela copa, dava pra ficar preso a meio hex de distância
    expect(r).toBeLessThan(0.8);
    expect(q.isWalkable(c.x + 0.9, c.z)).toBe(true);
  });

  it("o bloqueio ACOMPANHA a escala do prop", () => {
    const asset = "hex_building_castle_blue";
    const probe = propRadius(asset, 1) + 1.2;
    const small = withProp(asset, 1);
    const big = withProp(asset, 4);
    expect(small.q.isWalkable(small.c.x + probe, small.c.z)).toBe(true);
    expect(big.q.isWalkable(big.c.x + probe, big.c.z)).toBe(false);
  });

  it("a forma gira junto com o prop", () => {
    // hull alongado: acha a direção mais comprida e a mais curta
    const asset = "hex_building_barracks_blue";
    const hull = propHull(asset)!;
    let far: [number, number] = [0, 0], near: [number, number] = [0, 0];
    let maxD = -1, minD = Infinity;
    for (const [hx, hz] of hull) {
      const d = Math.hypot(hx, hz);
      if (d > maxD) { maxD = d; far = [hx, hz]; }
      if (d < minD) { minD = d; near = [hx, hz]; }
    }
    if (maxD - minD < 0.15) return; // asset quase redondo: nada a provar aqui
    const semRot = withProp(asset, 1, 0);
    // ponto logo além do vértice mais distante, na direção dele
    const k = (maxD + 0.6) / maxD;
    const px = far[0] * k, pz = far[1] * k;
    expect(semRot.q.isWalkable(semRot.c.x + px, semRot.c.z + pz)).toBe(true);
    // agora gira 90°: o mesmo ponto do mundo cai noutra parte da planta
    const rot = withProp(asset, 1, Math.PI / 2);
    const antes = semRot.q.isWalkable(semRot.c.x + px, semRot.c.z + pz);
    const depois = rot.q.isWalkable(rot.c.x + px, rot.c.z + pz);
    // pelo menos um ponto do anel muda de estado com a rotação
    let mudou = antes !== depois;
    for (let i = 0; i < 36 && !mudou; i++) {
      const a = (i / 36) * Math.PI * 2;
      const qx = Math.cos(a) * maxD * 0.95, qz = Math.sin(a) * maxD * 0.95;
      if (semRot.q.isWalkable(semRot.c.x + qx, semRot.c.z + qz) !== rot.q.isWalkable(rot.c.x + qx, rot.c.z + qz)) mudou = true;
    }
    expect(mudou).toBe(true);
  });

  it("props sem colisão (grama/arbusto/ponte/estrada) não bloqueiam", () => {
    setHexScale(1);
    const map = blankMap();
    const bridge = prop("hex_bridge_a", 3, 3, 5);
    bridge.colliderType = "none"; // é o que colliderForCategory("bridge") grava
    map.props = [bridge];
    const c = hexToWorld(3, 3);
    expect(createHexTerrainQuery(map).isWalkable(c.x, c.z)).toBe(true);
  });

  it("mapa salvo antes do colliderType cai na regra de categoria", () => {
    setHexScale(1);
    const map = blankMap();
    const legacy = prop("hex_mountain_a", 3, 3, 1);
    delete (legacy as { colliderType?: unknown }).colliderType;
    map.props = [legacy];
    const c = hexToWorld(3, 3);
    expect(createHexTerrainQuery(map).isWalkable(c.x, c.z)).toBe(false);
  });

  it("plantação e terra batida deixam passar (são decalques no chão)", () => {
    setHexScale(1);
    for (const asset of ["hex_building_grain", "hex_building_dirt"]) {
      const map = blankMap(12, 12);
      const p = prop(asset, 5, 5, 5);
      // como o editor grava: o colliderType sai de colliderForAsset
      p.colliderType = colliderForAsset(asset);
      map.props = [p];
      const c = hexToWorld(5, 5);
      expect(colliderForAsset(asset)).toBe("none");
      expect(createHexTerrainQuery(map).isWalkable(c.x, c.z)).toBe(true);
    }
    // e uma construção normal continua barrando
    expect(colliderForAsset("hex_building_castle_blue")).toBe("hull");
  });

  it("ponte sobre a água vira passagem, na altura MEDIDA do tabuleiro", () => {
    setHexScale(1);
    const map = blankMap(12, 12);
    const W = map.size.width;
    // rio na coluna 5, margens no nível 1
    for (let row = 0; row < map.size.height; row++) {
      map.surface[row * W + 5] = "river";
      map.collision[row * W + 5] = "water";
      map.heightmap[row * W + 4] = 1;
      map.heightmap[row * W + 6] = 1;
    }
    const c = hexToWorld(5, 5);
    const semPonte = createHexTerrainQuery(map);
    expect(semPonte.isWalkable(c.x, c.z)).toBe(false); // água barra

    const bridge = prop("hex_bridge_a", 5, 5, 1);
    bridge.colliderType = "none";
    map.props = [bridge];
    const comPonte = createHexTerrainQuery(map);
    expect(comPonte.isWalkable(c.x, c.z)).toBe(true);
    // anda no TABULEIRO, não no fundo do rio: a altura sai do modelo
    // (propDeck × escala do prop), não de um palpite pelo nível da margem —
    // assim o chão bate com o que está desenhado. Ver hex/bridge.test.ts.
    const deck = propDeck("hex_bridge_a")!;
    expect(comPonte.getHeight(c.x, c.z)).toBeCloseTo(bridge.position[1] + deck.y, 5);
    expect(comPonte.getHeight(c.x, c.z)).toBeGreaterThan(semPonte.getHeight(c.x, c.z));
    // a água ao lado, sem ponte, continua bloqueada
    const vizinho = hexToWorld(5, 8);
    expect(comPonte.isWalkable(vizinho.x, vizinho.z)).toBe(false);
  });

  it("água continua bloqueando e terreno livre segue andável", () => {
    setHexScale(1);
    const map = blankMap();
    const c = hexToWorld(2, 2);
    expect(createHexTerrainQuery(map).isWalkable(c.x, c.z)).toBe(true);
    map.collision[2 * map.size.width + 2] = "water";
    expect(createHexTerrainQuery(map).isWalkable(c.x, c.z)).toBe(false);
  });
});
