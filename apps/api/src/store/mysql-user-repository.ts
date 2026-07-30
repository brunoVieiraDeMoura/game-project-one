import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { AccountSchema, type Account, type AdminAuditEntry, type LoginHistoryEntry } from "@ragnarok/game-data";
import type {
	AccountDetail,
	AccountListQuery,
	AccountListResult,
	AuditQuery,
	AuditResult,
	BanInput,
	UserRepository,
} from "./user-repository.js";
import { roDatabase } from "./mysql.js";

/**
 * Contas direto da tabela `login` do rAthena.
 *
 * Aqui não existe "tabela de contas do painel": a conta é a do servidor de
 * jogo, e banir alguém é mexer no que o login-server lê no próximo login.
 *
 * O rAthena banir de dois jeitos diferentes:
 *  - `state = 5` → "conta banida" permanente (a mensagem que o cliente mostra);
 *  - `unban_time` → timestamp UNIX até quando o login é recusado (ban temporário).
 * Não há coluna de MOTIVO — isso é nosso, e vive em `panel_account_ban`
 * (criada aqui, fora do schema do rAthena, para não sujar a tabela dele).
 */
export class MysqlUserRepository implements UserRepository {
	private ready: Promise<void> | null = null;

	/** Cria a tabela auxiliar de motivos na primeira vez que for usada. */
	private async ensureSchema(): Promise<void> {
		this.ready ??= (async () => {
			await roDatabase().query(`CREATE TABLE IF NOT EXISTS \`panel_account_ban\` (
				\`id\` int(11) unsigned NOT NULL AUTO_INCREMENT,
				\`account_id\` int(11) unsigned NOT NULL,
				\`reason\` varchar(255) NOT NULL,
				\`banned_at\` datetime NOT NULL DEFAULT current_timestamp(),
				\`expires_at\` datetime DEFAULT NULL,
				\`lifted_at\` datetime DEFAULT NULL,
				\`banned_by\` int(11) unsigned NOT NULL DEFAULT 0,
				PRIMARY KEY (\`id\`),
				KEY \`conta\` (\`account_id\`, \`lifted_at\`)
			) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4`);

			await roDatabase().query(`CREATE TABLE IF NOT EXISTS \`panel_audit_log\` (
				\`id\` int(11) unsigned NOT NULL AUTO_INCREMENT,
				\`actor_account_id\` int(11) unsigned NOT NULL DEFAULT 0,
				\`action\` varchar(40) NOT NULL,
				\`target_type\` varchar(40) NOT NULL,
				\`target_id\` varchar(64) NOT NULL,
				\`reason\` varchar(255) DEFAULT NULL,
				\`at\` datetime NOT NULL DEFAULT current_timestamp(),
				PRIMARY KEY (\`id\`),
				KEY \`alvo\` (\`target_type\`, \`target_id\`)
			) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4`);
		})();
		return this.ready;
	}

	async listAccounts({ page, pageSize, search, bannedOnly }: AccountListQuery): Promise<AccountListResult> {
		await this.ensureSchema();
		const db = roDatabase();
		const where: string[] = [];
		const params: unknown[] = [];

		if (search) {
			where.push(`(userid LIKE ? OR email LIKE ?${/^\d+$/.test(search) ? " OR account_id = ?" : ""})`);
			params.push(`%${search}%`, `%${search}%`);
			if (/^\d+$/.test(search)) params.push(Number(search));
		}
		if (bannedOnly) {
			// state 5 = banido; unban_time no futuro = suspensão temporária
			where.push("(state = 5 OR unban_time > UNIX_TIMESTAMP())");
		}

		const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
		const [countRows] = await db.query<RowDataPacket[]>(
			`SELECT COUNT(*) AS total FROM \`login\` ${whereSql}`,
			params,
		);
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT account_id, userid, email, group_id, state, unban_time, lastlogin FROM \`login\`
			 ${whereSql} ORDER BY account_id LIMIT ? OFFSET ?`,
			[...params, pageSize, (page - 1) * pageSize],
		);

		const accounts = await Promise.all(rows.map((row) => this.toAccount(row)));
		return { accounts, total: Number(countRows[0]?.total ?? 0), page, pageSize };
	}

	async getAccount(id: number): Promise<AccountDetail | undefined> {
		await this.ensureSchema();
		const db = roDatabase();
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT account_id, userid, email, group_id, state, unban_time, lastlogin FROM \`login\` WHERE account_id = ?`,
			[id],
		);
		const row = rows[0];
		if (!row) return undefined;

		const account = await this.toAccount(row);

		// `loginlog` é do próprio rAthena (registro de cada tentativa de login).
		const [history] = await db.query<RowDataPacket[]>(
			`SELECT time, ip FROM \`loginlog\` WHERE user LIKE ? ORDER BY time DESC LIMIT 20`,
			[String(row.userid)],
		);
		const loginHistory: LoginHistoryEntry[] = history.map((h) => ({
			accountId: id,
			at: new Date(h.time as string).toISOString(),
			ip: String(h.ip ?? ""),
		}));

		const [past] = await db.query<RowDataPacket[]>(
			`SELECT reason, banned_at, expires_at, banned_by FROM \`panel_account_ban\`
			 WHERE account_id = ? AND lifted_at IS NOT NULL ORDER BY id DESC LIMIT 20`,
			[id],
		);

		return {
			...account,
			loginHistory,
			banHistory: past.map((b) => ({
				reason: String(b.reason),
				bannedAt: new Date(b.banned_at as string).toISOString(),
				expiresAt: b.expires_at ? new Date(b.expires_at as string).toISOString() : null,
				bannedByAccountId: Number(b.banned_by ?? 0),
			})),
		};
	}

	async ban(accountId: number, input: BanInput): Promise<Account | undefined> {
		await this.ensureSchema();
		const db = roDatabase();
		const [rows] = await db.query<RowDataPacket[]>(`SELECT account_id FROM \`login\` WHERE account_id = ?`, [
			accountId,
		]);
		if (!rows[0]) return undefined;

		// Um ban ativo por conta (CLAUDE.md): o novo levanta o anterior.
		await db.query(`UPDATE \`panel_account_ban\` SET lifted_at = NOW() WHERE account_id = ? AND lifted_at IS NULL`, [
			accountId,
		]);
		await db.query(
			`INSERT INTO \`panel_account_ban\` (account_id, reason, expires_at, banned_by) VALUES (?, ?, ?, ?)`,
			[accountId, input.reason, input.expiresAt ? new Date(input.expiresAt) : null, input.byAccountId],
		);

		if (input.expiresAt) {
			// temporário: o login-server compara unban_time com o relógio
			await db.query(`UPDATE \`login\` SET unban_time = ? WHERE account_id = ?`, [
				Math.floor(new Date(input.expiresAt).getTime() / 1000),
				accountId,
			]);
		} else {
			// permanente: state 5 é o código de "conta banida" do rAthena
			await db.query(`UPDATE \`login\` SET state = 5, unban_time = 0 WHERE account_id = ?`, [accountId]);
		}

		return (await this.getAccount(accountId)) ?? undefined;
	}

	async unban(accountId: number): Promise<Account | undefined> {
		await this.ensureSchema();
		const db = roDatabase();
		const [result] = await db.query<ResultSetHeader>(
			`UPDATE \`login\` SET state = 0, unban_time = 0 WHERE account_id = ?`,
			[accountId],
		);
		if (result.affectedRows === 0) return undefined;

		await db.query(`UPDATE \`panel_account_ban\` SET lifted_at = NOW() WHERE account_id = ? AND lifted_at IS NULL`, [
			accountId,
		]);
		return (await this.getAccount(accountId)) ?? undefined;
	}

	async listAudit({ page, pageSize, targetType, actorAccountId }: AuditQuery): Promise<AuditResult> {
		await this.ensureSchema();
		const db = roDatabase();
		const where: string[] = [];
		const params: unknown[] = [];

		if (targetType) {
			where.push("target_type = ?");
			params.push(targetType);
		}
		if (actorAccountId) {
			where.push("actor_account_id = ?");
			params.push(actorAccountId);
		}

		const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
		const [countRows] = await db.query<RowDataPacket[]>(
			`SELECT COUNT(*) AS total FROM \`panel_audit_log\` ${whereSql}`,
			params,
		);
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT * FROM \`panel_audit_log\` ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
			[...params, pageSize, (page - 1) * pageSize],
		);

		const entries: AdminAuditEntry[] = rows.map((r) => ({
			id: Number(r.id),
			actorAccountId: Number(r.actor_account_id),
			action: String(r.action),
			targetType: String(r.target_type),
			targetId: String(r.target_id),
			reason: r.reason ? String(r.reason) : undefined,
			at: new Date(r.at as string).toISOString(),
		}));

		return { entries, total: Number(countRows[0]?.total ?? 0), page, pageSize };
	}

	private async toAccount(row: RowDataPacket): Promise<Account> {
		const db = roDatabase();
		const accountId = Number(row.account_id);

		const [chars] = await db.query<RowDataPacket[]>(`SELECT char_id FROM \`char\` WHERE account_id = ?`, [
			accountId,
		]);
		const [ban] = await db.query<RowDataPacket[]>(
			`SELECT reason, banned_at, expires_at, banned_by FROM \`panel_account_ban\`
			 WHERE account_id = ? AND lifted_at IS NULL ORDER BY id DESC LIMIT 1`,
			[accountId],
		);

		const unbanTime = Number(row.unban_time ?? 0);
		const bannedInServer = Number(row.state ?? 0) === 5 || unbanTime > Date.now() / 1000;
		const banRow = ban[0];

		return AccountSchema.parse({
			id: accountId,
			username: String(row.userid),
			email: row.email ? String(row.email) : undefined,
			// group_id do rAthena É o nível de permissão (99 = GM total)
			groupLevel: Number(row.group_id ?? 0),
			// a tabela `login` não guarda data de criação; o mais próximo honesto
			// é o último login (e null quando nunca logou)
			createdAt: row.lastlogin ? new Date(row.lastlogin as string).toISOString() : new Date(0).toISOString(),
			lastLoginAt: row.lastlogin ? new Date(row.lastlogin as string).toISOString() : null,
			ban:
				bannedInServer && banRow
					? {
							reason: String(banRow.reason),
							bannedAt: new Date(banRow.banned_at as string).toISOString(),
							expiresAt: banRow.expires_at ? new Date(banRow.expires_at as string).toISOString() : null,
							bannedByAccountId: Number(banRow.banned_by ?? 0),
						}
					: bannedInServer
						? {
								// banido direto no servidor (por GM, @ban), sem passar pelo painel
								reason: "banido fora do painel",
								bannedAt: new Date().toISOString(),
								expiresAt: unbanTime > 0 ? new Date(unbanTime * 1000).toISOString() : null,
								bannedByAccountId: 0,
							}
						: null,
			characterIds: chars.map((c) => Number(c.char_id)),
		});
	}
}
