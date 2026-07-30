#!/usr/bin/env bash
# game-project — sobe o MariaDB no WSL e importa o schema do rAthena.
# Idempotente: pode rodar de novo sem quebrar.
set -euo pipefail

DST="$HOME/game-project/rathena"
# Banco proprio: o mesmo MariaDB do WSL ja hospeda "ragnarok" (idle-narok).
# Precisa bater com rathena-conf/inter_conf.txt.
DB=gameproject
USER=gameproject
PASS=gameproject

echo "==> subindo mariadb"
service mariadb start >/dev/null 2>&1 || true
for i in $(seq 1 30); do
	mariadb -e "SELECT 1" >/dev/null 2>&1 && break
	sleep 1
done
mariadb -e "SELECT VERSION()"

echo "==> criando banco e usuario"
mariadb -e "CREATE DATABASE IF NOT EXISTS $DB CHARACTER SET utf8mb4;"
mariadb -e "CREATE USER IF NOT EXISTS '$USER'@'localhost' IDENTIFIED BY '$PASS';"
mariadb -e "CREATE USER IF NOT EXISTS '$USER'@'127.0.0.1' IDENTIFIED BY '$PASS';"
mariadb -e "GRANT ALL PRIVILEGES ON $DB.* TO '$USER'@'localhost';"
mariadb -e "GRANT ALL PRIVILEGES ON $DB.* TO '$USER'@'127.0.0.1';"
mariadb -e "FLUSH PRIVILEGES;"

echo "==> importando schema (main, logs, web, roulette)"
for f in main.sql logs.sql web.sql roulette_default_data.sql; do
	echo "    - $f"
	mariadb "$DB" < "$DST/sql-files/$f"
done

echo "==> tabelas criadas:"
mariadb "$DB" -e "SELECT COUNT(*) AS tabelas FROM information_schema.tables WHERE table_schema='$DB';"
