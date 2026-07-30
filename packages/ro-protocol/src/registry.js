/**
 * Registro opcode -> struct.
 *
 * Equivalente ao trecho de bootstrap do NetworkManager do roBrowser, sem o
 * socket global: aqui o registro e uma tabela pura, e cada RoConnection so
 * consulta. `initProtocol()` precisa rodar antes de qualquer conexao — e ele
 * que carrega a tabela de tamanhos do packetver e liga o getPacketVersion das
 * structs versionadas.
 */
import PACKET from "./vendor/Network/PacketStructure.js";
import PacketVersions from "./vendor/Network/PacketVersions.js";
import PacketRegister from "./vendor/Network/PacketRegister.js";
import PACKETVER from "./vendor/Network/PacketVerManager.js";
import Configs from "./vendor/Core/Configs.js";

/** @type {Map<number, { id: number, name: string, Struct: Function }>} */
const byId = new Map();

let initialized = 0;

/**
 * @param {number} packetver ex.: 20130618 (precisa bater com o --enable-packetver do build do rAthena)
 * @param {{ renewal?: boolean }} [options]
 */
export function initProtocol(packetver, options = {}) {
	if (initialized === packetver) {
		return;
	}

	Configs.set("renewal", options.renewal ?? true);
	// packetKeys fica desligado de proposito: o servidor compila com
	// PACKET_OBFUSCATION_KEY1/2/3 = 0 (rathena/src/custom/defines_pre.hpp), entao
	// o stream vem em claro. Ligar aqui embaralharia o que ja esta legivel.
	Configs.set("packetKeys", false);

	for (const date of Object.keys(PacketVersions)) {
		PACKETVER.addSupport(date, PacketVersions[date]);
	}

	PACKETVER.value = packetver;

	byId.clear();
	for (const key of Object.keys(PacketRegister)) {
		const Struct = PacketRegister[key];
		const id = Number(key);

		if (!Struct) {
			continue;
		}

		Struct.id = id;
		byId.set(id, { id, name: Struct.name, Struct });
	}

	initialized = packetver;
}

/** @param {number} id */
export function getPacket(id) {
	return byId.get(id);
}

/** Opcode de uma struct ja registrada (para hooks por referencia de struct). */
export function packetId(Struct) {
	if (!Struct || !Struct.id) {
		throw new Error(
			`[ro-protocol] struct "${Struct?.name ?? Struct}" nao registrada — initProtocol() rodou?`,
		);
	}
	return Struct.id;
}

export { PACKET, PACKETVER, Configs };
