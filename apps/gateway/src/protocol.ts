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
	/** o alvo está longe demais: o rAthena NÃO persegue por você (unit.cpp:3259) */
	"attack:too-far": (payload: { gid: number; x: number; y: number; euX: number; euY: number; range: number }) => void;
	/** o servidor recusou o disparo por falta de flecha (`ZC_ACTION_FAILURE`, `ARROWFAIL_NO_AMMO`) */
	"attack:no-ammo": () => void;
	"self:stat": (payload: { name: string; id: number; value: number; bonus?: number }) => void;
	"self:status": (payload: StatusBlock) => void;
	"inv:list": (payload: InventoryItem[]) => void;
	"inv:add": (payload: InventoryItem) => void;
	"inv:remove": (payload: { index: number; amount: number }) => void;
	/**
	 * Resposta a `card:list` (ZC.ITEMCOMPOSITION_LIST, 0x17b) — os índices de
	 * inventário que aceitam a carta. O rAthena NÃO manda nada (nem lista
	 * vazia) quando não há nenhum compatível (clif.cpp: `if(!c) return;`) —
	 * quem pede trata "nunca chegou" como "zero opções", não como erro.
	 */
	"card:options": (payload: { cardIndex: number; equipIndexes: number[] }) => void;
	/**
	 * Resposta a `card:insert` (ZC.ACK_ITEMCOMPOSITION, 0x17d). `cards` já vem
	 * pronto (o array do item depois da composição) — o rAthena não reenvia o
	 * item completo, só este ACK, então quem muta é o PRÓPRIO gateway
	 * (`RoSession`, ver comentário em `insertCard`).
	 */
	"card:result": (payload: { equipIndex: number; cardIndex: number; success: boolean; cards: number[] }) => void;
	"skill:list": (payload: PlayerSkill[]) => void;
	/** os 38 slots inteiros, sempre em lote — o rAthena manda a lista completa
	 * de novo no map-enter (`clif_hotkeys_send`), nunca incremental. */
	"hotkey:list": (payload: HotkeySlot[]) => void;
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
	/**
	 * `startTime` é o `gettick()` do map-server no instante em que o movimento
	 * COMEÇOU (`moveStartTime` do ZC_NOTIFY_MOVE). Sem ele o cliente ancorava o
	 * trecho na hora de CHEGADA do pacote, e um pacote atrasado fazia a entidade
	 * recomeçar o caminho do zero — é a base da interpolação de snapshots.
	 * `0` = o pacote não trouxe; o cliente cai no relógio local.
	 */
	"entity:move": (payload: {
		gid: number;
		from: Cell;
		to: Cell;
		speed: number;
		startTime: number;
	}) => void;
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
	"friend:list": (payload: Friend[]) => void;
	/** um amigo entrou/saiu (ZC_FRIENDS_STATE) — casa por accountId+charId */
	"friend:state": (payload: { accountId: number; charId: number; online: boolean }) => void;
	/** alguém pediu para ser seu amigo e o script está esperando resposta */
	"friend:request": (payload: { accountId: number; charId: number; name: string }) => void;
	"friend:added": (payload: { result: number; reason: string; friend: Friend | null }) => void;
	"friend:removed": (payload: { accountId: number; charId: number }) => void;
	"guild:members": (payload: GuildMember[]) => void;
	"ignore:list": (payload: string[]) => void;
	"session:closed": (payload: { stage: SessionStage; reason: string }) => void;
}

/**
 * Amigo da lista do rAthena.
 *
 * O protocolo carrega NOME e ids, mais nada: em PACKETVER 20130618 o
 * ZC_FRIENDS_LIST é `{ <account id>.L <char id>.L <name>.24B }*`
 * (clif.cpp:15355) e o online/offline chega separado, em ZC_FRIENDS_STATE.
 * Nível, classe e mapa do amigo NÃO existem em pacote nenhum desta faixa — quem
 * mostra a janela mostra "—", nunca um palpite.
 */
export interface Friend {
	accountId: number;
	charId: number;
	name: string;
	/** só é verdade depois de um ZC_FRIENDS_STATE; a lista nasce toda offline */
	online: boolean;
}

/**
 * Membro da guilda (ZC_MEMBERMGR_INFO, 0x154).
 *
 * Ao contrário da lista de amigos, esta traz nível, classe e online — é a única
 * lista de gente do protocolo que tem a linha inteira da referência.
 */
export interface GuildMember {
	accountId: number;
	charId: number;
	name: string;
	job: number;
	level: number;
	online: boolean;
	/** cargo dentro da guilda (índice na tabela de posições) */
	position: number;
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
	/**
	 * Bitmask EQP_* (rathena/src/common/mmo.hpp) de ONDE está equipado — 0 =
	 * não equipado. `equipped` só guardava o booleano e jogava fora o dado que
	 * diz QUAL slot; sem ele o cliente não sabe distinguir anel 1 de anel 2, ou
	 * espada de escudo, só que "algo" está vestido.
	 */
	location: number;
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
	/** flee2 do rAthena — Perfect Dodge, NÃO bônus de flee (ver comentário em session.ts) */
	perfectDodge: number;
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

/**
 * Um slot da barra de atalho do rAthena (`ZC_SHORTCUT_KEY_LIST_V2`,
 * `hotkey_data{isSkill,ID,count}` — `packets_struct.hpp`). `slot` é o índice
 * 0..37 (`MAX_HOTKEYS` neste packetver, `mmo.hpp`) — o servidor usa os 38,
 * mesmo a UI hoje só desenhando 27 (`SKILL_SLOTS`, `skillBarStore.ts`); os
 * 11 extras seguem sincronizados sem representação visual, de propósito.
 *
 * `count` é o campo cru do rAthena (nível pra skill, quantidade pra item —
 * ele reaproveita o mesmo campo pros dois, isto só espelha, não reinterpreta).
 * Nunca existe `"ammo"` aqui: é uma distinção só do cliente (equipar vs.
 * usar), sem contraparte no protocolo do servidor — ver `skillBarStore.ts`.
 */
export interface HotkeySlot {
	slot: number;
	kind: "empty" | "skill" | "item";
	id: number;
	count: number;
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
	/** DMG_* do rAthena (clif.hpp) — o mesmo código de `entity:action`, usado
	 * para distinguir crítico do dano normal (10 = crítico, 13 = multi-hit
	 * crítico). Só faz sentido em `kind: "target"`. */
	action: number;
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
	/** duplo clique na carta: pede ao servidor QUAIS equipamentos ela aceita (CZ.REQ_ITEMCOMPOSITION_LIST, 0x17a) */
	"card:list": (payload: { index: number }) => void;
	/** escolheu o equipamento: pede a composição de verdade (CZ.REQ_ITEMCOMPOSITION, 0x17c) */
	"card:insert": (payload: { cardIndex: number; equipIndex: number }) => void;
	"stat:raise": (payload: { stat: RaisableStat }) => void;
	"skill:use": (payload: { skillId: number; level: number; targetGid: number }) => void;
	"skill:use-ground": (payload: { skillId: number; level: number; x: number; y: number }) => void;
	"npc:talk": (payload: { gid: number }) => void;
	"npc:next": (payload: { gid: number }) => void;
	"npc:menu": (payload: { gid: number; choice: number }) => void;
	"npc:close": (payload: { gid: number }) => void;
	/** pede nome/HP/nível de uma entidade (CZ.REQNAME) — usado ao alvejar */
	"entity:info": (payload: { gid: number }) => void;
	/** convida pelo NOME (CZ_ADD_FRIENDS); o outro lado precisa aceitar */
	"friend:add": (payload: { name: string }) => void;
	"friend:remove": (payload: { accountId: number; charId: number }) => void;
	/** resposta ao convite que chegou em `friend:request` */
	"friend:answer": (payload: { accountId: number; charId: number; accept: boolean }) => void;
	/** pede a lista de membros da guilda (CZ_REQ_GUILD_MENU tipo 1) */
	"guild:request": () => void;
	"ignore:add": (payload: { name: string }) => void;
	"ignore:remove": (payload: { name: string }) => void;
	/**
	 * Sobe UM nível de uma habilidade (CZ_UPGRADE_SKILLLEVEL, 0x112).
	 *
	 * Como o atributo, o rAthena não tem pacote de "subir N de uma vez": quem
	 * quer três níveis manda três vezes. A confirmação volta em
	 * ZC_SKILLINFO_UPDATE, que o gateway já engancha — a lista de skills se
	 * atualiza sozinha.
	 */
	"skill:raise": (payload: { skillId: number }) => void;
	/**
	 * Muda UM slot da barra (`CZ_SHORTCUT_KEY_CHANGE1`, 0x02ba). O rAthena não
	 * valida skill/item existir nem nível (`clif_parse_Hotkey`, `clif.cpp` —
	 * grava `sd->status.hotkeys[idx]` sem checagem nenhuma além do índice
	 * caber em `MAX_HOTKEYS_DB`) nem manda confirmação de volta — a única
	 * prova de que pegou é reconectar e ver `hotkey:list` de novo.
	 */
	"hotkey:set": (payload: { slot: number; kind: "empty" | "skill" | "item"; id: number; count?: number }) => void;
}

/** Atributos que a janela de status permite subir com ponto. */
export type RaisableStat = "str" | "agi" | "vit" | "int" | "dex" | "luk";
