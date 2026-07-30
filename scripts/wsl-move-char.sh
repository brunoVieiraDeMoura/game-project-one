#!/usr/bin/env bash
# game-project — move um personagem (e o ponto de save) para um mapa/celula.
#
# Serve para tirar um personagem de um mapa que ainda nao tem cena 3D — ao
# morrer, o rAthena manda para o SAVE POINT, que pode ser Prontera, e ai o
# cliente so mostra o aviso "sem mapa 3D".
#
# Uso: wsl-move-char.sh <char_id> [mapa] [x] [y]
#      wsl-move-char.sh 150007 prt_fild08 170 373
#
# O char-server so le a tabela ao logar, e sobrescreve ao deslogar: por isso os
# servidores sao parados antes e subidos depois.
set -euo pipefail

CHAR_ID="${1:?uso: wsl-move-char.sh <char_id> [mapa] [x] [y]}"
MAP="${2:-prt_fild08}"
X="${3:-170}"
Y="${4:-373}"
DB=gameproject
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> parando servidores (o char-server sobrescreve a linha ao deslogar)"
bash "$HERE/wsl-stop.sh" >/dev/null

mariadb "$DB" -e "UPDATE \`char\`
	SET last_map = '$MAP', last_x = $X, last_y = $Y,
	    save_map = '$MAP', save_x = $X, save_y = $Y
	WHERE char_id = $CHAR_ID;"

mariadb "$DB" -e "SELECT char_id, name, last_map, last_x, last_y, save_map FROM \`char\` WHERE char_id = $CHAR_ID;"

echo "==> subindo servidores"
bash "$HERE/wsl-run.sh" | tail -5
