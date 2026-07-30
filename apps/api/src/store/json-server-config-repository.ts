import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ServerConfigSchema, type ServerConfig } from "@ragnarok/game-data";
import type { ServerConfigRepository } from "./server-config-repository";
import { DEFAULT_SERVER_CONFIG } from "./default-server-config";

/** Dev-mode singleton store. Sem arquivo = usa o default. */
export class JsonServerConfigRepository implements ServerConfigRepository {
  private config: ServerConfig;

  constructor(private readonly dataPath: string) {
    if (existsSync(dataPath)) {
      const parsed = ServerConfigSchema.safeParse(JSON.parse(readFileSync(dataPath, "utf-8")));
      this.config = parsed.success ? parsed.data : DEFAULT_SERVER_CONFIG;
    } else {
      this.config = DEFAULT_SERVER_CONFIG;
    }
  }

  async get(): Promise<ServerConfig> {
    return this.config;
  }

  async save(config: ServerConfig): Promise<ServerConfig> {
    this.config = config;
    mkdirSync(dirname(this.dataPath), { recursive: true });
    await writeFile(this.dataPath, JSON.stringify(config, null, 1), "utf-8");
    return config;
  }
}
