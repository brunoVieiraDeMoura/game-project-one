import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Admin identity resolved from a Supabase Auth token + accounts row. */
export interface AdminIdentity {
  accountId: number;
  username: string;
  groupLevel: number;
}

/** Minimum accounts.group_level allowed to mutate content. */
export const ADMIN_MIN_GROUP_LEVEL = 10;

export interface SecurityContext {
  /** Resolve Bearer token → admin identity, or null when invalid/not provisioned. */
  verify(token: string): Promise<AdminIdentity | null>;
  /** Append an admin_audit_log row (soul.txt §5.8). */
  audit(entry: {
    actor: AdminIdentity;
    /** "create" | "update" | "delete" | "ban" | "unban" | ... */
    action: string;
    targetType: string;
    targetId: string;
    reason?: string;
    payload?: unknown;
  }): Promise<void>;
}

interface CacheEntry {
  identity: AdminIdentity | null;
  expiresAt: number;
}

const TOKEN_CACHE_TTL_MS = 60_000;

/**
 * Supabase-backed security: token → auth.getUser → accounts.auth_user_id.
 * Short-lived cache keeps admin CRUD from paying one auth round trip per
 * request.
 */
export class SupabaseSecurity implements SecurityContext {
  private readonly client: SupabaseClient;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async verify(token: string): Promise<AdminIdentity | null> {
    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.identity;

    const identity = await this.resolve(token);
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(token, { identity, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
    return identity;
  }

  private async resolve(token: string): Promise<AdminIdentity | null> {
    const { data: userData, error: userError } = await this.client.auth.getUser(token);
    if (userError || !userData.user) return null;

    const { data: account, error: accountError } = await this.client
      .from("accounts")
      .select("id, username, group_level")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();
    if (accountError || !account) return null;

    return {
      accountId: account.id as number,
      username: account.username as string,
      groupLevel: account.group_level as number,
    };
  }

  async audit(entry: Parameters<SecurityContext["audit"]>[0]): Promise<void> {
    const { error } = await this.client.from("admin_audit_log").insert({
      actor_account_id: entry.actor.accountId,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId,
      reason: entry.reason ?? null,
      payload: entry.payload ?? null,
    });
    // audit failure must not fail the admin action, but must be visible
    if (error) console.error(`admin_audit_log insert failed: ${error.message}`);
  }
}
