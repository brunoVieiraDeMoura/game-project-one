import { create } from "zustand";
import { CHAT_TABS, DEFAULT_TABS, FIXED_TAB, type ChatTab } from "../ui/chatFrame";

export type { ChatTab };

export type WindowKey = "skills" | "status" | "inventory" | "friends" | "quests" | "settings" | "map";

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

/** deslocamento da janela em relação ao CENTRO da tela, em px — o arrasto escreve aqui */
export interface WindowPos {
  x: number;
  y: number;
}

interface HudState {
  /**
   * Quais janelas estão abertas, na ORDEM DE PILHA — a última é a de CIMA.
   *
   * Era um valor só (`openWindow: WindowKey | null`), e abrir uma fechava
   * qualquer outra: "abro Alt+Q, abro Alt+E, o Alt+Q fecha" era o próprio
   * formato do estado, não um bug de despacho. Lista em vez de valor é o que
   * deixa várias abertas ao mesmo tempo, cada uma na sua posição.
   */
  openWindows: WindowKey[];
  /** posições arrastadas — ausente = ainda centralizada (padrão) */
  positions: Partial<Record<WindowKey, WindowPos>>;
  isOpen: (w: WindowKey) => boolean;
  /** abre (ou só traz pra frente, se já estava aberta) — nunca fecha outra */
  openWindow: (w: WindowKey) => void;
  closeWindow: (w: WindowKey) => void;
  toggleWindow: (w: WindowKey) => void;
  /** põe no topo da pilha sem mudar quem está aberto */
  bringToFront: (w: WindowKey) => void;
  /**
   * Fecha a de CIMA — o ESC do RO desfaz da mais nova pra mais velha.
   * Devolve `false` quando não havia nenhuma (quem chama decide o próximo
   * passo da cadeia de ESC).
   */
  closeTopWindow: () => boolean;
  moveWindow: (w: WindowKey, pos: WindowPos) => void;

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

export const useHudStore = create<HudState>((set, get) => ({
  openWindows: [],
  positions: {},
  isOpen: (w) => get().openWindows.includes(w),
  openWindow: (w) =>
    set((s) => ({ openWindows: [...s.openWindows.filter((k) => k !== w), w] })),
  closeWindow: (w) => set((s) => ({ openWindows: s.openWindows.filter((k) => k !== w) })),
  toggleWindow: (w) =>
    set((s) =>
      s.openWindows.includes(w)
        ? { openWindows: s.openWindows.filter((k) => k !== w) }
        : { openWindows: [...s.openWindows, w] },
    ),
  bringToFront: (w) =>
    set((s) => {
      // já está no topo: nada muda, e nada muda de REFERÊNCIA — importante
      // porque isto roda em todo `pointerdown` dentro de QUALQUER janela, e
      // um array novo a cada clique reconciliaria as seis à toa.
      if (s.openWindows.at(-1) === w) return s;
      if (!s.openWindows.includes(w)) return s;
      return { openWindows: [...s.openWindows.filter((k) => k !== w), w] };
    }),
  closeTopWindow: () => {
    const topo = get().openWindows.at(-1);
    if (topo === undefined) return false;
    set((s) => ({ openWindows: s.openWindows.filter((k) => k !== topo) }));
    return true;
  },
  moveWindow: (w, pos) => set((s) => ({ positions: { ...s.positions, [w]: pos } })),

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
