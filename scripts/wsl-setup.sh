#!/usr/bin/env bash
# game-project — prepara o rAthena dentro do WSL2.
#
# Copia a arvore do rAthena do Windows para o ext4 do WSL (build em /mnt/c e
# lento demais) e liga conf/import de volta para rathena-conf/ do projeto,
# para que toda customizacao nossa continue morando no repo no Windows.
set -euo pipefail

SRC="/mnt/c/Users/Bruno/desktop/game-project"
DST="$HOME/game-project/rathena"

echo "==> sincronizando $SRC/rathena -> $DST"
mkdir -p "$DST"
rsync -a --delete --exclude=.git "$SRC/rathena/" "$DST/"

echo "==> ligando conf/import -> $SRC/rathena-conf"
rm -rf "$DST/conf/import"
ln -s "$SRC/rathena-conf" "$DST/conf/import"

# Nossos NPCs ficam no repo (npc-idle/) e entram na arvore do rAthena por
# symlink, igual ao conf/import. Assim editar um script no Windows vale na
# hora (basta @reloadscript no jogo), sem rsync e sem tocar em npc/ do core.
echo "==> ligando npc/game-project -> $SRC/npc-idle"
rm -rf "$DST/npc/game-project"
ln -s "$SRC/npc-idle" "$DST/npc/game-project"

# db/import e o mecanismo do proprio rAthena para SOBREPOR entradas do db
# principal sem editar os arquivos do upstream. E por ele que o painel admin
# grava skill/classe (que nao tem tabela SQL) — daí ele tambem apontar de volta
# para o repo no Windows, como o conf/import.
echo "==> ligando db/import -> $SRC/rathena-db-import"
rm -rf "$DST/db/import"
ln -s "$SRC/rathena-db-import" "$DST/db/import"

# npc/scripts_custom.conf e o ULTIMO import do npc/re/scripts_main.conf, e por
# isso o unico lugar de onde da para `delnpc:` um arquivo de spawn oficial: o
# `npc_delsrcfile` apaga da lista, entao so vale DEPOIS que o oficial entrou
# nela. No conf/import/map_conf.txt seria cedo demais (map.cpp:5357 roda antes
# do map_reloadnpc de :5363). E por aqui que o prt_fild08 volta ao spawn do RO
# original — ver npc-idle/scripts_custom.conf.
echo "==> ligando npc/scripts_custom.conf -> $SRC/npc-idle/scripts_custom.conf"
rm -f "$DST/npc/scripts_custom.conf"
ln -s "$SRC/npc-idle/scripts_custom.conf" "$DST/npc/scripts_custom.conf"

echo "==> conteudo de conf/import:"
ls -1 "$DST/conf/import/"

echo "==> tamanho:"
du -sh "$DST"
