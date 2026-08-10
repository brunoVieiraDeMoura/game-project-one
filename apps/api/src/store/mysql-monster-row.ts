import { MonsterSchema, type Element, type Monster, type MonsterDrop } from "@ragnarok/game-data";

/**
 * `Monster` ↔ linha de `mob_db_re` (tabela do rAthena).
 *
 * Três diferenças estruturais em relação ao nosso schema:
 *
 *  1. **Drops são 10 grupos de colunas** (`drop1_item`, `drop1_rate`, …) mais 3
 *     de MVP, e não uma lista. A taxa é em 1/10000 lá e em % aqui.
 *  2. **Modos e race groups são coluna booleana por bandeira**
 *     (`mode_aggressive`, `racegroup_goblin`, …).
 *  3. **O drop aponta para o NOME AEGIS do item, não para o id**
 *     (`drop1_item` = 'Apple'). Quem converte é o repositório, que consulta
 *     `item_db_re` — daí as funções abaixo receberem um resolvedor em vez de
 *     adivinharem.
 *
 * Spawns NÃO estão nesta tabela: no rAthena eles são linhas de script NPC
 * (`npc/re/mob/*.txt`), não banco. O admin lista o que veio da migração e não
 * tenta reescrever daqui — mexer em spawn é mexer em script.
 */

export interface MysqlMonsterRow {
	id: number;
	name_aegis: string;
	name_english: string;
	name_japanese: string | null;
	level: number | null;
	hp: number | null;
	sp: number | null;
	base_exp: number | null;
	job_exp: number | null;
	mvp_exp: number | null;
	attack: number | null;
	attack2: number | null;
	defense: number | null;
	magic_defense: number | null;
	resistance: number | null;
	magic_resistance: number | null;
	str: number | null;
	agi: number | null;
	vit: number | null;
	int: number | null;
	dex: number | null;
	luk: number | null;
	attack_range: number | null;
	skill_range: number | null;
	chase_range: number | null;
	size: string | null;
	race: string | null;
	element: string | null;
	element_level: number | null;
	walk_speed: number | null;
	attack_delay: number | null;
	attack_motion: number | null;
	damage_motion: number | null;
	damage_taken: number | null;
	groupid: number | null;
	title: string | null;
	ai: string | null;
	class: string | null;
	[column: string]: unknown;
}

/** Exportado só pra `mysql-monster-row.test.ts` provar que
 * `MONSTER_MODES` (game-data, opções do admin) nunca dessincroniza desta
 * lista real de colunas. */
export const MODE_COLUMNS = [
	"canmove",
	"looter",
	"aggressive",
	"assist",
	"castsensoridle",
	"norandomwalk",
	"nocast",
	"canattack",
	"castsensorchase",
	"changechase",
	"angry",
	"changetargetmelee",
	"changetargetchase",
	"targetweak",
	"randomtarget",
	"ignoremelee",
	"ignoremagic",
	"ignoreranged",
	"mvp",
	"ignoremisc",
	"knockbackimmune",
	"teleportblock",
	"fixeditemdrop",
	"detector",
	"statusimmune",
	"skillimmune",
] as const;

const MAX_DROPS = 10;
const MAX_MVP_DROPS = 3;

/** taxa do rAthena (1/10000) → % */
function rateToPercent(raw: number | null | undefined): number {
	return Math.min(100, Math.max(0, ((raw ?? 0) / 10000) * 100));
}

function percentToRate(percent: number): number {
	return Math.round((percent / 100) * 10000);
}

function truthy(value: unknown): boolean {
	return value === 1 || value === true || value === "1";
}

/** nome aegis do item → id (o repositório monta consultando item_db_re) */
export type ItemIdResolver = (aegisName: string) => number | undefined;
/** id do item → nome aegis (para escrita) */
export type ItemNameResolver = (itemId: number) => string | undefined;

export function mysqlRowToMonster(row: MysqlMonsterRow, resolveItemId: ItemIdResolver): Monster {
	const drops: MonsterDrop[] = [];
	for (let i = 1; i <= MAX_DROPS; i++) {
		const aegis = row[`drop${i}_item`] as string | null;
		const itemId = aegis ? resolveItemId(aegis) : undefined;
		// Drop apontando para item que não existe mais no item_db é dado
		// quebrado do servidor: melhor omitir da lista do que inventar um id.
		if (!itemId) continue;
		drops.push({
			itemId,
			rate: rateToPercent(row[`drop${i}_rate`] as number),
			stealProtected: truthy(row[`drop${i}_nosteal`]),
			randomOptionGroup: (row[`drop${i}_option`] as string | null) ?? undefined,
			index: (row[`drop${i}_index`] as number | null) ?? undefined,
		});
	}
	for (let i = 1; i <= MAX_MVP_DROPS; i++) {
		const aegis = row[`mvpdrop${i}_item`] as string | null;
		const itemId = aegis ? resolveItemId(aegis) : undefined;
		if (!itemId) continue;
		drops.push({
			itemId,
			rate: rateToPercent(row[`mvpdrop${i}_rate`] as number),
			stealProtected: true,
			randomOptionGroup: (row[`mvpdrop${i}_option`] as string | null) ?? undefined,
			index: (row[`mvpdrop${i}_index`] as number | null) ?? undefined,
		});
	}

	const modes = MODE_COLUMNS.filter((mode) => truthy(row[`mode_${mode}`]));

	return MonsterSchema.parse({
		id: row.id,
		aegisName: row.name_aegis,
		name: row.name_english,
		level: row.level ?? 1,
		hp: row.hp ?? 1,
		sp: row.sp ?? 0,
		baseExp: row.base_exp ?? 0,
		jobExp: row.job_exp ?? 0,
		mvpExp: row.mvp_exp ?? 0,
		stats: {
			str: row.str ?? 1,
			agi: row.agi ?? 1,
			vit: row.vit ?? 1,
			int: row.int ?? 1,
			dex: row.dex ?? 1,
			luk: row.luk ?? 1,
		},
		attackRange: row.attack_range ?? 1,
		skillRange: row.skill_range ?? 0,
		chaseRange: row.chase_range ?? 0,
		attack: row.attack ?? 0,
		magicAttack: row.attack2 ?? 0,
		defense: row.defense ?? 0,
		magicDefense: row.magic_defense ?? 0,
		resistance: row.resistance ?? 0,
		magicResistance: row.magic_resistance ?? 0,
		walkSpeed: row.walk_speed ?? 200,
		attackDelayMs: row.attack_delay ?? 0,
		attackMotionMs: row.attack_motion ?? 0,
		damageMotionMs: row.damage_motion ?? 0,
		damageTaken: row.damage_taken ?? 100,
		ai: String(row.ai ?? "06"),
		// `mode_aggressive` é a bandeira que decide se o mob ataca sozinho; o
		// resto do aiMode (assist/looter) vem das outras colunas.
		aiMode: modes.includes("aggressive")
			? "aggressive"
			: modes.includes("looter")
				? "looter"
				: modes.includes("assist")
					? "assist"
					: "passive",
		chasesAttacker: modes.includes("changechase") || modes.includes("changetargetchase"),
		class: (row.class ?? "Normal").toLowerCase(),
		modes,
		raceGroups: Object.keys(row)
			.filter((c) => c.startsWith("racegroup_") && truthy(row[c]))
			.map((c) => c.replace("racegroup_", "")),
		// undefined, nunca 0: espelha o writer (linha ~249) — se o GET reintroduz
		// 0 pra uma linha com groupid NULL, o próximo PUT sem tocar no campo
		// (ex. editar outro atributo e salvar) grava 0 de volta e reproduz o
		// crash de boot que a A26 devia ter fechado (auditoria independente da
		// Fase 3, achado A26b).
		groupId: row.groupid ?? undefined,
		title: row.title ?? undefined,
		race: (row.race ?? "Formless").toLowerCase(),
		element: {
			type: elementFromRathena(row.element ?? "Neutral"),
			level: row.element_level ?? 1,
		},
		size: (row.size ?? "Medium").toLowerCase(),
		drops,
		mvp: modes.includes("mvp"),
	});
}

export function monsterToMysqlRow(monster: Monster, resolveItemName: ItemNameResolver): MysqlMonsterRow {
	const row: MysqlMonsterRow = {
		id: monster.id,
		name_aegis: monster.aegisName,
		name_english: monster.name,
		name_japanese: monster.name,
		level: monster.level,
		hp: monster.hp,
		sp: monster.sp,
		base_exp: monster.baseExp,
		job_exp: monster.jobExp,
		mvp_exp: monster.mvpExp,
		attack: monster.attack,
		attack2: monster.magicAttack,
		defense: monster.defense,
		magic_defense: monster.magicDefense,
		resistance: monster.resistance,
		magic_resistance: monster.magicResistance,
		str: monster.stats.str,
		agi: monster.stats.agi,
		vit: monster.stats.vit,
		int: monster.stats.int,
		dex: monster.stats.dex,
		luk: monster.stats.luk,
		attack_range: monster.attackRange,
		skill_range: monster.skillRange,
		chase_range: monster.chaseRange,
		size: upperFirst(monster.size),
		race: upperFirst(monster.race),
		element: elementToRathena(monster.element.type),
		element_level: monster.element.level,
		walk_speed: monster.walkSpeed,
		attack_delay: monster.attackDelayMs,
		attack_motion: monster.attackMotionMs,
		damage_motion: monster.damageMotionMs,
		damage_taken: monster.damageTaken,
		// null, nunca 0: rAthena rejeita GroupId=0 explícito no load da linha
		// inteira ("Node 'GroupId' needs to be at least 1") — mob_db.cpp exige
		// ausência (NULL) pra "sem grupo", não zero. Reproduzido ao vivo na
		// Fase 3 (docs/audit/fase3-testes/monstros.md).
		groupid: monster.groupId ?? null,
		title: monster.title ?? null,
		ai: monster.ai,
		class: upperFirst(monster.class),
	};

	for (const mode of MODE_COLUMNS) {
		row[`mode_${mode}`] = monster.modes.includes(mode) ? 1 : null;
	}
	for (const group of monster.raceGroups) {
		row[`racegroup_${group}`] = 1;
	}

	// Drops: as 10 fatias são posicionais. Escrevemos todas — inclusive as
	// vazias — porque um drop removido no admin precisa VIRAR NULL no banco, e
	// não ficar pendurado da versão anterior.
	const normal = monster.drops.filter((d) => !d.stealProtected || !monster.mvp).slice(0, MAX_DROPS);
	const mvpDrops = monster.mvp ? monster.drops.filter((d) => d.stealProtected).slice(0, MAX_MVP_DROPS) : [];

	for (let i = 1; i <= MAX_DROPS; i++) {
		const drop = normal[i - 1];
		row[`drop${i}_item`] = drop ? (resolveItemName(drop.itemId) ?? null) : null;
		row[`drop${i}_rate`] = drop ? percentToRate(drop.rate) : null;
		row[`drop${i}_nosteal`] = drop?.stealProtected ? 1 : null;
		row[`drop${i}_option`] = drop?.randomOptionGroup ?? null;
		row[`drop${i}_index`] = drop?.index ?? null;
	}
	for (let i = 1; i <= MAX_MVP_DROPS; i++) {
		const drop = mvpDrops[i - 1];
		row[`mvpdrop${i}_item`] = drop ? (resolveItemName(drop.itemId) ?? null) : null;
		row[`mvpdrop${i}_rate`] = drop ? percentToRate(drop.rate) : null;
		row[`mvpdrop${i}_option`] = drop?.randomOptionGroup ?? null;
		row[`mvpdrop${i}_index`] = drop?.index ?? null;
	}

	return row;
}

function upperFirst(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

/** rAthena chama esse elemento de "Dark" (`db/re/mob_db.yml: Element: Dark`);
 * `ElementSchema` (`packages/game-data/src/common.ts`) chama de "shadow" —
 * o resto dos 10 elementos bate 1:1 por case (`Fire` ↔ `fire`). Sem esta
 * tradução, `MonsterSchema.parse` rejeitava TODO monstro com esse elemento
 * (`invalid_enum_value`, "dark" não é opção válida) e a lista inteira de
 * monstros voltava 500 — um `.safeParse` num lote falha o lote inteiro. */
function elementFromRathena(value: string): string {
	return value.toLowerCase() === "dark" ? "shadow" : value.toLowerCase();
}

function elementToRathena(element: Element): string {
	return element === "shadow" ? "Dark" : upperFirst(element);
}

/** schema (minúsculo) → grafia do rAthena ("fire" → "Fire"), pro filtro de elemento. */
export function monsterElementToRathena(element: Element): string {
	return elementToRathena(element);
}
