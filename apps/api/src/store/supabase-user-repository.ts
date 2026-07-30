import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@ragnarok/game-data";
import type {
  AccountDetail,
  AccountListQuery,
  AccountListResult,
  AuditQuery,
  AuditResult,
  BanInput,
  UserRepository,
} from "./user-repository";

function sanitizeSearch(search: string): string {
  return search.replace(/[,()%\\]/g, " ").trim();
}

interface AccountRow {
  id: number;
  username: string;
  email: string | null;
  group_level: number;
  created_at: string;
  last_login_at: string | null;
}

interface BanRow {
  id: number;
  account_id: number;
  reason: string;
  banned_at: string;
  expires_at: string | null;
  banned_by: number;
  lifted_at: string | null;
}

/** ban ativo = não levantado e (permanente ou ainda não expirado) */
function activeBanOf(bans: BanRow[], now: number): Account["ban"] {
  const active = bans.find(
    (b) => b.lifted_at === null && (b.expires_at === null || new Date(b.expires_at).getTime() > now),
  );
  if (!active) return null;
  return {
    reason: active.reason,
    bannedAt: active.banned_at,
    expiresAt: active.expires_at,
    bannedByAccountId: active.banned_by,
  };
}

function rowToAccount(row: AccountRow, bans: BanRow[], characterIds: number[], now: number): Account {
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? undefined,
    groupLevel: row.group_level,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    ban: activeBanOf(bans, now),
    characterIds,
  };
}

/** UserRepository backed by hosted Supabase (accounts/account_bans/
 * login_history/admin_audit_log da migração inicial). */
export class SupabaseUserRepository implements UserRepository {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private async bansFor(accountIds: number[]): Promise<Map<number, BanRow[]>> {
    const map = new Map<number, BanRow[]>();
    if (accountIds.length === 0) return map;
    const { data, error } = await this.client
      .from("account_bans")
      .select("*")
      .in("account_id", accountIds)
      .order("banned_at", { ascending: false });
    if (error) throw new Error(`supabase bans fetch failed: ${error.message}`);
    for (const b of data as BanRow[]) {
      const list = map.get(b.account_id) ?? [];
      list.push(b);
      map.set(b.account_id, list);
    }
    return map;
  }

  private async characterIdsFor(accountIds: number[]): Promise<Map<number, number[]>> {
    const map = new Map<number, number[]>();
    if (accountIds.length === 0) return map;
    const { data, error } = await this.client
      .from("characters")
      .select("id, account_id")
      .in("account_id", accountIds);
    if (error) throw new Error(`supabase characters fetch failed: ${error.message}`);
    for (const c of data as { id: number; account_id: number }[]) {
      const list = map.get(c.account_id) ?? [];
      list.push(c.id);
      map.set(c.account_id, list);
    }
    return map;
  }

  async listAccounts({ page, pageSize, search, bannedOnly }: AccountListQuery): Promise<AccountListResult> {
    let query = this.client.from("accounts").select("*", { count: "exact" });

    if (bannedOnly) {
      const nowIso = new Date().toISOString();
      const { data: banRows, error: banErr } = await this.client
        .from("account_bans")
        .select("account_id, expires_at, lifted_at")
        .is("lifted_at", null);
      if (banErr) throw new Error(`supabase banned filter failed: ${banErr.message}`);
      const ids = [
        ...new Set(
          (banRows as { account_id: number; expires_at: string | null }[])
            .filter((b) => b.expires_at === null || b.expires_at > nowIso)
            .map((b) => b.account_id),
        ),
      ];
      if (ids.length === 0) return { accounts: [], total: 0, page, pageSize };
      query = query.in("id", ids);
    }

    if (search) {
      const q = sanitizeSearch(search);
      if (q) {
        const filters = [`username.ilike.*${q}*`, `email.ilike.*${q}*`];
        if (/^\d+$/.test(q)) filters.push(`id.eq.${q}`);
        query = query.or(filters.join(","));
      }
    }

    const start = (page - 1) * pageSize;
    const { data, error, count } = await query.order("id").range(start, start + pageSize - 1);
    if (error && error.code === "PGRST103") return { accounts: [], total: count ?? 0, page, pageSize };
    if (error) throw new Error(`supabase list accounts failed: ${error.message}`);

    const rows = data as AccountRow[];
    const ids = rows.map((r) => r.id);
    const now = Date.now();
    const [bans, chars] = await Promise.all([this.bansFor(ids), this.characterIdsFor(ids)]);
    return {
      accounts: rows.map((r) => rowToAccount(r, bans.get(r.id) ?? [], chars.get(r.id) ?? [], now)),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async getAccount(id: number): Promise<AccountDetail | undefined> {
    const { data, error } = await this.client.from("accounts").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase get account failed: ${error.message}`);
    if (!data) return undefined;

    const now = Date.now();
    const [bans, chars] = await Promise.all([this.bansFor([id]), this.characterIdsFor([id])]);
    const banRows = bans.get(id) ?? [];

    const { data: loginRows, error: loginErr } = await this.client
      .from("login_history")
      .select("account_id, at, ip")
      .eq("account_id", id)
      .order("at", { ascending: false })
      .limit(50);
    if (loginErr) throw new Error(`supabase login history failed: ${loginErr.message}`);

    const account = rowToAccount(data as AccountRow, banRows, chars.get(id) ?? [], now);
    return {
      ...account,
      loginHistory: (loginRows as { account_id: number; at: string; ip: string | null }[]).map((l) => ({
        accountId: l.account_id,
        at: l.at,
        ip: l.ip ?? "",
      })),
      banHistory: banRows
        .filter((b) => b.lifted_at !== null || (b.expires_at !== null && new Date(b.expires_at).getTime() <= now))
        .map((b) => ({
          reason: b.reason,
          bannedAt: b.banned_at,
          expiresAt: b.expires_at,
          bannedByAccountId: b.banned_by,
        })),
    };
  }

  async ban(accountId: number, input: BanInput): Promise<Account | undefined> {
    const { data: acc, error: accErr } = await this.client
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .maybeSingle();
    if (accErr) throw new Error(`supabase ban account lookup failed: ${accErr.message}`);
    if (!acc) return undefined;

    // levanta ban ativo anterior antes de aplicar o novo (um ativo por vez)
    await this.client
      .from("account_bans")
      .update({ lifted_at: new Date().toISOString() })
      .eq("account_id", accountId)
      .is("lifted_at", null);

    const { error } = await this.client.from("account_bans").insert({
      account_id: accountId,
      reason: input.reason,
      expires_at: input.expiresAt,
      banned_by: input.byAccountId,
    });
    if (error) throw new Error(`supabase ban insert failed: ${error.message}`);
    return this.reloadAccount(accountId);
  }

  async unban(accountId: number): Promise<Account | undefined> {
    const { data: acc, error: accErr } = await this.client
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .maybeSingle();
    if (accErr) throw new Error(`supabase unban account lookup failed: ${accErr.message}`);
    if (!acc) return undefined;

    const { error } = await this.client
      .from("account_bans")
      .update({ lifted_at: new Date().toISOString() })
      .eq("account_id", accountId)
      .is("lifted_at", null);
    if (error) throw new Error(`supabase unban failed: ${error.message}`);
    return this.reloadAccount(accountId);
  }

  private async reloadAccount(id: number): Promise<Account> {
    const { data } = await this.client.from("accounts").select("*").eq("id", id).single();
    const now = Date.now();
    const [bans, chars] = await Promise.all([this.bansFor([id]), this.characterIdsFor([id])]);
    return rowToAccount(data as AccountRow, bans.get(id) ?? [], chars.get(id) ?? [], now);
  }

  async listAudit({ page, pageSize, targetType, actorAccountId }: AuditQuery): Promise<AuditResult> {
    let query = this.client.from("admin_audit_log").select("*", { count: "exact" });
    if (targetType) query = query.eq("target_type", targetType);
    if (actorAccountId !== undefined) query = query.eq("actor_account_id", actorAccountId);
    const start = (page - 1) * pageSize;
    const { data, error, count } = await query.order("at", { ascending: false }).range(start, start + pageSize - 1);
    if (error && error.code === "PGRST103") return { entries: [], total: count ?? 0, page, pageSize };
    if (error) throw new Error(`supabase list audit failed: ${error.message}`);
    return {
      entries: (
        data as {
          id: number;
          actor_account_id: number;
          action: string;
          target_type: string;
          target_id: string;
          reason: string | null;
          payload: Record<string, unknown> | null;
          at: string;
        }[]
      ).map((e) => ({
        id: e.id,
        actorAccountId: e.actor_account_id,
        action: e.action,
        targetType: e.target_type,
        targetId: e.target_id,
        reason: e.reason ?? undefined,
        payload: e.payload ?? undefined,
        at: e.at,
      })),
      total: count ?? 0,
      page,
      pageSize,
    };
  }
}
