import { FreeMovementController } from "./free";
import { GridMovementController } from "./grid";
import {
  DEFAULT_MOVEMENT_CONFIG,
  type MovementConfig,
  type MovementController,
  type MovementMode,
  type TerrainQuery,
} from "./types";

export * from "./types";
export { GridMovementController } from "./grid";
export { FreeMovementController } from "./free";

/**
 * Runtime-switchable factory (skill-r3f-conventions): the ONLY place that
 * picks a controller implementation. Mode comes from character/server config
 * (ServerConfig.defaultMovementMode in @ragnarok/game-data), never a
 * hardcoded branch at call sites.
 */
export function createMovementController(
  mode: MovementMode,
  terrain: TerrainQuery,
  config: MovementConfig = DEFAULT_MOVEMENT_CONFIG,
): MovementController {
  return mode === "grid"
    ? new GridMovementController(terrain, config)
    : new FreeMovementController(terrain, config);
}
