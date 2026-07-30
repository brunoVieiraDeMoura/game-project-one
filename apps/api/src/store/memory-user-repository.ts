import type { Account, AdminAuditEntry } from "@ragnarok/game-data";
import type {
  AccountDetail,
  AccountListQuery,
  AccountListResult,
  AuditQuery,
  AuditResult,
  BanInput,
  UserRepository,
} from "./user-repository";

interface StoredBan {
  reason: string;
  bannedAt: string;
  expiresAt: string | null;
  bannedByAccountId: number;
  liftedAt: string | null;
}

interface StoredAccount {
  account: Omit<Account, "ban">;
  bans: StoredBan[];
  loginHistory: { accountId: number; at: string; ip: string }[];
}

/**
 * Store em memória pro modo dev (sem Supabase) e testes. Contas reais vivem
 * só no Supabase (Auth); aqui é um stub semeável.
 */
export class MemoryUserRepository implements UserRepository {
  private accounts = new Map<number, StoredAccount>();
  private audit: AdminAuditEntry[] = [];
  private auditSeq = 1;

  seedAccount(account: Omit<Account, "ban">, loginHistory: { at: string; ip: string }[] = []): void {
    this.accounts.set(account.id, {
      account,
      bans: [],
      loginHistory: loginHistory.map((l) => ({ accountId: account.id, ...l })),
    });
  }

  seedAudit(entry: Omit<AdminAuditEntry, "id">): void {
    this.audit.push({ id: this.auditSeq++, ...entry });
  }

  private activeBan(stored: StoredAccount, now: number): Account["ban"] {
    const b = stored.bans.find(
      (x) => x.liftedAt === null && (x.expiresAt === null || new Date(x.expiresAt).getTime() > now),
    );
    return b
      ? { reason: b.reason, bannedAt: b.bannedAt, expiresAt: b.expiresAt, bannedByAccountId: b.bannedByAccountId }
      : null;
  }

  private compose(stored: StoredAccount, now: number): Account {
    return { ...stored.account, ban: this.activeBan(stored, now) };
  }

  async listAccounts({ page, pageSize, search, bannedOnly }: AccountListQuery): Promise<AccountListResult> {
    const now = Date.now();
    let all = [...this.accounts.values()];
    if (search) {
      const q = search.toLowerCase();
      all = all.filter(
        (s) =>
          s.account.username.toLowerCase().includes(q) ||
          (s.account.email?.toLowerCase().includes(q) ?? false) ||
          String(s.account.id) === q,
      );
    }
    if (bannedOnly) all = all.filter((s) => this.activeBan(s, now) !== null);
    all.sort((a, b) => a.account.id - b.account.id);
    const total = all.length;
    const start = (page - 1) * pageSize;
    return {
      accounts: all.slice(start, start + pageSize).map((s) => this.compose(s, now)),
      total,
      page,
      pageSize,
    };
  }

  async getAccount(id: number): Promise<AccountDetail | undefined> {
    const stored = this.accounts.get(id);
    if (!stored) return undefined;
    const now = Date.now();
    return {
      ...this.compose(stored, now),
      loginHistory: [...stored.loginHistory].reverse(),
      banHistory: stored.bans
        .filter((b) => b.liftedAt !== null || (b.expiresAt !== null && new Date(b.expiresAt).getTime() <= now))
        .reverse()
        .map((b) => ({
          reason: b.reason,
          bannedAt: b.bannedAt,
          expiresAt: b.expiresAt,
          bannedByAccountId: b.bannedByAccountId,
        })),
    };
  }

  async ban(accountId: number, input: BanInput): Promise<Account | undefined> {
    const stored = this.accounts.get(accountId);
    if (!stored) return undefined;
    const nowIso = new Date().toISOString();
    for (const b of stored.bans) if (b.liftedAt === null) b.liftedAt = nowIso;
    stored.bans.push({
      reason: input.reason,
      bannedAt: nowIso,
      expiresAt: input.expiresAt,
      bannedByAccountId: input.byAccountId,
      liftedAt: null,
    });
    return this.compose(stored, Date.now());
  }

  async unban(accountId: number): Promise<Account | undefined> {
    const stored = this.accounts.get(accountId);
    if (!stored) return undefined;
    const nowIso = new Date().toISOString();
    for (const b of stored.bans) if (b.liftedAt === null) b.liftedAt = nowIso;
    return this.compose(stored, Date.now());
  }

  async listAudit({ page, pageSize, targetType, actorAccountId }: AuditQuery): Promise<AuditResult> {
    let all = [...this.audit];
    if (targetType) all = all.filter((e) => e.targetType === targetType);
    if (actorAccountId !== undefined) all = all.filter((e) => e.actorAccountId === actorAccountId);
    all.sort((a, b) => b.id - a.id);
    const total = all.length;
    const start = (page - 1) * pageSize;
    return { entries: all.slice(start, start + pageSize), total, page, pageSize };
  }
}
