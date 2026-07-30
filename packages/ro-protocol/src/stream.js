/**
 * Enquadramento do stream TCP do rAthena.
 *
 * Reescrito a partir de NetworkManager.receive() do roBrowser, sem estado
 * global: uma instancia por conexao. O TCP nao respeita fronteira de pacote —
 * um `data` pode trazer meio pacote, tres pacotes, ou um pacote e meio — e a
 * unica forma de saber onde o proximo comeca e a tabela de tamanhos por opcode
 * (PacketLength). Opcode com tamanho negativo na tabela = pacote de tamanho
 * variavel: o tamanho real vem no uint16 logo apos o opcode.
 */
import BinaryReader from "./vendor/Utils/BinaryReader.js";
import PacketLength from "./vendor/Network/PacketLength.js";
import { getPacket } from "./registry.js";

export class PacketStream {
	/**
	 * @param {(packet: object, meta: { id: number, name: string }) => void} onPacket
	 * @param {(info: { id: number, length: number }) => void} [onUnknown]
	 */
	constructor(onPacket, onUnknown) {
		this.onPacket = onPacket;
		this.onUnknown = onUnknown ?? null;
		/** @type {Uint8Array|null} sobra do ultimo chunk (pacote incompleto) */
		this.pending = null;
		/** @type {((fp: any) => void)|null} leitura crua de uma vez so (AID sem cabecalho) */
		this.rawHook = null;
	}

	/**
	 * Consome os proximos bytes crus (sem cabecalho de pacote) no proximo chunk.
	 * Usado depois de CH.ENTER e, em packetver antigo, depois de CZ.ENTER.
	 */
	readRaw(callback) {
		this.rawHook = callback;
	}

	/** @param {Buffer|Uint8Array|ArrayBuffer} chunk */
	push(chunk) {
		let bytes = toUint8(chunk);

		if (this.pending) {
			const merged = new Uint8Array(this.pending.length + bytes.length);
			merged.set(this.pending, 0);
			merged.set(bytes, this.pending.length);
			bytes = merged;
			this.pending = null;
		}

		// BinaryReader trabalha sobre ArrayBuffer; a copia garante que o
		// byteOffset seja 0 (Buffer do Node quase sempre e uma view de um pool
		// compartilhado, e o DataView herdaria o offset errado).
		const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
		const fp = new BinaryReader(buffer);

		if (this.rawHook) {
			const hook = this.rawHook;
			this.rawHook = null;
			hook(fp);
		}

		while (fp.tell() < fp.length) {
			let offset = fp.tell();

			// Nem o opcode coube: guarda e espera o proximo chunk.
			if (offset + 2 > fp.length) {
				this.pending = new Uint8Array(buffer, offset, fp.length - offset);
				return;
			}

			const id = fp.readUShort();
			const tableLength = PacketLength.getPacketLength(id);
			// `false` = opcode desconhecido: nao da para saber onde o proximo
			// comeca, entao trata o resto do buffer como um pacote so.
			const packetLength = tableLength ? tableLength : fp.length - offset;
			let length;

			if (packetLength < 0) {
				if (offset + 4 > fp.length) {
					this.pending = new Uint8Array(buffer, offset, fp.length - offset);
					return;
				}
				length = fp.readUShort();
			} else {
				length = packetLength;
			}

			offset += length;

			// Pacote partido: rebobina para o inicio dele e espera mais bytes.
			if (offset > fp.length) {
				const start = fp.tell() - (packetLength < 0 ? 4 : 2);
				this.pending = new Uint8Array(buffer, start, fp.length - start);
				return;
			}

			const entry = getPacket(id);

			if (entry) {
				const instance = new entry.Struct(fp, offset);
				this.onPacket(instance, entry);
			} else if (this.onUnknown) {
				this.onUnknown({ id, length });
			}

			if (length) {
				fp.seek(offset, 2 /* SEEK_SET */);
			}
		}

		this.pending = null;
	}
}

function toUint8(chunk) {
	if (chunk instanceof Uint8Array) {
		return chunk;
	}
	if (chunk instanceof ArrayBuffer) {
		return new Uint8Array(chunk);
	}
	throw new TypeError("[ro-protocol] chunk precisa ser Buffer/Uint8Array/ArrayBuffer");
}
