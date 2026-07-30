import { ItemSchema, type Item, type ItemSubType, type ItemType } from "@ragnarok/game-data";

/**
 * `Item` (schema do projeto) ↔ linha de `item_db_re` (tabela do rAthena).
 *
 * Diferente das outras tabelas do admin, esta NÃO é nossa: o formato é o do
 * rAthena e ele lê direto dela (`use_sql_db: yes`). Três consequências:
 *
 *  1. **Booleano por coluna.** Jobs, classes e locais de equipamento não são
 *     array nem bitmask: são dezenas de colunas `job_swordman`, `location_armor`
 *     …, cada uma um booleano. Ausente = não permitido.
 *  2. **`script` é texto cru** (linguagem de script do rAthena). O `EffectList`
 *     tipado do projeto foi feito para LER script legado, não para gerá-lo de
 *     volta — 18k itens têm efeitos não mapeados. Reescrever o script a partir
 *     dele destruiria o item, então o texto é preservado como veio e o admin
 *     edita como texto.
 *  3. **Colunas NULL** valem "usar o default do rAthena"; não escrevemos 0 no
 *     lugar de NULL sem motivo.
 */

export interface MysqlItemRow {
	id: number;
	name_aegis: string;
	name_english: string;
	type: string | null;
	subtype: string | null;
	price_buy: number | null;
	price_sell: number | null;
	weight: number | null;
	attack: number | null;
	magic_attack: number | null;
	defense: number | null;
	range: number | null;
	slots: number | null;
	weapon_level: number | null;
	armor_level: number | null;
	equip_level_min: number | null;
	equip_level_max: number | null;
	refineable: number | boolean | null;
	gradable: number | boolean | null;
	view: number | null;
	alias_name: string | null;
	gender: string | null;
	script: string | null;
	equip_script: string | null;
	unequip_script: string | null;
	[column: string]: unknown;
}

/** job do nosso schema → coluna `job_*`. */
const JOB_COLUMNS: Record<string, string> = {
	all: "job_all",
	acolyte: "job_acolyte",
	alchemist: "job_alchemist",
	archer: "job_archer",
	assassin: "job_assassin",
	bard_dancer: "job_barddancer",
	blacksmith: "job_blacksmith",
	crusader: "job_crusader",
	gunslinger: "job_gunslinger",
	hunter: "job_hunter",
	kagerou_oboro: "job_kagerouoboro",
	knight: "job_knight",
	mage: "job_mage",
	merchant: "job_merchant",
	monk: "job_monk",
	ninja: "job_ninja",
	novice: "job_novice",
	priest: "job_priest",
	rebellion: "job_rebellion",
	rogue: "job_rogue",
	sage: "job_sage",
	soul_linker: "job_soullinker",
	spirit_handler: "job_spirit_handler",
	star_gladiator: "job_stargladiator",
	summoner: "job_summoner",
	super_novice: "job_supernovice",
	swordman: "job_swordman",
	taekwon: "job_taekwon",
	thief: "job_thief",
	wizard: "job_wizard",
};

const CLASS_COLUMNS: Record<string, string> = {
	all: "class_all",
	normal: "class_normal",
	upper: "class_upper",
	baby: "class_baby",
	third: "class_third",
	third_upper: "class_third_upper",
	third_baby: "class_third_baby",
	fourth: "class_fourth",
};

const LOCATION_COLUMNS: Record<string, string> = {
	head_top: "location_head_top",
	head_mid: "location_head_mid",
	head_low: "location_head_low",
	armor: "location_armor",
	right_hand: "location_right_hand",
	left_hand: "location_left_hand",
	garment: "location_garment",
	shoes: "location_shoes",
	right_accessory: "location_right_accessory",
	left_accessory: "location_left_accessory",
	costume_head_top: "location_costume_head_top",
	costume_head_mid: "location_costume_head_mid",
	costume_head_low: "location_costume_head_low",
	costume_garment: "location_costume_garment",
	ammo: "location_ammo",
	shadow_armor: "location_shadow_armor",
	shadow_weapon: "location_shadow_weapon",
	shadow_shield: "location_shadow_shield",
	shadow_shoes: "location_shadow_shoes",
	shadow_right_accessory: "location_shadow_right_accessory",
	shadow_left_accessory: "location_shadow_left_accessory",
};

/** Item com os scripts crus do rAthena preservados (round-trip seguro). */
export interface MysqlItem extends Item {
	rawScript?: string | undefined;
	rawEquipScript?: string | undefined;
	rawUnequipScript?: string | undefined;
}

function truthy(value: unknown): boolean {
	return value === 1 || value === true || value === "1";
}

function flagsFrom(row: MysqlItemRow, columns: Record<string, string>): string[] {
	return Object.entries(columns)
		.filter(([, column]) => truthy(row[column]))
		.map(([key]) => key);
}

export function mysqlRowToItem(row: MysqlItemRow): MysqlItem {
	const jobs = flagsFrom(row, JOB_COLUMNS);
	const item = ItemSchema.parse({
		id: row.id,
		aegisName: row.name_aegis,
		name: row.name_english,
		// O rAthena grava "Weapon"/"Usable"; o nosso schema usa minúsculo.
		// Tipo desconhecido vira "etc" — melhor listar o item com o tipo errado
		// do que sumir com ele da tela do admin.
		type: TYPE_TO_SCHEMA[row.type ?? ""] ?? "etc",
		subType: row.subtype ? SUBTYPE_TO_SCHEMA[row.subtype] : undefined,
		buyPrice: row.price_buy ?? 0,
		sellPrice: row.price_sell ?? 0,
		weight: row.weight ?? 0,
		attack: row.attack ?? 0,
		magicAttack: row.magic_attack ?? 0,
		defense: row.defense ?? 0,
		range: row.range ?? 0,
		slots: row.slots ?? 0,
		jobs: jobs.length ? jobs : ["all"],
		classes: flagsFrom(row, CLASS_COLUMNS),
		gender: (row.gender ?? "both").toLowerCase(),
		locations: flagsFrom(row, LOCATION_COLUMNS),
		weaponLevel: row.weapon_level ?? undefined,
		armorLevel: row.armor_level ?? undefined,
		equipLevelMin: row.equip_level_min ?? 0,
		equipLevelMax: row.equip_level_max ?? 0,
		refineable: truthy(row.refineable),
		gradable: truthy(row.gradable),
		viewSprite: row.view ?? 0,
		aliasName: row.alias_name ?? undefined,
	});

	return {
		...item,
		rawScript: row.script ?? undefined,
		rawEquipScript: row.equip_script ?? undefined,
		rawUnequipScript: row.unequip_script ?? undefined,
	};
}

export function itemToMysqlRow(item: MysqlItem): MysqlItemRow {
	const row: MysqlItemRow = {
		id: item.id,
		name_aegis: item.aegisName,
		name_english: item.name,
		type: TYPE_TO_RATHENA[item.type] ?? "Etc",
		subtype: item.subType ? (SUBTYPE_TO_RATHENA[item.subType] ?? null) : null,
		price_buy: item.buyPrice,
		price_sell: item.sellPrice,
		weight: item.weight,
		attack: item.attack,
		magic_attack: item.magicAttack,
		defense: item.defense,
		range: item.range,
		slots: item.slots,
		weapon_level: item.weaponLevel ?? null,
		armor_level: item.armorLevel ?? null,
		equip_level_min: item.equipLevelMin,
		equip_level_max: item.equipLevelMax,
		refineable: item.refineable ? 1 : 0,
		gradable: item.gradable ? 1 : 0,
		view: item.viewSprite,
		alias_name: item.aliasName ?? null,
		gender: item.gender === "both" ? null : item.gender === "male" ? "Male" : "Female",
		// texto do rAthena, preservado como veio (ver comentário do topo)
		script: item.rawScript ?? null,
		equip_script: item.rawEquipScript ?? null,
		unequip_script: item.rawUnequipScript ?? null,
	};

	// booleano por coluna: só escrevemos as marcadas; NULL = "não permitido"
	for (const [key, column] of Object.entries(JOB_COLUMNS)) {
		row[column] = item.jobs.includes(key as never) ? 1 : null;
	}
	for (const [key, column] of Object.entries(CLASS_COLUMNS)) {
		row[column] = item.classes.includes(key as never) ? 1 : null;
	}
	for (const [key, column] of Object.entries(LOCATION_COLUMNS)) {
		row[column] = item.locations.includes(key as never) ? 1 : null;
	}

	return row;
}

/**
 * Nome do rAthena ↔ valor do nosso schema.
 *
 * Não dá para converter no braço ("1hSword" não vira "1h_sword" por
 * lowercase): as tabelas abaixo são as mesmas usadas pela migração legada
 * (tools/legacy-migration/src/mappings.ts), copiadas aqui porque a API não
 * depende daquele pacote de ferramentas.
 */
const TYPE_TO_SCHEMA: Record<string, ItemType> = {
	Healing: "healing",
	Usable: "usable",
	Etc: "etc",
	Armor: "armor",
	Weapon: "weapon",
	Card: "card",
	PetEgg: "pet_egg",
	PetArmor: "pet_armor",
	Ammo: "ammo",
	DelayConsume: "delay_consume",
	ShadowGear: "shadow_gear",
	Cash: "cash",
};

const SUBTYPE_TO_SCHEMA: Record<string, ItemSubType> = {
	Dagger: "dagger",
	"1hSword": "1h_sword",
	"2hSword": "2h_sword",
	"1hSpear": "1h_spear",
	"2hSpear": "2h_spear",
	"1hAxe": "1h_axe",
	"2hAxe": "2h_axe",
	Mace: "mace",
	"2hMace": "2h_mace",
	Staff: "staff",
	"2hStaff": "2h_staff",
	Bow: "bow",
	Knuckle: "knuckle",
	Musical: "musical",
	Whip: "whip",
	Book: "book",
	Katar: "katar",
	Revolver: "revolver",
	Rifle: "rifle",
	Gatling: "gatling",
	Shotgun: "shotgun",
	Grenade: "grenade",
	Huuma: "huuma",
	Fist: "fist",
	Arrow: "arrow",
	Bullet: "bullet",
	Shell: "shell",
	Shuriken: "shuriken",
	Kunai: "kunai",
	CannonBall: "cannonball",
	Cannonball: "cannonball",
	ThrowableWeapon: "throwable_weapon",
	Throwweapon: "throwable_weapon",
	Normal: "normal_card",
	Enchant: "enchant_card",
};

const TYPE_TO_RATHENA = invert(TYPE_TO_SCHEMA);
const SUBTYPE_TO_RATHENA = invert(SUBTYPE_TO_SCHEMA);

function invert(map: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	// primeira ocorrência ganha: os apelidos (Cannonball/CannonBall) apontam
	// para o mesmo valor e o canônico é o primeiro da tabela
	for (const [rathena, schema] of Object.entries(map)) {
		if (!(schema in out)) out[schema] = rathena;
	}
	return out;
}
