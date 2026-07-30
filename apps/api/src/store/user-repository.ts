import type { Account, AdminAuditEntry, LoginHistoryEntry } from "@ragnarok/game-data";

export interface AccountListQuery {
  page: number;
  pageSize: number;
  /** username/email substring ou id numérico */
  search?: string | undefined;
  /** filtra só contas com ban ativo */
  bannedOnly?: boolean | undefined;
}

export interface AccountListResult {
  accounts: Account[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AccountDetail extends Account {
  loginHistory: LoginHistoryEntry[];
  /** bans anteriores já expirados/levantados, mais recente primeiro */
  banHistory: Account["ban"][];
}

export interface BanInput {
  reason: string;
  /** null = permanente */
  expiresAt: string | null;
  byAccountId: number;
}

export interface AuditQuery {
  page: number;
  pageSize: number;
  targetType?: string | undefined;
  actorAccountId?: number | undefined;
}

export interface AuditResult {
  entries: AdminAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/** Módulo Usuários (soul.txt §5.8): leitura de contas + ban/unban + auditoria.
 * Tudo admin-only (dados sensíveis; sem GET público). */
export interface UserRepository {
  listAccounts(query: AccountListQuery): Promise<AccountListResult>;
  getAccount(id: number): Promise<AccountDetail | undefined>;
  /** aplica ban; devolve a conta atualizada ou undefined se não existe */
  ban(accountId: number, input: BanInput): Promise<Account | undefined>;
  /** levanta o ban ativo; devolve a conta ou undefined se não existe */
  unban(accountId: number): Promise<Account | undefined>;
  listAudit(query: AuditQuery): Promise<AuditResult>;
}
