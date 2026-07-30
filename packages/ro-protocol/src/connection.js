/**
 * Uma conexao TCP com um servidor do rAthena (login, char ou map).
 *
 * O roBrowser tem UM socket por processo (NetworkManager). O gateway atende
 * varios jogadores ao mesmo tempo, entao aqui cada conexao e um objeto proprio,
 * sem estado de modulo.
 */
import net from "node:net";
import { EventEmitter } from "node:events";
import { PacketStream } from "./stream.js";
import { packetId } from "./registry.js";

export class RoConnection extends EventEmitter {
	/**
	 * @param {{ host: string, port: number, label?: string, debug?: boolean }} options
	 */
	constructor({ host, port, label = "", debug = false }) {
		super();
		this.host = host;
		this.port = port;
		this.label = label || `${host}:${port}`;
		this.debug = debug;
		this.connected = false;
		/** @type {net.Socket|null} */
		this.socket = null;
		/** @type {NodeJS.Timeout|null} */
		this.pingTimer = null;

		this.stream = new PacketStream(
			(instance, meta) => {
				if (this.debug) {
					console.log(`[ro-protocol:${this.label}] recv ${meta.name} (0x${meta.id.toString(16)})`);
				}
				this.emit("packet", instance, meta);
				this.emit(`packet:${meta.id}`, instance);
			},
			({ id, length }) => {
				// Nao e erro fatal: o rAthena manda pacotes que este packetver nao
				// conhece. Registrar ajuda a achar opcode faltando na tabela.
				if (this.debug) {
					console.warn(`[ro-protocol:${this.label}] opcode 0x${id.toString(16)} desconhecido, ${length}B`);
				}
				this.emit("unknown", { id, length });
			},
		);
	}

	/** @returns {Promise<void>} */
	connect() {
		return new Promise((resolve, reject) => {
			const socket = net.connect({ host: this.host, port: this.port });
			this.socket = socket;
			socket.setNoDelay(true);

			socket.once("connect", () => {
				this.connected = true;
				resolve();
			});

			socket.on("data", (chunk) => {
				try {
					this.stream.push(chunk);
				} catch (err) {
					this.emit("error", err);
				}
			});

			socket.on("error", (err) => {
				if (!this.connected) {
					reject(err);
					return;
				}
				this.emit("error", err);
			});

			socket.on("close", () => {
				this.connected = false;
				this.stopPing();
				this.emit("close");
			});
		});
	}

	/**
	 * Registra callback para um pacote. Aceita a struct (PACKET.AC.ACCEPT_LOGIN).
	 * @param {Function} Struct
	 * @param {(packet: any) => void} callback
	 */
	hook(Struct, callback) {
		this.on(`packet:${packetId(Struct)}`, callback);
		return this;
	}

	/** Consome os proximos 4 bytes crus (account id sem cabecalho de pacote). */
	readRaw(callback) {
		this.stream.readRaw(callback);
	}

	/** @param {{ build: () => { buffer: ArrayBuffer } }} packet */
	send(packet) {
		if (!this.socket || !this.connected) {
			throw new Error(`[ro-protocol:${this.label}] socket fechado`);
		}

		const built = packet.build();
		if (this.debug) {
			console.log(`[ro-protocol:${this.label}] send ${packet.constructor.name}`);
		}
		this.socket.write(Buffer.from(built.buffer));
	}

	/**
	 * Keep-alive. O rAthena derruba conexao ociosa; cada servidor tem o seu
	 * pacote (CA.CONNECT_INFO_CHANGED, CZ.PING, CZ.REQUEST_TIME).
	 * @param {() => void} tick
	 * @param {number} [intervalMs]
	 */
	startPing(tick, intervalMs = 10000) {
		this.stopPing();
		this.pingTimer = setInterval(() => {
			if (this.connected) {
				try {
					tick();
				} catch (err) {
					this.emit("error", err);
				}
			}
		}, intervalMs);
		return this;
	}

	stopPing() {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
	}

	close() {
		this.stopPing();
		if (this.socket) {
			this.socket.destroy();
			this.socket = null;
		}
		this.connected = false;
	}
}

/** Converte o ip em long dos pacotes (char/map server) para string. */
export function longToIP(long) {
	const buf = new ArrayBuffer(4);
	new Uint32Array(buf)[0] = long;
	return Array.prototype.join.call(new Uint8Array(buf), ".");
}
