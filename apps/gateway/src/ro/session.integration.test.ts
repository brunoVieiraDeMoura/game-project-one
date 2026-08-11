/**
 * Teste de integracao contra o rAthena de verdade.
 *
 * Pula sozinho se o login-server nao estiver escutando — assim `pnpm test` na
 * maquina de quem nao subiu o WSL nao quebra. Para rodar de verdade:
 *   wsl -d Ubuntu -u root bash scripts/wsl-run.sh
 *
 * Cria a conta na hora (sufixo _M + new_account: yes no login_conf.txt), entao
 * nao depende de nenhum estado previo do banco.
 */
import net from "node:net";
import { describe, expect, it, beforeAll } from "vitest";
import { config } from "../config.js";
import { RoSession } from "./session.js";
import type { HotkeySlot } from "../protocol.js";

const TIMEOUT = 20_000;

async function portOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.connect({ host, port });
		const done = (ok: boolean) => {
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => done(true));
		socket.once("timeout", () => done(false));
		socket.once("error", () => done(false));
	});
}

let serverUp = false;

beforeAll(async () => {
	serverUp = await portOpen(config.roHost, config.loginPort);
	if (!serverUp) {
		console.warn(
			`[teste] rAthena nao esta em ${config.roHost}:${config.loginPort} — integracao pulada (rode scripts/wsl-run.sh)`,
		);
	}
});

describe("RoSession contra o rAthena", () => {
	it(
		"autentica, recebe a lista de personagens e entra no mapa",
		async (ctx) => {
			if (!serverUp) {
				ctx.skip();
			}

			// Conta nova a cada rodada: o rAthena cria na hora quando o usuario
			// termina em _M e new_account esta ligado.
			const suffix = Date.now().toString().slice(-6);
			const account = `gp${suffix}`;
			const password = "gp123456";

			const session = new RoSession({
				host: config.roHost,
				loginPort: config.loginPort,
				packetver: config.packetver,
				debug: config.debug,
			});

			try {
				const chars = new Promise<{ chars: unknown[]; slots: number }>((resolve, reject) => {
					session.on("chars", (list, slots) => resolve({ chars: list, slots }));
					session.on("closed", ({ reason }) => reject(new Error(reason)));
				});

				await session.authenticate(`${account}_M`, password);
				const listed = await chars;

				expect(session.accountId).toBeGreaterThan(0);
				expect(session.authCode).not.toBe(0);
				expect(listed.slots).toBeGreaterThan(0);
				expect(Array.isArray(listed.chars)).toBe(true);

				// Conta nova nasce sem personagem: criamos um e entramos no mapa.
				const entered = new Promise<{ mapName: string; x: number; y: number }>((resolve, reject) => {
					session.on("map-enter", resolve);
					session.on("closed", ({ reason }) => reject(new Error(reason)));
				});

				const relisted = new Promise<void>((resolve) => {
					session.once("chars", () => resolve());
				});

				session.createChar({ slot: 0, name: `Teste${suffix}`, hair: 1, hairColor: 1 });
				await relisted;
				session.selectChar(0);

				const world = await entered;
				expect(world.mapName).toBeTruthy();
				expect(world.x).toBeGreaterThan(0);
				expect(world.y).toBeGreaterThan(0);
			} finally {
				session.close();
			}
		},
		TIMEOUT,
	);

	it(
		"hotkeys: os 38 slots chegam no map-enter, mudar 1 slot sobrevive a reconexao (prova real de persistencia no char-server)",
		async (ctx) => {
			if (!serverUp) {
				ctx.skip();
			}

			const suffix = Date.now().toString().slice(-6);
			const account = `hk${suffix}`;
			const password = "gp123456";
			const charName = `Hk${suffix}`;

			// sessao 1: cria a conta+personagem, entra no mapa, confirma os 38
			// slots (vazios, char novo) e muda o slot 5 pra um item real.
			const session1 = new RoSession({
				host: config.roHost,
				loginPort: config.loginPort,
				packetver: config.packetver,
				debug: config.debug,
			});
			try {
				const chars = new Promise<void>((resolve, reject) => {
					session1.on("chars", () => resolve());
					session1.on("closed", ({ reason }) => reject(new Error(reason)));
				});
				await session1.authenticate(`${account}_M`, password);
				await chars;

				const entered = new Promise<void>((resolve, reject) => {
					session1.on("map-enter", () => resolve());
					session1.on("closed", ({ reason }) => reject(new Error(reason)));
				});
				const hotkeysPromise = new Promise<HotkeySlot[]>((resolve) => session1.once("hotkeys", resolve));
				const relisted = new Promise<void>((resolve) => session1.once("chars", () => resolve()));
				session1.createChar({ slot: 0, name: charName, hair: 1, hairColor: 1 });
				await relisted;
				session1.selectChar(0);
				await entered;
				// `clif_hotkeys_send` só dispara dentro de `clif_parse_LoadEndAck`
				// (CZ_NOTIFY_ACTORINIT) — o cliente real manda isso quando a cena 3D
				// termina de montar (`world:ready` no gateway); aqui simulamos o
				// mesmo aviso manualmente, sem cena nenhuma.
				session1.notifyReady();

				const initial = await withTimeout(hotkeysPromise, 10_000, "hotkeys (sessao 1)");
				expect(initial).toHaveLength(38);
				// char novo: os 38 vem vazios (`hotkey_rowshift`/tabela `hotkey` sem
				// linha nenhuma pra este char_id ainda) — prova que o decode dos 38
				// slots está correto ANTES de qualquer escrita nossa.
				expect(initial.every((s) => s.kind === "empty")).toBe(true);

				// muda o slot 5 pra um item real (Red Potion, 501) — sem
				// confirmação nenhuma no protocolo (`clif_parse_Hotkey` não ecoa
				// nada de volta), só dá pra confiar que o pacote saiu.
				session1.setHotkey(5, { kind: "item", id: 501, count: 3 });
				await sleep(1000);
			} finally {
				session1.close();
			}

			// dá tempo do map-server avisar o char-server que o personagem saiu
			// (é aí que o char-server grava a tabela `hotkey` de verdade).
			await sleep(2000);

			// sessao 2: reloga na MESMA conta (sem sufixo _M — ela já existe) e
			// confirma que o slot 5 voltou com o valor gravado. Isto, e só isto,
			// é prova real de persistência — não "pacote enviado com sucesso".
			const session2 = new RoSession({
				host: config.roHost,
				loginPort: config.loginPort,
				packetver: config.packetver,
				debug: config.debug,
			});
			try {
				const chars2 = new Promise<void>((resolve, reject) => {
					session2.on("chars", () => resolve());
					session2.on("closed", ({ reason }) => reject(new Error(reason)));
				});
				await session2.authenticate(account, password);
				await chars2;

				const entered2 = new Promise<void>((resolve, reject) => {
					session2.on("map-enter", () => resolve());
					session2.on("closed", ({ reason }) => reject(new Error(reason)));
				});
				const hotkeysPromise2 = new Promise<HotkeySlot[]>((resolve) => session2.once("hotkeys", resolve));
				session2.selectChar(0);
				await entered2;
				session2.notifyReady();

				const afterReconnect = await withTimeout(hotkeysPromise2, 10_000, "hotkeys (sessao 2)");
				expect(afterReconnect).toHaveLength(38);
				expect(afterReconnect[5]).toEqual({ slot: 5, kind: "item", id: 501, count: 3 });
				// os outros slots continuam vazios — a mudança não vazou pra fora
				// do índice pedido.
				expect(afterReconnect.filter((s) => s.kind !== "empty")).toHaveLength(1);
			} finally {
				session2.close();
			}
		},
		TIMEOUT * 3,
	);
});

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} não chegou em ${ms}ms`)), ms)),
	]);
}
