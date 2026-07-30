#!/usr/bin/env bash
# game-project — da nivel de GM para uma conta e mostra os personagens dela.
# Uso: wsl-gm.sh [account_id]   (default: 2000000)
# Precisa relogar para o group_id novo valer.
set -euo pipefail

ACC="${1:-2000000}"
DB=gameproject

mariadb "$DB" -e "UPDATE login SET group_id = 99 WHERE account_id = $ACC;"

echo "==> conta:"
mariadb "$DB" -e "SELECT account_id, userid, sex, group_id FROM login WHERE account_id = $ACC;"

echo "==> personagens:"
mariadb "$DB" -e "SELECT char_id, name, class, base_level, job_level, base_exp, job_exp, zeny, last_map, last_x, last_y FROM \`char\` WHERE account_id = $ACC;"
