import { describe, expect, it } from "vitest";
import { createMovementController, DEFAULT_MOVEMENT_CONFIG, type MovementState } from "@ragnarok/engine-core";
import type { GameMap } from "@ragnarok/map-format";
import { createHexTerrainQuery } from "../hex/hexTerrainQuery";
import { hexToWorld, setHexScale, HEX_W } from "../hex/hexGrid";
import { HEX_LATTICE } from "../hex/hexLattice";

/**
 * Fluxo completo do clique-tile num mapa hex: destino → controller → terreno.
 * É teste de integração de propósito — o bug que motivou ele (clique "morto")
 * só aparecia com hexScale alto, quando as peças não conversavam entre si.
 */

function mapaPlano(w = 12, h = 12): GameMap {
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
    authoredHexScale: 1,
  } as unknown as GameMap;
}

/** roda o controller por `segundos` com passo fixo e devolve o estado final */
function simular(escala: number, destinoCel: { col: number; row: number }, segundos = 6) {
  setHexScale(escala);
  const map = mapaPlano();
  const terrain = createHexTerrainQuery(map);
  const inicio = hexToWorld(2, 2);
  const destino = hexToWorld(destinoCel.col, destinoCel.row);
  const moveSpeed = 20 * escala; // como o PlayView escala (scaleToWorld)
  const cellSize = HEX_W();
  const controller = createMovementController("grid", terrain, {
    ...DEFAULT_MOVEMENT_CONFIG,
    cellSize,
    freeUnitsPerSecond: moveSpeed,
    gridCellsPerSecond: moveSpeed / cellSize,
    lattice: HEX_LATTICE,
  });
  let state: MovementState = {
    position: { x: inicio.x, y: terrain.getHeight(inicio.x, inicio.z), z: inicio.z },
    heading: 0,
    moving: false,
  };
  const dt = 1 / 60;
  for (let i = 0; i < segundos * 60; i++) state = controller.update(state, { x: 0, z: 0, target: destino }, dt);
  const dist = Math.hypot(state.position.x - destino.x, state.position.z - destino.z);
  return { state, destino, dist, inicio };
}

describe("clique-tile em mapa hex", () => {
  it("anda até o destino na escala nativa", () => {
    const { dist } = simular(1, { col: 6, row: 5 });
    expect(dist).toBeLessThan(0.1);
  });

  it("anda até o destino com o bloco grande (hexScale 10)", () => {
    // o passo, a velocidade e o tamanho da célula têm que escalar juntos —
    // se um deles ficar na escala antiga o personagem trava ou orbita o alvo
    const { dist } = simular(10, { col: 6, row: 5 });
    expect(dist).toBeLessThan(1);
  });

  it("o passo é de um hexágono por vez (não teleporta)", () => {
    setHexScale(4);
    const map = mapaPlano();
    const terrain = createHexTerrainQuery(map);
    const inicio = hexToWorld(2, 2);
    const destino = hexToWorld(7, 2);
    const cellSize = HEX_W();
    const controller = createMovementController("grid", terrain, {
      ...DEFAULT_MOVEMENT_CONFIG,
      cellSize,
      freeUnitsPerSecond: 80,
      gridCellsPerSecond: 80 / cellSize,
      lattice: HEX_LATTICE,
    });
    let state: MovementState = { position: { x: inicio.x, y: 0, z: inicio.z }, heading: 0, moving: false };
    let maiorSalto = 0;
    for (let i = 0; i < 300; i++) {
      const antes = { ...state.position };
      state = controller.update(state, { x: 0, z: 0, target: destino }, 1 / 60);
      maiorSalto = Math.max(maiorSalto, Math.hypot(state.position.x - antes.x, state.position.z - antes.z));
    }
    expect(maiorSalto).toBeLessThan(cellSize); // nunca pula um hexágono inteiro num frame
  });

  it("com a célula do destino bloqueada, para em vez de atravessar", () => {
    setHexScale(4);
    const map = mapaPlano();
    const W = map.size.width;
    // parede vertical na coluna 4
    for (let row = 0; row < map.size.height; row++) map.collision[row * W + 4] = "wall";
    const terrain = createHexTerrainQuery(map);
    const inicio = hexToWorld(2, 2);
    const destino = hexToWorld(8, 2);
    const cellSize = HEX_W();
    const controller = createMovementController("grid", terrain, {
      ...DEFAULT_MOVEMENT_CONFIG,
      cellSize,
      freeUnitsPerSecond: 80,
      gridCellsPerSecond: 80 / cellSize,
      lattice: HEX_LATTICE,
    });
    let state: MovementState = { position: { x: inicio.x, y: 0, z: inicio.z }, heading: 0, moving: false };
    for (let i = 0; i < 600; i++) state = controller.update(state, { x: 0, z: 0, target: destino }, 1 / 60);
    const paredeX = hexToWorld(4, 2).x;
    expect(state.position.x).toBeLessThan(paredeX);
  });
});
