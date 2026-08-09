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

# --- Correcao: item sem "Classes:" no YAML fica INEQUIPAVEL vindo do banco ---
#
# E um bug de round-trip do PROPRIO yaml2sql/itemdb.cpp (rathena/, so leitura,
# nao mexemos la), nao da nossa migracao. Cadeia confirmada no source:
#
#   yaml2sql.cpp:490 `if (classes) { ... }` — so escreve as colunas class_* no
#   SQL quando o YAML TEM a chave "Classes:". Sem ela, as 8 colunas ficam
#   ausentes do INSERT e caem no DEFAULT NULL da tabela.
#
#   itemdb.cpp:418-420 (carregamento DIRETO do YAML) — quando "Classes:" nao
#   existe, aplica `item->class_upper = ITEMJ_ALL` (equipavel por qualquer
#   classe). Esse e o comportamento certo, e SO roda por este caminho.
#
#   itemdb.cpp:4153-4154 (`itemdb_read_sqldb_sub`, carregamento via
#   `use_sql_db: yes` — o modo deste projeto) — ao reconstruir o YAML a partir
#   da linha do banco, SEMPRE cria o no "Classes" (`classes |= ryml::MAP`),
#   mesmo com as 8 colunas nulas. Isso faz `nodeExists(node,"Classes")`
#   (itemdb.cpp:376) dar TRUE mesmo sem nenhum dado — pula o fallback
#   ITEMJ_ALL, o loop de classes roda 0 vezes, e `class_upper` fica em 0 pra
#   sempre. Resultado: pc_isItemClass (pc.cpp:1804) recusa TODO mundo, pra
#   TODO item assim, em QUALQUER classe — foi assim que a Fase 4 achou isto
#   (equipar sempre recusado, mesmo item sem restricao nenhuma).
#
# A correcao NAO inventa "todo item = equipavel por todos": so grava
# `class_all = 1` (o mesmo valor que o carregamento YAML direto ja aplicaria
# sozinho) nas linhas em que as OITO colunas de classe vieram nulas — o que so
# acontece quando o YAML de origem realmente nao tinha "Classes:". Item com
# QUALQUER restricao real (mesmo parcial, tipo so Third+Fourth) sempre grava
# pelo menos uma dessas colunas — conferido com Golden Rod Shoes (id 2467,
# Classes: {All_Third, Fourth} no YAML -> class_third/class_fourth = 1 no
# banco, os outros 6 ficam nulos DE PROPOSITO) — esses ficam intocados.
#
# Roda TODA VEZ que o script roda (nao so na primeira importacao): o yaml2sql
# regenera os .sql do zero a cada vez, com a mesma lacuna, e o REPLACE INTO do
# loop acima reintroduziria os NULL se essa correcao nao rodasse de novo por
# cima.
echo "==> corrigindo class_all ausente (bug de round-trip yaml2sql <-> itemdb_read_sqldb_sub)"
ANTES=$(mariadb "$DB" -N -e "SELECT COUNT(*) FROM item_db_re WHERE class_all IS NULL AND class_normal IS NULL AND class_upper IS NULL AND class_baby IS NULL AND class_third IS NULL AND class_third_upper IS NULL AND class_third_baby IS NULL AND class_fourth IS NULL;")
mariadb "$DB" -e "UPDATE item_db_re SET class_all = 1 WHERE class_all IS NULL AND class_normal IS NULL AND class_upper IS NULL AND class_baby IS NULL AND class_third IS NULL AND class_third_upper IS NULL AND class_third_baby IS NULL AND class_fourth IS NULL;"
DEPOIS=$(mariadb "$DB" -N -e "SELECT COUNT(*) FROM item_db_re WHERE class_all IS NULL AND class_normal IS NULL AND class_upper IS NULL AND class_baby IS NULL AND class_third IS NULL AND class_third_upper IS NULL AND class_third_baby IS NULL AND class_fourth IS NULL;")
echo "    class_* totalmente nulo (sem Classes: no YAML): $ANTES -> $DEPOIS"

echo "==> conteudo no banco:"
mariadb "$DB" -e "SELECT
	(SELECT COUNT(*) FROM item_db_re) AS itens,
	(SELECT COUNT(*) FROM mob_db_re) AS monstros,
	(SELECT COUNT(*) FROM mob_skill_db_re) AS skills_de_mob;"
