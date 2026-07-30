import { describe, expect, it } from "vitest";
import { createMovementController, DEFAULT_MOVEMENT_CONFIG } from "./index";
import type { CellLattice, MovementState, TerrainQuery } from "./types";

/** flat world, everything walkable except x >= 40 (a wall) */
const terrain: TerrainQuery = {
  getHeight: () => 0,
  isWalkable: (x) => x < 40,
};

const start = (): MovementState => ({
  position: { x: 12.5, y: 0, z: 12.5 }, // center of cell (2,2) with cellSize 5
  heading: 0,
  moving: false,
});

describe("runtime mode switch (soul.txt §4)", () => {
  it("factory returns the controller matching the config value", () => {
    expect(createMovementController("grid", terrain).mode).toBe("grid");
    expect(createMovementController("free", terrain).mode).toBe("free");
  });

  it("same state can be advanced by either controller after a runtime switch", () => {
    let state = start();
    const grid = createMovementController("grid", terrain);
    state = grid.update(state, { x: 1, z: 0 }, 0.1);
    expect(state.moving).toBe(true);

    // switch mode mid-session: same MovementState flows into the other controller
    const free = createMovementController("free", terrain);
    const afterSwitch = free.update(state, { x: 0, z: 1 }, 0.1);
    expect(afterSwitch.moving).toBe(true);
    expect(afterSwitch.position.z).toBeGreaterThan(state.position.z);
  });
});

describe("GridMovementController", () => {
  it("moves toward the neighbor cell center and snaps on arrival", () => {
    const grid = createMovementController("grid", terrain);
    let state = start();
    // hold right for enough frames to cross one cell (5 units at 14 u/s = ~0.36s)
    for (let i = 0; i < 60; i++) state = grid.update(state, { x: 1, z: 0 }, 1 / 60);
    // ...e até fechar o passo em voo (o snap só vale no fim do passo)
    for (let i = 0; i < 60 && state.stepTarget; i++) state = grid.update(state, { x: 1, z: 0 }, 1 / 60);
    // must land exactly on a cell center (x = cx*5+2.5)
    expect((state.position.x - 2.5) % 5).toBeCloseTo(0, 3);
    expect(state.position.x).toBeGreaterThan(12.5);
    expect(state.position.z).toBeCloseTo(12.5, 3);
  });

  it("quantizes heading to 8 directions", () => {
    const grid = createMovementController("grid", terrain);
    const s = grid.update(start(), { x: 1, z: 1 }, 1 / 60);
    expect(s.heading % (Math.PI / 4)).toBeCloseTo(0, 6);
  });

  it("refuses to step into a non-walkable cell", () => {
    const grid = createMovementController("grid", terrain);
    let state: MovementState = { position: { x: 37.5, y: 0, z: 12.5 }, heading: 0, moving: false };
    for (let i = 0; i < 30; i++) state = grid.update(state, { x: 1, z: 0 }, 1 / 60);
    expect(state.position.x).toBeCloseTo(37.5, 3); // stayed: next cell is the wall
    expect(state.moving).toBe(false);
  });

  it("both modes cover the same distance per second (same world speed)", () => {
    const cfg = { ...DEFAULT_MOVEMENT_CONFIG };
    const grid = createMovementController("grid", terrain, cfg);
    const free = createMovementController("free", terrain, cfg);
    let g = start();
    let f = start();
    for (let i = 0; i < 60; i++) {
      g = grid.update(g, { x: 1, z: 0 }, 1 / 60);
      f = free.update(f, { x: 1, z: 0 }, 1 / 60);
    }
    // grid snaps to cell centers, so allow half a cell of slack — what matters
    // is that neither mode is a multiple of the other (was 15 vs 14 u/s)
    expect(g.position.x - 12.5).toBeCloseTo(f.position.x - 12.5, 0);
  });
});

describe("GridMovementController with a custom lattice (hex maps)", () => {
  /** hex pointy-top, odd-r offset — same layout as apps/game/src/hex/hexGrid */
  const W = 2;
  const V = Math.sqrt(3);
  const hex: CellLattice = {
    toCell(x, z) {
      const cz = Math.round(z / V);
      return { cx: Math.round(x / W - 0.5 * (cz & 1)), cz };
    },
    center: (cx, cz) => ({ x: W * (cx + 0.5 * (cz & 1)), z: V * cz }),
    neighbors: (cx, cz) =>
      (cz & 1
        ? [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]]
        : [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]]
      ).map(([dc, dr]) => ({ cx: cx + dc!, cz: cz + dr! })),
  };
  const cfg = { cellSize: W, gridCellsPerSecond: 14 / W, freeUnitsPerSecond: 14, lattice: hex };

  const at = (cx: number, cz: number): MovementState => {
    const c = hex.center(cx, cz);
    return { position: { x: c.x, y: 0, z: c.z }, heading: 0, moving: false };
  };

  it("stops ON the center of the clicked hexagon", () => {
    const grid = createMovementController("grid", terrain, cfg);
    const goal = hex.center(4, 3);
    let state = at(1, 1);
    for (let i = 0; i < 600 && !(state.moving === false && i > 0); i++) {
      state = grid.update(state, { x: 0, z: 0, target: goal }, 1 / 60);
    }
    expect(state.position.x).toBeCloseTo(goal.x, 3);
    expect(state.position.z).toBeCloseTo(goal.z, 3);
  });

  it("never leaves the hex grid mid-path (every step lands on a center)", () => {
    const grid = createMovementController("grid", terrain, cfg);
    const goal = hex.center(5, 0);
    let state = at(0, 0);
    let steps = 0;
    for (let i = 0; i < 600; i++) {
      const before = state.stepTarget;
      state = grid.update(state, { x: 0, z: 0, target: goal }, 1 / 60);
      if (before && !state.stepTarget) {
        steps++;
        const c = hex.toCell(state.position.x, state.position.z);
        const center = hex.center(c.cx, c.cz);
        expect(Math.hypot(state.position.x - center.x, state.position.z - center.z)).toBeCloseTo(0, 6);
      }
    }
    expect(steps).toBeGreaterThan(0);
  });

  it("does not walk into a blocked hexagon", () => {
    const grid = createMovementController("grid", terrain, cfg); // parede em x >= 40
    let state = at(19, 0); // x = 38, próximo hex passaria de 40
    for (let i = 0; i < 120; i++) state = grid.update(state, { x: 0, z: 0, target: { x: 60, z: 0 } }, 1 / 60);
    expect(state.position.x).toBeLessThan(40);
  });
});

describe("FreeMovementController", () => {
  it("moves continuously (not snapped to grid)", () => {
    const free = createMovementController("free", terrain);
    const s = free.update(start(), { x: 1, z: 0 }, 1 / 60);
    expect(s.position.x).toBeCloseTo(12.5 + 14 / 60, 5);
    expect((s.position.x - 2.5) % 5).not.toBeCloseTo(0, 3);
  });

  it("has free (non-quantized) heading", () => {
    const free = createMovementController("free", terrain);
    const s = free.update(start(), { x: 0.3, z: 1 }, 1 / 60);
    expect(Math.abs(s.heading % (Math.PI / 4))).toBeGreaterThan(1e-3);
  });

  it("blocks against the same wall the grid controller uses", () => {
    const free = createMovementController("free", terrain);
    let state: MovementState = { position: { x: 39.9, y: 0, z: 12.5 }, heading: 0, moving: true };
    state = free.update(state, { x: 1, z: 0 }, 1 / 60);
    expect(state.position.x).toBeCloseTo(39.9, 5);
    expect(state.moving).toBe(false);
  });
});
