#!/usr/bin/env bash
# game-project — sobe MariaDB + login/char/map dentro do WSL.
# Logs em ~/game-project/logs/. Parar com: scripts/wsl-stop.sh
set -euo pipefail

DST="$HOME/game-project/rathena"
LOGS="$HOME/game-project/logs"
mkdir -p "$LOGS"

echo "==> mariadb"
service mariadb start >/dev/null 2>&1 || true
for i in $(seq 1 30); do
	mariadb -e "SELECT 1" >/dev/null 2>&1 && break
	sleep 1
done

# O mesmo WSL pode ter o idle-narok rodando, com processos de nome IDENTICO
# (login-server etc). pgrep -x casaria com os dois e o script pularia a nossa
# subida achando que ja estava de pe — por isso a checagem e pelo cwd do
# processo, que e a unica coisa que diferencia as duas instalacoes.
running_here() {
	local name="$1" pid
	for pid in $(pgrep -x "$name" 2>/dev/null); do
		[ "$(readlink -f "/proc/$pid/cwd")" = "$(readlink -f "$DST")" ] && return 0
	done
	return 1
}

cd "$DST"
for s in login char map; do
	if running_here "$s-server"; then
		echo "==> $s-server (game-project) ja rodando (pulando)"
		continue
	fi
	echo "==> subindo $s-server"
	nohup "./$s-server" >"$LOGS/$s.log" 2>&1 &
	sleep 3
done

sleep 2
echo
echo "==> processos do game-project:"
for s in login char map; do
	running_here "$s-server" && echo "    $s-server OK" || echo "    $s-server NAO SUBIU (ver $LOGS/$s.log)"
done
echo
echo "==> portas (6901 login / 6122 char / 5122 map):"
ss -tlnp 2>/dev/null | grep -E "6901|6122|5122" || echo "NENHUMA PORTA ABERTA"
