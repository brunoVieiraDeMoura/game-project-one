import { create } from "zustand";

/**
 * Notificações do sino (ui-change.txt).
 *
 * Ainda NÃO há origem de verdade: o gateway não emite convite de amizade nem
 * venda na feira. As duas linhas abaixo são o exemplo pedido no change, e estão
 * marcadas para ninguém confundir com dado do servidor. Quando o gateway
 * ganhar esses eventos, é só trocar o estado inicial por um `add()` chamado de
 * `useWorldEvents` — o resto da tela não muda.
 */
export interface Notificacao {
  id: number;
  titulo: string;
  texto: string;
  /** hora em que chegou, já formatada (é só para leitura) */
  quando: string;
}

interface NotificationState {
  itens: Notificacao[];
  aberto: boolean;
  abrir: (v: boolean) => void;
  add: (n: Omit<Notificacao, "id">) => void;
  remover: (id: number) => void;
  limpar: () => void;
}

/** MOCK — ver o comentário do módulo */
const EXEMPLOS: Notificacao[] = [
  {
    id: 1,
    titulo: "Pedido de amizade",
    texto: "Aurelia quer te adicionar como amigo.",
    quando: "agora",
  },
  {
    id: 2,
    titulo: "Feira de Vendas",
    texto: "Sua Espada Élfica foi vendida por 45.000z.",
    quando: "há 3 min",
  },
];

let seq = EXEMPLOS.length + 1;

export const useNotifications = create<NotificationState>((set) => ({
  itens: EXEMPLOS,
  aberto: false,
  abrir: (aberto) => set({ aberto }),
  add: (n) => set((s) => ({ itens: [{ ...n, id: seq++ }, ...s.itens] })),
  remover: (id) =>
    set((s) => {
      const itens = s.itens.filter((i) => i.id !== id);
      // fechar sozinho ao esvaziar: um popup vazio no meio da tela é lixo
      return { itens, aberto: itens.length > 0 && s.aberto };
    }),
  limpar: () => set({ itens: [], aberto: false }),
}));
