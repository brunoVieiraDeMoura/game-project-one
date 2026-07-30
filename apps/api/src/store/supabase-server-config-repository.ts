import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ServerConfigSchema, type ServerConfig } from "@ragnarok/game-data";
import type { ServerConfigRepository } from "./server-config-repository";
import { DEFAULT_SERVER_CONFIG } from "./default-server-config";

/**
 * Singleton em Supabase: tabela `server_config`, linha fixa id=1, config em
 * jsonb. Cache curto (TTL) pra hot-reload sem restart: leituras servem do
 * cache até expirar; save invalida na hora.
 */
export class SupabaseServerConfigRepository implements ServerConfigRepository {
  private readonly client: SupabaseClient;
  private static readonly ROW_ID = 1;
  private static readonly TTL_MS = 5000;
  private cache: { value: ServerConfig; at: number } | null = null;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async get(): Promise<ServerConfig> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < SupabaseServerConfigRepository.TTL_MS) {
      return this.cache.value;
    }
    const { data, error } = await this.client
      .from("server_config")
      .select("config")
      .eq("id", SupabaseServerConfigRepository.ROW_ID)
      .maybeSingle();
    if (error) throw new Error(`supabase server_config get failed: ${error.message}`);
    const value = data ? ServerConfigSchema.parse(data.config) : await this.save(DEFAULT_SERVER_CONFIG);
    this.cache = { value, at: now };
    return value;
  }

  async save(config: ServerConfig): Promise<ServerConfig> {
    const { error } = await this.client
      .from("server_config")
      .upsert({ id: SupabaseServerConfigRepository.ROW_ID, config, updated_at: new Date().toISOString() });
    if (error) throw new Error(`supabase server_config save failed: ${error.message}`);
    this.cache = { value: config, at: Date.now() }; // invalida/atualiza na hora
    return config;
  }
}
