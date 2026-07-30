import { create } from "zustand";
import { gateway } from "./gateway";

/**
 * Diálogo de NPC, do jeito que o rAthena conduz.
 *
 * O script do NPC roda NO SERVIDOR e vai mandando pedaços: um texto, depois um
 * "próximo", às vezes um menu. O cliente não decide nada — mostra o que chegou
 * e devolve o clique. Fechar sem avisar (`npc:close`) deixa o script preso do
 * lado do servidor, por isso o botão de fechar manda o pacote.
 */

export interface NpcDialogState {
  gid: number;
  /** falas acumuladas até o próximo "próximo"/menu */
  lines: string[];
  /** true = o servidor está esperando o clique de "próximo" */
  awaitingNext: boolean;
  /** opções do menu; vazio = sem menu agora */
  menu: string[];
}

interface NpcState {
  dialog: NpcDialogState | null;
  say: (gid: number, text: string) => void;
  awaitNext: (gid: number) => void;
  showMenu: (gid: number, options: string[]) => void;
  close: () => void;
  /** clique do jogador em "próximo" */
  next: () => void;
  /** clique numa opção (índice 0-based na lista mostrada) */
  choose: (index: number) => void;
  /** fechar pela UI — avisa o servidor */
  dismiss: () => void;
}

export const useNpcStore = create<NpcState>((set, get) => ({
  dialog: null,

  say: (gid, text) =>
    set((s) => ({
      dialog:
        s.dialog?.gid === gid
          ? { ...s.dialog, lines: [...s.dialog.lines, text], awaitingNext: false, menu: [] }
          : { gid, lines: [text], awaitingNext: false, menu: [] },
    })),

  awaitNext: (gid) =>
    set((s) => ({
      dialog: s.dialog?.gid === gid ? { ...s.dialog, awaitingNext: true } : { gid, lines: [], awaitingNext: true, menu: [] },
    })),

  showMenu: (gid, options) =>
    set((s) => ({
      dialog:
        s.dialog?.gid === gid
          ? { ...s.dialog, menu: options, awaitingNext: false }
          : { gid, lines: [], awaitingNext: false, menu: options },
    })),

  close: () => set({ dialog: null }),

  next: () => {
    const dialog = get().dialog;
    if (!dialog) return;
    // limpa o texto já lido: o servidor manda a próxima página do zero
    set({ dialog: { ...dialog, lines: [], awaitingNext: false } });
    gateway().emit("npc:next", { gid: dialog.gid });
  },

  choose: (index) => {
    const dialog = get().dialog;
    if (!dialog) return;
    set({ dialog: { ...dialog, menu: [], lines: [] } });
    // o rAthena conta a partir de 1
    gateway().emit("npc:menu", { gid: dialog.gid, choice: index + 1 });
  },

  dismiss: () => {
    const dialog = get().dialog;
    if (!dialog) return;
    set({ dialog: null });
    gateway().emit("npc:close", { gid: dialog.gid });
  },
}));
