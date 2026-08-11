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

/**
 * Hotkeys (Fase de Hotkeys do servidor). No packetver deste projeto
 * (20130618) o pacote efetivo eh ZC_SHORTCUT_KEY_LIST_V2 (0x07d9, 38 slots
 * fixos de {isSkill.B, ID.L, count.W} = 7 bytes cada, 268 no total com o
 * opcode) e CZ_SHORTCUT_KEY_CHANGE1 (0x02ba) na volta — confirmado em
 * rathena/src/map/packets_struct.hpp e rathena/src/map/clif.cpp (ver
 * CLAUDE.md, secao de hotkeys).
 */
test("ZC.SHORTCUT_KEY_LIST_V2: decodifica os 38 slots, preservando skill/item/vazio e as bordas 0 e 37", () => {
	initProtocol(PACKETVER_TARGET);

	const SLOT_COUNT = 38;
	const buf = new Uint8Array(2 + SLOT_COUNT * 7);
	const view = new DataView(buf.buffer);

	view.setUint16(0, 0x7d9, true);
	let off = 2;
	for (let i = 0; i < SLOT_COUNT; i++) {
		let isSkill = 0;
		let id = 0;
		let count = 0;
		if (i === 0) {
			// slot 0 (borda inferior): skill real
			isSkill = 1;
			id = 5; // NV_BASIC, so pra ter um id nao-zero
			count = 9; // nivel
		} else if (i === 1) {
			// item
			isSkill = 0;
			id = 501; // Red Potion
			count = 3; // quantidade
		} else if (i === 37) {
			// slot 37 (borda superior): outro skill, prova que o slot MAIS ALTO
			// (fora dos 27 que a UI hoje mostra) chega intacto tambem
			isSkill = 1;
			id = 143; // MG_FIREBOLT, so pra ter um id nao-zero
			count = 3;
		}
		view.setInt8(off, isSkill);
		view.setUint32(off + 1, id, true);
		view.setInt16(off + 5, count, true);
		off += 7;
	}

	const seen = [];
	const stream = new PacketStream((instance, meta) => seen.push({ instance, meta }));
	stream.push(buf);

	assert.equal(seen.length, 1);
	assert.equal(seen[0].meta.id, 0x7d9);
	const slots = seen[0].instance.ShortCutKey;
	assert.equal(slots.length, SLOT_COUNT, "os 38 slots tem que sobreviver ao decode, nao so os 27 que a UI mostra hoje");

	assert.deepEqual(slots[0], { isSkill: 1, ID: 5, count: 9 });
	assert.deepEqual(slots[1], { isSkill: 0, ID: 501, count: 3 });
	assert.deepEqual(slots[2], { isSkill: 0, ID: 0, count: 0 }); // vazio no meio nao vira lixo
	assert.deepEqual(slots[37], { isSkill: 1, ID: 143, count: 3 }); // borda superior (slot alem dos 27 da UI)
});

test("CZ.SHORTCUT_KEY_CHANGE1: serializa slot/skill corretamente, incluindo as bordas 0 e 37", () => {
	initProtocol(PACKETVER_TARGET);

	function build(index, isSkill, id, count) {
		const pkt = new PACKET.CZ.SHORTCUT_KEY_CHANGE1();
		pkt.Index = index;
		pkt.ShortCutKey = { isSkill, ID: id, count };
		const bytes = new Uint8Array(pkt.build().buffer);
		const view = new DataView(bytes.buffer);
		return { bytes, view };
	}

	// slot 0, skill
	{
		const { bytes, view } = build(0, 1, 5, 9);
		assert.equal(bytes.length, 2 + 2 + 1 + 4 + 2);
		assert.equal(view.getUint16(0, true), 0x2ba);
		assert.equal(view.getUint16(2, true), 0); // Index
		assert.equal(view.getInt8(4), 1); // isSkill
		assert.equal(view.getUint32(5, true), 5); // ID
		assert.equal(view.getInt16(9, true), 9); // count (nivel)
	}

	// slot 37 (fora dos 27 que a UI mostra hoje, mas o wire aceita ate MAX_HOTKEYS-1), item
	{
		const { bytes, view } = build(37, 0, 501, 3);
		assert.equal(view.getUint16(2, true), 37);
		assert.equal(view.getInt8(4), 0); // isSkill=0 = item
		assert.equal(view.getUint32(5, true), 501);
		assert.equal(view.getInt16(9, true), 3);
	}

	// slot vazio: convencao id=0
	{
		const { bytes, view } = build(10, 0, 0, 0);
		assert.equal(view.getUint16(2, true), 10);
		assert.equal(view.getUint32(5, true), 0);
	}
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
