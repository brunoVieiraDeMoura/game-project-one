import { create } from "zustand";

/**
 * Amigos, guilda, recentes e ignorados — o que a janela de Amigos (Alt+Z) lê.
 *
 * Três das quatro abas são do SERVIDOR e chegam por pacote (o gateway guarda e
 * reenvia no `world:ready`, porque a lista de amigos é despejada em `pc_authok`,
 * bem antes de o HUD existir). A quarta, "Recentes", é do NAVEGADOR: o
 * protocolo do rAthena não tem lista de "vistos por último", então ela é montada
 * aqui com quem apareceu na tela ou falou no chat nesta sessão. Ela existe para
 * o caminho que o RO não tem: ver o nome, clicar e mandar o convite sem digitar.
 *
 * O que o protocolo NÃO dá, esta store não inventa: em PACKETVER 20130618 o
 * ZC_FRIENDS_LIST traz `{ AID, CID, nome }` e nada mais — nível, classe e mapa
 * do amigo não existem em pacote nenhum. Por isso `Friend` não tem esses campos
 * e a janela mostra "—". Já `GuildMember` tem os três, porque o
 * ZC_MEMBERMGR_INFO manda (clif.cpp:8860).
 */

export interface Friend {
  accountId: number;
  charId: number;
  name: string;
  online: boolean;
}

export interface GuildMember {
  accountId: number;
  charId: number;
  name: string;
  job: number;
  level: number;
  online: boolean;
  position: number;
}

/** jogador visto nesta sessão — memória do navegador, não do servidor */
export interface RecentPlayer {
  name: string;
  /** `performance.now()` do último avistamento; ordena a aba */
  quando: number;
  /** apareceu na cena (spawn) ou só falou no chat */
  visto: "cena" | "chat";
}

/** aviso da janela: resultado de convite, pedido recebido, erro */
export interface FriendRequest {
  accountId: number;
  charId: number;
  name: string;
}

const RECENTES_MAX = 40;

interface FriendState {
  friends: Friend[];
  guild: GuildMember[];
  ignored: string[];
  recentes: RecentPlayer[];
  /** convite recebido que ainda espera sim/não */
  pedido: FriendRequest | null;
  /** última resposta do servidor ("vocês agora são amigos", "recusado"…) */
  aviso: string | null;

  setFriends: (f: Friend[]) => void;
  setFriendState: (p: { accountId: number; charId: number; online: boolean }) => void;
  addFriend: (f: Friend) => void;
  removeFriend: (p: { accountId: number; charId: number }) => void;
  setGuild: (m: GuildMember[]) => void;
  setIgnored: (n: string[]) => void;
  verJogador: (name: string, visto: RecentPlayer["visto"]) => void;
  setPedido: (p: FriendRequest | null) => void;
  setAviso: (a: string | null) => void;
  reset: () => void;
}

const VAZIO = {
  friends: [] as Friend[],
  guild: [] as GuildMember[],
  ignored: [] as string[],
  recentes: [] as RecentPlayer[],
  pedido: null,
  aviso: null,
};

export const useFriendStore = create<FriendState>((set) => ({
  ...VAZIO,

  setFriends: (friends) => set({ friends }),

  // Casa por accountId + charId, e não pelo nome: em 20130618 o
  // ZC_FRIENDS_STATE não carrega nome nenhum (clif.cpp:15307).
  setFriendState: ({ accountId, charId, online }) =>
    set((s) => ({
      friends: s.friends.map((f) =>
        f.accountId === accountId && f.charId === charId ? { ...f, online } : f,
      ),
    })),

  addFriend: (f) =>
    set((s) =>
      s.friends.some((x) => x.charId === f.charId) ? {} : { friends: [...s.friends, f] },
    ),

  removeFriend: ({ accountId, charId }) =>
    set((s) => ({
      friends: s.friends.filter((f) => f.accountId !== accountId || f.charId !== charId),
    })),

  setGuild: (guild) => set({ guild }),
  setIgnored: (ignored) => set({ ignored }),

  /**
   * Registra quem apareceu. Sobe o mais recente para o topo e corta a cauda: a
   * aba é um atalho para convidar, não um histórico — guardar tudo faria a lista
   * crescer sem fim numa cidade cheia.
   *
   * "cena" ganha de "chat" quando os dois acontecem: quem está na tela dá para
   * clicar e ver, e é a informação mais forte.
   */
  verJogador: (name, visto) =>
    set((s) => {
      if (!name) return {};
      const anterior = s.recentes.find((r) => r.name === name);
      const entrada: RecentPlayer = {
        name,
        quando: performance.now(),
        visto: anterior?.visto === "cena" ? "cena" : visto,
      };
      const resto = s.recentes.filter((r) => r.name !== name);
      return { recentes: [entrada, ...resto].slice(0, RECENTES_MAX) };
    }),

  setPedido: (pedido) => set({ pedido }),
  setAviso: (aviso) => set({ aviso }),

  reset: () => set({ ...VAZIO }),
}));
