import type { CharacterKey, WeaponFamily, WeaponMount } from "../assets";

/**
 * Classe (rAthena `e_job`) → personagem + arma + família de animação.
 *
 * Mapeamento CENTRALIZADO: uma classe nova na MESMA linhagem só precisa
 * entrar no `Set` de ids certo abaixo — herda personagem/arma/animação sem
 * tocar em `NetPlayer`, `NetEntity`, `Player` ou `CharacterPortrait`, que só
 * chamam `classModelFor(jobId)`.
 *
 * Auditoria dos 3 diretórios de assets (2026-08-10, ampliada 2026-08-11 com
 * `Ranger`), tudo em `assets-new/Characters/{Characters,Assets}/gltf` e
 * `KayKit_Character_Animations_1.1/.../Rig_Medium`:
 *
 *  - Todo personagem do kit (`Knight`, `Mage`, `Rogue`, `Rogue_Hooded`,
 *    `Barbarian`, `Ranger`, `Skeleton_*`) usa o MESMO rig — `Rig_Medium`, 23
 *    joints — e tem os mesmos dois nós de encaixe de arma (`handslot.l`/
 *    `handslot.r` no .glb; `handslotl`/`handslotr` em runtime, ver
 *    `assets.HandSlot`) (conferido por inspeção binária direta do glTF em
 *    cada .glb — meshes/skins/joints/animations/materials/images e nomes de
 *    nó, sem lib nem escrita). Por isso o mesmo conjunto de clips e o mesmo
 *    attach point servem qualquer combinação.
 *  - `Ranger` (`assets-new/Characters/Characters/gltf/Ranger.glb`) é o
 *    personagem de arqueiro DEDICADO do kit — mesma auditoria confirmou rig
 *    idêntico ao resto (23 joints, mesmos handslots nos dois lados, textura
 *    embutida) mais uma malha própria (`Ranger_Quiver`, carcaz nas costas)
 *    que nenhum outro personagem tem. Antes desta fase, `archer` usava
 *    `Rogue` (visual de ladrão) com o arco rotacionado por cima — funcionava
 *    tecnicamente mas era o personagem errado reaproveitado. Copiado para
 *    `public/assets/characters/Ranger.glb` e ligado em `assets.
 *    CHARACTER_URLS.ranger` nesta fase ("Modelo por classe de jogador");
 *    troca por compatibilidade de rig comprovada, não por preferência
 *    estética (regra do pedido).
 *  - As armas (`Characters/Assets/gltf/*.gltf`) são malha única sem
 *    esqueleto, com a origem no punho (bbox mínimo perto de y=0) — servem
 *    para virar filho direto do handslot sem offset (ver `EquippedWeapons`).
 *    EXCETO o arco: `bow_withString` é comprido no eixo Z (limbo a limbo),
 *    não no Y do resto do kit — sem o `rotation` em `WeaponMount` ele fica
 *    deitado, quase de fio (foi visto assim no char-select: "parece uma
 *    flecha"). `arrow_bow.gltf` (nome enganoso) é só a FLECHA sozinha, sem
 *    arco nenhum — não usar.
 *  - `Rogue_Hooded` e `Rogue` têm handslot NOS DOIS lados — dual wield real
 *    (duas dagas), não uma aproximação.
 */

const CLASS_MODEL: Record<WeaponFamily, { character: CharacterKey; weapons: WeaponMount[]; scale?: number }> = {
  // Teste isolado do Espadachim com rig Mixamo (leia1.txt) foi revertido a
  // pedido do usuário — volta pro `knight` do KayKit (`Rig_Medium`), arma no
  // `handslotr`, sem `scale` extra (default 1). O acervo `knight_mixamo`
  // (`assets.ts`, `scripts/prep-knight-mixamo.mjs`) fica no repo pra retomar
  // depois, só não está mais ligado aqui.
  swordsman: { character: "knight", weapons: [{ weapon: "sword_2handed", slot: "handslotr" }] },
  thief: {
    character: "rogue_hooded",
    weapons: [
      { weapon: "dagger", slot: "handslotl" },
      { weapon: "dagger", slot: "handslotr" },
    ],
  },
  mage: { character: "mage", weapons: [{ weapon: "staff", slot: "handslotr" }] },
  // `ranger`, não `rogue` (troca feita nesta fase, ver auditoria abaixo):
  // rotação do arco (rotX 90° + flipY 180°) vem do picker visual
  // (`/class-preview`, testada sobre `rogue`) e se mantém porque `ranger`
  // usa o MESMO rig/bind pose (`Rig_Medium`, mesmos handslots, conferido por
  // inspeção binária do .glb) — o osso da mão tem a mesma orientação local
  // nos dois personagens, então o mesmo ajuste de pose vale sem recalibrar.
  archer: {
    character: "ranger",
    weapons: [{ weapon: "bow", slot: "handslotl", rotation: [Math.PI / 2, Math.PI, 0] }],
  },
  other: { character: "barbarian", weapons: [] },
};

export interface ClassModel {
  character: CharacterKey;
  family: WeaponFamily;
  weapons: WeaponMount[];
  /** multiplicador em cima do `charScale` global — default 1 (ver `CLASS_MODEL`) */
  scale: number;
}

/**
 * ids de `e_job` (rAthena) por linhagem — extraído de
 * `tools/legacy-migration/output/job-classes.json` (175 entradas, árvore
 * renewal completa). Baby/transcendente/2ª forma (`*2`) entram junto: são a
 * MESMA classe visual, só stats diferentes.
 */
const SWORDSMAN_IDS = new Set([
  1, 7, 13, 14, 21, 4002, 4008, 4014, 4015, 4022, 4054, 4080, 4060, 4081, 4066, 4082, 4073, 4083, 4252, 4280, 4258,
  4281, 4024, 4030, 4036, 4037, 4044, 4096, 4109, 4102, 4110,
]);

const THIEF_IDS = new Set([
  6, 12, 4007, 4013, 17, 4018, 4059, 4065, 4072, 4079, 4254, 4029, 4035, 4040, 4101, 4108,
  // Abyss_Chaser (4260) — 4º job do Rogue (17), que já está nesta linhagem;
  // faltava por ser um id "solto" (não segue o padrão *_T/*2 do resto da
  // lista) — encontrado auditando `parentClassId` de TODO job contra os ids
  // já classificados (fecho transitivo, não achado por inspeção visual).
  4260,
  // Ninja/Kagerou/Oboro (id 25, `tools/legacy-migration/output/job-classes.json`)
  // — sem asset próprio (leque/kunai não existem no acervo), mas é a
  // linhagem mais próxima visualmente das 4 que já têm modelo: ágil,
  // dual-wield-like, mesma família de animação de combate corpo a corpo
  // rápido do Rogue_Hooded. Fase "Modelo por classe de jogador".
  25, 4211, 4212, 4222, 4223, 4224,
  // Shinkiro/Shiranui (4304/4305) — 4º job de Kagerou/Oboro, mesmo motivo do
  // Abyss_Chaser acima: achado só no fecho transitivo, não no primeiro corte.
  4304, 4305,
]);

const MAGE_IDS = new Set([
  2, 9, 4003, 4010, 16, 4017, 4055, 4061, 4067, 4074, 4255, 4261, 4025, 4032, 4039, 4097, 4103,
  // Acolyte/Priest/Arch_Bishop (id 4/8, `job-classes.json`) — cajado/bordão
  // é o equipamento clássico dessa linhagem no Ragnarok real (não confirmado
  // pelo `allowedWeapons` do catálogo migrado, que é stub vazio — achado A10/
  // A11 já documentado — então isto é conhecimento do jogo, não dado
  // migrado), então compartilhar o family `mage` (Mage + staff) é a arma
  // mais coerente entre as 4 que já existem no acervo. NÃO inclui
  // Monk/Champion/Sura (mesma raiz `Acolyte`, id 15/4016/4070/4077): esses
  // lutam DESARMADOS de verdade no jogo real — ficam no fallback `other`
  // (Barbarian sem arma) de propósito, porque "sem arma" já é a resposta
  // visual CORRETA pra eles, não uma lacuna. Fase "Modelo por classe de
  // jogador".
  4, 8, 4005, 4009, 4027, 4031, 4057, 4063, 4099,
  // Cardinal (4256) — 4º job do Priest (8), que já está nesta linhagem;
  // mesmo caso do Abyss_Chaser acima: achado só no fecho transitivo sobre
  // `parentClassId`, não no primeiro corte manual. Monk continua fora
  // mesmo tendo a mesma raiz Acolyte — exclusão intencional, não esquecida.
  4256,
]);

/** arqueiro/hunter/sniper/ranger e evoluções — pedido explícito do usuário */
const ARCHER_IDS = new Set([
  3, 11, 4004, 4012, 19, 20, 4020, 4021, 4068, 4069, 4056, 4084, 4062, 4085, 4257, 4278, 4263, 4264, 4026, 4034, 4042,
  4043, 4098, 4111, 4104, 4105,
  // Minstrel_T/Wanderer_T (4075/4076) — forma transcendente de Bard(19)/
  // Dancer(20), que já estão nesta linhagem; faltavam por não seguirem o
  // padrão `*2`/`4xxx+id-base` do resto — achado pelo mesmo fecho
  // transitivo sobre `parentClassId` que revelou Abyss_Chaser/Cardinal.
  4075, 4076,
]);

/**
 * Tudo que não está nas 4 linhagens acima cai no fallback: Barbarian, sem
 * arma. Cada grupo abaixo foi CONFERIDO contra `job-classes.json`
 * (`parentClassId`/nome), não é "resto" por preguiça — é fallback
 * intencional, com o motivo registrado (regra "não force uma combinação que
 * não existe no mapeamento", Fase "Modelo por classe de jogador"):
 *
 *  - **Monk/Champion/Sura** (raiz `Acolyte`, id 15/4016/4070/4077 + baby):
 *    lutam DESARMADOS de verdade no jogo real — "sem arma" já É a resposta
 *    visual certa, não uma lacuna.
 *  - **Merchant/Blacksmith/Alchemist/Creator/Genetic/Mechanic** (machado/
 *    maça/cajado mecânico): nenhuma arma desse tipo existe no acervo
 *    (`WEAPON_URLS` só tem espada 2M/adaga/cajado/arco) — forçar espada de
 *    Cavaleiro num Ferreiro seria a combinação forçada que a regra proíbe.
 *  - **Gunslinger/Rebellion** (arma de fogo): mesma razão — nenhuma pistola/
 *    espingarda no acervo; usar o arco do arqueiro pareceria errado (arma
 *    trocada), pior que ficar sem arma.
 *  - **Taekwon/Star_Gladiator/Soul_Linker/Gangsi** (marcial/exótico): igual
 *    Monk, majoritariamente desarmado no jogo real.
 *  - **Novice/Super_Novice/Novice_High/Super_Novice_E/Hyper_Novice**: sem
 *    arma "de assinatura" no Ragnarok real — desarmado é o esperado.
 *  - **Summoner/Baby_Summoner** (raça Doram): playstyle exótico demais pra
 *    encaixar com segurança numa das 4 famílias existentes sem estar
 *    inventando — deixado de fora de propósito, não decidido no escuro.
 *  - **Classes expandidas de 4º job sem linhagem clássica nas 4 famílias**
 *    (Star_Emperor, Soul_Reaper, Meister [raiz Blacksmith, fallback junto],
 *    Biolo, Inquisitor [raiz Monk, fallback junto], Night_Watch,
 *    Spirit_Handler, Sky_Emperor, Soul_Ascetic, Death_Knight,
 *    Dark_Collector...): `parentClassId` delas é nulo/ausente OU aponta pra
 *    uma raiz que já é fallback (Merchant/Monk/etc.) — sem sinal confiável
 *    pra herdar família de nenhuma das 4. Conferido por FECHO TRANSITIVO
 *    (não só inspeção manual): todo job cujo `parentClassId` caía num dos 4
 *    `Set`s foi adicionado automaticamente — é assim que Abyss_Chaser,
 *    Cardinal, Shinkiro/Shiranui e Minstrel_T/Wanderer_T entraram nos sets
 *    acima nesta rodada, mesmo sem estar na lista original manual.
 */
export function weaponFamilyFor(jobId: number | undefined | null): WeaponFamily {
  if (jobId == null) return "other";
  if (SWORDSMAN_IDS.has(jobId)) return "swordsman";
  if (THIEF_IDS.has(jobId)) return "thief";
  if (MAGE_IDS.has(jobId)) return "mage";
  if (ARCHER_IDS.has(jobId)) return "archer";
  return "other";
}

export function classModelFor(jobId: number | undefined | null): ClassModel {
  const family = weaponFamilyFor(jobId);
  const model = CLASS_MODEL[family];
  return { family, ...model, scale: model.scale ?? 1 };
}

/**
 * Espadachim OU alguma evolução da linhagem dele (Knight, Crusader, Lord
 * Knight, Paladin, Rune Knight, Royal Guard, Dragon Knight, Imperial Guard,
 * baby/high-novice/transcendente de todas essas) — não só o job base.
 *
 * Reusa `SWORDSMAN_IDS` (via `weaponFamilyFor`) de propósito: é a MESMA
 * árvore, já fechada transitivamente contra `job-classes.json`, que decide o
 * modelo visual. Áudio de combate (`audio/combatVoice`, `audio/combatWeapon`)
 * usa esta função como o único portão de classe — nunca `jobId === 1`
 * (perderia as evoluções) nem o nome exibido na UI (frágil a
 * localização/typo).
 */
export function isSwordmanClass(jobId: number | undefined | null): boolean {
  return weaponFamilyFor(jobId) === "swordsman";
}

/**
 * Arqueiro (Archer) e evoluções (Hunter, Sniper, Ranger, transcendentes/baby)
 * — mesmo espírito de `isSwordmanClass`: reusa `ARCHER_IDS` via
 * `weaponFamilyFor`, nunca uma lista de ids paralela.
 */
export function isArcherClass(jobId: number | undefined | null): boolean {
  return weaponFamilyFor(jobId) === "archer";
}

/**
 * Mage e evoluções (Wizard, High Wizard, Warlock, transcendentes/baby) — MESMA
 * família (`MAGE_IDS`) que também cobre Acolyte/Priest/Arch_Bishop/Cardinal
 * (cajado compartilhado, ver comentário de `MAGE_IDS`). Áudio de combate do
 * Mago (`audio/combatVoice`, `audio/mage/multiHitCastAudio`) usa este portão, mesmo
 * espírito de `isSwordmanClass`/`isArcherClass`.
 */
export function isMageClass(jobId: number | undefined | null): boolean {
  return weaponFamilyFor(jobId) === "mage";
}
