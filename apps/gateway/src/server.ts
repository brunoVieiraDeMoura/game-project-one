/**
 * Gateway: ponte entre o navegador (Socket.IO/JSON) e o rAthena (TCP binario).
 *
 * Uma sessao rAthena por socket do navegador. O binario morre aqui: para fora
 * so saem os eventos de src/protocol.ts. Antes de mexer em pacote, ler
 * .claude/skills/skill-network-protocol/SKILL.md — layout de struct e por
 * PACKETVER e um byte fora desanda o stream inteiro.
 */
import { Server } from "socket.io";
import { config } from "./config.js";
import { RoSession } from "./ro/session.js";
import type { ChatScope, RaisableStat } from "./protocol.js";

/** Lista fechada: o cliente não escolhe o id do atributo, só o nome. */
const RAISABLE: RaisableStat[] = ["str", "agi", "vit", "int", "dex", "luk"];

const io = new Server(config.gatewayPort, {
	cors: { origin: "*" },
});

io.on("connection", (socket) => {
	socket.emit("gateway:hello", { protocol: 2, packetver: config.packetver });

	/** Nome do personagem escolhido — o pacote de chat exige "Nome : msg". */
	let charName = "";
	let session: RoSession | null = null;

	const teardown = () => {
		session?.close();
		session = null;
	};

	socket.on("auth:login", async (payload: { username?: string; password?: string }) => {
		if (session) {
			socket.emit("auth:error", { reason: "ja existe uma sessao neste socket" });
			return;
		}

		const username = String(payload?.username ?? "");
		const password = String(payload?.password ?? "");

		if (!username || !password) {
			socket.emit("auth:error", { reason: "usuario e senha sao obrigatorios" });
			return;
		}

		const ro = new RoSession({
			host: config.roHost,
			loginPort: config.loginPort,
			packetver: config.packetver,
			debug: config.debug,
		});
		session = ro;

		ro.on("chars", (chars, slots) => {
			socket.emit("auth:ok", { accountId: ro.accountId, sex: ro.sex });
			socket.emit("char:list", { chars, slots });
		});
		// A ficha do personagem (nível, zeny, classe, atributos) NÃO chega em
		// pacote de status: o rAthena só avisa quando muda. O valor inicial está
		// na lista do char-server, então vai junto do "entrou no mundo" — assim o
		// HUD não depende de a tela de seleção ter guardado nada.
		ro.on("map-enter", (info) =>
			socket.emit("world:enter", {
				...info,
				char: ro.chars.find((c) => c.name === charName) ?? null,
			}),
		);
		ro.on("self-move", (payload) => socket.emit("self:move", payload));
		ro.on("self-warp", (payload) => socket.emit("self:warp", payload));
		ro.on("attack-too-far", (payload) => socket.emit("attack:too-far", payload));
		ro.on("attack-no-ammo", () => socket.emit("attack:no-ammo"));
		ro.on("entity-spawn", (entity) => socket.emit("entity:spawn", entity));
		ro.on("entity-move", (payload) => socket.emit("entity:move", payload));
		ro.on("entity-stop", (payload) => socket.emit("entity:stop", payload));
		ro.on("entity-vanish", (payload) => socket.emit("entity:vanish", payload));
		ro.on("entity-name", (payload) => socket.emit("entity:name", payload));
		ro.on("entity-level", (payload) => socket.emit("entity:level", payload));
		ro.on("entity-action", (payload) => socket.emit("entity:action", payload));
		ro.on("entity-hp", (payload) => socket.emit("entity:hp", payload));
		ro.on("entity-option", (payload) => socket.emit("entity:option", payload));
		ro.on("entity-status-duration", (payload) => socket.emit("entity:status-duration", payload));
			ro.on("status-start", (payload) => socket.emit("status:start", payload));
			ro.on("status-end", (payload) => socket.emit("status:end", payload));
		ro.on("stat", (payload) => socket.emit("self:stat", payload));
		ro.on("status", (payload) => socket.emit("self:status", payload));
		ro.on("inventory", (payload) => socket.emit("inv:list", payload));
		ro.on("item-add", (payload) => socket.emit("inv:add", payload));
		ro.on("item-remove", (payload) => socket.emit("inv:remove", payload));
		ro.on("item-equip-result", (payload) => socket.emit("item:equip-result", payload));
		ro.on("card-options", (payload) => socket.emit("card:options", payload));
		ro.on("card-result", (payload) => socket.emit("card:result", payload));
		ro.on("skills", (payload) => socket.emit("skill:list", payload));
		ro.on("hotkeys", (payload) => socket.emit("hotkey:list", payload));
		ro.on("skill-cast", (payload) => socket.emit("skill:cast", payload));
		ro.on("skill-casting", (payload) => socket.emit("skill:casting", payload));
		ro.on("skill-ground-cast", (payload) => socket.emit("skill:ground-cast", payload));
		ro.on("skill-ground", (payload) => socket.emit("skill:ground", payload));
		ro.on("skill-ground-gone", (payload) => socket.emit("skill:ground-gone", payload));
		ro.on("skill-cooldown", (payload) => socket.emit("skill:cooldown", payload));
		ro.on("npc-dialog", (payload) => socket.emit("npc:dialog", payload));
		ro.on("ground-item", (payload) => socket.emit("ground:item", payload));
		ro.on("ground-item-gone", (payload) => socket.emit("ground:item-gone", payload));
		ro.on("chat", (payload) => socket.emit("chat:message", payload));
		ro.on("friends", (payload) => socket.emit("friend:list", payload));
		ro.on("friend-state", (payload) => socket.emit("friend:state", payload));
		ro.on("friend-request", (payload) => socket.emit("friend:request", payload));
		ro.on("friend-added", (payload) => socket.emit("friend:added", payload));
		ro.on("friend-removed", (payload) => socket.emit("friend:removed", payload));
		ro.on("guild-members", (payload) => socket.emit("guild:members", payload));
		ro.on("ignore-list", (payload) => socket.emit("ignore:list", payload));
		ro.on("closed", (payload) => {
			socket.emit("session:closed", payload);
			teardown();
		});
		ro.on("error", (err) => {
			console.error("[gateway] sessao:", err.message);
		});

		try {
			await ro.authenticate(username, password);
		} catch (err) {
			socket.emit("auth:error", { reason: err instanceof Error ? err.message : String(err) });
			teardown();
		}
	});

	socket.on("char:select", (payload: { slot?: number }) => {
		const slot = Number(payload?.slot ?? 0);
		charName = session?.chars.find((c) => c.slot === slot)?.name ?? "";
		withSession((ro) => ro.selectChar(slot));
	});

	socket.on("char:create", (payload: { slot?: number; name?: string; hair?: number; hairColor?: number }) => {
		withSession((ro) =>
			ro.createChar({
				slot: Number(payload?.slot ?? 0),
				name: String(payload?.name ?? ""),
				hair: Number(payload?.hair ?? 1),
				hairColor: Number(payload?.hairColor ?? 1),
			}),
		);
	});

	socket.on("char:delete", (payload: { gid?: number; email?: string }) => {
		withSession((ro) => ro.deleteChar(Number(payload?.gid ?? 0), String(payload?.email ?? "")));
	});

	socket.on("world:ready", () => withSession((ro) => ro.notifyReady()));

	socket.on("move:to", (payload: { x?: number; y?: number }) => {
		withSession((ro) => ro.moveTo({ x: Number(payload?.x ?? 0), y: Number(payload?.y ?? 0) }));
	});

	socket.on("action:attack", (payload: { gid?: number; continuous?: boolean }) => {
		withSession((ro) => ro.attack(Number(payload?.gid ?? 0), payload?.continuous ?? true));
	});

	socket.on("chat:send", (payload: { text?: string; scope?: ChatScope }) => {
		withSession((ro) => ro.say(String(payload?.text ?? ""), charName, payload?.scope));
	});

	socket.on("item:use", (payload: { index?: number }) => {
		withSession((ro) => ro.useItem(Number(payload?.index ?? 0)));
	});

	socket.on("item:equip", (payload: { index?: number; position?: number }) => {
		// `position` só quando o CLIENTE realmente manda um (nenhum manda hoje) —
		// forçar 0 aqui pisava no default certo de `RoSession.equipItem` (ver lá
		// o porquê de 0 estar ERRADO, não "deixa o servidor escolher").
		withSession((ro) => ro.equipItem(Number(payload?.index ?? 0), payload?.position != null ? Number(payload.position) : undefined));
	});

	socket.on("item:unequip", (payload: { index?: number }) => {
		withSession((ro) => ro.unequipItem(Number(payload?.index ?? 0)));
	});

	socket.on("item:pickup", (payload: { gid?: number }) => {
		withSession((ro) => ro.pickUp(Number(payload?.gid ?? 0)));
	});

	socket.on("stat:raise", (payload: { stat?: RaisableStat }) => {
		const stat = payload?.stat;
		if (!stat || !RAISABLE.includes(stat)) {
			socket.emit("session:closed", { stage: "map", reason: `atributo inválido: ${stat}` });
			return;
		}
		withSession((ro) => ro.raiseStat(stat));
	});

	socket.on("skill:use", (payload: { skillId?: number; level?: number; targetGid?: number }) => {
		withSession((ro) =>
			ro.useSkill(Number(payload?.skillId ?? 0), Number(payload?.level ?? 1), Number(payload?.targetGid ?? 0)),
		);
	});

	socket.on("hotkey:set", (payload: { slot?: number; kind?: "empty" | "skill" | "item"; id?: number; count?: number }) => {
		const kind = payload?.kind;
		if (kind !== "empty" && kind !== "skill" && kind !== "item") return;
		withSession((ro) =>
			ro.setHotkey(Number(payload?.slot ?? -1), { kind, id: Number(payload?.id ?? 0), count: Number(payload?.count ?? 0) }),
		);
	});

	socket.on("skill:use-ground", (payload: { skillId?: number; level?: number; x?: number; y?: number }) => {
		withSession((ro) =>
			ro.useSkillOnGround(Number(payload?.skillId ?? 0), Number(payload?.level ?? 1), {
				x: Number(payload?.x ?? 0),
				y: Number(payload?.y ?? 0),
			}),
		);
	});

	socket.on("npc:talk", (payload: { gid?: number }) => {
		withSession((ro) => ro.contactNpc(Number(payload?.gid ?? 0)));
	});

	socket.on("npc:next", (payload: { gid?: number }) => {
		withSession((ro) => ro.npcNext(Number(payload?.gid ?? 0)));
	});

	socket.on("npc:menu", (payload: { gid?: number; choice?: number }) => {
		withSession((ro) => ro.npcMenu(Number(payload?.gid ?? 0), Number(payload?.choice ?? 1)));
	});

	socket.on("npc:close", (payload: { gid?: number }) => {
		withSession((ro) => ro.npcClose(Number(payload?.gid ?? 0)));
	});

	socket.on("item:drop", (payload: { index?: number; amount?: number }) => {
		withSession((ro) => ro.dropItem(Number(payload?.index ?? 0), Number(payload?.amount ?? 1)));
	});

	socket.on("card:list", (payload: { index?: number }) => {
		withSession((ro) => ro.requestCardOptions(Number(payload?.index ?? 0)));
	});

	socket.on("card:insert", (payload: { cardIndex?: number; equipIndex?: number }) => {
		withSession((ro) => ro.insertCard(Number(payload?.cardIndex ?? 0), Number(payload?.equipIndex ?? 0)));
	});

	socket.on("entity:info", (payload: { gid?: number }) => {
		withSession((ro) => ro.requestName(Number(payload?.gid ?? 0)));
	});

	socket.on("friend:add", (payload: { name?: string }) => {
		const name = String(payload?.name ?? "").trim();
		if (!name) return;
		withSession((ro) => ro.addFriend(name));
	});

	socket.on("friend:remove", (payload: { accountId?: number; charId?: number }) => {
		withSession((ro) => ro.removeFriend(Number(payload?.accountId ?? 0), Number(payload?.charId ?? 0)));
	});

	socket.on("friend:answer", (payload: { accountId?: number; charId?: number; accept?: boolean }) => {
		withSession((ro) =>
			ro.answerFriendRequest(
				Number(payload?.accountId ?? 0),
				Number(payload?.charId ?? 0),
				payload?.accept === true,
			),
		);
	});

	socket.on("skill:raise", (payload: { skillId?: number }) => {
		const skillId = Number(payload?.skillId ?? 0);
		if (!skillId) return;
		withSession((ro) => ro.raiseSkill(skillId));
	});

	socket.on("guild:request", () => withSession((ro) => ro.requestGuildMembers()));

	socket.on("ignore:add", (payload: { name?: string }) => {
		const name = String(payload?.name ?? "").trim();
		if (!name) return;
		withSession((ro) => ro.setIgnored(name, true));
	});

	socket.on("ignore:remove", (payload: { name?: string }) => {
		const name = String(payload?.name ?? "").trim();
		if (!name) return;
		withSession((ro) => ro.setIgnored(name, false));
	});

	socket.on("disconnect", teardown);

	function withSession(fn: (ro: RoSession) => void): void {
		if (!session) {
			socket.emit("session:closed", { stage: "idle", reason: "sem sessao — faca login antes" });
			return;
		}
		try {
			fn(session);
		} catch (err) {
			socket.emit("session:closed", {
				stage: session.stage,
				reason: err instanceof Error ? err.message : String(err),
			});
		}
	}
});

console.log(
	`[gateway] Socket.IO :${config.gatewayPort} -> rAthena ${config.roHost}:${config.loginPort} (packetver ${config.packetver})`,
);
