/**
 * varID dos pacotes de status → nome legível.
 *
 * O rAthena manda "o parâmetro 5 virou 40" e cabe ao cliente saber que 5 é HP.
 * Os números saem do enum `_sp` em rathena/src/map/map.hpp:499-560 — não são
 * uma convenção nossa, então nada de renumerar por conta própria.
 *
 * O que não está aqui vai para o cliente como `sp_<id>`: preferimos um nome feio
 * a jogar fora um parâmetro que o servidor considerou importante.
 */
export const STAT_NAMES: Record<number, string> = {
	0: "speed",
	1: "baseExp",
	2: "jobExp",
	3: "karma",
	4: "manner",
	5: "hp",
	6: "maxHp",
	7: "sp",
	8: "maxSp",
	9: "statusPoint",
	11: "baseLevel",
	12: "skillPoint",
	13: "str",
	14: "agi",
	15: "vit",
	16: "int",
	17: "dex",
	18: "luk",
	19: "class",
	20: "zeny",
	21: "sex",
	22: "nextBaseExp",
	23: "nextJobExp",
	24: "weight",
	25: "maxWeight",
	// custo em pontos para subir mais 1 no atributo (o "+" da janela de status)
	32: "upStr",
	33: "upAgi",
	34: "upVit",
	35: "upInt",
	36: "upDex",
	37: "upLuk",
	41: "atk", // SP_ATK1 = pc_leftside_atk — base (clif.cpp:3696)
	// SP_ATK2/DEF2/MDEF2 = pc_rightside_* (clif.cpp:3705-3719) — a mesma
	// divisão base/bônus do pacote COUPLESTATUS (0xbd, `pushStat` com `bonus`),
	// só que mandada como PAR_CHANGE incremental separado — ex.: ao equipar
	// arma, só o ATK2 muda, o ATK1 (base) nem chega. Nomear como o campo
	// `*Bonus` de verdade (não "atk2"/"def2"/"mdef2", que não batem com nada
	// em `ServerStats` e eram descartados em silêncio por
	// `playerStore.applyStat`) é o que faz o indicador de equipar/desequipar
	// atualizar sozinho, sem esperar o snapshot completo do login.
	42: "atkBonus",
	43: "matkMax",
	44: "matkMin",
	45: "def",
	46: "defBonus",
	47: "mdef",
	48: "mdefBonus",
	49: "hit",
	50: "flee",
	// FLEE2 NÃO é bônus de FLEE1 — é "Perfect Dodge", um stat próprio
	// (clif.cpp:3672, `battle_status.flee2/10`). Campo dedicado em
	// `ServerStats.perfectDodge` (achado auditando o indicador de status —
	// antes disto caía errado dentro de "fleeBonus").
	51: "perfectDodge",
	52: "critical",
	53: "aspd",
	55: "jobLevel",
	// 4ª classe (só chegam em servidor com essas classes ligadas)
	219: "pow",
	220: "sta",
	221: "wis",
	222: "spl",
	223: "con",
	224: "crt",
	231: "traitPoint",
	232: "ap",
	233: "maxAp",
};

export function statName(varId: number): string {
	return STAT_NAMES[varId] ?? `sp_${varId}`;
}
