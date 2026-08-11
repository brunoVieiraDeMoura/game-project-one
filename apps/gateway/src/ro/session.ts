/**
 * Uma sessao de jogo: login (6901) -> char (6122) -> map (5122).
 *
 * Sao tres conexoes TCP em sequencia, nao uma. Cada etapa entrega credencial
 * para a proxima (AuthCode/AID vindos do login; GID e endereco do map vindos do
 * char). A ordem e os dois pontos de "bytes crus" foram tirados do
 * roBrowserLegacy (client/src/Engine/{Login,Char,Map}Engine.js) — sem eles o
 * parser desanda ou o servidor derruba a conexao.
 */
import { EventEmitter } from "node:events";
import { PACKET, PACKETVER, RoConnection, initProtocol, longToIP } from "@ragnarok/ro-protocol";
import type {
	CharSummary,
	Cell,
	ChatScope,
	EntitySnapshot,
	Friend,
	GuildMember,
	InventoryItem,
	GroundItem,
	HotkeySlot,
	NpcDialog,
	PlayerSkill,
	SessionStage,
	SkillCast,
	SkillCasting,
	SkillGround,
	StatusBlock,
} from "../protocol.js";
import { entityKindFromObjectType } from "./entity-kind.js";
import { statName } from "./stat-names.js";

export interface SessionOptions {
	host: string;
	loginPort: number;
	packetver: number;
	/** clienttype/langtype do CA.LOGIN; 12 e o que o roBrowser usa por padrao */
	langType?: number;
	/** version do CA.LOGIN */
	clientVersion?: number;
	debug?: boolean;
	/**
	 * O endereco que o char/map server devolve vem de dentro do pacote e pode ser
	 * inalcancavel (0.0.0.0 quando o servidor escuta em tudo). Com isto ligado
	 * usamos sempre `host` e so aproveitamos a porta — equivale ao
	 * `forceUseAddress` do roBrowser.
	 */
	forceHost?: boolean;
}

interface PendingAuth {
	resolve: () => void;
	reject: (err: Error) => void;
}

/** quantas perguntas de nome saem por rodada e de quanto em quanto tempo */
const NAME_QUERIES_PER_TICK = 4;
const NAME_QUERY_INTERVAL_MS = 120;
/** tentativas por entidade e espera antes de repetir (ver `queryName`) */
const NAME_QUERY_TRIES = 2;
const NAME_RETRY_DELAY_MS = 1500;
/** `MAX_HOTKEYS` (mmo.hpp) pra este packetver (20130618, sem o 2º tab de
 * atalhos — esse exige >= 20190522). Fora disso o rAthena ignora em silêncio
 * (`clif_parse_Hotkey`: `if(idx >= MAX_HOTKEYS_DB) return;`) — checar antes
 * evita gastar um pacote à toa, não é regra inventada. */
const MAX_HOTKEYS = 38;

export declare interface RoSession {
	on(event: "chars", listener: (chars: CharSummary[], slots: number) => void): this;
	on(
		event: "map-enter",
		listener: (info: { mapName: string; x: number; y: number; dir: number; gid: number }) => void,
	): this;
	on(event: "entity-spawn", listener: (entity: EntitySnapshot) => void): this;
	on(
		event: "entity-move",
		listener: (payload: {
			gid: number;
			from: Cell;
			to: Cell;
			speed: number;
			/** `gettick()` do map-server quando o movimento começou (ver o hook) */
			startTime: number;
		}) => void,
	): this;
	on(event: "entity-stop", listener: (payload: { gid: number; x: number; y: number }) => void): this;
	on(event: "entity-vanish", listener: (payload: { gid: number; reason: number }) => void): this;
	on(event: "entity-name", listener: (payload: { gid: number; name: string }) => void): this;
	on(event: "entity-level", listener: (payload: { gid: number; level: number }) => void): this;
	on(
		event: "entity-action",
		listener: (payload: {
			gid: number;
			targetGid: number;
			damage: number;
			count: number;
			action: number;
		}) => void,
	): this;
	on(event: "entity-hp", listener: (payload: { gid: number; hp: number; maxHp: number }) => void): this;
	on(
		event: "self-move",
		listener: (payload: { from: Cell; to: Cell; startTime: number }) => void,
	): this;
	/** o servidor REPOSICIONOU o personagem (teleporte, empurrão, fixpos) */
	on(event: "self-warp", listener: (payload: Cell) => void): this;
	on(
		event: "attack-too-far",
		listener: (payload: { gid: number; x: number; y: number; euX: number; euY: number; range: number }) => void,
	): this;
	/** o servidor recusou o disparo por falta de flecha (`ARROWFAIL_NO_AMMO`) */
	on(event: "attack-no-ammo", listener: () => void): this;
	on(
		event: "stat",
		listener: (payload: { name: string; id: number; value: number; bonus?: number }) => void,
	): this;
	on(event: "status", listener: (payload: StatusBlock) => void): this;
	on(event: "inventory", listener: (payload: InventoryItem[]) => void): this;
	on(event: "item-add", listener: (payload: InventoryItem) => void): this;
	on(event: "item-remove", listener: (payload: { index: number; amount: number }) => void): this;
	on(
		event: "item-equip-result",
		listener: (payload: { index: number; success: boolean; equipped: boolean; location: number }) => void,
	): this;
	on(event: "card-options", listener: (payload: { cardIndex: number; equipIndexes: number[] }) => void): this;
	on(
		event: "card-result",
		listener: (payload: { equipIndex: number; cardIndex: number; success: boolean; cards: number[] }) => void,
	): this;
	on(event: "skills", listener: (payload: PlayerSkill[]) => void): this;
	on(event: "hotkeys", listener: (payload: HotkeySlot[]) => void): this;
	on(event: "skill-cast", listener: (payload: SkillCast) => void): this;
	on(event: "skill-casting", listener: (payload: SkillCasting) => void): this;
	on(event: "skill-ground", listener: (payload: SkillGround) => void): this;
	on(event: "skill-ground-gone", listener: (payload: { gid: number }) => void): this;
	on(event: "skill-cooldown", listener: (payload: { skillId: number; durationMs: number }) => void): this;
	on(event: "npc-dialog", listener: (payload: NpcDialog) => void): this;
	on(event: "ground-item", listener: (payload: GroundItem) => void): this;
	on(event: "ground-item-gone", listener: (payload: { gid: number }) => void): this;
	on(event: "char-error", listener: (payload: { reason: string }) => void): this;
	on(event: "chat", listener: (payload: { gid?: number; text: string; scope: ChatScope }) => void): this;
	on(event: "friends", listener: (payload: Friend[]) => void): this;
	on(
		event: "friend-state",
		listener: (payload: { accountId: number; charId: number; online: boolean }) => void,
	): this;
	on(
		event: "friend-request",
		listener: (payload: { accountId: number; charId: number; name: string }) => void,
	): this;
	on(
		event: "friend-added",
		listener: (payload: { result: number; reason: string; friend: Friend | null }) => void,
	): this;
	on(event: "friend-removed", listener: (payload: { accountId: number; charId: number }) => void): this;
	on(event: "guild-members", listener: (payload: GuildMember[]) => void): this;
	on(event: "ignore-list", listener: (payload: string[]) => void): this;
	on(event: "closed", listener: (payload: { stage: SessionStage; reason: string }) => void): this;
	on(event: "error", listener: (err: Error) => void): this;
}

export class RoSession extends EventEmitter {
	private readonly options: Required<Pick<SessionOptions, "host" | "loginPort" | "packetver">> &
		SessionOptions;

	stage: SessionStage = "idle";
	accountId = 0;
	authCode = 0;
	userLevel = 0;
	sex = 0;
	gid = 0;
	chars: CharSummary[] = [];

	/**
	 * Último estado conhecido do personagem.
	 *
	 * O rAthena despeja HP, SP, peso, exp, inventário e a janela de status
	 * INTEIRA logo depois do CZ.ENTER — bem antes de a cena 3D existir no
	 * navegador. Sem guardar, o HUD abre zerado e só se corrige no próximo
	 * pacote (que pode demorar minutos, porque só chega quando algo muda).
	 */
	private readonly stats = new Map<string, { id: number; value: number; bonus?: number }>();
	private statusBlock: StatusBlock | null = null;
	private inventory: InventoryItem[] = [];
	/** índice da carta do pedido de LISTA em voo — o ACK (0x17b) não ecoa esse índice de volta */
	private cardListRequested: number | null = null;
	/** pedido de composição em voo — o ACK (0x17d) não traz o itemId da carta, só índices */
	private pendingCardInsert: { cardIndex: number; equipIndex: number; itemId: number } | null = null;
	private readonly skills = new Map<number, PlayerSkill>();
	/**
	 * Entidades já vistas neste mapa.
	 *
	 * O map-server anuncia os NPCs e mobs UMA VEZ, logo depois do
	 * NOTIFY_ACTORINIT — quem não estava escutando naquele instante nunca mais
	 * recebe (só quando a entidade se mexer). Como a cena 3D monta depois,
	 * guardamos e reenviamos.
	 */
	private readonly entities = new Map<number, EntitySnapshot>();
	/**
	 * Lista de amigos, guilda e ignorados.
	 *
	 * A de amigos chega em `pc_authok` (pc.cpp:2252), ou seja, ANTES do
	 * NOTIFY_ACTORINIT — o navegador ainda nem montou a cena. Sem guardar aqui, a
	 * janela de amigos abria vazia até alguém entrar ou sair do jogo. As três
	 * são reenviadas no `world:ready`, como o resto do estado.
	 */
	private friends: Friend[] = [];
	private guildMembers: GuildMember[] = [];
	private ignored: string[] = [];

	private login: RoConnection | null = null;
	private char: RoConnection | null = null;
	private map: RoConnection | null = null;
	private charServer: { ip: number; port: number } | null = null;
	private pendingAuth: PendingAuth | null = null;

	constructor(options: SessionOptions) {
		super();
		this.options = { langType: 12, clientVersion: 25, forceHost: true, ...options };
		initProtocol(options.packetver);
	}

	/** Autentica e ja pede a lista de personagens (evento "chars"). */
	async authenticate(username: string, password: string): Promise<void> {
		if (this.stage !== "idle") {
			throw new Error(`sessao ja em uso (stage=${this.stage})`);
		}

		this.stage = "login";
		const conn = new RoConnection({
			host: this.options.host,
			port: this.options.loginPort,
			label: "login",
			debug: this.options.debug,
		});
		this.login = conn;

		conn.on("error", (err) => this.emit("error", err));
		conn.on("close", () => {
			if (this.stage === "login") {
				this.fail("login", "conexao com o login-server caiu");
			}
		});

		const done = new Promise<void>((resolve, reject) => {
			this.pendingAuth = { resolve, reject };
		});

		this.hookLoginPackets(conn);
		await conn.connect();

		const pkt = new PACKET.CA.LOGIN();
		pkt.ID = username;
		pkt.Passwd = password;
		pkt.Version = this.options.clientVersion;
		pkt.clienttype = this.options.langType;
		conn.send(pkt);

		// O login-server derruba conexao ociosa; o roBrowser manda este a cada 10s.
		conn.startPing(() => conn.send(new PACKET.CA.CONNECT_INFO_CHANGED()));

		return done;
	}

	private hookLoginPackets(conn: RoConnection): void {
		const accept = (pkt: any) => {
			this.accountId = pkt.AID;
			this.authCode = pkt.AuthCode;
			this.userLevel = pkt.userLevel;
			this.sex = pkt.Sex;

			const server = pkt.ServerList?.[0];
			if (!server) {
				this.fail("login", "login aceito mas nenhum char-server na lista");
				return;
			}

			this.charServer = { ip: server.ip, port: server.port };
			void this.connectChar().catch((err) => this.fail("login", String(err)));
		};

		conn.hook(PACKET.AC.ACCEPT_LOGIN, accept);
		if (PACKET.AC.ACCEPT_LOGIN3) {
			conn.hook(PACKET.AC.ACCEPT_LOGIN3, accept);
		}

		const refuse = (pkt: any) => {
			this.fail("login", refuseReason(pkt.ErrorCode ?? pkt.errorCode), pkt.ErrorCode);
		};
		for (const name of [
			"REFUSE_LOGIN",
			"REFUSE_LOGIN_R2",
			"REFUSE_LOGIN3",
			"REFUSE_LOGIN_EX",
		] as const) {
			if (PACKET.AC[name]) {
				conn.hook(PACKET.AC[name], refuse);
			}
		}
	}

	private async connectChar(): Promise<void> {
		if (!this.charServer) {
			throw new Error("sem char-server");
		}

		this.stage = "char";
		const host = this.options.forceHost ? this.options.host : longToIP(this.charServer.ip);
		const conn = new RoConnection({
			host,
			port: this.charServer.port,
			label: "char",
			debug: this.options.debug,
		});
		this.char = conn;

		conn.on("error", (err) => this.emit("error", err));
		conn.on("close", () => {
			if (this.stage === "char") {
				this.fail("char", "conexao com o char-server caiu");
			}
		});

		this.hookCharPackets(conn);
		await conn.connect();

		// O char-server responde com 4 bytes CRUS de account id antes de qualquer
		// pacote. Sem consumir, o parser leria o AID como opcode.
		conn.readRaw((fp: any) => {
			this.accountId = fp.readLong();
		});

		const pkt = new PACKET.CH.ENTER();
		pkt.AID = this.accountId;
		pkt.AuthCode = this.authCode;
		pkt.userLevel = this.userLevel;
		pkt.Sex = this.sex;
		pkt.clientType = this.options.langType;
		conn.send(pkt);

		conn.startPing(() => conn.send(new PACKET.CZ.PING()));
	}

	private hookCharPackets(conn: RoConnection): void {
		const onCharList = (pkt: any) => {
			this.chars = (pkt.charInfo ?? []).map(toCharSummary);
			const slots = pkt.TotalSlotNum ?? this.chars.length;

			if (this.pendingAuth) {
				this.pendingAuth.resolve();
				this.pendingAuth = null;
			}
			this.emit("chars", this.chars, slots);
		};

		conn.hook(PACKET.HC.ACCEPT_ENTER_NEO_UNION, onCharList);
		if (PACKET.HC.ACCEPT_ENTER_NEO_UNION_LIST) {
			conn.hook(PACKET.HC.ACCEPT_ENTER_NEO_UNION_LIST, onCharList);
		}

		if (PACKET.HC.REFUSE_ENTER) {
			conn.hook(PACKET.HC.REFUSE_ENTER, (pkt: any) => {
				this.fail("char", `char-server recusou (codigo ${pkt.ErrorCode ?? "?"})`);
			});
		}

		conn.hook(PACKET.HC.NOTIFY_ZONESVR, (pkt: any) => {
			this.gid = pkt.GID;
			void this.connectMap(pkt.addr, pkt.mapName).catch((err) => this.fail("char", String(err)));
		});

		if (PACKET.HC.NOTIFY_ZONESVR2) {
			conn.hook(PACKET.HC.NOTIFY_ZONESVR2, (pkt: any) => {
				this.gid = pkt.GID;
				void this.connectMap(pkt.addr, pkt.mapName).catch((err) => this.fail("char", String(err)));
			});
		}

		// O char-server NAO reenvia a lista inteira depois de criar (um segundo
		// CH.ENTER e simplesmente ignorado) — quem traz o personagem novo e o
		// proprio 0x6d, com o mesmo bloco de char da lista. Entao emendamos na
		// lista local e reemitimos.
		for (const name of ["ACCEPT_MAKECHAR_NEO_UNION", "ACCEPT_MAKECHAR"] as const) {
			if (!PACKET.HC[name]) {
				continue;
			}
			conn.hook(PACKET.HC[name], (pkt: any) => {
				const info = pkt.charinfo ?? pkt.charInfo;
				if (!info) {
					return;
				}
				const created = toCharSummary(info, this.chars.length);
				this.chars = [...this.chars.filter((c) => c.slot !== created.slot), created].sort(
					(a, b) => a.slot - b.slot,
				);
				this.emit("chars", this.chars, this.chars.length);
			});
		}

		for (const name of ["REFUSE_MAKECHAR", "REFUSE_MAKECHAR2"] as const) {
			if (PACKET.HC[name]) {
				conn.hook(PACKET.HC[name], (pkt: any) => {
					this.emit("char-error", { reason: makeCharRefuseReason(pkt.ErrorCode ?? pkt.errorCode) });
				});
			}
		}

		for (const name of ["ACCEPT_DELETECHAR", "REFUSE_DELETECHAR"] as const) {
			if (PACKET.HC[name]) {
				conn.hook(PACKET.HC[name], () => this.emit("chars", this.chars, this.chars.length));
			}
		}
	}

	selectChar(slot: number): void {
		if (!this.char) {
			throw new Error("sem conexao com o char-server");
		}
		const pkt = new PACKET.CH.SELECT_CHAR();
		pkt.CharNum = slot;
		this.char.send(pkt);
	}

	createChar(params: { slot: number; name: string; hair: number; hairColor: number }): void {
		if (!this.char) {
			throw new Error("sem conexao com o char-server");
		}

		// Qual pacote vale e decidido pelo PACKETVER, nao por "o mais novo que
		// existe": o char-server so aceita UM formato, o do #if com que foi
		// compilado (rathena/src/common/packets.hpp:120-155). Mandar o 0xa39 num
		// build 2013 faz o servidor derrubar a conexao sem dizer nada.
		//   >= 20151001 -> 0xa39 (manda job e sexo)
		//   >= 20120307 -> 0x970 (atributos e job vem do servidor)
		//   senao       -> 0x67  (os 6 atributos vao no pacote)
		const ver = PACKETVER.value;
		const Make =
			ver >= 20151001 && PACKET.CH.MAKE_CHAR3
				? PACKET.CH.MAKE_CHAR3
				: ver >= 20120307 && PACKET.CH.MAKE_CHAR2
					? PACKET.CH.MAKE_CHAR2
					: PACKET.CH.MAKE_CHAR;

		const pkt = new Make();
		pkt.name = params.name;
		pkt.CharNum = params.slot;
		pkt.head = params.hair;
		pkt.headPal = params.hairColor;

		if (Make === PACKET.CH.MAKE_CHAR) {
			// 0x67 exige os atributos; 5 em cada da os 30 pontos do Novice.
			pkt.Str = 5;
			pkt.Agi = 5;
			pkt.Vit = 5;
			pkt.Int = 5;
			pkt.Dex = 5;
			pkt.Luk = 5;
		}
		if (Make === PACKET.CH.MAKE_CHAR3) {
			pkt.Job = 0; // Novice
			pkt.Sex = this.sex;
		}

		this.char.send(pkt);
	}

	deleteChar(gid: number, email: string): void {
		if (!this.char) {
			throw new Error("sem conexao com o char-server");
		}
		// Mesma regra do createChar: de 20040419 em diante o pacote e 0x1fb com
		// chave de 50 bytes (packets.hpp:158-165); antes disso 0x68 com 40.
		const Delete =
			PACKETVER.value >= 20040419 && PACKET.CH.DELETE_CHAR2
				? PACKET.CH.DELETE_CHAR2
				: PACKET.CH.DELETE_CHAR;
		const pkt = new Delete();
		pkt.GID = gid;
		pkt.key = email;
		this.char.send(pkt);
	}

	private async connectMap(addr: { ip: number; port: number }, mapName: string): Promise<void> {
		this.stage = "map";
		const host = this.options.forceHost ? this.options.host : longToIP(addr.ip);
		const conn = new RoConnection({
			host,
			port: addr.port,
			label: "map",
			debug: this.options.debug,
		});
		this.map = conn;

		conn.on("error", (err) => this.emit("error", err));
		conn.on("close", () => {
			if (this.stage === "map") {
				this.fail("map", "conexao com o map-server caiu");
			}
		});

		this.hookMapPackets(conn, mapName);
		await conn.connect();

		// Ate o packetver 20070521 o map-server tambem prefixa o stream com um AID
		// cru. Depois disso nao — ler a toa comeria o inicio de um pacote de verdade.
		if (PACKETVER.value < 20070521) {
			conn.readRaw((fp: any) => {
				this.gid = fp.readLong();
			});
		}

		const Enter = PACKETVER.value >= 20180307 && PACKET.CZ.ENTER2 ? PACKET.CZ.ENTER2 : PACKET.CZ.ENTER;
		const pkt = new Enter();
		pkt.AID = this.accountId;
		pkt.GID = this.gid;
		pkt.AuthCode = this.authCode;
		// O build() do roBrowser le `ClientTime` (maiusculo) e o construtor cria
		// `clientTime`; preenchemos os dois para nao mandar 0.
		pkt.clientTime = Date.now();
		pkt.ClientTime = pkt.clientTime;
		pkt.Sex = this.sex;
		conn.send(pkt);

		const Ping = PACKETVER.value >= 20180307 && PACKET.CZ.REQUEST_TIME2 ? PACKET.CZ.REQUEST_TIME2 : PACKET.CZ.REQUEST_TIME;
		conn.startPing(() => {
			const ping = new Ping();
			ping.clientTime = Date.now();
			ping.ClientTime = ping.clientTime;
			conn.send(ping);
		});
	}

	private hookMapPackets(conn: RoConnection, mapNameFromChar: string): void {
		let mapName = normalizeMapName(mapNameFromChar);

		const onAcceptEnter = (pkt: any) => {
			const [x, y, dir] = pkt.PosDir ?? [0, 0, 0];
			this.emit("map-enter", { mapName, x, y, dir, gid: this.gid });
		};
		conn.hook(PACKET.ZC.ACCEPT_ENTER, onAcceptEnter);
		for (const name of ["ACCEPT_ENTER2", "ACCEPT_ENTER3"] as const) {
			if (PACKET.ZC[name]) {
				conn.hook(PACKET.ZC[name], onAcceptEnter);
			}
		}

		if (PACKET.ZC.NPCACK_MAPMOVE) {
			conn.hook(PACKET.ZC.NPCACK_MAPMOVE, (pkt: any) => {
				// mapa novo, mundo novo: o que estava em volta ficou para trás
				this.entities.clear();
				const destino = normalizeMapName(pkt.mapName);
				const mesmoMapa = destino === mapName;
				mapName = destino;
				this.emit("map-enter", { mapName, x: pkt.xPos, y: pkt.yPos, dir: 0, gid: this.gid });
				// `pc_setpos` manda este pacote TAMBÉM quando o destino é o mesmo
				// mapa (pc.cpp:7118) — é o caso de `@jump`, de warp de NPC interno
				// e da Asa de Borboleta. Sem reposicionar aqui, a cena continuava
				// desenhando o personagem na célula velha: ele "não saía do
				// lugar" e todo pedido de andar partia de onde ele não estava.
				if (mesmoMapa) this.emit("self-warp", { x: pkt.xPos, y: pkt.yPos });
			});
		}

		// Spawn: o rAthena tem uma geracao de pacote de spawn por epoca de cliente
		// (STANDENTRY, NEWENTRY, ACTENTRY, MOVEENTRY + numeradas ate 11). Qual
		// chega depende do PACKETVER, entao enganchamos TODAS as registradas e
		// normalizamos — igual ao roBrowser, que joga as 31 no mesmo handler.
		for (const key of Object.keys(PACKET.ZC)) {
			if (!/^NOTIFY_(STANDENTRY|NEWENTRY|ACTENTRY|MOVEENTRY)\d*$/.test(key)) {
				continue;
			}
			const Struct = PACKET.ZC[key];
			if (!Struct?.id) {
				continue;
			}
			conn.hook(Struct, (pkt: any) => {
				const entity = toEntity(pkt);
				const isNew = !this.entities.has(entity.gid);
				this.entities.set(entity.gid, entity);
				this.emit("entity-spawn", entity);

				// Pergunta o nome de TODA entidade nova, mesmo das que já vieram
				// nomeadas no spawn: é a RESPOSTA (ACK_REQNAMEALL) que carrega
				// "Lv. 1 | HP: 55/55" — sem perguntar, a plaquinha fica só com o
				// nome e a barra de HP do mob nunca aparece.
				if (isNew) {
					this.queryName(entity.gid);
				}

				// MOVEENTRY = a entidade entrou no seu campo de visão JÁ ANDANDO, e
				// o pacote traz o trecho inteiro (de onde saiu → para onde vai). Sem
				// reemitir isso como movimento, o mob aparece congelado no destino
				// até o próximo NOTIFY_MOVE — que só vem quando ele escolher outro
				// caminho.
				if (Array.isArray(pkt.MoveData)) {
					const [fromX, fromY, toX, toY] = pkt.MoveData;
					this.emit("entity-move", {
						gid: entity.gid,
						from: { x: fromX, y: fromY },
						to: { x: toX, y: toY },
						speed: entity.speed,
						/**
						 * O pacote de spawn-andando também traz `moveStartTime`, e ele
						 * importa MAIS aqui que no NOTIFY_MOVE: a entidade entrou no
						 * campo de visão no MEIO de um trecho já em andamento, então
						 * ancorar na chegada a faria recomeçar o caminho do início.
						 *
						 * As variantes numeradas do pacote nem sempre trazem o campo;
						 * `0` significa "não sei" e o cliente cai no relógio local.
						 */
						startTime: pkt.moveStartTime ?? 0,
					});
				}
			});
		}

		conn.hook(PACKET.ZC.NOTIFY_PLAYERMOVE, (pkt: any) => {
			const [fromX, fromY, toX, toY] = pkt.MoveData;
			this.emit("self-move", {
				from: { x: fromX, y: fromY },
				to: { x: toX, y: toY },
				startTime: pkt.moveStartTime,
			});
		});

		conn.hook(PACKET.ZC.NOTIFY_MOVE, (pkt: any) => {
			const [fromX, fromY, toX, toY] = pkt.MoveData;
			this.emit("entity-move", {
				gid: pkt.GID,
				from: { x: fromX, y: fromY },
				to: { x: toX, y: toY },
				/**
				 * O TICK DO SERVIDOR, que estava sendo jogado fora.
				 *
				 * `ZC_NOTIFY_MOVE` (0x86) carrega `moveStartTime` — o `gettick()`
				 * do map-server no instante em que o movimento COMEÇOU
				 * (PacketStructure.js:4813). Sem ele, o cliente ancorava o
				 * trecho na hora de CHEGADA do pacote: um pacote que demorou
				 * 80 ms fazia o mob recomeçar o trecho do zero, 80 ms atrasado,
				 * e a diferença se acumulava em cada passo. Com o tick, o
				 * cliente sabe em que ponto do trecho o bicho já está.
				 *
				 * É `gettick()`, não epoch: conta ms desde o boot do
				 * map-server. Quem traduz para o relógio local é o cliente
				 * (`net/relogioDoServidor`), estimando o desvio por mediana.
				 */
				startTime: pkt.moveStartTime,
				/**
				 * A struct 0x86 NÃO tem campo de velocidade (só GID, MoveData e
				 * moveStartTime). O `pkt.speed ?? 0` de antes lia `undefined` e
				 * mandava 0 em TODO pacote de movimento, e o cliente caía no
				 * fallback `prev.speed` sempre. Mandar o que se sabe — o do
				 * snapshot — é honesto; inventar um número não.
				 */
				speed: this.entities.get(pkt.GID)?.speed ?? 0,
			});
		});

		// ZC_STOPMOVE (0x88) é o "fixpos" do rAthena: parou de andar, levou
		// empurrão, ou foi TELEPORTADO dentro do mesmo mapa (@jump, warp de NPC,
		// Fly Wing — `clif_fixpos`, clif.cpp:2203). Quando o AID é o do próprio
		// jogador, ele reposiciona QUEM JOGA: sem isso o cliente seguia achando
		// que estava na célula velha, e todo pedido de andar saía de um lugar
		// onde o personagem não estava mais.
		conn.hook(PACKET.ZC.STOPMOVE, (pkt: any) => {
			if (this.isSelf(pkt.AID)) this.emit("self-warp", { x: pkt.xPos, y: pkt.yPos });
			else this.emit("entity-stop", { gid: pkt.AID, x: pkt.xPos, y: pkt.yPos });
		});

		// ZC_HIGHJUMP (`clif_slide`) — teleporte visual instantâneo, mandado
		// junto do fixpos em knockback/backslide.
		if (PACKET.ZC.HIGHJUMP) {
			conn.hook(PACKET.ZC.HIGHJUMP, (pkt: any) => {
				const gid = pkt.AID;
				if (this.isSelf(gid)) this.emit("self-warp", { x: pkt.xPos, y: pkt.yPos });
				else this.emit("entity-stop", { gid, x: pkt.xPos, y: pkt.yPos });
			});
		}

		/**
		 * ZC_ATTACK_FAILURE_FOR_DISTANCE (0x139) — "longe demais, ande até lá".
		 *
		 * O rAthena NÃO persegue o alvo por conta do jogador. Em
		 * `unit_attack_timer_sub` (unit.cpp:3259) o ramo do MONSTRO chama
		 * `unit_walktobl`, mas o do jogador só manda este pacote e desiste:
		 *
		 * ```c
		 * if(sd && !check_distance_client_bl(src,target,range)) {
		 *     // Player tries to attack but target is too far, notify client
		 *     clif_movetoattack( *sd, *target );
		 *     return 1;
		 * }
		 * ```
		 *
		 * Ou seja: aproximar-se é trabalho do CLIENTE, e é o que o cliente
		 * oficial faz. Sem enganchar aqui, clicar num monstro longe não fazia
		 * absolutamente nada.
		 *
		 * O pacote traz tudo que a aproximação precisa — onde o alvo está e qual
		 * o alcance da arma —, então não é preciso adivinhar nada.
		 */
		if (PACKET.ZC.ATTACK_FAILURE_FOR_DISTANCE) {
			conn.hook(PACKET.ZC.ATTACK_FAILURE_FOR_DISTANCE, (pkt: any) => {
				this.emit("attack-too-far", {
					gid: pkt.targetAID,
					x: pkt.targetXPos,
					y: pkt.targetYPos,
					// a posição do PRÓPRIO jogador segundo o servidor: é a única
					// que não sofre da deriva do desenho, e é por ela que o
					// cliente decide se já pode parar de andar
					euX: pkt.xPos,
					euY: pkt.yPos,
					range: pkt.currentAttRange,
				});
			});
		}

		/**
		 * ZC_ATTACK_RANGE (0x013a) — "até onde você pode atacar", mandado no
		 * login (`clif_initialstatus`, clif.cpp:4171) e de novo toda vez que
		 * `status_calc_pc_` recalcula e `rhw.range` MUDA (status.cpp:6653-6654,
		 * o mesmo diff-e-avisa de HP/ATK/DEF). Cobre arma, passiva (Vulture's
		 * Eye), carta, refino e buff de uma vez, porque é o PRÓPRIO servidor
		 * quem soma tudo isso em `rhw.range` — não uma tabela nossa tentando
		 * adivinhar bônus.
		 *
		 * Entra pelo MESMO cano do resto dos stats (`pushStat`/`self:stat`):
		 * sobrevive a `world:ready` (reenviado do snapshot) e o cliente não
		 * precisa de um canal novo para um número que é, no fundo, mais um
		 * atributo do personagem.
		 */
		if (PACKET.ZC.ATTACK_RANGE) {
			conn.hook(PACKET.ZC.ATTACK_RANGE, (pkt: any) => {
				this.pushStat({ name: statName(1000), id: 1000, value: pkt.currentAttRange });
			});
		}

		conn.hook(PACKET.ZC.NOTIFY_VANISH, (pkt: any) => {
			this.entities.delete(pkt.GID);
			this.emit("entity-vanish", { gid: pkt.GID, reason: pkt.type });
		});

		for (const name of ["ACK_REQNAME", "ACK_REQNAMEALL", "ACK_REQNAMEALL2"] as const) {
			if (!PACKET.ZC[name]) continue;
			conn.hook(PACKET.ZC[name], (pkt: any) => {
				const gid = pkt.GID ?? pkt.AID;
				const label = cleanText(pkt.CName ?? pkt.name ?? "");
				this.emit("entity-name", { gid, name: label });
				// guarda no snapshot: quem entra na cena depois (o replay do
				// `world:ready`) tem que receber a entidade JÁ nomeada — a
				// resposta do REQNAME chega antes de a cena 3D existir e não se
				// repete.
				const known = this.entities.get(gid);
				if (known && label) known.name = label;

				// Com `show_mob_info` ligado, o rAthena manda "Lv. 1 | HP: 55/55"
				// no campo de NOME DE PARTY do mesmo pacote (clif.cpp:10036-10061)
				// — é o truque que o cliente oficial usa para mostrar a vida do
				// monstro sem um pacote próprio. Aproveitamos os números.
				const info = cleanText(pkt.PName ?? "");
				if (!info) return;

				const hp = info.match(/HP:\s*(\d+)\s*\/\s*(\d+)/i);
				if (hp) {
					if (known) {
						known.hp = Number(hp[1]);
						known.maxHp = Number(hp[2]);
					}
					this.emit("entity-hp", { gid, hp: Number(hp[1]), maxHp: Number(hp[2]) });
				}
				const level = info.match(/Lv\.?\s*(\d+)/i);
				if (level) {
					if (known) known.level = Number(level[1]);
					this.emit("entity-level", { gid, level: Number(level[1]) });
				}
			});
		}

		for (const name of ["NOTIFY_ACT", "NOTIFY_ACT2", "NOTIFY_ACT3"] as const) {
			if (PACKET.ZC[name]) {
				conn.hook(PACKET.ZC[name], (pkt: any) => {
					this.emit("entity-action", {
						gid: pkt.GID,
						targetGid: pkt.targetGID,
						damage: pkt.damage,
						count: pkt.count,
						action: pkt.action,
					});
				});
			}
		}

		for (const name of ["NOTIFY_MONSTER_HP", "HP_INFO_TINY"] as const) {
			if (PACKET.ZC[name]) {
				conn.hook(PACKET.ZC[name], (pkt: any) => {
					const gid = pkt.GID ?? pkt.AID;
					const known = this.entities.get(gid);
					if (known) {
						known.hp = pkt.hp;
						known.maxHp = pkt.maxhp;
					}
					this.emit("entity-hp", { gid, hp: pkt.hp, maxHp: pkt.maxhp });
				});
			}
		}

		// "o parâmetro X virou Y". É por aqui que passam HP, SP, zeny, exp, peso,
		// nível — o rAthena não manda um "bloco de personagem", manda diferenças.
		for (const name of ["PAR_CHANGE", "LONGPAR_CHANGE", "LONGLONGPAR_CHANGE"] as const) {
			if (PACKET.ZC[name]) {
				conn.hook(PACKET.ZC[name], (pkt: any) => {
					const value = Number(pkt.count ?? pkt.amount ?? 0);
					this.pushStat({ name: statName(pkt.varID), id: pkt.varID, value });
				});
			}
		}

		// STATUS_CHANGE (0xbc) é o par "atributo base / custo do próximo ponto";
		// COUPLESTATUS separa o valor base do bônus de equipamento (ATK 50 + 12).
		if (PACKET.ZC.STATUS_CHANGE) {
			conn.hook(PACKET.ZC.STATUS_CHANGE, (pkt: any) => {
				this.pushStat({ name: statName(pkt.statusID), id: pkt.statusID, value: pkt.value });
			});
		}
		if (PACKET.ZC.COUPLESTATUS) {
			conn.hook(PACKET.ZC.COUPLESTATUS, (pkt: any) => {
				this.pushStat({
					name: statName(pkt.statusType),
					id: pkt.statusType,
					value: pkt.defaultStatus,
					bonus: pkt.plusStatus,
				});
			});
		}

		// 0xbd: a janela de status inteira de uma vez (chega no login e a cada
		// mudança grande). Vale como "verdade" — os PAR_CHANGE ajustam por cima.
		if (PACKET.ZC.STATUS) {
			conn.hook(PACKET.ZC.STATUS, (pkt: any) => {
				this.pushStatus({
					statusPoint: pkt.point,
					str: pkt.str,
					agi: pkt.agi,
					vit: pkt.vit,
					int: pkt.Int,
					dex: pkt.dex,
					luk: pkt.luk,
					upStr: pkt.standardStr,
					upAgi: pkt.standardAgi,
					upVit: pkt.standardVit,
					upInt: pkt.standardInt,
					upDex: pkt.standardDex,
					upLuk: pkt.standardLuk,
					atk: pkt.attPower,
					atkBonus: pkt.refiningPower,
					matkMin: pkt.min_mattPower,
					matkMax: pkt.max_mattPower,
					def: pkt.itemdefPower,
					defBonus: pkt.plusdefPower,
					mdef: pkt.mdefPower,
					mdefBonus: pkt.plusmdefPower,
					hit: pkt.hitSuccessValue,
					// `flee` já é o TOTAL (equipamento incluído, clif.cpp:4156) — não
					// tem par base+bônus no protocolo. `plusAvoidSuccessValue` é
					// `flee2` (clif.cpp:4157 = battle_status.flee2/10), ou seja,
					// Perfect Dodge — um stat PRÓPRIO, achado auditando o indicador
					// de status (a Fase 4 tinha isto guardado como "fleeBonus" por
					// engano, somando duas coisas diferentes na tela).
					flee: pkt.avoidSuccessValue,
					perfectDodge: pkt.plusAvoidSuccessValue,
					critical: pkt.criticalSuccessValue,
					aspd: pkt.ASPD,
				});
			});
		}

		// Inventário: o rAthena manda a lista inteira ao entrar e depois só o
		// que muda (pegou/usou/caiu). Cada geração de cliente tem seu pacote de
		// lista, então enganchamos todas as registradas.
		for (const key of Object.keys(PACKET.ZC)) {
			if (!/^(NORMAL_ITEMLIST|EQUIPMENT_ITEMLIST|INVENTORY_ITEMLIST_NORMAL|INVENTORY_ITEMLIST_EQUIP)\d*$/.test(key)) {
				continue;
			}
			const Struct = PACKET.ZC[key];
			if (!Struct?.id) continue;
			conn.hook(Struct, (pkt: any) => {
				const list = (pkt.itemInfo ?? pkt.ItemInfo ?? pkt.list ?? []).map(toInventoryItem);
				if (!list.length) return;
				// Equipamento e consumível vêm em pacotes SEPARADOS: mesclar em vez
				// de substituir, senão a segunda lista apaga a primeira.
				const byIndex = new Map(this.inventory.map((i) => [i.index, i]));
				for (const item of list) byIndex.set(item.index, item);
				this.inventory = [...byIndex.values()].sort((a, b) => a.index - b.index);
				this.emit("inventory", this.inventory);
			});
		}

		for (const key of Object.keys(PACKET.ZC)) {
			if (!/^ITEM_PICKUP_ACK\d*$/.test(key)) continue;
			const Struct = PACKET.ZC[key];
			if (!Struct?.id) continue;
			conn.hook(Struct, (pkt: any) => {
				// result !== 0 = não pegou (peso, inventário cheio…)
				if (pkt.result !== 0) return;
				const item = toInventoryItem(pkt);
				// `pkt.location` aqui é `pc_equippoint(sd,n)` (clif.cpp:2859) — o
				// bitmask de ONDE O ITEM CABE, não onde está vestido. Item pego do
				// chão NUNCA está equipado (o RO não veste sozinho); sem isto uma
				// arma ou carta pega do chão chegava com `equipped: true` (mesma
				// armadilha do `toInventoryItem`, achada testando Cartas ao vivo —
				// ali era a lista NORMAL, aqui é o próprio ACK de pickup).
				item.equipped = false;
				item.location = 0;
				const existing = this.inventory.find((i) => i.index === item.index);
				if (existing) existing.amount += item.amount;
				else this.inventory.push(item);
				this.emit("item-add", item);
			});
		}

		if (PACKET.ZC.ITEM_THROW_ACK) {
			conn.hook(PACKET.ZC.ITEM_THROW_ACK, (pkt: any) => {
				this.forgetItem(pkt.Index ?? pkt.index, pkt.count);
			});
		}
		if (PACKET.ZC.DELETE_ITEM_FROM_BODY) {
			/**
			 * `PACKET_ZC_DELETE_ITEM_FROM_BODY` (PacketStructure.js:9669) lê os
			 * campos com MAIÚSCULA — `this.Index`/`this.Count`, diferente de todo
			 * outro pacote de item deste arquivo (USE_ITEM_ACK, ITEM_THROW_ACK)
			 * que usa minúscula. Ler `pkt.index`/`pkt.count` aqui dava sempre
			 * `undefined` — silencioso, porque `forgetItem(undefined, undefined)`
			 * não encontra item nenhum pelo índice e o `item-remove` sai vazio
			 * (`JSON.stringify({index:undefined,...})` → `{}`). Era a causa raiz
			 * de "flecha consumida no servidor, inventário nunca desce no
			 * cliente" — este pacote é o ÚNICO caminho de `pc_delitem` para
			 * consumo de munição (`battle_consume_ammo`, battle.cpp:2666) e de
			 * skill (skill.cpp:4262/4618/5461).
			 */
			conn.hook(PACKET.ZC.DELETE_ITEM_FROM_BODY, (pkt: any) => {
				this.forgetItem(pkt.Index ?? pkt.index, pkt.Count ?? pkt.count);
			});
		}

		// Usar consumível: o rAthena não manda inv:remove por conta própria, só
		// este ACK — sem enganchá-lo, a barra de quantidade nunca descia (era o
		// "usei poção e não diminui"). `count` aqui é o QUANTO SOBROU no slot, não
		// um delta, então a conta é pelo que o snapshot já tinha guardado.
		for (const name of ["USE_ITEM_ACK", "USE_ITEM_ACK2"] as const) {
			if (!PACKET.ZC[name]) continue;
			conn.hook(PACKET.ZC[name], (pkt: any) => {
				if (!pkt.result) return; // 0 = recusado, item continua como estava
				const item = this.inventory.find((i) => i.index === pkt.index);
				const delta = item ? item.amount - pkt.count : 1;
				if (delta > 0) this.forgetItem(pkt.index, delta);
			});
		}

		/**
		 * Equipar/desequipar: confirmado no source do rAthena
		 * (clif.cpp:4301-4349), NÃO no palpite da auditoria anterior (0xaa/0xac
		 * eram do cliente pré-2010). No PACKETVER deste projeto (20130618,
		 * `PACKETVER_MAIN_NUM >= 20121205`) o servidor manda a variante V5:
		 * `ZC_ACK_WEAR_EQUIP_V5` (0x999, `wearLocation` de 4 bytes) e
		 * `ZC_ACK_TAKEOFF_EQUIP_V5` (0x99a, idem). As três gerações são
		 * enganchadas do mesmo jeito que USE_ITEM_ACK — só UMA dispara em tempo
		 * de execução, a que o binário compilado realmente manda; as outras
		 * ficam mortas sem custo. O codec (`packages/ro-protocol`) já normaliza
		 * a inversão de `result` de cada geração (rAthena troca o sentido do bit
		 * conforme a versão) — aqui `pkt.result` é sempre "true = sucesso".
		 *
		 * `this.inventory` é atualizado NA HORA, sem esperar um re-envio de
		 * ITEMLIST (que a auditoria anterior marcou como "não confirmado") — é
		 * o próprio ACK que diz o resultado e, se deu certo, ONDE.
		 */
		for (const name of ["ACK_WEAR_EQUIP_V5", "REQ_WEAR_EQUIP_ACK2", "REQ_WEAR_EQUIP_ACK"] as const) {
			if (!PACKET.ZC[name]) continue;
			conn.hook(PACKET.ZC[name], (pkt: any) => {
				const item = this.inventory.find((i) => i.index === pkt.index);
				const success = Boolean(pkt.result);
				if (item && success) {
					item.location = pkt.wearLocation ?? 0;
					item.equipped = item.location !== 0;
				}
				this.emit("item-equip-result", {
					index: pkt.index,
					success,
					equipped: item?.equipped ?? false,
					location: item?.location ?? 0,
				});
			});
		}
		for (const name of ["ACK_TAKEOFF_EQUIP_V5", "REQ_TAKEOFF_EQUIP_ACK2", "REQ_TAKEOFF_EQUIP_ACK"] as const) {
			if (!PACKET.ZC[name]) continue;
			conn.hook(PACKET.ZC[name], (pkt: any) => {
				const item = this.inventory.find((i) => i.index === pkt.index);
				const success = Boolean(pkt.result);
				if (item && success) {
					item.location = 0;
					item.equipped = false;
				}
				this.emit("item-equip-result", {
					index: pkt.index,
					success,
					equipped: item?.equipped ?? false,
					location: item?.location ?? 0,
				});
			});
		}

		/**
		 * Munição é o ÚNICO tipo de equip cujo SUCESSO não passa pelo ACK
		 * genérico acima — confirmado no source (`pc.cpp:12163-12166`):
		 * `if(pos==EQP_AMMO) { clif_arrowequip(*sd); clif_arrow_fail(*sd,
		 * ARROWFAIL_SUCCESS); }` no lugar de `clif_equipitemack`. A FALHA de
		 * flecha (classe errada, nível baixo etc) continua saindo pelo ACK
		 * normal — pc_isequip roda ANTES dessa bifurcação — só o SUCESSO tem
		 * pacote próprio. Sem este hook, todo `item:equip` de munição parecia
		 * "sem resposta" pro cliente: o rAthena equipava de verdade
		 * (confirmado no log do servidor, `equip <id> (<n>) <pos>:<pos>` sem
		 * erro seguinte) e o item ficava com a flecha carregada, mas a UI
		 * nunca soube — o slot no Alt+Q não acendia e o pedido "expirava".
		 *
		 * `ZC_EQUIP_ARROW` (0x013c) só traz o ÍNDICE (client_index já
		 * aplicado pelo rAthena, `clif.cpp:4212`) — location é sempre
		 * EQP_AMMO, não vem no pacote porque só existe UM slot possível.
		 */
		conn.hook(PACKET.ZC.EQUIP_ARROW, (pkt: any) => {
			const item = this.inventory.find((i) => i.index === pkt.index);
			if (item) {
				item.location = 0x8000; // EQP_AMMO
				item.equipped = true;
			}
			this.emit("item-equip-result", {
				index: pkt.index,
				success: true,
				equipped: item?.equipped ?? true,
				location: item?.location ?? 0x8000,
			});
		});

		/**
		 * ZC_ACTION_FAILURE (0x13b) — o servidor tentou atirar e não pôde.
		 * `e_action_failure` (clif.hpp:798) só tem 4 valores e o único que nos
		 * interessa é `ARROWFAIL_NO_AMMO = 0` (`battle.cpp:7171`, dentro de
		 * `battle_weapon_attack`, quando `equip_index[EQI_AMMO] < 0`).
		 *
		 * Existe pelo mesmo motivo do pré-check no cliente (`equipmentStore.
		 * precisaDeMunicaoSemTer`, checado ANTES de mandar `action:attack`) NÃO
		 * bastar sozinho: entre o clique e o pacote chegar ao servidor, a
		 * última flecha pode ter sido consumida por um golpe anterior que
		 * ainda estava em voo — o pré-check local vê munição que já não existe
		 * mais no personagem real. Este pacote é a correção AUTORITATIVA para
		 * essa corrida, e cobre também qualquer outro caminho de ataque que o
		 * pré-check não tenha coberto.
		 */
		if (PACKET.ZC.ACTION_FAILURE) {
			conn.hook(PACKET.ZC.ACTION_FAILURE, (pkt: any) => {
				if (pkt.errorCode === 0) this.emit("attack-no-ammo");
			});
		}

		/**
		 * Cartas (clif.cpp:7070-7142): duplo clique pede a LISTA de equipamentos
		 * compatíveis (0x17a→0x17b) — o rAthena escreve os índices já em
		 * formato de FIO (`i+2`, o mesmo de `this.inventory[].index` em todo o
		 * resto deste arquivo), então `ITIDList` sai direto, sem conta nenhuma.
		 * Quando NÃO há nenhum compatível o servidor não manda nada (nem lista
		 * vazia) — `card:options` simplesmente não chega, e quem pediu trata
		 * isso como zero opções (ver `net/cardStore` no cliente).
		 */
		if (PACKET.ZC.ITEMCOMPOSITION_LIST) {
			conn.hook(PACKET.ZC.ITEMCOMPOSITION_LIST, (pkt: any) => {
				this.emit("card-options", { cardIndex: this.cardListRequested ?? 0, equipIndexes: pkt.ITIDList ?? [] });
			});
		}
		/**
		 * Composição de verdade (0x17c→0x17d). O ACK só traz {equipIndex,
		 * cardIndex, result} — NUNCA o item atualizado —, então é ESTE hook
		 * que muta `this.inventory` (mesmo padrão de equipar/desequipar, duas
		 * dezenas de linhas acima). O itemId da carta precisa vir de ANTES:
		 * por essa altura o `DELETE_ITEM_FROM_BODY` que consome a carta
		 * (clif_delitem, disparado por `pc_delitem` dentro de
		 * `pc_insert_card`, ANTES do próprio ACK) já rodou e já tirou a carta
		 * de `this.inventory` — `insertCard()` guarda o itemId antes de
		 * mandar o pedido exatamente por isso.
		 */
		if (PACKET.ZC.ACK_ITEMCOMPOSITION) {
			conn.hook(PACKET.ZC.ACK_ITEMCOMPOSITION, (pkt: any) => {
				// 0 = sucesso, 1 = falha — ao CONTRÁRIO do `Boolean(pkt.result)`
				// que os ACKs de equipar usam acima; aqui é o próprio comentário
				// do rAthena (clif.cpp:7130-7132) que manda.
				const success = !pkt.result;
				const pending = this.pendingCardInsert;
				this.pendingCardInsert = null;
				if (success && pending && pending.equipIndex === pkt.equipIndex && pending.cardIndex === pkt.cardIndex) {
					const equip = this.inventory.find((i) => i.index === pkt.equipIndex);
					if (equip) {
						const slot = equip.cards.findIndex((c) => c === 0);
						if (slot !== -1) equip.cards[slot] = pending.itemId;
					}
					/**
					 * A carta CONSUMIDA não gera pacote nenhum próprio — confirmado
					 * no source, não suposto: `pc_insert_card` chama `pc_delitem(sd,
					 * idx_card, 1, 1, 0, ...)` com `type=1`, e `pc_delitem` só manda
					 * `clif_delitem` (o DELETE_ITEM_FROM_BODY que o resto deste
					 * arquivo escuta) quando `!(type&1)` — pc.cpp:6120-6121. Com
					 * type=1 essa notificação é PULADA de propósito; o cliente
					 * original deduz a remoção pelo sucesso do próprio ACK, e é
					 * exatamente isso que este bloco faz no lugar dele (achado
					 * testando ao vivo: sem isto a carta ficava fantasma na bolsa
					 * mesmo já composta de verdade no equipamento).
					 */
					this.forgetItem(pkt.cardIndex, 1);
				}
				this.emit("card-result", {
					equipIndex: pkt.equipIndex,
					cardIndex: pkt.cardIndex,
					success,
					cards: this.inventory.find((i) => i.index === pkt.equipIndex)?.cards ?? [],
				});
			});
		}

		// Árvore de habilidades: a lista chega inteira ao entrar; ADD_SKILL avisa
		// quando uma nova é aprendida e SKILLINFO_UPDATE quando muda de nível.
		for (const key of Object.keys(PACKET.ZC)) {
			if (!/^SKILLINFO_LIST\d*$/.test(key)) continue;
			const Struct = PACKET.ZC[key];
			if (!Struct?.id) continue;
			conn.hook(Struct, (pkt: any) => {
				const list = (pkt.skillList ?? []).map(toSkill);
				for (const skill of list) this.skills.set(skill.id, skill);
				this.emit("skills", [...this.skills.values()]);
			});
		}

		// Barra de atalho: o rAthena manda os 38 slots INTEIROS de novo a cada
		// vez (nunca incremental — não há pacote de "1 slot mudou" na volta, só
		// CZ_SHORTCUT_KEY_CHANGE* de saída), então basta decodificar e emitir —
		// sem Map acumulador, diferente de skills. Mesmo padrão de variante
		// múltipla do bloco acima: só a struct que o packetver realmente
		// registrou (`.id` setado por `initProtocol`) é enganchada — neste
		// projeto (20130618) é só `SHORTCUT_KEY_LIST_V2`.
		for (const key of Object.keys(PACKET.ZC)) {
			if (!/^SHORTCUT_KEY_LIST(_V\d+)?$/.test(key)) continue;
			const Struct = PACKET.ZC[key];
			if (!Struct?.id) continue;
			conn.hook(Struct, (pkt: any) => {
				this.emit("hotkeys", toHotkeys(pkt.ShortCutKey ?? []));
			});
		}

		for (const name of ["ADD_SKILL", "SKILLINFO_UPDATE", "SKILLINFO_UPDATE2"] as const) {
			if (!PACKET.ZC[name]) continue;
			conn.hook(PACKET.ZC[name], (pkt: any) => {
				const raw = pkt.data ?? pkt;
				const id = raw.SKID ?? raw.skid ?? 0;
				if (!id) return;
				const prev = this.skills.get(id);
				this.skills.set(id, {
					...(prev ?? { id, name: raw.skillName ?? `skill_${id}`, spCost: 0, range: 0, upgradable: false }),
					...toSkill({ ...raw, SKID: id, skillName: raw.skillName ?? prev?.name ?? `skill_${id}` }),
				});
				this.emit("skills", [...this.skills.values()]);
			});
		}

		// --- VFX de skill ---------------------------------------------------
		// "fulano usou a skill X em beltrano": é o que vira efeito visual no
		// cliente. Dano de skill vem no mesmo pacote (NOTIFY_SKILL).
		for (const name of ["NOTIFY_SKILL", "NOTIFY_SKILL2"] as const) {
			if (!PACKET.ZC[name]) continue;
			conn.hook(PACKET.ZC[name], (pkt: any) => {
				this.emit("skill-cast", {
					skillId: pkt.SKID,
					level: pkt.level ?? 1,
					sourceGid: pkt.AID,
					targetGid: pkt.targetID,
					damage: pkt.damage ?? 0,
					count: pkt.count ?? 1,
					kind: "target",
					// mesmo byte DMG_* do NOTIFY_ACT — sem repassar, o cliente não tinha
					// como saber que a skill acertou (só o VFX aparecia, nunca o número
					// de dano em cima do monstro)
					action: pkt.action ?? 0,
				});
			});
		}

		// skill sem dano (buff, cura): o servidor manda ZC.USE_SKILL
		for (const name of ["USE_SKILL", "USE_SKILL2"] as const) {
			if (!PACKET.ZC[name]) continue;
			conn.hook(PACKET.ZC[name], (pkt: any) => {
				if (!pkt.result) return; // 0 = falhou
				this.emit("skill-cast", {
					skillId: pkt.SKID,
					level: pkt.level ?? 1,
					sourceGid: pkt.srcAID,
					targetGid: pkt.targetAID,
					damage: 0,
					count: 0,
					kind: "buff",
					action: 0,
				});
			});
		}

		// barra de conjuração (o "castando…" do RO)
		for (const name of ["USESKILL_ACK", "USESKILL_ACK2", "USESKILL_ACK3"] as const) {
			if (!PACKET.ZC[name]) continue;
			conn.hook(PACKET.ZC[name], (pkt: any) => {
				this.emit("skill-casting", {
					skillId: pkt.SKID,
					sourceGid: pkt.AID,
					targetGid: pkt.targetID,
					x: pkt.xPos,
					y: pkt.yPos,
					durationMs: pkt.delayTime ?? 0,
				});
			});
		}

		// área no chão (Storm Gust, armadilha, Safety Wall…)
		for (const key of Object.keys(PACKET.ZC)) {
			if (!/^SKILL_ENTRY\d*$/.test(key)) continue;
			const Struct = PACKET.ZC[key];
			if (!Struct?.id) continue;
			conn.hook(Struct, (pkt: any) => {
				this.emit("skill-ground", {
					gid: pkt.AID,
					creatorGid: pkt.creatorAID,
					x: pkt.xPos,
					y: pkt.yPos,
					// `job` aqui é o id da UNIDADE de skill, não da skill em si
					unitId: pkt.job,
					visible: pkt.isVisible !== 0,
				});
			});
		}

		if (PACKET.ZC.SKILL_DISAPPEAR) {
			conn.hook(PACKET.ZC.SKILL_DISAPPEAR, (pkt: any) => {
				this.emit("skill-ground-gone", { gid: pkt.AID ?? pkt.GID });
			});
		}

		// Recarga da skill: quem manda o tempo é o servidor (clif.cpp:6033,
		// `043d <skill ID>.W <tick>.L`). O cliente não tem como calcular — a
		// duração sai do skill_db e de modificadores de status.
		if (PACKET.ZC.SKILL_POSTDELAY) {
			conn.hook(PACKET.ZC.SKILL_POSTDELAY, (pkt: any) => {
				this.emit("skill-cooldown", { skillId: pkt.SKID, durationMs: pkt.DelayTM });
			});
		}

		// --- itens no chão ----------------------------------------------------
		// ITEM_ENTRY = item que já estava lá quando cheguei; ITEM_FALL_ENTRY = item
		// que acabou de cair (drop de mob). Os dois têm a mesma carga.
		for (const name of ["ITEM_ENTRY", "ITEM_FALL_ENTRY", "ITEM_FALL_ENTRY2", "ITEM_FALL_ENTRY3"] as const) {
			if (!PACKET.ZC[name]) continue;
			conn.hook(PACKET.ZC[name], (pkt: any) => {
				this.emit("ground-item", {
					gid: pkt.ITAID,
					itemId: pkt.ITID,
					amount: pkt.count ?? 1,
					x: pkt.xPos,
					y: pkt.yPos,
					identified: Boolean(pkt.IsIdentified ?? 1),
					// deslocamento dentro da célula: no RO dois itens na mesma
					// célula não ficam empilhados no mesmo pixel
					subX: pkt.subX ?? 0,
					subY: pkt.subY ?? 0,
				});
			});
		}

		if (PACKET.ZC.ITEM_DISAPPEAR) {
			conn.hook(PACKET.ZC.ITEM_DISAPPEAR, (pkt: any) => {
				this.emit("ground-item-gone", { gid: pkt.ITAID });
			});
		}

		// --- diálogo de NPC ---------------------------------------------------
		if (PACKET.ZC.SAY_DIALOG) {
			conn.hook(PACKET.ZC.SAY_DIALOG, (pkt: any) => {
				this.emit("npc-dialog", { gid: pkt.NAID, kind: "text", text: cleanText(pkt.msg) });
			});
		}
		if (PACKET.ZC.WAIT_DIALOG) {
			conn.hook(PACKET.ZC.WAIT_DIALOG, (pkt: any) => {
				this.emit("npc-dialog", { gid: pkt.NAID, kind: "next" });
			});
		}
		if (PACKET.ZC.CLOSE_DIALOG) {
			conn.hook(PACKET.ZC.CLOSE_DIALOG, (pkt: any) => {
				this.emit("npc-dialog", { gid: pkt.NAID, kind: "close" });
			});
		}
		if (PACKET.ZC.MENU_LIST) {
			conn.hook(PACKET.ZC.MENU_LIST, (pkt: any) => {
				// o rAthena manda as opções numa string só, separadas por ":"
				this.emit("npc-dialog", {
					gid: pkt.NAID,
					kind: "menu",
					options: cleanText(pkt.msg)
						.split(":")
						.map((o: string) => o.trim())
						.filter(Boolean),
				});
			});
		}

		if (PACKET.ZC.NOTIFY_PLAYERCHAT) {
			conn.hook(PACKET.ZC.NOTIFY_PLAYERCHAT, (pkt: any) => {
				this.emit("chat", { text: pkt.msg ?? "", scope: "self" });
			});
		}
		if (PACKET.ZC.NOTIFY_CHAT) {
			conn.hook(PACKET.ZC.NOTIFY_CHAT, (pkt: any) => {
				this.emit("chat", { gid: pkt.GID, text: pkt.msg ?? "", scope: "public" });
			});
		}
		if (PACKET.ZC.BROADCAST) {
			conn.hook(PACKET.ZC.BROADCAST, (pkt: any) => {
				this.emit("chat", { text: pkt.msg ?? "", scope: "announce" });
			});
		}
		// Party e guilda têm pacote PRÓPRIO (clif.cpp:13968 e 14584); sem
		// enganchá-los a fala desses canais simplesmente não chegava, e as abas
		// do chat ficavam vazias para sempre.
		if (PACKET.ZC.NOTIFY_CHAT_PARTY) {
			conn.hook(PACKET.ZC.NOTIFY_CHAT_PARTY, (pkt: any) => {
				this.emit("chat", { gid: pkt.AID, text: pkt.msg ?? "", scope: "party" });
			});
		}
		if (PACKET.ZC.GUILD_CHAT) {
			conn.hook(PACKET.ZC.GUILD_CHAT, (pkt: any) => {
				this.emit("chat", { text: pkt.msg ?? "", scope: "guild" });
			});
		}
		// Canais (#global, #trade) chegam TODOS por 0x2c1; quem separa é o
		// apelido que `channel_send` põe na frente (channel.cpp:466).
		if (PACKET.ZC.NPC_CHAT) {
			conn.hook(PACKET.ZC.NPC_CHAT, (pkt: any) => {
				const text = String(pkt.msg ?? "");
				this.emit("chat", { text, scope: scopeDoCanal(text) });
			});
		}

		this.hookSocialPackets(conn);
	}

	/**
	 * Amigos, guilda e ignorados.
	 *
	 * Os três alimentam a MESMA janela (`hud/FriendsWindow`), mas são três
	 * caminhos independentes do protocolo:
	 *
	 * - amigos: 0x201 (lista) + 0x206 (entrou/saiu) + 0x207/0x209/0x20a
	 * - guilda: 0x154, e só depois de pedir (CZ_REQ_GUILD_MENU tipo 1)
	 * - ignorados: 0xd4, idem (CZ_REQ_WHISPER_LIST)
	 *
	 * A lista de amigos NÃO traz nível, classe nem mapa nesta faixa de
	 * PACKETVER; a da guilda traz os três. Quem desenha respeita a diferença.
	 */
	private hookSocialPackets(conn: RoConnection): void {
		if (PACKET.ZC.FRIENDS_LIST) {
			conn.hook(PACKET.ZC.FRIENDS_LIST, (pkt: any) => {
				// A lista nasce toda OFFLINE: o rAthena manda um 0x206 logo em
				// seguida para cada amigo que está no ar (clif.cpp:15378). Chutar
				// "online" aqui piscaria todo mundo verde por um instante.
				this.friends = (pkt.friendList ?? []).map((f: any) => ({
					accountId: f.AID,
					charId: f.GID,
					name: String(f.Name ?? ""),
					online: false,
				}));
				this.emit("friends", this.friends);
			});
		}
		if (PACKET.ZC.FRIENDS_STATE) {
			conn.hook(PACKET.ZC.FRIENDS_STATE, (pkt: any) => {
				// `State` é 0 = online, 1 = offline (clif.cpp:15300). Em 20130618 o
				// pacote NÃO carrega o nome, então quem casa é o par de ids.
				const online = pkt.State === 0;
				const alvo = this.friends.find((f) => f.accountId === pkt.AID && f.charId === pkt.GID);
				if (alvo) alvo.online = online;
				this.emit("friend-state", { accountId: pkt.AID, charId: pkt.GID, online });
			});
		}
		if (PACKET.ZC.REQ_ADD_FRIENDS) {
			conn.hook(PACKET.ZC.REQ_ADD_FRIENDS, (pkt: any) => {
				this.emit("friend-request", {
					accountId: pkt.ReqAID,
					charId: pkt.ReqGID,
					name: String(pkt.Name ?? ""),
				});
			});
		}
		if (PACKET.ZC.ADD_FRIENDS_LIST) {
			conn.hook(PACKET.ZC.ADD_FRIENDS_LIST, (pkt: any) => {
				const amigo: Friend = {
					accountId: pkt.AID,
					charId: pkt.GID,
					name: String(pkt.Name ?? ""),
					// quem acabou de aceitar está por definição no ar
					online: true,
				};
				const ok = pkt.Result === 0;
				if (ok && !this.friends.some((f) => f.charId === amigo.charId)) {
					this.friends.push(amigo);
				}
				this.emit("friend-added", {
					result: pkt.Result,
					reason: ADD_FRIEND_RESULT[pkt.Result as 0 | 1 | 2 | 3] ?? "resposta desconhecida",
					friend: ok ? amigo : null,
				});
			});
		}
		if (PACKET.ZC.DELETE_FRIENDS) {
			conn.hook(PACKET.ZC.DELETE_FRIENDS, (pkt: any) => {
				this.friends = this.friends.filter((f) => f.accountId !== pkt.AID || f.charId !== pkt.GID);
				this.emit("friend-removed", { accountId: pkt.AID, charId: pkt.GID });
			});
		}
		if (PACKET.ZC.MEMBERMGR_INFO) {
			conn.hook(PACKET.ZC.MEMBERMGR_INFO, (pkt: any) => {
				this.guildMembers = (pkt.memberInfo ?? []).map((m: any) => ({
					accountId: m.AID,
					charId: m.GID,
					name: String(m.CharName ?? ""),
					job: m.Job,
					level: m.Level,
					// `CurrentState`: 0 = offline, 1 = online (clif.cpp:8855)
					online: m.CurrentState !== 0,
					position: m.GPositionID,
				}));
				this.emit("guild-members", this.guildMembers);
			});
		}
		if (PACKET.ZC.WHISPER_LIST) {
			conn.hook(PACKET.ZC.WHISPER_LIST, (pkt: any) => {
				this.ignored = (pkt.wisperList ?? [])
					.map((w: any) => String(w.name ?? ""))
					.filter(Boolean);
				this.emit("ignore-list", this.ignored);
			});
		}
	}

	/**
	 * Avisa o map-server que a cena carregou — sem isto o mundo nao "liga" — e
	 * devolve ao cliente o estado que já tinha chegado antes dele estar pronto.
	 */
	notifyReady(): void {
		this.map?.send(new PACKET.CZ.NOTIFY_ACTORINIT());

		for (const stat of this.stats.values()) {
			this.emit("stat", stat);
		}
		if (this.statusBlock) {
			this.emit("status", this.statusBlock);
		}
		if (this.inventory.length) {
			this.emit("inventory", this.inventory);
		}
		if (this.skills.size) {
			this.emit("skills", [...this.skills.values()]);
		}
		for (const entity of this.entities.values()) {
			this.emit("entity-spawn", entity);
		}
		// A lista de amigos chega em `pc_authok`, antes de tudo isto.
		if (this.friends.length) {
			this.emit("friends", this.friends);
		}
		// Guilda e ignorados só existem se forem PEDIDOS. Pedir agora (e não
		// quando a janela abre) é o que faz a aba já vir preenchida no primeiro
		// Alt+Z; o custo é um pacote de 2 bytes cada.
		this.requestGuildMembers();
		this.requestIgnoreList();
	}

	/**
	 * Convida pelo NOME (CZ_ADD_FRIENDS).
	 *
	 * Não existe "adicionar direto": o rAthena manda ZC_REQ_ADD_FRIENDS ao outro
	 * lado e só grava quando ele aceita (clif.cpp:15475). Quem chama aqui vê o
	 * resultado em `friend-added`, que pode ser recusa ou lista cheia.
	 */
	addFriend(name: string): void {
		const pkt = new PACKET.CZ.ADD_FRIENDS();
		pkt.name = name;
		this.sendMap(pkt);
	}

	removeFriend(accountId: number, charId: number): void {
		const pkt = new PACKET.CZ.DELETE_FRIENDS();
		pkt.AID = accountId;
		pkt.GID = charId;
		this.sendMap(pkt);
	}

	answerFriendRequest(accountId: number, charId: number, accept: boolean): void {
		const pkt = new PACKET.CZ.ACK_REQ_ADD_FRIENDS();
		pkt.ReqAID = accountId;
		pkt.ReqGID = charId;
		pkt.Result = accept ? 1 : 0;
		this.sendMap(pkt);
	}

	/**
	 * Gasta um ponto de habilidade (CZ_UPGRADE_SKILLLEVEL).
	 *
	 * Quem valida é o servidor: pré-requisito de árvore, ponto disponível e teto
	 * de nível. Recusa volta calada, e o nível na tela simplesmente não muda —
	 * por isso o cliente não soma nada por conta própria.
	 */
	raiseSkill(skillId: number): void {
		const pkt = new PACKET.CZ.UPGRADE_SKILLLEVEL();
		pkt.SKID = skillId;
		this.sendMap(pkt);
	}

	/** tipo 1 = "members list, list job title" (clif.cpp:14310) */
	requestGuildMembers(): void {
		if (!this.map || !PACKET.CZ.REQ_GUILD_MENU) return;
		const pkt = new PACKET.CZ.REQ_GUILD_MENU();
		pkt.Type = 1;
		this.map.send(pkt);
	}

	requestIgnoreList(): void {
		if (!this.map || !PACKET.CZ.REQ_WHISPER_LIST) return;
		this.map.send(new PACKET.CZ.REQ_WHISPER_LIST());
	}

	/** `type` 0 = ignorar, 1 = voltar a ouvir (CZ_SETTING_WHISPER_PC) */
	setIgnored(name: string, ignore: boolean): void {
		const pkt = new PACKET.CZ.SETTING_WHISPER_PC();
		pkt.name = name;
		pkt.type = ignore ? 0 : 1;
		this.sendMap(pkt);
		// O rAthena responde com 0xd1 (ack do próprio comando), NÃO com a lista
		// nova — sem pedir de novo a aba ficava desatualizada até o próximo login.
		this.requestIgnoreList();
	}

	private pushStat(stat: { name: string; id: number; value: number; bonus?: number }): void {
		this.stats.set(stat.name, stat);
		this.emit("stat", stat);
	}

	private pushStatus(block: StatusBlock): void {
		this.statusBlock = block;
		this.emit("status", block);
	}

	/** tira do inventário GUARDADO (o snapshot que reenviamos no world:ready) */
	private forgetItem(index: number, amount: number): void {
		const item = this.inventory.find((i) => i.index === index);
		if (item) {
			item.amount -= amount;
			if (item.amount <= 0) {
				this.inventory = this.inventory.filter((i) => i.index !== index);
			}
		}
		this.emit("item-remove", { index, amount });
	}

	/** Envia pelo socket do mapa, com erro claro quando ainda não há mundo. */
	private sendMap(packet: { build: () => { buffer: ArrayBuffer } }): void {
		if (!this.map) {
			throw new Error("sem conexao com o map-server");
		}
		this.map.send(packet);
	}

	moveTo(cell: Cell): void {
		if (!this.map) {
			throw new Error("sem conexao com o map-server");
		}
		const Move = PACKETVER.value >= 20180307 && PACKET.CZ.REQUEST_MOVE2 ? PACKET.CZ.REQUEST_MOVE2 : PACKET.CZ.REQUEST_MOVE;
		const pkt = new Move();
		pkt.dest = [cell.x, cell.y];
		this.map.send(pkt);
	}

	attack(gid: number, continuous = true): void {
		if (!this.map) {
			throw new Error("sem conexao com o map-server");
		}
		const Act = PACKETVER.value >= 20180307 && PACKET.CZ.REQUEST_ACT2 ? PACKET.CZ.REQUEST_ACT2 : PACKET.CZ.REQUEST_ACT;
		const pkt = new Act();
		pkt.targetGID = gid;
		pkt.action = continuous ? 7 : 0;
		this.map.send(pkt);
	}

	useItem(index: number): void {
		const Use = PACKETVER.value >= 20180307 && PACKET.CZ.USE_ITEM2 ? PACKET.CZ.USE_ITEM2 : PACKET.CZ.USE_ITEM;
		const pkt = new Use();
		pkt.index = index;
		pkt.AID = this.accountId;
		this.sendMap(pkt);
	}

	/**
	 * `position` era documentado (errado) como "0 = onde couber". Não é: o
	 * rAthena confere `pos & req_pos` (`pc.cpp:12064`, `pos` = posição real do
	 * item, vinda do próprio item_db) — com `req_pos = 0` a interseção é SEMPRE
	 * vazia e o pedido falha, pra QUALQUER item, sempre. Não é "deixa o servidor
	 * escolher", é "recusa tudo". Achado testando Fase 4 ao vivo (nenhum equip
	 * tinha sucesso mesmo com item_db corrigido) e confirmado lendo o source.
	 *
	 * O certo é mandar TODOS os bits (`0xFFFFFFFF`): a checagem só quer
	 * QUALQUER sobreposição com a posição real do item, então isso nunca
	 * conflita — e é exatamente o valor que ativa a escolha automática do
	 * próprio rAthena nos casos ambíguos (acessório esquerdo/direito,
	 * `pc.cpp:12088-12091`; arma de duas mãos, `pc.cpp:12108-12114`).
	 */
	equipItem(index: number, position = 0xffffffff): void {
		const pkt = new PACKET.CZ.REQ_WEAR_EQUIP();
		pkt.index = index;
		pkt.wearLocation = position;
		this.sendMap(pkt);
	}

	unequipItem(index: number): void {
		const pkt = new PACKET.CZ.REQ_TAKEOFF_EQUIP();
		pkt.index = index;
		this.sendMap(pkt);
	}

	/** Joga um item do inventário no chão (CZ.ITEM_THROW). */
	dropItem(index: number, amount: number): void {
		const Throw =
			PACKETVER.value >= 20180307 && PACKET.CZ.ITEM_THROW2 ? PACKET.CZ.ITEM_THROW2 : PACKET.CZ.ITEM_THROW;
		const pkt = new Throw();
		pkt.Index = index;
		pkt.count = amount;
		this.sendMap(pkt);
	}

	pickUp(gid: number): void {
		const Pick =
			PACKETVER.value >= 20180307 && PACKET.CZ.ITEM_PICKUP2 ? PACKET.CZ.ITEM_PICKUP2 : PACKET.CZ.ITEM_PICKUP;
		const pkt = new Pick();
		pkt.ITAID = gid;
		this.sendMap(pkt);
	}

	/** Pede ao servidor quais equipamentos esta carta aceita (CZ.REQ_ITEMCOMPOSITION_LIST). */
	requestCardOptions(cardIndex: number): void {
		this.cardListRequested = cardIndex;
		const pkt = new PACKET.CZ.REQ_ITEMCOMPOSITION_LIST();
		pkt.cardIndex = cardIndex;
		this.sendMap(pkt);
	}

	/**
	 * Compõe a carta no equipamento escolhido (CZ.REQ_ITEMCOMPOSITION).
	 *
	 * Guarda o itemId da carta ANTES de mandar: o `DELETE_ITEM_FROM_BODY` que
	 * consome a carta chega ANTES do ACK de composição (`pc_insert_card`
	 * chama `pc_delitem` primeiro), então por ocasião do ACK a carta já
	 * sumiu de `this.inventory` — sem guardar aqui, o hook do ACK não saberia
	 * MAIS qual carta foi inserida.
	 */
	insertCard(cardIndex: number, equipIndex: number): void {
		const carta = this.inventory.find((i) => i.index === cardIndex);
		this.pendingCardInsert = carta ? { cardIndex, equipIndex, itemId: carta.itemId } : null;
		const pkt = new PACKET.CZ.REQ_ITEMCOMPOSITION();
		pkt.cardIndex = cardIndex;
		pkt.equipIndex = equipIndex;
		this.sendMap(pkt);
	}

	/**
	 * Gasta 1 ponto num atributo. Os ids são os mesmos do enum `_sp`
	 * (map.hpp:499) — 13=STR … 18=LUK.
	 */
	raiseStat(stat: "str" | "agi" | "vit" | "int" | "dex" | "luk"): void {
		const ids = { str: 13, agi: 14, vit: 15, int: 16, dex: 17, luk: 18 } as const;
		const pkt = new PACKET.CZ.STATUS_CHANGE();
		pkt.statusID = ids[stat];
		pkt.changeAmount = 1;
		this.sendMap(pkt);
	}

	/**
	 * Este bloco é o próprio personagem?
	 *
	 * Dentro do mapa, o rAthena identifica um PC pelo ACCOUNT id — o `gid` que o
	 * char-server devolveu (o id do personagem) só vale no handshake. Comparar
	 * com ele fazia o teleporte do próprio jogador (`@jump`, warp de NPC) ser
	 * tratado como movimento de OUTRA entidade: o mundo seguia desenhando o
	 * personagem na célula velha e todo pedido de andar saía do lugar errado.
	 */
	private isSelf(blockId: number): boolean {
		return blockId === this.accountId || blockId === this.gid;
	}

	/**
	 * Pergunta o nome de uma entidade (CZ.REQNAME).
	 *
	 * Os pacotes de spawn antigos não trazem nome; o do rAthena com
	 * `show_mob_info` ligado devolve nome + HP + nível na mesma string. É assim
	 * que o cliente oficial preenche a plaquinha em cima da cabeça.
	 */
	requestName(gid: number): void {
		const Req = PACKETVER.value >= 20180307 && PACKET.CZ.REQNAME2 ? PACKET.CZ.REQNAME2 : PACKET.CZ.REQNAME;
		const pkt = new Req();
		pkt.AID = gid;
		this.sendMap(pkt);
	}

	/**
	 * Pergunta o nome sem afogar o servidor.
	 *
	 * O pacote de spawn de mob JÁ traz o nome — mas é só o nome. O `Lv.`/`HP:`
	 * que a plaquinha mostra vem do ACK_REQNAMEALL (`show_mob_info`), ou seja,
	 * só de quem pergunta. Perguntar de todo mundo no instante do spawn é um
	 * pico de pacotes ao entrar num mapa cheio, então a pergunta entra numa fila
	 * drenada aos poucos — o cliente oficial também espalha no tempo.
	 */
	private nameQueue: number[] = [];
	private nameTimer: NodeJS.Timeout | null = null;
	private nameTries = new Map<number, number>();

	queryName(gid: number): void {
		if (this.nameQueue.includes(gid)) return;
		this.nameQueue.push(gid);
		if (this.nameTimer) return;
		this.nameTimer = setInterval(() => {
			// A fila só existe enquanto há mapa. Sem esta guarda, uma sessão que
			// caiu (ou que está trocando de mapa) com pergunta pendente fazia
			// `requestName` → `sendMap` lançar DENTRO do setInterval — exceção
			// fora de qualquer try, ou seja, o processo do gateway inteiro
			// morria e derrubava junto todas as outras sessões.
			if (!this.map) {
				this.pararFilaDeNomes();
				return;
			}
			for (let i = 0; i < NAME_QUERIES_PER_TICK; i++) {
				const gid = this.nameQueue.shift();
				if (gid === undefined) break;
				const entity = this.entities.get(gid);
				if (!entity) continue;
				this.requestName(gid);

				// Perguntado cedo demais, o mob responde só com o nome: o bloco
				// "Lv. 1 | HP: 55/55" ainda não existe no instante do spawn. Uma
				// segunda pergunta, mais tarde, volta completa — e é ela que
				// preenche a barra de vida sem o jogador ter que clicar.
				const tries = (this.nameTries.get(gid) ?? 0) + 1;
				this.nameTries.set(gid, tries);
				if (tries < NAME_QUERY_TRIES && entity.hp === undefined) {
					setTimeout(() => {
						if (this.entities.get(gid)?.hp === undefined) this.queryName(gid);
					}, NAME_RETRY_DELAY_MS);
				}
			}
			if (this.nameQueue.length === 0) {
				this.pararFilaDeNomes();
			}
		}, NAME_QUERY_INTERVAL_MS);
	}

	private pararFilaDeNomes(): void {
		if (this.nameTimer) {
			clearInterval(this.nameTimer);
			this.nameTimer = null;
		}
		this.nameQueue.length = 0;
	}

	/** Fala com um NPC (o clique no boneco). */
	contactNpc(gid: number): void {
		const pkt = new PACKET.CZ.CONTACTNPC();
		pkt.NAID = gid;
		pkt.type = 1;
		this.sendMap(pkt);
	}

	/** Botão "próximo" do diálogo. */
	npcNext(gid: number): void {
		const pkt = new PACKET.CZ.REQ_NEXT_SCRIPT();
		pkt.NAID = gid;
		this.sendMap(pkt);
	}

	/** Escolhe uma opção do menu (1-based, como o rAthena espera). */
	npcMenu(gid: number, choice: number): void {
		const pkt = new PACKET.CZ.CHOOSE_MENU();
		pkt.NAID = gid;
		pkt.num = choice;
		this.sendMap(pkt);
	}

	npcClose(gid: number): void {
		const pkt = new PACKET.CZ.CLOSE_DIALOG();
		pkt.NAID = gid;
		this.sendMap(pkt);
	}

	/** Usa skill num alvo (ou em si mesmo, quando targetGid é o próprio). */
	useSkill(skillId: number, level: number, targetGid: number): void {
		const Use = PACKETVER.value >= 20180307 && PACKET.CZ.USE_SKILL2 ? PACKET.CZ.USE_SKILL2 : PACKET.CZ.USE_SKILL;
		const pkt = new Use();
		pkt.SKID = skillId;
		pkt.selectedLevel = level;
		pkt.targetID = targetGid;
		this.sendMap(pkt);
	}

	/**
	 * Usa skill numa célula do chão (área).
	 *
	 * SEMPRE pela tabela de versão (`USE_SKILL_TOGROUND`), nunca pela variante
	 * "2": ela escreve o opcode 0x0366 CRAVADO no código, e nesta faixa de
	 * cliente 0x0366 é outro pacote, de 90 bytes. O map-server lia o cabeçalho,
	 * via 10 bytes onde esperava 90 e DERRUBAVA A SESSÃO
	 * ("clif_parse: Received packet 0x0366 with expected packet length 90") —
	 * de dentro do jogo parecia que o servidor tinha caído ao usar Storm Gust.
	 * Em 20130618 o pacote certo é 0x096a, que a tabela já sabe.
	 */
	useSkillOnGround(skillId: number, level: number, cell: Cell): void {
		const Use = PACKET.CZ.USE_SKILL_TOGROUND;
		const pkt = new Use();
		pkt.SKID = skillId;
		pkt.selectedLevel = level;
		pkt.xPos = cell.x;
		pkt.yPos = cell.y;
		this.sendMap(pkt);
	}

	/**
	 * Muda UM slot da barra de atalho (`CZ_SHORTCUT_KEY_CHANGE1`, 0x02ba —
	 * único variante ativo neste packetver, `CHANGE2`/tab exige >= 20190522).
	 * `count` é o campo cru (nível de skill / quantidade de item, mesmo campo
	 * pros dois no rAthena). `kind: "empty"` limpa o slot (convenção do
	 * próprio protocolo: `id=0`).
	 *
	 * Sem confirmação nenhuma na volta — `clif_parse_Hotkey` só grava
	 * `sd->status.hotkeys[idx]`, sem checar skill/item existir nem nível, e
	 * não manda pacote de resposta. A prova de que persistiu é reconectar.
	 */
	setHotkey(slot: number, data: { kind: "empty" | "skill" | "item"; id: number; count?: number }): void {
		if (slot < 0 || slot >= MAX_HOTKEYS) return;
		const pkt = new PACKET.CZ.SHORTCUT_KEY_CHANGE1();
		pkt.Index = slot;
		pkt.ShortCutKey = {
			isSkill: data.kind === "skill" ? 1 : 0,
			ID: data.kind === "empty" ? 0 : data.id,
			count: data.count ?? 0,
		};
		this.sendMap(pkt);
	}

	/**
	 * Fala num canal.
	 *
	 * Cada canal tem um caminho DIFERENTE no protocolo, e usar o pacote errado
	 * faz a mensagem simplesmente sumir:
	 *  - mapa/geral: CZ_REQUEST_CHAT (0x8c)
	 *  - party:      CZ_REQUEST_CHAT_PARTY (0x108)
	 *  - guilda:     CZ_GUILD_CHAT (0x17e)
	 *  - #global e #trade: são CANAIS, e o rAthena os recebe pelo pacote de
	 *    SUSSURRO com o nome do canal no lugar do destinatário
	 *    (clif.cpp:11916). Ele ainda entra no canal sozinho se a pessoa não
	 *    estiver nele e não houver senha, então não é preciso `@join`.
	 *
	 * Os três primeiros exigem o texto como "Nome : mensagem" numa string só —
	 * `clif_process_message` valida esse prefixo e descarta o que vier fora do
	 * formato. O do canal vai com a mensagem crua, porque o nome entra pelo
	 * campo do destinatário.
	 */
	say(text: string, charName: string, scope?: ChatScope): void {
		if (!this.map) {
			throw new Error("sem conexao com o map-server");
		}
		const comNome = `${charName} : ${text}`;

		if (scope === "party") {
			const pkt = new PACKET.CZ.REQUEST_CHAT_PARTY();
			pkt.msg = comNome;
			this.map.send(pkt);
			return;
		}
		if (scope === "guild") {
			const pkt = new PACKET.CZ.GUILD_CHAT();
			pkt.msg = comNome;
			this.map.send(pkt);
			return;
		}
		if (scope === "global" || scope === "trade") {
			const pkt = new PACKET.CZ.WHISPER();
			pkt.receiver = scope === "global" ? "#global" : "#trade";
			pkt.msg = text;
			this.map.send(pkt);
			return;
		}

		const pkt = new PACKET.CZ.REQUEST_CHAT();
		pkt.msg = comNome;
		this.map.send(pkt);
	}

	private fail(stage: SessionStage, reason: string, code?: number): void {
		if (this.pendingAuth) {
			this.pendingAuth.reject(new Error(reason));
			this.pendingAuth = null;
		}
		this.emit("closed", { stage, reason, code });
		this.close();
	}

	close(): void {
		this.pararFilaDeNomes();
		this.nameTries.clear();
		this.login?.close();
		this.char?.close();
		this.map?.close();
		this.login = null;
		this.char = null;
		this.map = null;
		this.stage = "idle";
	}
}

function toCharSummary(info: any, index: number): CharSummary {
	return {
		slot: info.CharNum ?? index,
		gid: info.GID,
		name: info.name,
		job: info.job,
		level: info.level,
		jobLevel: info.joblevel,
		baseExp: info.exp,
		jobExp: info.jobexp,
		zeny: info.money,
		hp: info.hp,
		maxHp: info.maxhp,
		sp: info.sp,
		maxSp: info.maxsp,
		str: info.Str,
		agi: info.Agi,
		vit: info.Vit,
		int: info.Int,
		dex: info.Dex,
		luk: info.Luk,
		head: info.head,
		headPalette: info.headpalette,
		bodyPalette: info.bodypalette,
		weapon: info.weapon,
		shield: info.shield,
		mapName: normalizeMapName(info.lastMap ?? ""),
	};
}

function toEntity(pkt: any): EntitySnapshot {
	// STANDENTRY traz PosDir (parado); MOVEENTRY traz MoveData (andando) e a
	// posicao util e o destino.
	let x = 0;
	let y = 0;
	let dir = 0;

	if (Array.isArray(pkt.PosDir)) {
		[x, y, dir] = pkt.PosDir;
	} else if (Array.isArray(pkt.MoveData)) {
		// Entrou no campo de visão andando: a posição do spawn é de ONDE ele saiu.
		// O trecho até o destino sai logo depois como entity-move.
		x = pkt.MoveData[0];
		y = pkt.MoveData[1];
	}

	return {
		gid: pkt.GID ?? pkt.AID ?? 0,
		kind: entityKindFromObjectType(pkt.objecttype),
		job: pkt.job ?? 0,
		name: pkt.name || undefined,
		x,
		y,
		dir,
		speed: pkt.speed ?? 150,
		// O pacote de spawn manda -1 quando NÃO SABE o HP (é o padrão para mob;
		// só GvG/boss trazem valor). Repassar o -1 apagava o HP verdadeiro que a
		// resposta do REQNAME já tinha trazido — "desconhecido" tem que sair
		// como ausente, não como número.
		hp: typeof pkt.hp === "number" && pkt.hp >= 0 ? pkt.hp : undefined,
		maxHp: typeof pkt.maxhp === "number" && pkt.maxhp > 0 ? pkt.maxhp : undefined,
	};
}

/** Texto do rAthena vem com   no fim e códigos de cor ^RRGGBB. */
/**
 * Resposta do pedido de amizade (ZC_ADD_FRIENDS_LIST).
 *
 * Os quatro casos são os do rAthena (clif.cpp:15391), traduzidos aqui e não no
 * navegador — o número cru é do protocolo e não deve vazar para a UI.
 */
const ADD_FRIEND_RESULT: Record<0 | 1 | 2 | 3, string> = {
	0: "vocês agora são amigos",
	1: "o pedido foi recusado",
	2: "sua lista de amigos está cheia",
	3: "a lista de amigos dessa pessoa está cheia",
};

function cleanText(raw: unknown): string {
	return String(raw ?? "")
		.replace(/ .*$/s, "")
		.replace(/\^[0-9a-fA-F]{6}/g, "");
}

/**
 * Apelido do canal → escopo.
 *
 * `channel_send` monta a linha como "%s %s : %s" = apelido, nome, mensagem
 * (channel.cpp:466), e o apelido é o de `conf/channels.conf` — "[Global]",
 * "[Trade]", "[Support]", "[Ally]". Tudo o mais que chega por 0x2c1 é fala de
 * NPC ou aviso do servidor, e cai em `system`.
 */
function scopeDoCanal(texto: string): ChatScope {
	const apelido = /^\[([^\]]+)\]/.exec(texto)?.[1]?.toLowerCase();
	if (apelido === "global") return "global";
	if (apelido === "trade") return "trade";
	return "system";
}

function toSkill(raw: any): PlayerSkill {
	return {
		id: raw.SKID,
		name: String(raw.skillName ?? "").replace(/\0.*$/, ""),
		level: raw.level ?? 0,
		spCost: raw.spcost ?? 0,
		range: raw.attackRange ?? 0,
		/** o rAthena marca aqui se ainda dá para subir com ponto de habilidade */
		upgradable: Boolean(raw.upgradable),
	};
}

/** `ID: 0` é a convenção do próprio rAthena pra slot vazio (char novo/slot
 * nunca gravado nasce assim, `sql-files/main.sql`) — não é o gateway
 * inventando "vazio", é o mesmo valor que o servidor já usa. */
function toHotkeys(raw: { isSkill: number; ID: number; count: number }[]): HotkeySlot[] {
	return raw.map((h, slot) => ({
		slot,
		kind: h.ID === 0 ? "empty" : h.isSkill ? "skill" : "item",
		id: h.ID,
		count: h.count,
	}));
}

/**
 * Item do inventário. Os pacotes mudam de nome de campo entre gerações (index
 * vs Index, count vs amount), mas o miolo é sempre o mesmo — daí normalizar
 * aqui em vez de espalhar `??` pelo cliente.
 */
function toInventoryItem(raw: any): InventoryItem {
	/**
	 * `WearState` existe nos DOIS pacotes de inventário (clif.cpp:2258-2263,
	 * `NORMALITEM_INFO`/`EQUIPITEM_INFO`), mas com significados DIFERENTES:
	 * - equipamento (ZC_EQUIPMENT_ITEMLIST e variantes): `p->WearState =
	 *   it->equip` (clif.cpp:2946) — o bitmask EQP_* de ONDE ESTÁ EQUIPADO
	 *   AGORA, do item de INSTÂNCIA. É o que o `equipmentStore` precisa.
	 * - normal (ZC_NORMAL_ITEMLIST e variantes — consumível, etc, CARTA):
	 *   `p->WearState = id->equip` (clif.cpp:3001) — o bitmask de ONDE O ITEM
	 *   CABE, da DEFINIÇÃO estática (`id`, não `it`). Uma carta de arma tem
	 *   `equip = EQP_HAND_R` sempre, mesmo solta na bolsa — não é "equipado".
	 *
	 * A distinção não dá pra fazer pelo TIPO do item (a normal list carrega
	 * carta, mas também item tipo "etc" que por acaso tem `equip` zerado, o
	 * que escondia o bug): é a PRESENÇA do campo `location` que diferencia os
	 * dois pacotes — só o de equipamento tem essa struct (`EQUIPITEM_INFO`),
	 * a normal nunca escreve `location` nenhum. Achado testando Cartas ao
	 * vivo: toda carta chegava com "(equipado)" no tooltip mesmo solta.
	 */
	const deEquipamento = raw.location !== undefined;
	const location = deEquipamento ? (raw.WearState ?? raw.location ?? 0) : 0;
	return {
		index: raw.index ?? raw.Index ?? 0,
		itemId: raw.ITID ?? 0,
		amount: raw.count ?? raw.amount ?? 1,
		type: raw.type ?? 0,
		identified: Boolean(raw.IsIdentified ?? 1),
		refine: raw.RefiningLevel ?? 0,
		equipped: deEquipamento && location !== 0,
		location,
		cards: [raw.slot?.card1 ?? 0, raw.slot?.card2 ?? 0, raw.slot?.card3 ?? 0, raw.slot?.card4 ?? 0],
	};
}

/** "prt_fild08.gat\0..." -> "prt_fild08" */
function normalizeMapName(raw: string): string {
	return String(raw ?? "")
		.replace(/\0.*$/, "")
		.replace(/\.gat$/i, "");
}

function makeCharRefuseReason(code: number | undefined): string {
	switch (code) {
		case 0x00:
			return "nome ja em uso";
		case 0x01:
			return "nome proibido";
		case 0x02:
			return "voce nao tem direito a esse slot";
		case 0x03:
			return "nivel de conta insuficiente";
		default:
			return `criacao recusada (codigo ${code ?? "?"})`;
	}
}

function refuseReason(code: number | undefined): string {
	switch (code) {
		case 0:
			return "conta inexistente";
		case 1:
			return "senha incorreta";
		case 2:
			return "conta expirada";
		case 3:
			return "servidor recusou (rejected from server)";
		case 4:
			return "conta bloqueada";
		case 5:
			return "versao de cliente incompativel";
		case 6:
			return "conta banida temporariamente";
		case 8:
			return "servidor cheio";
		default:
			return `login recusado (codigo ${code ?? "?"})`;
	}
}
