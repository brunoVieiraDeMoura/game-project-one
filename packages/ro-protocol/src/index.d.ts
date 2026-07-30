/**
 * Tipos da borda do codec. As structs do roBrowser sao ~15k linhas de JS gerado
 * e nao vale a pena tipar campo a campo — `PACKET` e propositalmente frouxo. O
 * que esta tipado de verdade e o que o gateway usa: conexao, hooks e stream.
 */

export interface PacketMeta {
	id: number;
	name: string;
}

/** Struct de pacote (construtor). Entrada tem `.id`; saida tem `.build()`. */
export interface PacketStruct {
	new (...args: any[]): any;
	id?: number;
	size?: number;
	name: string;
}

/** Instancia construida para enviar. */
export interface OutgoingPacket {
	build(): { buffer: ArrayBuffer };
}

/** Arvore de pacotes: CA/AC (login), CH/HC (char), CZ/ZC (map). */
export declare const PACKET: {
	CA: Record<string, any>;
	AC: Record<string, any>;
	CH: Record<string, any>;
	HC: Record<string, any>;
	CZ: Record<string, any>;
	ZC: Record<string, any>;
	SC: Record<string, any>;
	[group: string]: Record<string, any>;
};

export declare const PACKETVER: {
	value: number;
	addSupport(date: string | number, list: unknown[]): void;
	parseCharInfo(fp: unknown, end?: number): Record<string, any>[];
};

export declare const Configs: {
	get(key: string, defaultValue?: unknown): any;
	set(key: string, value: unknown): void;
};

/**
 * Carrega tabela de tamanhos e registra as structs de entrada.
 * Precisa rodar antes de qualquer conexao. O packetver tem que ser o mesmo do
 * `--enable-packetver` com que o rAthena foi compilado.
 */
export declare function initProtocol(packetver: number, options?: { renewal?: boolean }): void;

export declare function getPacket(id: number): PacketMeta & { Struct: PacketStruct } | undefined;
export declare function packetId(Struct: PacketStruct): number;

export declare class PacketStream {
	constructor(
		onPacket: (packet: any, meta: PacketMeta) => void,
		onUnknown?: (info: { id: number; length: number }) => void,
	);
	pending: Uint8Array | null;
	readRaw(callback: (fp: any) => void): void;
	push(chunk: Uint8Array | ArrayBuffer): void;
}

export declare class RoConnection {
	constructor(options: { host: string; port: number; label?: string; debug?: boolean });
	readonly host: string;
	readonly port: number;
	readonly label: string;
	connected: boolean;
	connect(): Promise<void>;
	hook(Struct: PacketStruct, callback: (packet: any) => void): this;
	readRaw(callback: (fp: any) => void): void;
	send(packet: OutgoingPacket): void;
	startPing(tick: () => void, intervalMs?: number): this;
	stopPing(): void;
	close(): void;

	on(event: "packet", listener: (packet: any, meta: PacketMeta) => void): this;
	on(event: "unknown", listener: (info: { id: number; length: number }) => void): this;
	on(event: "close", listener: () => void): this;
	on(event: "error", listener: (err: Error) => void): this;
	on(event: string, listener: (...args: any[]) => void): this;
	once(event: string, listener: (...args: any[]) => void): this;
	off(event: string, listener: (...args: any[]) => void): this;
	removeAllListeners(event?: string): this;
}

export declare function longToIP(long: number): string;

export declare const BinaryReader: any;
export declare const BinaryWriter: any;
