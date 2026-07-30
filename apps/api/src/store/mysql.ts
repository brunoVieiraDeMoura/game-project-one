import mysql from "mysql2/promise";
import { env } from "../env.js";

/**
 * Pool para o MariaDB do rAthena (o mesmo banco que o map-server usa).
 *
 * Um pool por processo: cada rota abrindo conexão estouraria o
 * `max_connections` do MariaDB em poucos cliques no admin.
 */
let pool: mysql.Pool | null = null;

export function roDatabase(): mysql.Pool {
	if (!pool) {
		pool = mysql.createPool({
			host: env.roDbHost,
			port: env.roDbPort,
			user: env.roDbUser,
			password: env.roDbPassword,
			database: env.roDbName,
			connectionLimit: 5,
			// O rAthena grava latin1 em algumas colunas antigas; utf8mb4 é o
			// charset do banco que criamos (scripts/wsl-db.sh).
			charset: "utf8mb4",
			// `script` de item passa fácil de 64 KB em item encantado
			maxPreparedStatements: 200,
		});
	}
	return pool;
}

export function hasRoDatabase(): boolean {
	return Boolean(env.roDbHost && env.roDbName);
}

export async function closeRoDatabase(): Promise<void> {
	await pool?.end();
	pool = null;
}
