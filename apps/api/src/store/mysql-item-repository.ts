import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { Item } from "@ragnarok/game-data";
import type { ItemListQuery, ItemListResult, ItemRepository } from "./item-repository.js";
import { itemToMysqlRow, mysqlRowToItem, type MysqlItem, type MysqlItemRow } from "./mysql-item-row.js";
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

	constructor(table = "item_db_re") {
		this.table = table;
	}

	async list({ page, pageSize, search }: ItemListQuery): Promise<ItemListResult> {
		const db = roDatabase();
		const where: string[] = [];
		const params: unknown[] = [];

		if (search) {
			where.push("(name_english LIKE ? OR name_aegis LIKE ?" + (/^\d+$/.test(search) ? " OR id = ?" : "") + ")");
			params.push(`%${search}%`, `%${search}%`);
			if (/^\d+$/.test(search)) params.push(Number(search));
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

		return {
			items: rows.map((row) => mysqlRowToItem(row as MysqlItemRow)),
			total,
			page,
			pageSize,
		};
	}

	async get(id: number): Promise<Item | undefined> {
		const db = roDatabase();
		const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM \`${this.table}\` WHERE id = ?`, [id]);
		const row = rows[0];
		return row ? mysqlRowToItem(row as MysqlItemRow) : undefined;
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

export type ReloadKind = "itemdb" | "mobdb" | "skilldb" | "script" | "battleconf";

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
