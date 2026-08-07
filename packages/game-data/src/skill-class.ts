/**
 * Prefixo do nome aegis → classe que ensina a habilidade.
 *
 * Promovido de `apps/game/src/ui/skills.ts` (que reexporta os mesmos nomes)
 * pra `apps/admin` poder filtrar por classe sem duplicar a tabela.
 *
 * De onde vem: o ZC.SKILLINFO_LIST manda a CONSTANTE do rAthena ("MG_FIREBOLT",
 * "WZ_STORMGUST"), e nela o prefixo é o código da classe. É o que dá as abas da
 * janela de habilidades do jogo ("Noviço | Mago | Wizard | High Wizard") sem
 * precisar de uma árvore de classes que o cliente não tem: as abas são as
 * classes que APARECEM nas habilidades que o personagem realmente possui.
 *
 * A ORDEM aqui é a ordem das abas — progressão de classe. Prefixo fora da
 * tabela não é adivinhado: vira o próprio prefixo e vai para o fim (ver
 * `classeDaSkill`). Preferi a lacuna a um nome errado, regra que já vale para
 * `character/jobNames`.
 *
 * `tier` marca só os prefixos de 3ª/4ª classe e das linhas "expandidas"
 * (mercenário, homúnculo, elemental, NPC, cash shop...) — é o que alimenta os
 * três buckets de atalho do filtro da dashboard ("Terceiras Classes", "Quarta
 * Classe", "Expandida"). 1ª, 2ª e transcendente não levam `tier`: cada uma já
 * é seu próprio item na lista de filtro, individual.
 */
export interface SkillClassEntry {
  prefix: string;
  label: string;
  grupo?: string;
  tier?: "terceira" | "quarta" | "expandida";
}

export const SK_CLASS_BY_PREFIX: SkillClassEntry[] = [
  // Ataque Básico (id -1, cliente): não vem do rAthena, então não tem
  // constante aegis nenhuma. Primeira fita de propósito — é a skill que já
  // nasce no slot 1 da barra.
  { prefix: "BASIC", label: "Básica" },
  // Noviço (NV_) e as comuns a todas as classes (ALL_) entram na MESMA fita do
  // Ataque Básico (`grupo: "BASIC"`, junto do prefixo sintético acima): são as
  // habilidades que todo personagem tem antes de escolher classe.
  { prefix: "NV", label: "Básica", grupo: "BASIC" },
  { prefix: "ALL", label: "Básica", grupo: "BASIC" },
  // primeira classe
  { prefix: "SM", label: "Espadachim" },
  { prefix: "MG", label: "Mago" },
  { prefix: "AC", label: "Arqueiro" },
  { prefix: "AL", label: "Noviço Acólito" },
  { prefix: "MC", label: "Mercador" },
  { prefix: "TF", label: "Gatuno" },
  { prefix: "TK", label: "Taekwon" },
  { prefix: "NJ", label: "Ninja" },
  { prefix: "GS", label: "Justiceiro" },
  { prefix: "SU", label: "Doram" },
  // segunda classe
  { prefix: "KN", label: "Cavaleiro" },
  { prefix: "PR", label: "Sacerdote" },
  { prefix: "WZ", label: "Bruxo" },
  { prefix: "BS", label: "Ferreiro" },
  { prefix: "HT", label: "Caçador" },
  { prefix: "AS", label: "Mercenário" },
  { prefix: "CR", label: "Templário" },
  { prefix: "MO", label: "Monge" },
  { prefix: "SA", label: "Sábio" },
  { prefix: "RG", label: "Arruaceiro" },
  { prefix: "AM", label: "Alquimista" },
  { prefix: "BA", label: "Bardo" },
  { prefix: "DC", label: "Odalisca" },
  { prefix: "BD", label: "Dueto" },
  { prefix: "SG", label: "Astro" },
  { prefix: "SL", label: "Espiritualista" },
  // transcendentes
  { prefix: "LK", label: "Lorde" },
  { prefix: "HP", label: "Sumo Sacerdote" },
  { prefix: "HW", label: "Arquimago" },
  { prefix: "WS", label: "Mestre Ferreiro" },
  { prefix: "SN", label: "Atirador de Elite" },
  { prefix: "ASC", label: "Algoz" },
  { prefix: "PA", label: "Paladino" },
  { prefix: "CH", label: "Mestre" },
  { prefix: "PF", label: "Professor" },
  { prefix: "ST", label: "Estalajadeiro" },
  { prefix: "CG", label: "Menestrel" },
  // terceira classe
  { prefix: "RK", label: "Cavaleiro Rúnico", tier: "terceira" },
  { prefix: "GC", label: "Sicário", tier: "terceira" },
  { prefix: "AB", label: "Arcebispo", tier: "terceira" },
  { prefix: "WL", label: "Arcano", tier: "terceira" },
  { prefix: "RA", label: "Ranger", tier: "terceira" },
  { prefix: "NC", label: "Mecânico", tier: "terceira" },
  { prefix: "LG", label: "Guardião Real", tier: "terceira" },
  { prefix: "SR", label: "Shura", tier: "terceira" },
  { prefix: "SC", label: "Renegado", tier: "terceira" },
  { prefix: "WM", label: "Trovador", tier: "terceira" },
  { prefix: "SO", label: "Feiticeiro", tier: "terceira" },
  { prefix: "GN", label: "Geneticista", tier: "terceira" },
  { prefix: "KO", label: "Kagerou", tier: "terceira" },
  { prefix: "RL", label: "Rebelde", tier: "terceira" },
  { prefix: "SJ", label: "Imperador Estelar", tier: "terceira" },
  { prefix: "SP", label: "Ceifador de Almas", tier: "terceira" },
  // quarta classe
  { prefix: "DK", label: "Cavaleiro Dragão", tier: "quarta" },
  { prefix: "IG", label: "Guarda Imperial", tier: "quarta" },
  { prefix: "SHC", label: "Shadow Cross", tier: "quarta" },
  { prefix: "ABC", label: "Abyss Chaser", tier: "quarta" },
  { prefix: "WH", label: "Windhawk", tier: "quarta" },
  { prefix: "BO", label: "Biolo", tier: "quarta" },
  { prefix: "TR", label: "Trouvère", tier: "quarta" },
  { prefix: "EM", label: "Mestre Elemental", tier: "quarta" },
  { prefix: "CD", label: "Cardeal", tier: "quarta" },
  { prefix: "IQ", label: "Inquisidor", tier: "quarta" },
  { prefix: "MT", label: "Meister", tier: "quarta" },
  { prefix: "AG", label: "Arquimago (4ª)", tier: "quarta" },
  { prefix: "SS", label: "Shinkiro/Shiranui", tier: "quarta" },
  { prefix: "SKE", label: "Imperador Celeste", tier: "quarta" },
  { prefix: "SOA", label: "Asceta das Almas", tier: "quarta" },
  { prefix: "NW", label: "Sentinela Noturna", tier: "quarta" },
  { prefix: "HN", label: "Hyper Novice", tier: "quarta" },
  { prefix: "SH", label: "Domador de Espíritos", tier: "quarta" },
  { prefix: "ABR", label: "Robô (Meister)", tier: "quarta" },
  // expandida: linhas fora da progressão numérica 1ª→2ª→3ª→4ª
  { prefix: "WE", label: "Casamento", tier: "expandida" },
  { prefix: "GD", label: "Guilda", tier: "expandida" },
  { prefix: "MER", label: "Mercenário (unidade)", tier: "expandida" },
  { prefix: "MA", label: "Mercenário (unidade)", grupo: "MER", tier: "expandida" },
  { prefix: "MS", label: "Mercenário (unidade)", grupo: "MER", tier: "expandida" },
  { prefix: "ML", label: "Mercenário (unidade)", grupo: "MER", tier: "expandida" },
  { prefix: "HLIF", label: "Homúnculo", tier: "expandida" },
  { prefix: "HAMI", label: "Homúnculo", grupo: "HLIF", tier: "expandida" },
  { prefix: "HFLI", label: "Homúnculo", grupo: "HLIF", tier: "expandida" },
  { prefix: "HVAN", label: "Homúnculo", grupo: "HLIF", tier: "expandida" },
  { prefix: "MH", label: "Homúnculo S", tier: "expandida" },
  { prefix: "EL", label: "Elemental", tier: "expandida" },
  { prefix: "NPC", label: "Monstro/NPC", tier: "expandida" },
  { prefix: "KG", label: "Kagerou", grupo: "KG_OB", tier: "expandida" },
  { prefix: "OB", label: "Oboro", grupo: "KG_OB", tier: "expandida" },
  { prefix: "WA", label: "Wanderer", tier: "expandida" },
  { prefix: "MI", label: "Minstrel", tier: "expandida" },
  { prefix: "CASH", label: "Cash Shop", tier: "expandida" },
  { prefix: "ECL", label: "Eclage", grupo: "ECL", tier: "expandida" },
  { prefix: "ECLAGE", label: "Eclage", grupo: "ECL", tier: "expandida" },
  { prefix: "ITM", label: "Item", grupo: "ITM", tier: "expandida" },
  { prefix: "ITEM", label: "Item", grupo: "ITM", tier: "expandida" },
  { prefix: "GM", label: "GM", tier: "expandida" },
  { prefix: "RETURN", label: "Teleporte", tier: "expandida" },
];

/**
 * Classe de uma habilidade a partir da constante do servidor.
 *
 * O prefixo é o que vem antes do PRIMEIRO "_", e a busca tem que ser por
 * igualdade e não por "começa com": `AL_HEAL` é do Acólito e `ALL_RESURRECTION`
 * é comum a todos — casar por prefixo solto trocaria uma pela outra.
 */
export function prefixOf(aegisName: string): string {
  const corte = aegisName.indexOf("_");
  return corte > 0 ? aegisName.slice(0, corte) : aegisName;
}

export function classeDaSkill(aegisName: string): { key: string; label: string; ordem: number } {
  const prefix = prefixOf(aegisName);
  const i = SK_CLASS_BY_PREFIX.findIndex((c) => c.prefix === prefix);
  const achado = i < 0 ? undefined : SK_CLASS_BY_PREFIX[i];
  if (!achado) return { key: prefix, label: prefix, ordem: SK_CLASS_BY_PREFIX.length };
  // `grupo` junta prefixos numa fita só (NV_ + ALL_ = Básica, com o Ataque
  // Básico); sem ele, cada prefixo é a própria fita. A ORDEM é a da primeira
  // ocorrência do grupo, para a fita não pular de lugar conforme a skill que
  // o personagem tiver.
  const key = achado.grupo ?? prefix;
  const ordem = achado.grupo ? SK_CLASS_BY_PREFIX.findIndex((c) => c.grupo === achado.grupo) : i;
  return { key, label: achado.label, ordem };
}

/**
 * Opções do filtro multi-seleção da dashboard: uma por classe individual
 * (1ª/2ª/transcendente, deduplicadas por `grupo`) mais três buckets de
 * atalho — "Terceiras Classes", "Quarta Classe" e "Expandida" — que marcam
 * de uma vez todos os prefixos daquele tier. Cada opção carrega a lista de
 * prefixos que ela representa; o filtro em si sempre viaja como lista de
 * PREFIXOS crus pro servidor (nunca o rótulo do tier).
 */
export interface SkillClassFilterOption {
  value: string;
  label: string;
  prefixes: string[];
}

export function skillClassFilterOptions(): SkillClassFilterOption[] {
  const individual: SkillClassFilterOption[] = [];
  const seenGroups = new Set<string>();
  for (const entry of SK_CLASS_BY_PREFIX) {
    if (entry.tier) continue; // 3ª/4ª/expandida entram só pelo bucket, não individualmente
    const key = entry.grupo ?? entry.prefix;
    if (seenGroups.has(key)) continue;
    seenGroups.add(key);
    const prefixes = entry.grupo
      ? SK_CLASS_BY_PREFIX.filter((c) => c.grupo === entry.grupo).map((c) => c.prefix)
      : [entry.prefix];
    individual.push({ value: key, label: entry.label, prefixes });
  }

  const buckets: SkillClassFilterOption[] = (
    [
      ["terceira", "Terceiras Classes"],
      ["quarta", "Quarta Classe"],
      ["expandida", "Expandida"],
    ] as const
  ).map(([tier, label]) => ({
    value: tier,
    label,
    prefixes: SK_CLASS_BY_PREFIX.filter((c) => c.tier === tier).map((c) => c.prefix),
  }));

  return [...individual, ...buckets];
}
