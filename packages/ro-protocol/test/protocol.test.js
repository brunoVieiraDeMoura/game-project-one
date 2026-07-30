/**
 * Testes do codec sem servidor: garantem que o port do roBrowser roda em Node
 * (sem window/self), que a tabela de tamanhos do packetver carregou e que o
 * enquadramento aguenta os dois casos que quebram um parser ingenuo — pacote
 * partido entre chunks e pacote de tamanho variavel.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { initProtocol, PACKET, PACKETVER, PacketStream, getPacket } from "../src/index.js";

const PACKETVER_TARGET = 20130618; // = scripts/wsl-build.sh

test("initProtocol carrega structs e tabela de tamanho", () => {
	initProtocol(PACKETVER_TARGET);

	assert.equal(PACKETVER.value, PACKETVER_TARGET);

	// So os pacotes de ENTRADA entram no registro: e o opcode que decide qual
	// struct parseia o que chegou. Os de saida (CA/CH/CZ) escrevem o proprio
	// opcode dentro do build(), entao nao tem .id — e por isso hook() so aceita
	// struct de entrada.
	assert.equal(PACKET.AC.ACCEPT_LOGIN.id, 0x69);
	assert.equal(getPacket(0x69).name, "PACKET_AC_ACCEPT_LOGIN");
	assert.equal(getPacket(0x71).name, "PACKET_HC_NOTIFY_ZONESVR");
	assert.equal(PACKET.CA.LOGIN.id, undefined);
});

test("CA.LOGIN serializa no layout que o login-server espera", () => {
	initProtocol(PACKETVER_TARGET);

	const pkt = new PACKET.CA.LOGIN();
	pkt.Version = 25;
	pkt.ID = "teste";
	pkt.Passwd = "teste123";
	pkt.clienttype = 12;

	const bytes = new Uint8Array(pkt.build().buffer);
	const view = new DataView(bytes.buffer);

	assert.equal(bytes.length, 2 + 4 + 24 + 24 + 1);
	assert.equal(view.getUint16(0, true), 0x64);
	assert.equal(view.getUint32(2, true), 25);
	assert.equal(String.fromCharCode(...bytes.slice(6, 11)), "teste");
	assert.equal(String.fromCharCode(...bytes.slice(30, 38)), "teste123");
	assert.equal(bytes[54], 12);
});

test("stream remonta pacote partido entre dois chunks", () => {
	initProtocol(PACKETVER_TARGET);

	// ZC.NOTIFY_TIME (0x7f): 6 bytes, tamanho fixo na tabela.
	const packet = new Uint8Array([0x7f, 0x00, 0x11, 0x22, 0x33, 0x44]);
	const seen = [];
	const stream = new PacketStream((instance, meta) => seen.push(meta.id));

	stream.push(packet.slice(0, 3));
	assert.equal(seen.length, 0, "com 3 bytes nao da para fechar o pacote");

	stream.push(packet.slice(3));
	assert.deepEqual(seen, [0x7f]);
	assert.equal(stream.pending, null);
});

test("stream le pacote de tamanho variavel e o proximo em seguida", () => {
	initProtocol(PACKETVER_TARGET);

	// ZC.NOTIFY_PLAYERCHAT (0x8e) e variavel: opcode + uint16 tamanho total.
	const msg = "oi\0";
	const varLen = 4 + msg.length;
	const buf = new Uint8Array(varLen + 6);
	const view = new DataView(buf.buffer);

	view.setUint16(0, 0x8e, true);
	view.setUint16(2, varLen, true);
	for (let i = 0; i < msg.length; i++) {
		buf[4 + i] = msg.charCodeAt(i);
	}
	view.setUint16(varLen, 0x7f, true); // pacote fixo colado logo apos

	const seen = [];
	const stream = new PacketStream((instance, meta) => seen.push(meta.id));
	stream.push(buf);

	assert.deepEqual(seen, [0x8e, 0x7f]);
});

test("readRaw consome o account id cru antes do enquadramento", () => {
	initProtocol(PACKETVER_TARGET);

	const buf = new Uint8Array(4 + 6);
	const view = new DataView(buf.buffer);
	view.setUint32(0, 2000000, true); // AID cru, sem cabecalho (pos CH.ENTER)
	view.setUint16(4, 0x7f, true);

	let aid = 0;
	const seen = [];
	const stream = new PacketStream((instance, meta) => seen.push(meta.id));

	stream.readRaw((fp) => {
		aid = fp.readLong();
	});
	stream.push(buf);

	assert.equal(aid, 2000000);
	assert.deepEqual(seen, [0x7f], "sem consumir o AID o parser leria 0x1e84 como opcode");
});
