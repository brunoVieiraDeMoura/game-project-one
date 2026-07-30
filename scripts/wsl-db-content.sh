#!/usr/bin/env bash
# game-project — importa as tabelas de CONTEUDO (item/mob/mob_skill) no banco.
#
# Por padrao o rAthena le item_db/mob_db dos YAML em db/re/. Com
# `use_sql_db: yes` (rathena-conf/inter_conf.txt) ele passa a ler destas
# tabelas — e ai o admin pode editar o jogo pelo painel e recarregar sem
# reiniciar o servidor (@reloaditemdb / @reloadmobdb).
#
# Os .sql de dados NAO vem no rAthena: sao gerados pelo yaml2sql a partir dos
# proprios YAML (passo 1 abaixo). Rodar de novo re-importa por cima.
set -euo pipefail

DST="$HOME/game-project/rathena"
DB=gameproject

cd "$DST"

echo "==> mariadb"
service mariadb start >/dev/null 2>&1 || true
for i in $(seq 1 30); do
	mariadb -e "SELECT 1" >/dev/null 2>&1 && break
	sleep 1
done

if [ ! -s "sql-files/item_db_re_equip.sql" ] || [ "$(stat -c%s sql-files/item_db_re_equip.sql)" -lt 1000 ]; then
	echo "==> gerando .sql a partir dos YAML (yaml2sql)"
	if [ ! -x ./yaml2sql ]; then
		make tools
	fi
	# O yaml2sql pergunta Y/N e le UM CARACTERE por vez, direto do terminal
	# (getch/termios): pipe com "\n" responderia N a cada pergunta seguinte, e
	# sem tty ele nem le. Dai o `script` (cria um pty) e so a letra Y.
	printf 'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY' | script -qec ./yaml2sql /dev/null | tail -3
fi

# mob_skill_db ainda e .txt (nao virou YAML): quem converte e um perl do
# proprio rAthena, nao o yaml2sql.
if [ "$(stat -c%s sql-files/mob_skill_db_re.sql)" -lt 10000 ]; then
	echo "==> convertendo mob_skill_db.txt -> sql"
	( cd tools && perl convert_sql.pl --i=../db/re/mob_skill_db.txt \
		--o=../sql-files/mob_skill_db_re.sql --t=re --m=mob_skill --table=mob_skill_db_re | tail -1 )
fi

# As tabelas "2" (item_db2_re, mob_db2_re, mob_skill_db2_re) sao o equivalente
# do db/import/: ficam VAZIAS, mas o map-server consulta as duas e morre com
# "Table doesn't exist" se faltarem.
echo "==> importando tabelas de conteudo (renewal)"
for f in item_db_re.sql item_db_re_equip.sql item_db_re_etc.sql item_db_re_usable.sql \
	item_db2_re.sql mob_db_re.sql mob_db2_re.sql mob_skill_db_re.sql mob_skill_db2_re.sql; do
	echo "    - $f"
	mariadb "$DB" < "sql-files/$f"
done

# Os arquivos *_equip/_etc/_usable NAO criam tabela propria: sao os DADOS
# (REPLACE INTO) da mesma `item_db_re`. Sao tres arquivos porque o rAthena
# tambem divide os YAML em tres.
echo "==> conteudo no banco:"
mariadb "$DB" -e "SELECT
	(SELECT COUNT(*) FROM item_db_re) AS itens,
	(SELECT COUNT(*) FROM mob_db_re) AS monstros,
	(SELECT COUNT(*) FROM mob_skill_db_re) AS skills_de_mob;"
