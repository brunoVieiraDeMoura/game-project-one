#!/usr/bin/env bash
# game-project — compila o rAthena dentro do WSL.
#
# PACKETVER precisa bater com o valor que packages/ro-protocol usa no gateway
# (apps/gateway). 20130618 e o mesmo valor validado no idle-narok: esta na
# faixa que ofusca pacotes, dai o defines_pre.hpp zerar as chaves.
set -euo pipefail

DST="$HOME/game-project/rathena"
PACKETVER=20130618

cd "$DST"

echo "==> configure (packetver=$PACKETVER)"
./configure --enable-packetver="$PACKETVER"

echo "==> make server (-j$(nproc))"
make -j"$(nproc)" server

echo "==> binarios:"
ls -la "$DST"/{login,char,map}-server
