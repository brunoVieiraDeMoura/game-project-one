import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { Monster } from "@ragnarok/game-data";
import type { MonsterListQuery, MonsterListResult, MonsterRepository } from "./monster-repository.js";
import {
	monsterElementToRathena,
	monsterToMysqlRow,
	mysqlRowToMonster,
	type MysqlMonsterRow,
} from "./mysql-monster-row.js";
import { queueReload } from "./mysql-item-repository.js";
import { roDatabase } from "./mysql.js";

/**
 * Monstros direto da tabela do rAthena (`mob_db_re`).
 *
 * Mesma ideia do MysqlItemRepository: editar aqui muda o jogo, e toda escrita
 * enfileira `@reloadmobdb`. Monstro já vivo no mapa mantém o status antigo até
 * renascer — o reload troca a FICHA, não os que já estão spawnados.
 */
export class MysqlMonsterRepository implements MonsterRepository {
	private readonly table: string;
	private readonly itemTable: string;

	constructor(table = "mob_db_re", itemTable = "item_db_re") {
		this.table = table;
		this.itemTable = itemTable;
	}

	/**
	 * Traduz os nomes aegis dos drops para id, numa consulta só.
	 *
	 * O rAthena guarda o drop como 'Red_Potion', mas o admin (e o cliente 3D)
	 * falam em id. Resolver item a item seria uma query por drop — dez por
	 * monstro, numa lista de vinte monstros.
	 */
	private async itemIdsByName(rows: MysqlMonsterRow[]): Promise<Map<string, number>> {
		const names = new Set<string>();
		for (const row of rows) {
			for (let i = 1; i <= 10; i++) {
				const name = row[`drop${i}_item`] as string | null;
				if (name) names.add(name);
			}
			for (let i = 1; i <= 3; i++) {
				const name = row[`mvpdrop${i}_item`] as string | null;
				if (name) names.add(name);
			}
		}
		if (names.size === 0) return new Map();

		const list = [...names];
		const [items] = await roDatabase().query<RowDataPacket[]>(
			`SELECT id, name_aegis FROM \`${this.itemTable}\` WHERE name_aegis IN (${list.map(() => "?").join(",")})`,
			list,
		);
		return new Map(items.map((i) => [String(i.name_aegis), Number(i.id)]));
	}

	private async itemNamesById(ids: number[]): Promise<Map<number, string>> {
		if (ids.length === 0) return new Map();
		const [items] = await roDatabase().query<RowDataPacket[]>(
			`SELECT id, name_aegis FROM \`${this.itemTable}\` WHERE id IN (${ids.map(() => "?").join(",")})`,
			ids,
		);
		return new Map(items.map((i) => [Number(i.id), String(i.name_aegis)]));
	}

	async list({ page, pageSize, search, dropsItem, levelMin, levelMax, element }: MonsterListQuery): Promise<MonsterListResult> {
		const db = roDatabase();
		const where: string[] = [];
		const params: unknown[] = [];

		if (search) {
			where.push("(name_english LIKE ? OR name_aegis LIKE ?" + (/^\d+$/.test(search) ? " OR id = ?" : "") + ")");
			params.push(`%${search}%`, `%${search}%`);
			if (/^\d+$/.test(search)) params.push(Number(search));
		}
		// "Quem dropa o item?" — bug antigo: este filtro chegava até aqui e era
		// silenciosamente ignorado (list() só desestruturava page/pageSize/search).
		// O rAthena guarda o drop pelo NOME AEGIS, não pelo id, então resolve
		// primeiro; item inexistente = ninguém dropa, resultado vazio.
		if (dropsItem !== undefined) {
			const names = await this.itemNamesById([dropsItem]);
			const aegis = names.get(dropsItem);
			if (!aegis) return { monsters: [], total: 0, page, pageSize };
			const dropColumns = [
				...Array.from({ length: 10 }, (_, i) => `drop${i + 1}_item`),
				...Array.from({ length: 3 }, (_, i) => `mvpdrop${i + 1}_item`),
			];
			where.push(`(${dropColumns.map((c) => `\`${c}\` = ?`).join(" OR ")})`);
			params.push(...dropColumns.map(() => aegis));
		}
		if (levelMin !== undefined) {
			// nível NULL lê como 1 (mysqlRowToMonster) — sem o OR, uma faixa que
			// cobre o default perderia esses monstros.
			where.push(levelMin <= 1 ? "(`level` >= ? OR `level` IS NULL)" : "`level` >= ?");
			params.push(levelMin);
		}
		if (levelMax !== undefined) {
			where.push(levelMax >= 1 ? "(`level` <= ? OR `level` IS NULL)" : "`level` <= ?");
			params.push(levelMax);
		}
		if (element) {
			where.push("`element` = ?");
			params.push(monsterElementToRathena(element));
		}

		const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
		const [countRows] = await db.query<RowDataPacket[]>(
			`SELECT COUNT(*) AS total FROM \`${this.table}\` ${whereSql}`,
			params,
		);
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT * FROM \`${this.table}\` ${whereSql} ORDER BY id LIMIT ? OFFSET ?`,
			[...params, pageSize, (page - 1) * pageSize],
		);

		const byName = await this.itemIdsByName(rows as MysqlMonsterRow[]);
		return {
			monsters: rows.map((row) => mysqlRowToMonster(row as MysqlMonsterRow, (n) => byName.get(n))),
			total: Number(countRows[0]?.total ?? 0),
			page,
			pageSize,
		};
	}

	async get(id: number): Promise<Monster | undefined> {
		const db = roDatabase();
		const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM \`${this.table}\` WHERE id = ?`, [id]);
		const row = rows[0];
		if (!row) return undefined;
		const byName = await this.itemIdsByName([row as MysqlMonsterRow]);
		return mysqlRowToMonster(row as MysqlMonsterRow, (n) => byName.get(n));
	}

	async create(monster: Monster): Promise<Monster> {
		const db = roDatabase();
		if (await this.get(monster.id)) {
			throw Object.assign(new Error(`monstro ${monster.id} já existe`), { code: "DUPLICATE" });
		}

		const names = await this.itemNamesById(monster.drops.map((d) => d.itemId));
		const row = monsterToMysqlRow(monster, (id) => names.get(id));
		const columns = Object.keys(row);
		await db.query<ResultSetHeader>(
			`INSERT INTO \`${this.table}\` (${columns.map((c) => `\`${c}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
			columns.map((c) => row[c]),
		);
		await queueReload("mobdb");
		return monster;
	}

	async update(id: number, monster: Monster): Promise<Monster | undefined> {
		const db = roDatabase();
		if (!(await this.get(id))) return undefined;

		const names = await this.itemNamesById(monster.drops.map((d) => d.itemId));
		const row = monsterToMysqlRow(monster, (id) => names.get(id));
		const columns = Object.keys(row).filter((c) => c !== "id");
		await db.query<ResultSetHeader>(
			`UPDATE \`${this.table}\` SET ${columns.map((c) => `\`${c}\` = ?`).join(", ")} WHERE id = ?`,
			[...columns.map((c) => row[c]), id],
		);
		await queueReload("mobdb");
		return monster;
	}

	async remove(id: number): Promise<boolean> {
		const db = roDatabase();
		const [result] = await db.query<ResultSetHeader>(`DELETE FROM \`${this.table}\` WHERE id = ?`, [id]);
		if (result.affectedRows === 0) return false;
		await queueReload("mobdb");
		return true;
	}
}
