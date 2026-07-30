import type {
  CellLattice,
  MovementConfig,
  MovementController,
  MovementInput,
  MovementState,
  TerrainQuery,
} from "./types";

/** 8-direction headings (radians), index = octant. */
const OCTANT = Math.PI / 4;

function quantizeHeading(dx: number, dz: number): number {
  const angle = Math.atan2(dx, dz);
  return Math.round(angle / OCTANT) * OCTANT;
}

/** default lattice: square cells of `cellSize`, origin at the corner */
function squareLattice(cellSize: number): CellLattice {
  return {
    toCell: (x, z) => ({ cx: Math.floor(x / cellSize), cz: Math.floor(z / cellSize) }),
    center: (cx, cz) => ({ x: cx * cellSize + cellSize / 2, z: cz * cellSize + cellSize / 2 }),
  };
}

/**
 * RO-style tile movement: positions snap to cell centers, path advances one
 * neighbor cell at a time, facing quantized to 8 directions.
 *
 * The lattice is pluggable (`config.lattice`): square by default, hexagonal on
 * hex maps. With an explicit neighbor list the step is the neighbor best
 * aligned with the destination (falling back to the next best when blocked),
 * and the facing is the exact step direction — the lattice already quantizes it.
 */
export class GridMovementController implements MovementController {
  readonly mode = "grid" as const;
  private readonly cells: CellLattice;

  constructor(
    private readonly terrain: TerrainQuery,
    private readonly config: MovementConfig,
  ) {
    this.cells = config.lattice ?? squareLattice(config.cellSize);
  }

  /** neighbor cell to step into, best aligned with (dirX,dirZ); null = blocked */
  private pickNeighbor(cur: { cx: number; cz: number }, dirX: number, dirZ: number) {
    const list = this.cells.neighbors!(cur.cx, cur.cz);
    const from = this.cells.center(cur.cx, cur.cz);
    const scored = list
      .map((n) => {
        const c = this.cells.center(n.cx, n.cz);
        const dx = c.x - from.x;
        const dz = c.z - from.z;
        const len = Math.hypot(dx, dz) || 1;
        return { center: c, dot: (dx * dirX + dz * dirZ) / len };
      })
      .sort((a, b) => b.dot - a.dot);
    // dot <= 0 = anda pra trás/de lado do destino: melhor parar que orbitar
    for (const cand of scored) {
      if (cand.dot <= 0) break;
      if (this.terrain.isWalkable(cand.center.x, cand.center.z)) return cand.center;
    }
    return null;
  }

  update(state: MovementState, input: MovementInput, dtSeconds: number): MovementState {
    const speed = this.config.gridCellsPerSecond * this.config.cellSize;

    // A step in flight is committed — finish it before reading new input.
    let goal = state.stepTarget;
    let heading = state.heading;

    if (!goal) {
      const cur = this.cells.toCell(state.position.x, state.position.z);

      // Resolve destination cell: click target wins, else axis input steps one cell.
      let dest = cur;
      if (input.target) {
        dest = this.cells.toCell(input.target.x, input.target.z);
      } else if (input.x !== 0 || input.z !== 0) {
        dest = { cx: cur.cx + Math.sign(input.x), cz: cur.cz + Math.sign(input.z) };
      }

      if (dest.cx === cur.cx && dest.cz === cur.cz) {
        return { ...state, moving: false, stepTarget: undefined };
      }

      if (this.cells.neighbors) {
        // lattice com vizinhança própria (hex): passo = vizinho mais alinhado
        const from = this.cells.center(cur.cx, cur.cz);
        const to = this.cells.center(dest.cx, dest.cz);
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const len = Math.hypot(dx, dz) || 1;
        const next = this.pickNeighbor(cur, dx / len, dz / len);
        if (!next) return { ...state, moving: false, stepTarget: undefined };
        goal = next;
        heading = Math.atan2(next.x - state.position.x, next.z - state.position.z);
      } else {
        const stepX = Math.sign(dest.cx - cur.cx);
        const stepZ = Math.sign(dest.cz - cur.cz);
        const next = this.cells.center(cur.cx + stepX, cur.cz + stepZ);
        if (!this.terrain.isWalkable(next.x, next.z)) {
          return { ...state, moving: false, stepTarget: undefined };
        }
        goal = next;
        heading = quantizeHeading(stepX, stepZ);
      }
    }

    const dx = goal.x - state.position.x;
    const dz = goal.z - state.position.z;
    const dist = Math.hypot(dx, dz);
    const maxStep = speed * dtSeconds;

    let nx: number;
    let nz: number;
    let arrived: boolean;

    if (dist <= maxStep) {
      nx = goal.x;
      nz = goal.z;
      arrived = true;
    } else {
      nx = state.position.x + (dx / dist) * maxStep;
      nz = state.position.z + (dz / dist) * maxStep;
      arrived = false;
    }

    return {
      position: { x: nx, y: this.terrain.getHeight(nx, nz), z: nz },
      heading,
      moving: true,
      stepTarget: arrived ? undefined : goal,
    };
  }
}
