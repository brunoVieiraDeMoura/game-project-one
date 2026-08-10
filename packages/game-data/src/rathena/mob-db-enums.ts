/**
 * `modes[]` (`"MD_"+s`, `mob.cpp:5490-5521`, `mmo.hpp:243-271`) e
 * `raceGroups[]` (`"RC2_"+s`, `mob.cpp:5291-5322`, `map.hpp:342-387`) do
 * Monster. Contados linha a linha contra o C++ e a coluna SQL na revisão
 * da Fase 2 (`docs/audit/risk-report.md`) — não é lista redigitada de
 * memória.
 *
 * `MONSTER_MODES` (26) bate 1:1 com `MODE_COLUMNS` de
 * `apps/api/src/store/mysql-monster-row.ts` (confirmado 26=26, mesmos
 * nomes) — `mysql-monster-row.test.ts` (mesmo pacote de teste do superset
 * abaixo) garante que os dois nunca dessincronizam.
 *
 * `MONSTER_RACE_GROUPS` (42) tem 2 marcados `deprecated: true`:
 * `RC2_GUARDIAN`/`RC2_BATTLEFIELD` têm o comentário LITERAL no rAthena
 * ("// Deprecated to CLASS_GUARDIAN"/"// Deprecated to CLASS_BATTLEFIELD",
 * `map.hpp:347,350`) — a coluna SQL ainda existe (dado legado pode ter o
 * bit ligado), mas não há razão pra marcar um mob NOVO com eles: quem
 * decide chefe/campo-de-batalha hoje é `Monster.class`.
 */

const MODE_LABELS: Record<string, string> = {
  canmove: "Pode se mover",
  looter: "Pega item do chão",
  aggressive: "Agressivo",
  assist: "Auxilia outros da espécie",
  castsensoridle: "Sente skill parado",
  norandomwalk: "Não anda à toa",
  nocast: "Não conjura skill",
  canattack: "Pode atacar",
  castsensorchase: "Sente skill perseguindo",
  changechase: "Muda de alvo perseguindo",
  angry: "Fica bravo (segue mesmo fora de alcance)",
  changetargetmelee: "Muda de alvo (corpo a corpo)",
  changetargetchase: "Muda de alvo (perseguição)",
  targetweak: "Mira o mais fraco",
  randomtarget: "Mira aleatório",
  ignoremelee: "Ignora dano corpo a corpo",
  ignoremagic: "Ignora dano mágico",
  ignoreranged: "Ignora dano à distância",
  mvp: "MVP",
  ignoremisc: "Ignora dano diverso",
  knockbackimmune: "Imune a empurrão",
  teleportblock: "Bloqueia teleporte",
  fixeditemdrop: "Drop fixo (ignora taxa do servidor)",
  detector: "Detecta escondido",
  statusimmune: "Imune a status",
  skillimmune: "Imune a skill",
};

/** As mesmas 26 chaves de `MODE_COLUMNS` (`mysql-monster-row.ts:64-91`) —
 * ordem não importa aqui, só o conjunto. */
export const MONSTER_MODES: readonly string[] = Object.keys(MODE_LABELS);

export type MonsterModeOption = { value: string; label: string; description?: string; deprecated?: boolean };

export const MONSTER_MODE_OPTIONS: MonsterModeOption[] = MONSTER_MODES.map((m) => ({
  value: m,
  label: MODE_LABELS[m]!,
  description: `MD_${m.toUpperCase()}`,
}));

const RACE_GROUP_LABELS: Record<string, string> = {
  goblin: "Goblin",
  kobold: "Kobold",
  orc: "Orc",
  golem: "Golem",
  guardian: "Guardião (obsoleto — use Classe)",
  ninja: "Ninja",
  gvg: "GvG",
  battlefield: "Campo de batalha (obsoleto — use Classe)",
  treasure: "Tesouro",
  biolab: "Bio Labs",
  manuk: "Manuk",
  splendide: "Splendide",
  scaraba: "Scaraba",
  ogh_atk_def: "OGH (ataque/defesa)",
  ogh_hidden: "OGH (escondido)",
  bio5_swordman_thief: "Bio 5 (Espadachim/Ladrão)",
  bio5_acolyte_merchant: "Bio 5 (Acólito/Mercador)",
  bio5_mage_archer: "Bio 5 (Mago/Arqueiro)",
  bio5_mvp: "Bio 5 (MVP)",
  clocktower: "Torre do Relógio",
  thanatos: "Thanatos",
  faceworm: "Faceworm",
  hearthunter: "Hearthunter",
  rockridge: "Rockridge",
  werner_lab: "Laboratório Werner",
  temple_demon: "Templo Demoníaco",
  illusion_vampire: "Ilusão — Vampiro",
  malangdo: "Malangdo",
  ep172alpha: "Episódio 17.2 Alpha",
  ep172beta: "Episódio 17.2 Beta",
  ep172bath: "Episódio 17.2 Banho",
  illusion_turtle: "Ilusão — Tartaruga",
  rachel_sanctuary: "Santuário de Rachel",
  illusion_luanda: "Ilusão — Luanda",
  illusion_frozen: "Ilusão — Congelado",
  illusion_moonlight: "Ilusão — Luar",
  ep16_def: "Episódio 16 (defesa)",
  edda_arunafeltz: "Edda Arunafeltz",
  lasagna: "Lasagna",
  glast_heim_abyss: "Glast Heim — Abismo",
  destroyed_valkyrie_realm: "Reino Valkyrie Destruído",
  encroached_gephenia: "Gephenia Invadida",
};

const DEPRECATED_RACE_GROUPS = new Set(["guardian", "battlefield"]);

/** As mesmas 42 chaves de `racegroup_*` (`mob_db_re.sql:34-75`). */
export const MONSTER_RACE_GROUPS: readonly string[] = Object.keys(RACE_GROUP_LABELS);

export const MONSTER_RACE_GROUP_OPTIONS: MonsterModeOption[] = MONSTER_RACE_GROUPS.map((g) => ({
  value: g,
  label: RACE_GROUP_LABELS[g]!,
  description: `RC2_${g.toUpperCase()}`,
  deprecated: DEPRECATED_RACE_GROUPS.has(g),
}));
