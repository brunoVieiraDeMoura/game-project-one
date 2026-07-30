/**
 * Endereco do rAthena. Os defaults sao as portas DESTE projeto (6901/6122/5122,
 * ver rathena-conf/): as padrao (6900/6121/5121) sao do idle-narok, que pode
 * estar de pe no mesmo WSL.
 *
 * PACKETVER tem que ser o mesmo do scripts/wsl-build.sh — layout de struct muda
 * por build, e nao ha negociacao em tempo de conexao.
 */
export const config = {
	gatewayPort: Number(process.env.GATEWAY_PORT ?? 4100),
	roHost: process.env.RO_HOST ?? "127.0.0.1",
	loginPort: Number(process.env.RO_LOGIN_PORT ?? 6901),
	packetver: Number(process.env.RO_PACKETVER ?? 20130618),
	debug: process.env.RO_DEBUG === "1",
} as const;
