#!/usr/bin/env bash
# game-project — derruba SO os servidores do rAthena deste projeto.
#
# O mesmo WSL pode ter o idle-narok de pe com processos de nome identico; um
# pkill -x levaria os dois junto. Mata por PID, filtrando pelo cwd do processo.
set -uo pipefail

DST="$HOME/game-project/rathena"

pids_here() {
	local name="$1" pid
	for pid in $(pgrep -x "$name" 2>/dev/null); do
		[ "$(readlink -f "/proc/$pid/cwd")" = "$(readlink -f "$DST")" ] && echo "$pid"
	done
}

for s in map char login; do
	pids="$(pids_here "$s-server")"
	if [ -n "$pids" ]; then
		kill $pids
		echo "==> $s-server parado (pid $pids)"
	else
		echo "==> $s-server nao estava rodando"
	fi
done

# espera os processos realmente sairem antes de devolver o controle
for i in $(seq 1 20); do
	[ -z "$(pids_here map-server)$(pids_here char-server)$(pids_here login-server)" ] && break
	sleep 0.5
done
