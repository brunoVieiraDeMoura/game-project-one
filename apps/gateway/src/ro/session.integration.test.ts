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
});
