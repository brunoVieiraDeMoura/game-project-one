import { create } from "zustand";
import type { ServerStats } from "./playerStore";

/**
 * Indicador temporário "ATK 120 ↑ +20" ao lado do status afetado, por ~10s
 * depois de equipar/desequipar.
 *
 * O delta é sempre `after - before` entre dois snapshots AUTORITATIVOS do
 * `playerStore.stats` (`net/equipmentStore.beginStatusWatch`/
 * `settleStatusWatch`) — nunca `item.atk` somado à mão. O valor comparado é o
 * MESMO que a `StatusWindow` já mostra (base + bônus do equipamento), porque
 * é isso que o jogador lê como "ATK": mostrar o delta de um número que a tela
 * não exibe seria confuso.
 */
export interface StatusDeltaField {
  key: string;
  label: string;
  value: (s: ServerStats) => number;
}

export const STATUS_DELTA_FIELDS: StatusDeltaField[] = [
  { key: "atk", label: "ATK", value: (s) => s.atk + s.atkBonus },
  { key: "def", label: "DEF", value: (s) => s.def + s.defBonus },
  { key: "mdef", label: "MDEF", value: (s) => s.mdef + s.mdefBonus },
  // matkMin(base) + matkMax(bônus) — mesmo padrão de atk/def, não um
  // intervalo (ver comentário em `playerStore.ServerStats.matkMin`).
  { key: "matk", label: "MATK", value: (s) => s.matkMin + s.matkMax },
  { key: "hit", label: "Precisão", value: (s) => s.hit },
  // `flee` já é o TOTAL — sem `+fleeBonus` (esse campo nem existe mais; era
  // Perfect Dodge mal-rotulado, ver `perfectDodge` abaixo).
  { key: "flee", label: "Esquiva", value: (s) => s.flee },
  { key: "perfectDodge", label: "Perfect Dodge", value: (s) => s.perfectDodge },
  { key: "critical", label: "Crítico", value: (s) => s.critical },
  // Formato do VALOR EXIBIDO, não do interno: `aspd` menor = mais rápido, e
  // a tela mostra `200 - aspd/10` (maior = melhor). Calculando o delta em
  // cima do número que a tela mostra, "melhorou" sempre vira ↑ — sem
  // inverter sinal em lugar nenhum depois.
  // arredondado a 2 casas: `aspd/10` pode gerar dízima de float (21.3-19.7
  // vira 1.5999999999999996 em JS), e a tela mostra só 2 casas mesmo.
  { key: "aspd", label: "Vel. Ataque", value: (s) => Math.round((200 - s.aspd / 10) * 100) / 100 },
  { key: "maxHp", label: "HP", value: (s) => s.maxHp },
  { key: "maxSp", label: "SP", value: (s) => s.maxSp },
  { key: "str", label: "Força", value: (s) => s.str + s.strBonus },
  { key: "agi", label: "Agilidade", value: (s) => s.agi + s.agiBonus },
  { key: "vit", label: "Vitalidade", value: (s) => s.vit + s.vitBonus },
  { key: "int", label: "Inteligência", value: (s) => s.int + s.intBonus },
  { key: "dex", label: "Destreza", value: (s) => s.dex + s.dexBonus },
  { key: "luk", label: "Sorte", value: (s) => s.luk + s.lukBonus },
];

/** só os campos que REALMENTE mudaram — `+0` não é delta, é ruído */
export function diffStats(before: ServerStats, after: ServerStats): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of STATUS_DELTA_FIELDS) {
    const d = f.value(after) - f.value(before);
    if (d !== 0) out[f.key] = d;
  }
  return out;
}

const DURATION_MS = 10_000;
let timer: ReturnType<typeof setTimeout> | undefined;

interface StatusDeltaState {
  deltas: Record<string, number>;
  show: (deltas: Record<string, number>) => void;
  clear: () => void;
}

export const useStatusDelta = create<StatusDeltaState>((set) => ({
  deltas: {},

  // Uma troca nova durante o timer da anterior REINICIA — não soma, não
  // empilha. `deltas` é sempre "o que mudou na ÚLTIMA operação", como o
  // pedido descreve ("atualizar/reiniciar de forma consistente").
  show: (deltas) => {
    if (timer) clearTimeout(timer);
    set({ deltas });
    timer = setTimeout(() => useStatusDelta.setState({ deltas: {} }), DURATION_MS);
  },

  clear: () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    set({ deltas: {} });
  },
}));
