import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { Item } from "@ragnarok/game-data";
import type { ItemListQuery, ItemListResult, ItemRepository } from "./item-repository.js";
import {
	itemSubTypeToRathena,
	itemToMysqlRow,
	itemTypeToRathena,
	mysqlRowToItem,
	type MysqlItem,
	type MysqlItemRow,
} from "./mysql-item-row.js";
import { roDatabase } from "./mysql.js";

/**
 * Itens direto da tabela do rAthena (`item_db_re`).
 *
 * Editar aqui é editar o JOGO: o map-server lê esta tabela na inicialização e
 * em `@reloaditemdb`. Por isso toda escrita enfileira um reload (ver
 * `queueReload`) — sem isso a mudança fica no banco e o jogo continua com o
 * item antigo em memória.
 */
export class MysqlItemRepository implements ItemRepository {
	private readonly table: string;
	private ready: Promise<void> | null = null;

	constructor(table = "item_db_re") {
		this.table = table;
	}

	/**
	 * Ícone do item, fora do `item_db_re` (que não é nossa: é a tabela que o
	 * rAthena lê direto, ver comentário de `mysql-item-row.ts`). Mesmo padrão
	 * de `panel_account_ban`/`panel_audit_log` (`mysql-user-repository.ts`):
	 * tabela auxiliar criada na primeira vez que este repositório é usado,
	 * pra não sujar o schema do jogo.
	 */
	private async ensureSchema(): Promise<void> {
		this.ready ??= roDatabase().query(`CREATE TABLE IF NOT EXISTS \`panel_item_icon\` (
			\`item_id\` int(11) unsigned NOT NULL,
			\`filename\` varchar(255) NOT NULL,
			\`updated_at\` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
			PRIMARY KEY (\`item_id\`)
		) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4`).then(() => undefined);
		return this.ready;
	}

	private async iconsFor(ids: number[]): Promise<Map<number, string>> {
		if (ids.length === 0) return new Map();
		await this.ensureSchema();
		const db = roDatabase();
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT item_id, filename FROM \`panel_item_icon\` WHERE item_id IN (${ids.map(() => "?").join(",")})`,
			ids,
		);
		return new Map(rows.map((r) => [Number(r.item_id), String(r.filename)]));
	}

	/** Grava/remove o ícone do item — não passa por `update()` de propósito:
	 * `item_db_re` não tem coluna pra isso (ver `iconsFor`), e um upload de
	 * ícone não deveria exigir o formulário inteiro do item validado. */
	async setIcon(id: number, filename: string | null): Promise<Item | undefined> {
		await this.ensureSchema();
		const db = roDatabase();
		if (filename) {
			await db.query(
				"INSERT INTO `panel_item_icon` (`item_id`, `filename`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `filename` = VALUES(`filename`)",
				[id, filename],
			);
		} else {
			await db.query("DELETE FROM `panel_item_icon` WHERE `item_id` = ?", [id]);
		}
		return this.get(id);
	}

	async list({ page, pageSize, search, type, subType }: ItemListQuery): Promise<ItemListResult> {
		const db = roDatabase();
		const where: string[] = [];
		const params: unknown[] = [];

		if (search) {
			where.push("(name_english LIKE ? OR name_aegis LIKE ?" + (/^\d+$/.test(search) ? " OR id = ?" : "") + ")");
			params.push(`%${search}%`, `%${search}%`);
			if (/^\d+$/.test(search)) params.push(Number(search));
		}
		if (type) {
			const raw = itemTypeToRathena(type);
			// tipo NULL na coluna lê como "etc" (mysqlRowToItem) — o filtro de "etc"
			// tem que casar os dois lados, senão esses itens somem da lista.
			if (type === "etc") {
				where.push("(`type` = ? OR `type` IS NULL)");
				params.push(raw);
			} else {
				where.push("`type` = ?");
				params.push(raw);
			}
		}
		if (subType) {
			const raw = itemSubTypeToRathena(subType);
			if (raw) {
				where.push("`subtype` = ?");
				params.push(raw);
			}
		}

		const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
		const [countRows] = await db.query<RowDataPacket[]>(
			`SELECT COUNT(*) AS total FROM \`${this.table}\` ${whereSql}`,
			params,
		);
		const total = Number(countRows[0]?.total ?? 0);

		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT * FROM \`${this.table}\` ${whereSql} ORDER BY id LIMIT ? OFFSET ?`,
			[...params, pageSize, (page - 1) * pageSize],
		);

		const items = rows.map((row) => mysqlRowToItem(row as MysqlItemRow));
		const icons = await this.iconsFor(items.map((i) => i.id));
		return {
			items: items.map((i) => (icons.has(i.id) ? { ...i, icon: icons.get(i.id) } : i)),
			total,
			page,
			pageSize,
		};
	}

	async get(id: number): Promise<Item | undefined> {
		const db = roDatabase();
		const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM \`${this.table}\` WHERE id = ?`, [id]);
		const row = rows[0];
		if (!row) return undefined;
		const item = mysqlRowToItem(row as MysqlItemRow);
		const icons = await this.iconsFor([id]);
		const icon = icons.get(id);
		return icon ? { ...item, icon } : item;
	}

	async create(item: Item): Promise<Item> {
		const db = roDatabase();
		const existing = await this.get(item.id);
		if (existing) {
			throw Object.assign(new Error(`item ${item.id} já existe`), { code: "DUPLICATE" });
		}

		const row = itemToMysqlRow(item as MysqlItem);
		const columns = Object.keys(row);
		await db.query<ResultSetHeader>(
			`INSERT INTO \`${this.table}\` (${columns.map((c) => `\`${c}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
			columns.map((c) => row[c]),
		);
		await queueReload("itemdb");
		return item;
	}

	async update(id: number, item: Item): Promise<Item | undefined> {
		const db = roDatabase();
		const current = (await this.get(id)) as MysqlItem | undefined;
		if (!current) return undefined;

		// O script cru NÃO vem do formulário do admin (o EffectList tipado não
		// re-serializa); preserva o que está no banco a menos que o chamador
		// mande um novo texto explicitamente.
		const incoming = item as MysqlItem;
		const row = itemToMysqlRow({
			...incoming,
			rawScript: incoming.rawScript ?? current.rawScript,
			rawEquipScript: incoming.rawEquipScript ?? current.rawEquipScript,
			rawUnequipScript: incoming.rawUnequipScript ?? current.rawUnequipScript,
		});

		const columns = Object.keys(row).filter((c) => c !== "id");
		await db.query<ResultSetHeader>(
			`UPDATE \`${this.table}\` SET ${columns.map((c) => `\`${c}\` = ?`).join(", ")} WHERE id = ?`,
			[...columns.map((c) => row[c]), id],
		);
		await queueReload("itemdb");
		return item;
	}

	async remove(id: number): Promise<boolean> {
		const db = roDatabase();
		const [result] = await db.query<ResultSetHeader>(`DELETE FROM \`${this.table}\` WHERE id = ?`, [id]);
		if (result.affectedRows === 0) return false;
		await queueReload("itemdb");
		return true;
	}
}

export type ReloadKind = "itemdb" | "mobdb" | "skilldb" | "script" | "battleconf" | "pcdb" | "statusdb";

/**
 * Pede ao map-server que releia a base.
 *
 * O rAthena não tem porta de administração: quem executa o `@reloaditemdb` é um
 * NPC nosso (`npc-idle/panel.txt`) que consulta esta fila a cada 2 s. Falha aqui
 * não derruba a edição — o dado já está salvo; só o jogo em memória fica velho
 * até o próximo reload.
 */
export async function queueReload(kind: ReloadKind): Promise<void> {
	try {
		await roDatabase().query("INSERT INTO `panel_reload_queue` (`kind`) VALUES (?)", [kind]);
	} catch (err) {
		console.warn(`[api] não deu para enfileirar reload "${kind}":`, (err as Error).message);
	}
}
