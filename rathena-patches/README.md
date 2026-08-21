# rathena-patches/

`rathena/` e vendored e gitignored (`.gitignore:20: /rathena/`) — copia de
leitura da arvore original, sincronizada pro WSL2 por `scripts/wsl-setup.sh`
(rsync). Nenhuma edicao direta em `rathena/` fica em historico de git.

Quando uma mudanca de servidor e realmente necessaria (nao da pra fazer via
`rathena-conf/`, YAML de `db/import`, ou NPC), o diff mora aqui como patch
reproduzivel, e a MESMA edicao ja fica aplicada no working tree de
`rathena/` (e o que builda). Este arquivo documenta como reaplicar caso
`rathena/` seja re-vendorizado do zero (update de upstream, clone novo).

## Aplicar

De dentro do WSL2 (tem `patch`; Windows nao tem por padrao):

```bash
cd /mnt/c/Users/Bruno/desktop/game-project
patch -p1 -d rathena < rathena-patches/0001-ghost-dome-safetywall-block-notify.patch
```

Ou com `git apply` (funciona fora de repo git, com `--unsafe-paths` se for
preciso path fora do cwd):

```bash
git apply -p1 --directory=rathena rathena-patches/0001-ghost-dome-safetywall-block-notify.patch
```

Depois: `scripts/wsl-build.sh` + `scripts/wsl-run.sh` pra reconstruir/subir
com a mudanca.

## Patches

- **0001-ghost-dome-safetywall-block-notify.patch** — Ghost Dome/Safety Wall:
  notifica o client quando uma carga REAL e consumida (`ATK_BLOCK`), via
  `clif_skill_nodamage()`/`ZC_USE_SKILL` (0x011a, mesmo mecanismo que
  `SC_WEAPONBLOCKING` ja usa na mesma funcao). Motivacao completa no
  cabecalho do proprio patch. Client consome em
  `apps/gateway/src/ro/session.ts` → evento `ghost-dome-block` →
  `apps/game/src/vfx/mage/ghost-dome/ghostDomeBlockReaction.ts`.
- **0002-blink-gp-blink.patch** — nova skill `GP_BLINK` (id `9000`, faixa
  9000-9999 livre entre ABR e `GD_SKILLBASE`): teleporte pra frente,
  `skills/custom/blink.cpp`/`.hpp`, registrado em
  `skills/custom/skill_factory_custom.cpp`. Reusa a mesma cadeia do Backslide
  (`skill_blown → unit_blown → path_blownpos`, `CELL_CHKPASS` célula a
  célula, para na última válida antes do bloqueio) só alimentando a direção
  OPOSTA à que o personagem encara — `skill_blown()` inverte o vetor de
  novo e o resultado sai pra frente. Alcance (`Knockback`), cooldown
  (`Cooldown`) e custo de SP (`Requires.SpCost`) ficam inteiros em
  `skill_db.yml`, escrito pelo painel admin
  (`apps/api/src/store/yaml-skill-repository.ts`) — nada disso é hardcoded
  no C++. Criada para validar que uma skill nova cadastrada pelo painel
  persiste e roda de verdade no rAthena (ver plano/leia1.txt "Blink 15").
