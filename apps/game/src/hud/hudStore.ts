import { create } from "zustand";
import { CHAT_TABS, DEFAULT_TABS, FIXED_TAB, type ChatTab } from "../ui/chatFrame";

export type { ChatTab };

export type WindowKey =
  | "skills"
  | "status"
  | "inventory"
  | "friends"
  | "quests"
  | "settings"
  | "map"
  | null;

/**
 * Quais abas o jogador escolheu deixar abertas.
 *
 * Fica no localStorage porque o change pede ("salvar essa informação que ele
 * gosta que estivesse de ativa toda vez que logasse") e porque é preferência de
 * VISUAL, não estado de personagem — o servidor não tem onde guardar isso. É
 * uma lista de no máximo 5 palavras, longe da cota que os rascunhos do editor
 * disputam (ver `editor/draftStorage`).
 */
const TABS_KEY = "ragnarok:chat-tabs";

function lerAbas(): ChatTab[] {
  try {
    const cru = localStorage.getItem(TABS_KEY);
    if (!cru) return DEFAULT_TABS;
    const lista = (JSON.parse(cru) as unknown[]).filter(
      (t): t is ChatTab => typeof t === "string" && (CHAT_TABS as readonly string[]).includes(t),
    );
    // o Geral sempre existe: é o destino de tudo que não tem canal próprio
    return lista.includes(FIXED_TAB) ? lista : [FIXED_TAB, ...lista];
  } catch {
    return DEFAULT_TABS; // aba nova salva por uma versão futura, ou storage bloqueado
  }
}

function gravarAbas(abas: ChatTab[]): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(abas));
  } catch {
    /* cota cheia ou storage bloqueado: a sessão continua, só não lembra */
  }
}

interface HudState {
  openWindow: WindowKey;
  setWindow: (w: WindowKey) => void;
  toggleWindow: (w: Exclude<WindowKey, null>) => void;

  chatTab: ChatTab;
  setChatTab: (t: ChatTab) => void;
  /** abas visíveis, na ordem em que aparecem */
  chatTabs: ChatTab[];
  addChatTab: (t: ChatTab) => void;
  removeChatTab: (t: ChatTab) => void;

  /** página da barra de skills (0..2 → 3 fileiras de 9) */
  skillPage: number;
  setSkillPage: (p: number) => void;

  /** mouse sobre um monstro (pra trocar o cursor pra espada) */
}

export const useHudStore = create<HudState>((set) => ({
  openWindow: null,
  setWindow: (openWindow) => set({ openWindow }),
  toggleWindow: (w) => set((s) => ({ openWindow: s.openWindow === w ? null : w })),

  chatTab: FIXED_TAB,
  setChatTab: (chatTab) => set({ chatTab }),
  chatTabs: lerAbas(),
  addChatTab: (t) =>
    set((s) => {
      if (s.chatTabs.includes(t)) return { chatTab: t };
      // a ordem canônica de CHAT_TABS manda: assim a fileira não embaralha
      // conforme a ordem em que o jogador foi adicionando
      const chatTabs = CHAT_TABS.filter((c) => c === t || s.chatTabs.includes(c));
      gravarAbas(chatTabs);
      return { chatTabs, chatTab: t };
    }),
  removeChatTab: (t) =>
    set((s) => {
      if (t === FIXED_TAB) return {}; // o Geral não fecha
      const chatTabs = s.chatTabs.filter((c) => c !== t);
      gravarAbas(chatTabs);
      // fechar a aba ABERTA tem que mover o foco, senão o chat fica em branco
      return { chatTabs, chatTab: s.chatTab === t ? FIXED_TAB : s.chatTab };
    }),

  skillPage: 0,
  setSkillPage: (skillPage) => set({ skillPage: ((skillPage % 3) + 3) % 3 }),

}));
