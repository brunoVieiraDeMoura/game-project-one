/**
 * Contrato JSON entre o navegador e o gateway.
 *
 * Regra da casa (.claude/skills/skill-network-protocol): opcode cru do rAthena
 * NAO vaza para o browser. Tudo que sai daqui e um evento nomeado com campos
 * ja traduzidos; o binario morre no gateway.
 */

export interface CharSummary {
	slot: number;
	gid: number;
	name: string;
	job: number;
	level: number;
	jobLevel: number;
	baseExp: number;
	jobExp: number;
	zeny: number;
	hp: number;
	maxHp: number;
	sp: number;
	maxSp: number;
	str: number;
	agi: number;
	vit: number;
	int: number;
	dex: number;
	luk: number;
	head: number;
	headPalette: number;
	bodyPalette: number;
	weapon: number;
	shield: number;
	mapName: string;
}

/** Posicao em celulas do rAthena (o mapa 3D converte para hexagono). */
export interface Cell {
	x: number;
	y: number;
}

export interface EntitySnapshot {
	gid: number;
	/** player | mob | npc | item | unknown — derivado do objecttype do pacote */
	kind: EntityKind;
	/** id do mob (mob_db) ou classe do jogador; e o mesmo campo "job" no protocolo */
	job: number;
	name?: string;
	x: number;
	y: number;
	dir: number;
	speed: number;
	hp?: number;
	maxHp?: number;
	/** nível do mob, quando `show_mob_info` faz o servidor mandá-lo */
	level?: number;
}

export type EntityKind = "player" | "mob" | "npc" | "item" | "skill" | "unknown";

export interface ServerEvents {
	"auth:ok": (payload: { accountId: number; sex: number }) => void;
	"auth:error": (payload: { reason: string; code?: number }) => void;
	"char:list": (payload: { chars: CharSummary[]; slots: number }) => void;
	"char:error": (payload: { reason: string; code?: number }) => void;
	"world:enter": (payload: {
		mapName: string;
		x: number;
		y: number;
		dir: number;
		gid: number;
		/** ficha da lista de personagens (estado inicial do HUD) */
		char: CharSummary | null;
	}) => void;
	"self:move": (payload: { from: Cell; to: Cell; startTime: number; speed: number }) => void;
	/** o servidor pôs o personagem noutra célula sem andar (teleporte, empurrão) */
	"self:warp": (payload: Cell) => void;
	"self:stat": (payload: { name: string; id: number; value: number; bonus?: number }) => void;
	"self:status": (payload: StatusBlock) => void;
	"inv:list": (payload: InventoryItem[]) => void;
	"inv:add": (payload: InventoryItem) => void;
	"inv:remove": (payload: { index: number; amount: number }) => void;
	"skill:list": (payload: PlayerSkill[]) => void;
	"skill:cast": (payload: SkillCast) => void;
	"skill:casting": (payload: SkillCasting) => void;
	"skill:ground": (payload: SkillGround) => void;
	"skill:ground-gone": (payload: { gid: number }) => void;
	/**
	 * Recarga da skill (ZC_SKILL_POSTDELAY, 0x43d). É o servidor que decide
	 * quanto dura — o cliente só desenha. Chega DEPOIS do uso, junto com o
	 * pacote de ação, e vale a partir do instante em que chega.
	 */
	"skill:cooldown": (payload: { skillId: number; durationMs: number }) => void;
	"npc:dialog": (payload: NpcDialog) => void;
	"ground:item": (payload: GroundItem) => void;
	"ground:item-gone": (payload: { gid: number }) => void;
	"entity:spawn": (payload: EntitySnapshot) => void;
	"entity:move": (payload: { gid: number; from: Cell; to: Cell; speed: number }) => void;
	"entity:stop": (payload: { gid: number; x: number; y: number }) => void;
	"entity:vanish": (payload: { gid: number; reason: number }) => void;
	"entity:name": (payload: { gid: number; name: string }) => void;
	"entity:level": (payload: { gid: number; level: number }) => void;
	"entity:action": (payload: {
		gid: number;
		targetGid: number;
		damage: number;
		count: number;
		action: number;
	}) => void;
	"entity:hp": (payload: { gid: number; hp: number; maxHp: number }) => void;
	"chat:message": (payload: { gid?: number; name?: string; text: string; scope: ChatScope }) => void;
	"session:closed": (payload: { stage: SessionStage; reason: string }) => void;
}

export interface InventoryItem {
	/** posição no inventário do servidor — é por ela que se usa/equipa */
	index: number;
	itemId: number;
	amount: number;
	type: number;
	identified: boolean;
	refine: number;
	equipped: boolean;
	cards: number[];
}

/** Bloco completo da janela de status (ZC.STATUS, 0xbd). */
export interface StatusBlock {
	statusPoint: number;
	str: number;
	agi: number;
	vit: number;
	int: number;
	dex: number;
	luk: number;
	/** custo, em pontos, para subir mais 1 no atributo */
	upStr: number;
	upAgi: number;
	upVit: number;
	upInt: number;
	upDex: number;
	upLuk: number;
	atk: number;
	atkBonus: number;
	matkMin: number;
	matkMax: number;
	def: number;
	defBonus: number;
	mdef: number;
	mdefBonus: number;
	hit: number;
	flee: number;
	fleeBonus: number;
	critical: number;
	aspd: number;
}

export interface PlayerSkill {
	id: number;
	name: string;
	level: number;
	spCost: number;
	range: number;
	/** ainda dá para subir com ponto de habilidade */
	upgradable: boolean;
}

/** Uso de skill que já aconteceu (o VFX sai daqui). */
export interface SkillCast {
	skillId: number;
	level: number;
	sourceGid: number;
	targetGid: number;
	damage: number;
	count: number;
	/** target = acertou alguém; buff = efeito sem dano */
	kind: "target" | "buff";
}

/** Conjuração em andamento (barra de cast). */
export interface SkillCasting {
	skillId: number;
	sourceGid: number;
	targetGid: number;
	x: number;
	y: number;
	durationMs: number;
}

/** Unidade de skill no chão (área, armadilha, parede). */
export interface SkillGround {
	gid: number;
	creatorGid: number;
	x: number;
	y: number;
	unitId: number;
	visible: boolean;
}

/** Item caído no chão. */
export interface GroundItem {
	/** id do OBJETO no chão (não do item) — é ele que se manda em CZ.ITEM_PICKUP */
	gid: number;
	itemId: number;
	amount: number;
	x: number;
	y: number;
	identified: boolean;
	/** deslocamento dentro da célula (o RO espalha itens na mesma célula) */
	subX: number;
	subY: number;
}

/** Janela de diálogo do NPC. */
export type NpcDialog =
	| { gid: number; kind: "text"; text: string }
	| { gid: number; kind: "next" }
	| { gid: number; kind: "menu"; options: string[] }
	| { gid: number; kind: "close" };

/**
 * De onde a fala veio.
 *
 * `party` e `guild` são pacotes próprios do protocolo (ZC_NOTIFY_CHAT_PARTY
 * 0x109 e ZC_GUILD_CHAT 0x17f). `global` e `trade` NÃO são: são os canais
 * `#global` e `#trade` que o rAthena traz em `conf/channels.conf`, e chegam
 * todos pelo mesmo ZC_NPC_CHAT (0x2c1) — quem separa é o apelido no começo da
 * mensagem ("[Global] Fulano : oi"), que é como `channel_send` monta a linha
 * (channel.cpp:466). `announce` continua sendo o @broadcast do GM.
 */
export type ChatScope =
	| "self"
	| "public"
	| "announce"
	| "system"
	| "party"
	| "guild"
	| "global"
	| "trade";
export type SessionStage = "idle" | "login" | "char" | "map";

export interface ClientEvents {
	"auth:login": (payload: { username: string; password: string }) => void;
	"char:select": (payload: { slot: number }) => void;
	"char:create": (payload: { slot: number; name: string; hair: number; hairColor: number }) => void;
	"char:delete": (payload: { gid: number; email: string }) => void;
	"move:to": (payload: Cell) => void;
	"action:attack": (payload: { gid: number; continuous: boolean }) => void;
	/** `scope` escolhe o canal; omitido = fala normal do mapa */
	"chat:send": (payload: { text: string; scope?: ChatScope }) => void;
	"world:ready": () => void;
	"item:use": (payload: { index: number }) => void;
	"item:equip": (payload: { index: number; position?: number }) => void;
	"item:unequip": (payload: { index: number }) => void;
	"item:pickup": (payload: { gid: number }) => void;
	"item:drop": (payload: { index: number; amount: number }) => void;
	"stat:raise": (payload: { stat: RaisableStat }) => void;
	"skill:use": (payload: { skillId: number; level: number; targetGid: number }) => void;
	"skill:use-ground": (payload: { skillId: number; level: number; x: number; y: number }) => void;
	"npc:talk": (payload: { gid: number }) => void;
	"npc:next": (payload: { gid: number }) => void;
	"npc:menu": (payload: { gid: number; choice: number }) => void;
	"npc:close": (payload: { gid: number }) => void;
	/** pede nome/HP/nível de uma entidade (CZ.REQNAME) — usado ao alvejar */
	"entity:info": (payload: { gid: number }) => void;
}

/** Atributos que a janela de status permite subir com ponto. */
export type RaisableStat = "str" | "agi" | "vit" | "int" | "dex" | "luk";
