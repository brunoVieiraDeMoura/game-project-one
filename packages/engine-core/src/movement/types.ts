export type MovementMode = "grid" | "free";

/**
 * Terrain access shared by BOTH controllers (skill-r3f-conventions): the game
 * app implements this once over the shared Rapier heightfield collider.
 * Controllers never duplicate collision logic — only input handling and
 * snapping behavior differ between grid and free.
 */
export interface TerrainQuery {
  /** ground height (world Y) at world x/z */
  getHeight(x: number, z: number): number;
  /** false = wall/cliff/blocked cell */
  isWalkable(x: number, z: number): boolean;
}

export interface MovementInput {
  /** continuous axes, -1..1 (WASD). Used by free mode; grid mode uses it for 8-dir stepping. */
  x: number;
  z: number;
  /** click-to-move destination in world units (both modes accept it; grid resolves to cell) */
  target?: { x: number; z: number } | undefined;
}

export interface MovementState {
  position: { x: number; y: number; z: number };
  /** facing in radians around Y; grid mode quantizes to 8 directions */
  heading: number;
  moving: boolean;
  /** grid mode: cell-center step currently in flight (cleared on arrival/switch) */
  stepTarget?: { x: number; z: number } | undefined;
}

/**
 * Cell lattice used by grid mode. Default: SQUARE grid of `cellSize`.
 * Hex maps inject their own (apps/game/src/hex/hexLattice.ts) so click-to-move
 * steps hexagon by hexagon and stops on the hexagon CENTER — otherwise the
 * character walks a square lattice that has nothing to do with the tiles it is
 * standing on, and the ground cursor never matches where it stops.
 */
export interface CellLattice {
  toCell(x: number, z: number): { cx: number; cz: number };
  center(cx: number, cz: number): { x: number; z: number };
  /**
   * Neighbors of a cell, any order — the controller picks the one best aligned
   * with the direction to the destination. Omitted = step by sign on both axes
   * (square lattice, 8 directions).
   */
  neighbors?(cx: number, cz: number): { cx: number; cz: number }[];
}

export interface MovementConfig {
  /** world units per grid cell (see map-format cellSize) */
  cellSize: number;
  /** grid mode speed, cells per second */
  gridCellsPerSecond: number;
  /** free mode speed, world units per second */
  freeUnitsPerSecond: number;
  /** grid mode lattice; omitted = square grid of `cellSize` */
  lattice?: CellLattice | undefined;
}

export interface MovementController {
  readonly mode: MovementMode;
  /**
   * Pure step function: previous state + input + dt → next state.
   * No rendering concerns, no Rapier types — the R3F layer applies the
   * resulting position to the kinematic body.
   */
  update(state: MovementState, input: MovementInput, dtSeconds: number): MovementState;
}

/**
 * Both modes move at the SAME world speed (14 units/s): grid mode is expressed
 * in cells/s, so it is the same number divided by `cellSize`. Click-to-move and
 * WASD must not feel different — only the pathing does.
 */
export const DEFAULT_MOVEMENT_CONFIG: MovementConfig = {
  cellSize: 5,
  gridCellsPerSecond: 14 / 5,
  freeUnitsPerSecond: 14,
};
