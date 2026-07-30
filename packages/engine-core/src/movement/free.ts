import type {
  MovementConfig,
  MovementController,
  MovementInput,
  MovementState,
  TerrainQuery,
} from "./types";

/**
 * WoW-style continuous movement: velocity from held input, free heading,
 * ground height and walkability from the same TerrainQuery the grid
 * controller uses (single source of collision truth).
 */
export class FreeMovementController implements MovementController {
  readonly mode = "free" as const;

  constructor(
    private readonly terrain: TerrainQuery,
    private readonly config: MovementConfig,
  ) {}

  update(state: MovementState, input: MovementInput, dtSeconds: number): MovementState {
    let dirX = input.x;
    let dirZ = input.z;

    // click-to-move fallback: steer toward target when no axis input held
    if (dirX === 0 && dirZ === 0 && input.target) {
      const tx = input.target.x - state.position.x;
      const tz = input.target.z - state.position.z;
      const d = Math.hypot(tx, tz);
      if (d > 0.25) {
        dirX = tx / d;
        dirZ = tz / d;
      }
    }

    const mag = Math.hypot(dirX, dirZ);
    if (mag < 1e-6) {
      return {
        ...state,
        position: { ...state.position, y: this.terrain.getHeight(state.position.x, state.position.z) },
        moving: false,
        stepTarget: undefined, // grid-mode leftover is meaningless in free mode
      };
    }

    const nxDir = dirX / mag;
    const nzDir = dirZ / mag;
    const step = this.config.freeUnitsPerSecond * dtSeconds;
    const nx = state.position.x + nxDir * step;
    const nz = state.position.z + nzDir * step;

    // blocked → stay in place (no wall sliding yet; add via axis-separated test later)
    if (!this.terrain.isWalkable(nx, nz)) {
      return { ...state, moving: false, stepTarget: undefined };
    }

    return {
      position: { x: nx, y: this.terrain.getHeight(nx, nz), z: nz },
      heading: Math.atan2(nxDir, nzDir),
      moving: true,
      stepTarget: undefined,
    };
  }
}
