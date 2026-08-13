import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { ATAQUE_BASICO_ID } from "../net/ataqueBasico";
import { usePlayerStore } from "../net/playerStore";
import { gateway, type HotkeySlotPayload } from "../net/gateway";
import { tocarMoveuItem } from "../audio/itemSfx";

/**
 * Quais skills/itens o jogador colocou em cada slot da barra.
 *
 * No Ragnarok a barra é ARRUMADA PELO JOGADOR (arrasta da janela de
 * habilidades ou do inventário), não preenchida sozinha — e a arrumação
 * sobrevive ao relog. O rAthena guarda hotkeys no servidor
 * (`ZC_SHORTCUT_KEY_LIST`) — este store agora sincroniza com ele: nasce do
 * `localStorage` (fallback pra antes do primeiro sync chegar ou pra quando o
 * gateway está fora do ar), e a partir do primeiro evento `"hotkeys"` o
 * servidor vira a fonte de verdade (ver `hydrateFromServer`).
 *
 * A barra é DO PERSONAGEM, não da aba do navegador: `bindToCharacter`/
 * `unbindCharacter` (fim do arquivo) amarram o store ao personagem ativo. Sem
 * personagem vinculado (`charAtual === null`) nada é lido, escrito nem
 * mandado pro servidor — é assim que a barra de um personagem nunca vaza pra
 * outro, nem da mesma conta nem de conta diferente.
 *
 * 27 slots = 3 páginas de 9, como no RO — é só o que a BARRA desenha. O
 * `MAX_HOTKEYS` real do rAthena neste packetver é 38 (`SERVER_HOTKEY_SLOTS`);
 * os 11 extras não têm representação visual nesta fase (de propósito — não
 * redesenhar a barra), mas continuam sincronizados como os outros 27.
 */
export const SKILL_SLOTS = 27;

/** `MAX_HOTKEYS` do rAthena neste packetver (`mmo.hpp`, sem o 2º tab de
 * atalhos — esse exige packetver >= 20190522). O `slots[]` deste store tem
 * SEMPRE este tamanho, mesmo os índices 27..37 nunca aparecendo na UI. */
export const SERVER_HOTKEY_SLOTS = 38;

/**
 * `id` é a chave de identidade de cada tipo — skill id do rAthena para
 * `"skill"`, `itemId` do catálogo para `"item"`/`"ammo"` — NUNCA o índice do
 * inventário: o índice é volátil (o mesmo item pode reaparecer noutro slot da
 * bolsa depois de um stack zerar e ser pego de novo), e a skill já guardava
 * por id pela mesma razão. `id: 0` é o vazio, para os três tipos.
 *
 * `"ammo"` é um tipo À PARTE de `"item"`, mesmo os dois sendo "coisa achada
 * no inventário por itemId": o gatilho é DIFERENTE (equipar, não usar/
 * consumir — `SkillBar.trigger`) e não pode ser confundido com o de item
 * comum, que manda `CZ.USE_ITEM`. Munição continua item de verdade (tipo
 * `IT_AMMO`, categoria Etc no inventário) — só o SLOT DA BARRA é um tipo
 * próprio, para o clique saber que ação tomar sem checar `item.type` de novo.
 */
export interface SkillBarSlot {
  kind: "skill" | "item" | "ammo";
  id: number;
}

const SLOT_VAZIO: SkillBarSlot = { kind: "skill", id: 0 };

interface SkillBarState {
  slots: SkillBarSlot[];
  /** `true` depois do PRIMEIRO evento `"hotkeys"` do servidor — a partir
   * daí o servidor é a fonte de verdade e toda mudança local também é
   * mandada pra ele (ver `sendToServer`). Antes disso a barra funciona só
   * com o que já tinha no `localStorage`, sem tentar sincronizar. */
  serverSynced: boolean;
  /** slot vira skill */
  assign: (slot: number, skillId: number) => void;
  /** slot vira item (consumível arrastado do inventário) */
  assignItem: (slot: number, itemId: number) => void;
  /** slot vira munição (arraste do Etc — clique EQUIPA, não usa) */
  assignAmmo: (slot: number, itemId: number) => void;
  clear: (slot: number) => void;
  swap: (from: number, to: number) => void;
  reset: () => void;
  /** os 38 slots reais chegaram do servidor — substitui o estado local
   * inteiro (nunca mescla: a partir daqui o servidor manda). */
  hydrateFromServer: (serverSlots: HotkeySlotPayload[]) => void;
}

const EMPTY = Array.from({ length: SERVER_HOTKEY_SLOTS }, (): SkillBarSlot => ({ ...SLOT_VAZIO }));

/**
 * A barra NASCE com o Ataque Básico no primeiro slot.
 *
 * Ele é do cliente, não do rAthena, então não aparece na janela de habilidades
 * (que é montada a partir do que o servidor manda) e não haveria de onde
 * arrastá-lo. Deixá-lo posto é o que o torna alcançável; daí em diante ele se
 * move, troca e sai como qualquer outro, e a escolha persiste.
 *
 * Como é um id NEGATIVO (`ATAQUE_BASICO_ID = -1`, `net/ataqueBasico.ts`) sem
 * NENHUM equivalente real no rAthena, `sendToServer` abaixo NUNCA manda este
 * slot pro servidor — mandar mandaria `id: -1` como `uint32`, virando lixo
 * (4294967295) do outro lado. `hydrateFromServer` sabe disso e PRESERVA o
 * slot quando o servidor não tem nada ali (ver o comentário lá) — ele nunca
 * é sobrescrito pelo primeiro sync só por não ter contraparte no rAthena.
 */
function comAtaqueBasico(): SkillBarSlot[] {
  const slots = EMPTY.map((s) => ({ ...s }));
  slots[0] = { kind: "skill", id: ATAQUE_BASICO_ID };
  return slots;
}

/**
 * `null` = este slot não tem como virar hotkey de servidor — nunca manda
 * nada pro gateway pra ele. Dois casos: `"ammo"` (tipo só do cliente, sem
 * contraparte no protocolo — equipar vs. usar não existe pro rAthena) e o
 * Ataque Básico (id negativo, só do cliente). Os dois continuam funcionando
 * normalmente localmente; só não atravessam pro servidor.
 */
function paraServidor(s: SkillBarSlot): { kind: "empty" | "skill" | "item"; id: number } | null {
  if (s.kind === "ammo") return null;
  if (s.kind === "skill" && s.id === ATAQUE_BASICO_ID) return null;
  if (s.id === 0) return { kind: "empty", id: 0 };
  return { kind: s.kind === "item" ? "item" : "skill", id: s.id };
}

function sendToServer(slot: number, s: SkillBarSlot): void {
  // Sem personagem vinculado não há pra quem mandar — cinto e suspensório
  // além do `serverSynced` que cada call site já checa (ver `bindToCharacter`).
  if (charAtual === null) return;
  const payload = paraServidor(s);
  if (!payload) return;
  gateway().emit("hotkey:set", { slot, kind: payload.kind, id: payload.id });
}

/**
 * Personagem dono do store agora, ou `null` fora de sessão (login, tela de
 * seleção, logout). É a única fonte de identidade que o storage adapter e
 * `sendToServer` consultam — nunca `accountId`: `charId` já é PK global do
 * rAthena, único entre contas, então compor os dois só criaria uma segunda
 * forma de escrever a chave errada.
 */
let charAtual: number | null = null;

/**
 * Adapter que compõe a chave de `localStorage` com o personagem ativo NO
 * MOMENTO DA CHAMADA (`ragnarok:skillbar:<charId>`, mesmo padrão de
 * `editor/draftStorage.ts`). Com `charAtual === null` não lê nem escreve
 * nada — sem personagem não existe barra a persistir.
 */
const storage = createJSONStorage<{ slots: SkillBarSlot[] }>(() => ({
  getItem: (name) => (charAtual === null ? null : localStorage.getItem(`${name}:${charAtual}`)),
  setItem: (name, value) => {
    if (charAtual !== null) localStorage.setItem(`${name}:${charAtual}`, value);
  },
  removeItem: (name) => {
    if (charAtual !== null) localStorage.removeItem(`${name}:${charAtual}`);
  },
}));

export const useSkillBar = create<SkillBarState>()(
  persist(
    (set, get) => ({
      slots: comAtaqueBasico(),
      serverSynced: false,

      assign: (slot, skillId) => {
        let previous = -1;
        set((s) => {
          const slots = s.slots.map((x) => ({ ...x }));
          // a mesma skill não fica em dois lugares (o RO também move, não copia)
          previous = slots.findIndex((x) => x.kind === "skill" && x.id === skillId);
          if (previous !== -1) slots[previous] = { ...SLOT_VAZIO };
          slots[slot] = { kind: "skill", id: skillId };
          return { slots };
        });
        if (get().serverSynced) {
          if (previous !== -1) sendToServer(previous, SLOT_VAZIO);
          sendToServer(slot, { kind: "skill", id: skillId });
        }
      },

      assignItem: (slot, itemId) => {
        let previous = -1;
        set((s) => {
          const slots = s.slots.map((x) => ({ ...x }));
          // mesma regra do assign: o mesmo item não fica em dois lugares
          previous = slots.findIndex((x) => x.kind === "item" && x.id === itemId);
          if (previous !== -1) slots[previous] = { ...SLOT_VAZIO };
          slots[slot] = { kind: "item", id: itemId };
          return { slots };
        });
        if (get().serverSynced) {
          if (previous !== -1) sendToServer(previous, SLOT_VAZIO);
          sendToServer(slot, { kind: "item", id: itemId });
        }
        // som de "item mudou de container" — só quando o slot MUDOU de
        // verdade (soltar o item de volta no mesmo slot que já ocupava não é
        // movimento nenhum, e não deveria soar como um)
        if (previous !== slot) tocarMoveuItem();
      },

      // "ammo" nunca chama sendToServer — de propósito, sem equivalente no
      // rAthena (ver paraServidor). Continua 100% local, como sempre foi.
      assignAmmo: (slot, itemId) => {
        let previous = -1;
        set((s) => {
          const slots = s.slots.map((x) => ({ ...x }));
          previous = slots.findIndex((x) => x.kind === "ammo" && x.id === itemId);
          if (previous !== -1) slots[previous] = { ...SLOT_VAZIO };
          slots[slot] = { kind: "ammo", id: itemId };
          return { slots };
        });
        if (previous !== slot) tocarMoveuItem();
      },

      clear: (slot) => {
        // capturado ANTES de zerar: precisa saber se havia item/munição ali
        // pra decidir se toca o som — limpar skill, ou um slot já vazio, não
        // é "item saindo da barra"
        const eraItemOuMunicao = get().slots[slot]?.kind === "item" || get().slots[slot]?.kind === "ammo";
        set((s) => {
          const slots = s.slots.map((x) => ({ ...x }));
          slots[slot] = { ...SLOT_VAZIO };
          return { slots };
        });
        if (get().serverSynced) sendToServer(slot, SLOT_VAZIO);
        if (eraItemOuMunicao) tocarMoveuItem();
      },

      swap: (from, to) => {
        let novoFrom: SkillBarSlot = SLOT_VAZIO;
        let novoTo: SkillBarSlot = SLOT_VAZIO;
        set((s) => {
          const slots = s.slots.map((x) => ({ ...x }));
          const tmp = slots[to] ?? { ...SLOT_VAZIO };
          slots[to] = slots[from] ?? { ...SLOT_VAZIO };
          slots[from] = tmp;
          novoTo = slots[to]!;
          novoFrom = slots[from]!;
          return { slots };
        });
        if (get().serverSynced) {
          sendToServer(from, novoFrom);
          sendToServer(to, novoTo);
        }
      },

      // Só local, de propósito — não existe pacote de "limpar tudo" no
      // rAthena, e mandar 38 CZ_SHORTCUT_KEY_CHANGE1 pra recriar o Ataque
      // Básico (que nem sincroniza) seria inventar comportamento que o
      // servidor nunca pediu. Quem quer a barra do servidor limpa de fato
      // arrasta/limpa slot a slot, que aí sim sincroniza.
      reset: () => set({ slots: comAtaqueBasico() }),

      // Substitui os 38 slots pelo que o servidor mandou — para todo slot
      // cujo `paraServidor` NÃO retorna null (é sincronizável de verdade),
      // é o "não sobrescrever com o estado antigo depois" de sempre: só
      // entra slot novo por AÇÃO do jogador daqui em diante, nunca pela
      // leitura antiga do localStorage.
      //
      // EXCEÇÃO deliberada: slots client-only (`"ammo"` e Ataque Básico,
      // ver `paraServidor`) nunca são mandados pro servidor — então o índice
      // correspondente no rAthena É SEMPRE "empty" pra ele, em TODO sync,
      // pra sempre. Sem esta exceção, o primeiro `hotkey:list` da sessão
      // (que chega uma vez por conexão, sempre — `clif_hotkeys_send` só no
      // `connect_new`) apagava esses slots incondicionalmente, mesmo tendo
      // acabado de vir corretos do `localStorage` — era a causa real de
      // "Auto Attack some depois de salvar e recarregar": o servidor nunca
      // teve, nunca terá e nunca precisa ter registro dele; ele não é uma
      // divergência a corrigir, é a única fonte de verdade que existe pra
      // aquele slot. Se o servidor MANDAR algo de verdade nesse índice
      // (kind !== "empty"), ele ainda prevalece — client-only só sobrevive
      // quando não há absolutamente nada com que reconciliar.
      hydrateFromServer: (serverSlots) =>
        set((atual) => {
          const doServidor = new Map(
            serverSlots
              .filter((s) => s.slot >= 0 && s.slot < SERVER_HOTKEY_SLOTS)
              .map((s) => [s.slot, s] as const),
          );
          const slots = EMPTY.map((_, i) => {
            const local = atual.slots[i] ?? SLOT_VAZIO;
            const recebido = doServidor.get(i);
            if (recebido && recebido.kind !== "empty") return { kind: recebido.kind, id: recebido.id };
            if (paraServidor(local) === null) return { ...local };
            return { ...SLOT_VAZIO };
          });
          return { slots, serverSynced: true };
        }),
    }),
    {
      name: "ragnarok:skillbar",
      storage,
      // Ninguém está vinculado no `create()` — a reidratação automática e
      // síncrona do zustand rodaria antes de qualquer personagem existir e
      // não teria chave nenhuma pra ler. `bindToCharacter` chama
      // `persist.rehydrate()` explicitamente depois de saber quem é o dono.
      skipHydration: true,
      // `serverSynced` NUNCA é persistido: é o que fazia a barra do
      // personagem anterior se autodeclarar "sincronizada" e escrever no
      // servidor do personagem novo antes do primeiro `hydrateFromServer`
      // de verdade chegar.
      partialize: (s) => ({ slots: s.slots }),
      /**
       * v1→v2: `slots` era `number[]` (id de skill cru); virou
       * `SkillBarSlot[]` para caber item além de skill. Quem guardava um
       * array de números recebe o MESMO id de volta, só embrulhado —
       * `kind: "skill"` é a única leitura possível de um número puro, porque
       * "item" não existia antes desta versão.
       *
       * v0→v1 continua embutida aqui (não é um passo separado): quem nunca
       * teve o Ataque Básico ganha ele no primeiro slot livre, ANTES da
       * conversão de forma — assim uma migração cobre os dois saltos de quem
       * pulou direto de v0 para v2.
       *
       * v2→v3: `slots` tinha 27 posições (só o que a UI desenhava); o
       * servidor tem 38 (`SERVER_HOTKEY_SLOTS`, `MAX_HOTKEYS` do rAthena
       * neste packetver) — só ESTICA com slot vazio no final, nunca corta
       * nem reordena o que já existia. É puramente local até o primeiro
       * `hydrateFromServer` chegar e substituir tudo pela verdade real.
       */
      version: 3,
      migrate: (guardado, versao) => {
        const estado = guardado as { slots?: unknown[] } | undefined;
        if (!estado?.slots) return guardado as never;

        let slots: SkillBarSlot[];
        if (versao < 2) {
          const nums = [...(estado.slots as number[])];
          if (versao < 1 && !nums.includes(ATAQUE_BASICO_ID)) {
            const livre = nums.indexOf(0);
            if (livre !== -1) nums[livre] = ATAQUE_BASICO_ID;
          }
          slots = nums.map((id) => ({ kind: "skill", id }) as SkillBarSlot);
        } else {
          slots = [...(estado.slots as SkillBarSlot[])];
        }

        while (slots.length < SERVER_HOTKEY_SLOTS) slots.push({ ...SLOT_VAZIO });

        return { ...estado, slots } as never;
      },
    },
  ),
);

/**
 * Personagem passa a ser dono do store — chamar assim que `world:enter`
 * chegar, ANTES de `world:ready` (o `hotkey:list` que vem em seguida precisa
 * achar o binding já certo).
 *
 * Idempotente para o MESMO personagem de propósito: `world:enter` também
 * chega em warp de mesmo mapa (`@jump`, Asa de Borboleta, respawn — ver o
 * comentário sobre isso em `net/useGatewayEvents.ts`), e re-bindar ali
 * reiniciaria `serverSynced` e a barra a cada teleporte.
 */
export function bindToCharacter(charId: number): void {
  if (charId === charAtual) return;
  // A ORDEM aqui importa: o `persist` do zustand escreve no storage a cada
  // `setState`, usando o `charAtual` QUE JÁ ESTIVER valendo no momento da
  // escrita. Zerar o estado com `charAtual` já apontando pro personagem novo
  // gravaria o reset por cima do que esse personagem já tinha salvo — e o
  // `rehydrate` logo depois releria o próprio reset, não o dado de verdade.
  // Com `charAtual = null` durante o reset, o storage adapter recusa a
  // escrita (nenhum personagem "dono" dela) e nada é sobrescrito.
  charAtual = null;
  useSkillBar.setState({ slots: comAtaqueBasico(), serverSynced: false });
  charAtual = charId;
  // Carrega o blob DESTE personagem do localStorage (fallback até o
  // `hydrateFromServer` de verdade chegar).
  void useSkillBar.persist.rehydrate();
}

/**
 * Fim de sessão (logout, disconnect) — chamar junto dos outros resets de
 * `encerrar()` em `net/useGatewayEvents.ts`. Sem personagem vinculado nada é
 * lido, escrito nem mandado ao servidor (ver `storage` e `sendToServer`
 * acima) até o próximo `bindToCharacter`.
 */
export function unbindCharacter(): void {
  charAtual = null;
  useSkillBar.setState({ slots: comAtaqueBasico(), serverSynced: false });
}

/**
 * Item removido/trocado/zerado no inventário não pode deixar a hotbar
 * apontando para nada.
 *
 * Mora fora do React, como a reação do Ataque Básico em `net/ataqueBasico.ts`
 * — é regra de sessão, não de componente montado. A base é o `playerStore`,
 * que É o estado autoritativo (só muda quando o servidor manda `inv:remove`/
 * `ITEMLIST`): a limpeza aqui não é o cliente "achando" que chegou a 0, é
 * reagir ao que o servidor já confirmou.
 */
usePlayerStore.subscribe((estado, anterior) => {
  if (charAtual === null) return;
  if (estado.inventory === anterior.inventory) return;
  const presentes = new Set(estado.inventory.map((it) => it.itemId));
  const bar = useSkillBar.getState();
  bar.slots.forEach((slot, i) => {
    if (slot.kind === "item" && slot.id !== 0 && !presentes.has(slot.id)) bar.clear(i);
  });
  // "ammo" fica de FORA de propósito: a pilha pode zerar e voltar (comprou
  // mais, pegou no chão), e o atalho tem que continuar apontando pro mesmo
  // itemId quando isso acontecer — é o "quick-switch" pedido, não um slot de
  // usar-e-sumir como os itens comuns.
});

// mesmo espírito do __world/__player/__basico: "o atalho ainda está
// configurado?" é a pergunta que a tela sozinha não responde quando o slot
// está vazio (a pilha zerou) — sem isto, "o atalho sumiu" e "a pilha zerou"
// pareciam a mesma coisa de fora.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __hotbar?: () => SkillBarSlot[] }).__hotbar = () => useSkillBar.getState().slots;
  (window as unknown as { __skillBarTmp?: unknown }).__skillBarTmp = useSkillBar;
}
