/**
 * Nome de classe por id, só para a UI (seleção de personagem, alvo, ficha).
 *
 * Fonte: o enum `e_job` de `rathena/src/common/mmo.hpp` — os ids saem de lá,
 * um a um, e não de memória. A tabela anterior tinha sido escrita "de cabeça" e
 * estava deslocada da classe 4001 em diante: um Arcano (4055) aparecia como
 * "Cavaleiro Rúnico Montado", e o jogador jurava que o jogo trocava a classe
 * dele. Classe é dado do SERVIDOR; aqui só se traduz o número.
 *
 * O que não estiver aqui cai no fallback "classe <id>" — melhor um número
 * honesto que um nome errado.
 */
export const JOB_NAMES: Record<number, string> = {
  // primeira classe e 2-1/2-2
  0: "Aprendiz",
  1: "Espadachim",
  2: "Mago",
  3: "Arqueiro",
  4: "Noviço",
  5: "Mercador",
  6: "Gatuno",
  7: "Cavaleiro",
  8: "Sacerdote",
  9: "Bruxo",
  10: "Ferreiro",
  11: "Caçador",
  12: "Mercenário",
  13: "Cavaleiro Montado",
  14: "Templário",
  15: "Monge",
  16: "Sábio",
  17: "Arruaceiro",
  18: "Alquimista",
  19: "Bardo",
  20: "Odalisca",
  21: "Templário Montado",
  22: "Casado",
  23: "Superaprendiz",
  24: "Justiceiro",
  25: "Ninja",

  // transclasse (JOB_*_HIGH e 2-1/2-2 transcendidas)
  4001: "Aprendiz Alto",
  4002: "Espadachim Alto",
  4003: "Mago Alto",
  4004: "Arqueiro Alto",
  4005: "Noviço Alto",
  4006: "Mercador Alto",
  4007: "Gatuno Alto",
  4008: "Lorde",
  4009: "Sumo Sacerdote",
  4010: "Arquimago",
  4011: "Mestre Ferreiro",
  4012: "Atirador de Elite",
  4013: "Algoz",
  4014: "Lorde Montado",
  4015: "Paladino",
  4016: "Mestre",
  4017: "Professor",
  4018: "Estripador",
  4019: "Criador",
  4020: "Menestrel",
  4021: "Cigana",
  4022: "Paladino Montado",
  4023: "Aprendiz (Bebê)",

  // terceira classe
  4054: "Cavaleiro Rúnico",
  4055: "Arcano",
  4056: "Sentinela",
  4057: "Arcebispo",
  4058: "Mecânico",
  4059: "Sicário",
  4060: "Cavaleiro Rúnico T",
  4061: "Arcano T",
  4062: "Sentinela T",
  4063: "Arcebispo T",
  4064: "Mecânico T",
  4065: "Sicário T",
  4066: "Guardião Real",
  4067: "Feiticeiro",
  4068: "Trovador",
  4069: "Musa",
  4070: "Shura",
  4071: "Geneticista",
  4072: "Renegado",
  4073: "Guardião Real T",
  4074: "Feiticeiro T",
  4075: "Trovador T",
  4076: "Musa T",
  4077: "Shura T",
  4078: "Geneticista T",
  4079: "Renegado T",

  // montarias das terceiras (o servidor troca o id ao montar)
  4080: "Cavaleiro Rúnico Montado",
  4081: "Cavaleiro Rúnico T Montado",
  4082: "Guardião Real Montado",
  4083: "Guardião Real T Montado",
  4084: "Sentinela (Warg)",
  4085: "Sentinela T (Warg)",
  4086: "Mecânico (Magnum)",
  4087: "Mecânico T (Magnum)",

  // classes expandidas
  4190: "Superaprendiz Expandido",
  4211: "Kagerou",
  4212: "Oboro",
  4215: "Renegado das Armas",
  4218: "Doram",
};
