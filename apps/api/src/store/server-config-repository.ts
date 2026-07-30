import type { ServerConfig } from "@ragnarok/game-data";

/** server_config é singleton (uma linha). Só get/save. version/updatedAt
 * são bumpados pela rota. */
export interface ServerConfigRepository {
  get(): Promise<ServerConfig>;
  save(config: ServerConfig): Promise<ServerConfig>;
}
