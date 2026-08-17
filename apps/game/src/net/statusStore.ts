import { create } from "zustand";
import {
  OPT1_FREEZE,
  OPT1_IMPRISON,
  OPT1_SLEEP,
  OPT1_STONE,
  OPT1_STONEWAIT,
  OPT1_STUN,
  OPT2_BLIND,
  OPT2_CONFUSION,
  OPT2_CURSE,
  OPT2_POISON,
  OPT2_SILENCE,
} from "./entityOption";

/**
 * Efeitos ativos (buff/debuff/skill com duração) por entidade, alimentados
 * pelo servidor via gateway (`status:start`/`status:end`, "auditoria buffs/
 * debuffs" 2026-08-14 — pacotes EFST reais do rAthena, ver `apps/gateway/
 * src/ro/session.ts`).
 *
 * Store SEPARADA de `worldStore.entities`, de propósito:
 *  1. status pode chegar pra um gid que ainda não está em `entities`
 *     (inclusive o PRÓPRIO personagem antes do primeiro spawn) — guardar
 *     junto exigiria criar entidade fantasma só pra não perder o evento.
 *  2. `worldStore.entities` é lido a cada quadro pelo pathfinding/`NetPlayer`
 *     — escrever ali a cada buff/debuff churnaria o caminho quente à toa.
 *
 * Guarda-se o INSTANTE em que termina (`performance.now()` absoluto), nunca
 * "quanto falta": o que falta muda a cada quadro, e por `setState` isso
 * repintaria a UI 60×/s. Mesmo padrão de `net/cooldownStore.ts`. Quem
 * desenha o cronômetro lê `endsAt` e anima sozinho (rAF), nunca `setInterval`
 * por ícone.
 *
 * `totalMs===0` é o servidor dizendo "sem timer conhecido" (0x196 flag=1) —
 * o ícone fica até um `status:end` de verdade chegar, sem contagem regressiva
 * nem tentativa de adivinhar duração no cliente.
 */
/**
 * `opt1` ("estado do corpo": petrificado/congelado/atordoado/dormindo/
 * enraizando-antes-de-petrificar) NUNCA teve pacote de ícone de status
 * (EFST) — é outro mecanismo do rAthena inteiro (`ZC_STATE_CHANGE` 0x119,
 * `net/entityOption.ts`), mas é gameplay real (bloqueia mover/atacar/agir) e
 * não aparecia na barra de jeito NENHUM até esta auditoria (2026-08-14,
 * "checagem completa das regras de exibição"). `opt1` já é 100% autoritativo
 * do servidor — a UI só espelha o valor que `net/useWorldEvents.ts: onOption`
 * já escreve em `worldStore.entities[gid].opt1`, nunca inventa duração (a
 * própria ZC_STATE_CHANGE não carrega duração nenhuma — por isso
 * `totalMs=0`/sem contagem regressiva, igual ao "0x196 sem duração" comum).
 *
 * Espaço de pseudo-id RESERVADO, bem abaixo de qualquer `-skillId` real
 * (`SELF_TRACKED_BUFF_SKILLS`) pra nunca colidir — skill id nunca chega
 * perto de um milhão neste servidor.
 */
const BODY_STATE_EFST_BASE = -1_000_000;
/** ordem de checagem/limpeza — valores de `opt1` que travam o corpo e RENDERIZAM
 * pseudo-ícone (todos, MENOS `OPT1_NONE`). `OPT1_BURNING` fica de fora de
 * propósito: `Burning` é o único status desta família com `Icon: EFST_BURNT`
 * em `status.yml` (`rathena/db/re/status.yml:3122-3127`) — ele JÁ chega por
 * `status:start`/EFST de verdade, com duração real. Incluir aqui duplicaria
 * o ícone (um sem timer via body-state, outro com timer via EFST) pro MESMO
 * status (auditoria "status negativos em inimigos" 2026-08-14). `Whiteimprison`
 * não tem `Icon:` — sem esse problema, fica dentro normalmente. */
export const BODY_STATE_LOCKING_VALUES = [
  OPT1_STONE,
  OPT1_FREEZE,
  OPT1_STUN,
  OPT1_SLEEP,
  OPT1_STONEWAIT,
  OPT1_IMPRISON,
] as const;

/** `opt1` (1/2/3/4/6) → pseudo-id da barra de status. Só pros 5 valores de
 * `BODY_STATE_LOCKING_VALUES` — nunca chamar com `OPT1_NONE` (0). */
export function bodyStateEfstId(opt1: number): number {
  return BODY_STATE_EFST_BASE - opt1;
}

/** o inverso de `bodyStateEfstId` — `undefined` se `efstId` não é um pseudo-id de body-state */
export function opt1FromBodyStateEfstId(efstId: number): number | undefined {
  if (efstId > BODY_STATE_EFST_BASE || efstId <= BODY_STATE_EFST_BASE - 10) return undefined;
  return BODY_STATE_EFST_BASE - efstId;
}

/** rótulo fixo — não existe catálogo pra isso (nem status.yml, nem skill_db:
 * `opt1` é estado de ENGINE, não efeito nomeado). Mesmos 5 nomes que
 * `net/entityOption.ts` já documenta. */
export const BODY_STATE_LABEL: Record<number, string> = {
  [OPT1_STONE]: "Petrificado",
  [OPT1_FREEZE]: "Congelado",
  [OPT1_STUN]: "Atordoado",
  [OPT1_SLEEP]: "Dormindo",
  [OPT1_STONEWAIT]: "Petrificando",
  [OPT1_IMPRISON]: "Aprisionado",
};

/** arquivo em `public/assets/debuffs/` por valor de `opt1` — acervo
 * `assets-new/skill_icons/debuffs` (2026-08-15). `OPT1_IMPRISON` fica de fora
 * de propósito: sem arquivo correspondente no acervo, mostrar ícone nenhum é
 * melhor que mostrar um errado (mesmo critério de `RACE_ICON` em
 * `ui/monsterIcons.ts`). `STONE`/`STONEWAIT` dividem o mesmo arquivo
 * (petrificando vs. petrificado é o MESMO ícone, só o rótulo do tooltip muda). */
export const BODY_STATE_ICON: Partial<Record<number, string>> = {
  [OPT1_STONE]: "Petrificação.png",
  [OPT1_STONEWAIT]: "Petrificação.png",
  [OPT1_FREEZE]: "Congelamento.png",
  [OPT1_STUN]: "Atordoamento.png",
  [OPT1_SLEEP]: "Sono.png",
};

/**
 * `opt2`/`healthState` — família SEPARADA de body-state, de propósito
 * (auditoria "opt2/healthState" 2026-08-14, pedido explícito "não transforme
 * Opt2 em BODY_STATE"): é BITMASK (`net/entityOption.ts: OPT2_*`), vários
 * bits ativos ao mesmo tempo, contra `opt1` que é posição única. Espaço de
 * pseudo-id PRÓPRIO, um milhão abaixo do de body-state — nunca colide com
 * `BODY_STATE_EFST_BASE` (-1.000.000..-1.000.009), skill id (sempre >= 0) ou
 * EFST real (sempre >= 0).
 */
const HEALTH_STATE_EFST_BASE = -2_000_000;

/** só os 5 bits pedidos nesta auditoria — `OPT2_BLEEDING` fica de fora (já
 * tem `Icon: EFST_BLOODING` real, mesmo motivo de `OPT1_BURNING` acima) e
 * `OPT2_ANGELUS` fica de fora (é BUFF, fora do escopo "debuff em inimigo").
 * `OPT2_DPOISON`/`OPT2_FEAR` não foram pedidos — dá pra somar depois no
 * mesmo padrão, sem mudar a forma. */
export const HEALTH_STATE_LOCKING_BITS = [OPT2_POISON, OPT2_CURSE, OPT2_SILENCE, OPT2_CONFUSION, OPT2_BLIND] as const;

/** bit (valor de potência de 2) → pseudo-id. Só pros 5 bits de
 * `HEALTH_STATE_LOCKING_BITS` — nunca chamar com `OPT2_NONE` (0). */
export function healthStateEfstId(bit: number): number {
  return HEALTH_STATE_EFST_BASE - bit;
}

/** o inverso de `healthStateEfstId` — `undefined` se `efstId` não é um pseudo-id de healthState */
export function opt2BitFromHealthStateEfstId(efstId: number): number | undefined {
  if (efstId > HEALTH_STATE_EFST_BASE || efstId <= HEALTH_STATE_EFST_BASE - 0x0200) return undefined;
  return HEALTH_STATE_EFST_BASE - efstId;
}

/** rótulo fixo, mesmo motivo de `BODY_STATE_LABEL`: `opt2` é estado de
 * ENGINE (bit cru), não efeito nomeado com entrada em catálogo. */
export const HEALTH_STATE_LABEL: Record<number, string> = {
  [OPT2_POISON]: "Envenenado",
  [OPT2_CURSE]: "Amaldiçoado",
  [OPT2_SILENCE]: "Silenciado",
  [OPT2_CONFUSION]: "Confuso",
  [OPT2_BLIND]: "Cego",
};

/** arquivo em `public/assets/debuffs/` por bit de `opt2` — mesmo acervo/
 * critério de `BODY_STATE_ICON` acima. */
export const HEALTH_STATE_ICON: Partial<Record<number, string>> = {
  [OPT2_POISON]: "Envenenamento.png",
  [OPT2_CURSE]: "Maldição.png",
  [OPT2_SILENCE]: "Silêncio.png",
  [OPT2_CONFUSION]: "Caos.png",
  [OPT2_BLIND]: "Cegueira.png",
};

/**
 * Arquivo em `public/assets/debuffs/` por `StatusInfo.id` (nome SC minúsculo
 * do catálogo, `net/statusCatalog.ts`) — só os EFST reais que o acervo cobre
 * com confiança (nome em inglês → tradução PT direta e sem ambiguidade,
 * conferido contra `tools/legacy-migration/output/statuses.json`, campo
 * `icon` presente = o rAthena REALMENTE manda esse EFST). Deliberadamente
 * incompleto: o acervo tem 29 arquivos, boa parte pra status raros/eventos
 * (ex. "Coma", "Medo") sem tradução clara o bastante pra não arriscar
 * ícone ERRADO — ficam sem entrada aqui até alguém confirmar a
 * correspondência, não é esquecimento. */
export const EFST_ICON_BY_ID: Partial<Record<string, string>> = {
  burning: "Ardência.png",
  bleeding: "Sangramento.png",
  hallucination: "Alucinação.png",
  crystalize: "Cristalização.png",
  deepsleep: "Sono Profundo.png",
  freezing: "Esfriamento.png",
  toxin: "Intoxicação.png",
  winkcharm: "Sedução.png",
  electricshocker: "Eletrificação.png",
};

export interface ActiveStatus {
  /**
   * Positivo = id EFST real (vindo do servidor). Entre `BODY_STATE_EFST_BASE`
   * e `BODY_STATE_EFST_BASE-9` = pseudo-id de `opt1` (petrificado/congelado/
   * atordoado/dormindo, ver acima). Outro negativo = pseudo-id de um
   * self-buff sintetizado no cliente (`-skillId`, ver `SELF_TRACKED_BUFF_
   * SKILLS` abaixo) — os três espaços nunca colidem: EFST e skill id são
   * sempre >= 0, e nenhum skill id real chega perto de um milhão.
   */
  efstId: number;
  /** performance.now() absoluto em que o efeito acaba; 0 = sem timer (0x196 sem duração) */
  endsAt: number;
  /** duração total em ms, pra desenhar a fração que falta; 0 = sem timer */
  totalMs: number;
  val1: number;
  val2: number;
  val3: number;
  /**
   * `true` só pros self-buffs sintetizados (`efstId < 0`): sem pacote real
   * de status, o servidor NUNCA manda um `status:end` pra estes — é o
   * próprio cronômetro da UI (`hud/StatusEffectIcons.tsx`) quem apaga a
   * entrada ao chegar em zero. Um efeito vindo de verdade do servidor
   * (`efstId >= 0`) NUNCA se auto-apaga: só some com `status:end`
   * (`net/statusStore.ts` topo do arquivo) — perder o pacote deixaria o
   * ícone visualmente pendurado em 0, mas nunca some sozinho por conta
   * própria, pra não mentir sobre o que o servidor ainda considera ativo.
   */
  selfExpire?: boolean;
}

/**
 * Aegis names de self-buff cuja duração o rAthena NUNCA sinaliza por pacote
 * de status pro cliente (nem EFST/SC_START, nem opt1/opt2/opt3) — conferido
 * em `tools/legacy-migration/output/statuses.json`: o status ligado a estas
 * skills (`durationLookupSkill`) não tem `icon` nenhum, porque usa o bitmask
 * `option` (`clif_changeoption`/OPTION_*), que este cliente não decodifica
 * (só existe pra ligar/desligar comportamento, sem pacote de ícone de UI).
 * "Oráculo"/Sight (MG_SIGHT) é o caso que motivou isto — auditoria
 * "skills ativáveis sem contador na barra" 2026-08-14.
 *
 * DELIBERADAMENTE pequeno e curado, não "todo self_buff com duração": a
 * maioria dos self-buffs (Blessing, Increase AGI, Energy Coat, …) JÁ manda
 * um EFST de verdade — tratar todos como sintéticos duplicaria o ícone
 * quando o pacote real chegasse.
 */
export const SELF_TRACKED_BUFF_SKILLS = new Set<string>(["MG_SIGHT"]);

/**
 * Duração pendente (auditoria "contador de duração" 2026-08-14): o pacote
 * `entity:status-duration` (customizado, ver `net/useWorldEvents.ts`) e o
 * pacote `entity:option`/`status:start` que CRIA a entrada em `byGid` são
 * DOIS pacotes separados — a ordem de chegada não é garantida (parte 9/10 do
 * pedido: "BODY_STATE → DURATION" e "DURATION → BODY_STATE" precisam
 * funcionar as duas). Se a duração chegar ANTES da entrada existir, fica
 * guardada aqui — determinístico, sem `setTimeout`/polling — e `start()`
 * aplica sozinho assim que a entrada nascer. `end()` invalida qualquer
 * pendência da mesma chave, pra uma duração atrasada nunca reviver um
 * status que o servidor já cancelou.
 */
interface DuracaoPendente {
  totalMs: number;
  remainMs: number;
}

interface StatusState {
  /** gid → lista de efeitos ativos (sem duplicar por efstId — start substitui) */
  byGid: Record<number, ActiveStatus[]>;
  /** gid → efstId → duração chegada antes da entrada existir (ver doc acima) */
  pendingDurations: Record<number, Record<number, DuracaoPendente>>;
  start: (
    gid: number,
    payload: {
      efstId: number;
      totalMs: number;
      remainMs: number;
      val1: number;
      val2: number;
      val3: number;
      selfExpire?: boolean;
    },
  ) => void;
  end: (gid: number, efstId: number) => void;
  /**
   * Duração real chegou pro par (gid, efstId) — atualiza a entrada JÁ
   * existente (nunca cria `Freeze` + `FreezeTimer` separados); se a entrada
   * ainda não existe, guarda como pendente até `start()` criar.
   */
  setDuration: (gid: number, efstId: number, totalMs: number, remainMs: number) => void;
  /** entidade saiu do alcance de visão / desapareceu — não faz sentido reter os efeitos dela */
  clearGid: (gid: number) => void;
  clearAll: () => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  byGid: {},
  pendingDurations: {},

  start: (gid, payload) =>
    set((s) => {
      const atual = s.byGid[gid] ?? [];
      const semEsteId = atual.filter((e) => e.efstId !== payload.efstId);
      // duração pendente pra este exato (gid, efstId) — chegou antes da
      // entrada existir (ordem "DURATION → BODY_STATE"), aplica agora.
      const pendente = s.pendingDurations[gid]?.[payload.efstId];
      const totalMs = pendente ? pendente.totalMs : payload.totalMs;
      const remainMs = pendente ? pendente.remainMs : payload.remainMs;
      const efeito: ActiveStatus = {
        efstId: payload.efstId,
        endsAt: totalMs > 0 ? performance.now() + remainMs : 0,
        totalMs,
        val1: payload.val1,
        val2: payload.val2,
        val3: payload.val3,
        selfExpire: payload.selfExpire,
      };
      let pendingDurations = s.pendingDurations;
      if (pendente) {
        const semEstaChave = { ...(pendingDurations[gid] ?? {}) };
        delete semEstaChave[payload.efstId];
        pendingDurations = { ...pendingDurations, [gid]: semEstaChave };
      }
      return { byGid: { ...s.byGid, [gid]: [...semEsteId, efeito] }, pendingDurations };
    }),

  end: (gid, efstId) =>
    set((s) => {
      // invalida qualquer duração pendente da mesma chave — uma duração
      // atrasada não pode reviver um status que o servidor já encerrou.
      let pendingDurations = s.pendingDurations;
      if (pendingDurations[gid]?.[efstId] !== undefined) {
        const semEstaChave = { ...pendingDurations[gid] };
        delete semEstaChave[efstId];
        pendingDurations = { ...pendingDurations, [gid]: semEstaChave };
      }
      const atual = s.byGid[gid];
      if (!atual) return pendingDurations === s.pendingDurations ? s : { pendingDurations };
      const restante = atual.filter((e) => e.efstId !== efstId);
      if (restante.length === atual.length) return pendingDurations === s.pendingDurations ? s : { pendingDurations };
      const byGid = { ...s.byGid };
      if (restante.length === 0) delete byGid[gid];
      else byGid[gid] = restante;
      return { byGid, pendingDurations };
    }),

  setDuration: (gid, efstId, totalMs, remainMs) =>
    set((s) => {
      const atual = s.byGid[gid];
      const idx = atual?.findIndex((e) => e.efstId === efstId) ?? -1;
      if (idx === -1) {
        // entrada ainda não existe — guarda pendente ("BODY_STATE → DURATION"
        // não aconteceu ainda), `start()` aplica quando ela nascer.
        return {
          pendingDurations: {
            ...s.pendingDurations,
            [gid]: { ...(s.pendingDurations[gid] ?? {}), [efstId]: { totalMs, remainMs } },
          },
        };
      }
      const novo = [...atual!];
      novo[idx] = { ...novo[idx]!, totalMs, endsAt: totalMs > 0 ? performance.now() + remainMs : 0 };
      return { byGid: { ...s.byGid, [gid]: novo } };
    }),

  clearGid: (gid) =>
    set((s) => {
      if (!s.byGid[gid] && !s.pendingDurations[gid]) return s;
      const byGid = { ...s.byGid };
      delete byGid[gid];
      const pendingDurations = { ...s.pendingDurations };
      delete pendingDurations[gid];
      return { byGid, pendingDurations };
    }),

  clearAll: () => set({ byGid: {}, pendingDurations: {} }),
}));

/** `__status()` no console — inspeciona `byGid` cru, mesmo padrão de
 * `__world()`/`__skillsReset` etc. */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __status?: () => StatusState }).__status = () => useStatusStore.getState();
}
