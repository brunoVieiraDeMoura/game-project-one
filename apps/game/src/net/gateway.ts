import { io, type Socket } from "socket.io-client";
import {
  aplicarPingSimulado,
  guardarPing,
  lerPingGuardado,
  pingDaUrl,
  SEM_PING,
  type PingSimulado,
  type SocketEmbrulhavel,
} from "./pingSimulado";
import { ativo, quadro, registrarEvento, registrarMeta } from "../core/diagnostics/flightRecorder";

/**
 * Único ponto de contato com o gateway (apps/gateway, porta 4100).
 *
 * O navegador NÃO fala o protocolo do rAthena: o binário morre no gateway e
 * aqui só chegam estes eventos JSON. Trocar de servidor, reconectar ou trocar o
 * transporte é mexer só neste arquivo.
 */

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:4100";

export interface CharSummary {
  slot: number;
  gid: number;
  name: string;
  job: number;
  level: number;
  jobLevel: number;
  baseExp: number;
  jobExp: number;
  zeny: number;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  str: number;
  agi: number;
  vit: number;
  int: number;
  dex: number;
  luk: number;
  head: number;
  headPalette: number;
  bodyPalette: number;
  weapon: number;
  shield: number;
  mapName: string;
}

/** Célula do rAthena (o mapa 3D converte para hexágono). */
export interface Cell {
  x: number;
  y: number;
}

export type EntityKind = "player" | "mob" | "npc" | "item" | "skill" | "unknown";

export interface EntitySnapshot {
  gid: number;
  kind: EntityKind;
  /** mobId (mob_db) para monstro; classe para jogador */
  job: number;
  name?: string;
  x: number;
  y: number;
  dir: number;
  speed: number;
  hp?: number;
  maxHp?: number;
}

export interface InventoryItemPayload {
  index: number;
  itemId: number;
  amount: number;
  type: number;
  identified: boolean;
  refine: number;
  equipped: boolean;
  /** bitmask EQP_* de onde está equipado — 0 = não equipado */
  location: number;
  cards: number[];
}

export interface SkillPayload {
  id: number;
  name: string;
  level: number;
  spCost: number;
  range: number;
  upgradable: boolean;
}

/** Janela de diálogo do NPC, como o gateway manda. */
export type NpcDialogPayload =
  | { gid: number; kind: "text"; text: string }
  | { gid: number; kind: "next" }
  | { gid: number; kind: "menu"; options: string[] }
  | { gid: number; kind: "close" };

export interface WorldEnter {
  mapName: string;
  x: number;
  y: number;
  dir: number;
  gid: number;
  /** ficha vinda da lista do char-server — estado inicial do HUD */
  char: CharSummary | null;
}

export interface ServerEvents {
  "gateway:hello": (p: { protocol: number; packetver: number }) => void;
  "auth:ok": (p: { accountId: number; sex: number }) => void;
  "auth:error": (p: { reason: string }) => void;
  "char:list": (p: { chars: CharSummary[]; slots: number }) => void;
  "char:error": (p: { reason: string }) => void;
  "world:enter": (p: WorldEnter) => void;
  "self:move": (p: { from: Cell; to: Cell; startTime: number }) => void;
  /** teleporte/empurrão: nova célula do próprio personagem, sem caminhada */
  "self:warp": (p: Cell) => void;
  /**
   * O alvo está longe demais para bater.
   *
   * O rAthena NÃO persegue por conta do jogador (só monstro faz isso,
   * unit.cpp:3259): ele manda esta resposta e desiste. Aproximar-se é trabalho
   * do cliente, e é o que o cliente oficial faz.
   */
  "attack:too-far": (p: { gid: number; x: number; y: number; euX: number; euY: number; range: number }) => void;
  "self:stat": (p: { name: string; id: number; value: number; bonus?: number }) => void;
  "self:status": (p: Record<string, number>) => void;
  "inv:list": (p: InventoryItemPayload[]) => void;
  "inv:add": (p: InventoryItemPayload) => void;
  "inv:remove": (p: { index: number; amount: number }) => void;
  "item:equip-result": (p: { index: number; success: boolean; equipped: boolean; location: number }) => void;
  /** resposta a `card:list` — silêncio do servidor (sem pacote nenhum) já quer dizer "zero opções" */
  "card:options": (p: { cardIndex: number; equipIndexes: number[] }) => void;
  /** resposta a `card:insert`; `cards` já vem pronto, calculado pelo gateway */
  "card:result": (p: { equipIndex: number; cardIndex: number; success: boolean; cards: number[] }) => void;
  "skill:list": (p: SkillPayload[]) => void;
  "skill:cast": (p: { skillId: number; level: number; sourceGid: number; targetGid: number; damage: number; count: number; kind: "target" | "buff"; action: number }) => void;
  "skill:casting": (p: { skillId: number; sourceGid: number; targetGid: number; x: number; y: number; durationMs: number }) => void;
  "skill:ground": (p: { gid: number; creatorGid: number; x: number; y: number; unitId: number; visible: boolean }) => void;
  "skill:ground-gone": (p: { gid: number }) => void;
  /** recarga da skill; a duração é do servidor (ZC_SKILL_POSTDELAY) */
  "skill:cooldown": (p: { skillId: number; durationMs: number }) => void;
  "npc:dialog": (p: NpcDialogPayload) => void;
  "ground:item": (p: { gid: number; itemId: number; amount: number; x: number; y: number; identified: boolean; subX: number; subY: number }) => void;
  "ground:item-gone": (p: { gid: number }) => void;
  "entity:spawn": (p: EntitySnapshot) => void;
  "entity:move": (p: { gid: number; from: Cell; to: Cell; speed: number }) => void;
  "entity:stop": (p: { gid: number; x: number; y: number }) => void;
  "entity:vanish": (p: { gid: number; reason: number }) => void;
  "entity:name": (p: { gid: number; name: string }) => void;
  "entity:level": (p: { gid: number; level: number }) => void;
  "entity:action": (p: {
    gid: number;
    targetGid: number;
    damage: number;
    count: number;
    action: number;
  }) => void;
  "entity:hp": (p: { gid: number; hp: number; maxHp: number }) => void;
  "chat:message": (p: { gid?: number; text: string; scope: string }) => void;
  "friend:list": (p: FriendPayload[]) => void;
  "friend:state": (p: { accountId: number; charId: number; online: boolean }) => void;
  "friend:request": (p: { accountId: number; charId: number; name: string }) => void;
  "friend:added": (p: { result: number; reason: string; friend: FriendPayload | null }) => void;
  "friend:removed": (p: { accountId: number; charId: number }) => void;
  "guild:members": (p: GuildMemberPayload[]) => void;
  "ignore:list": (p: string[]) => void;
  "session:closed": (p: { stage: string; reason: string }) => void;
}

/**
 * Amigo da lista do servidor. Sem nível, classe ou mapa DE PROPÓSITO: em
 * PACKETVER 20130618 o ZC_FRIENDS_LIST só carrega ids e nome (clif.cpp:15355).
 */
export interface FriendPayload {
  accountId: number;
  charId: number;
  name: string;
  online: boolean;
}

/** Membro da guilda (ZC_MEMBERMGR_INFO): esta, sim, traz nível e classe. */
export interface GuildMemberPayload {
  accountId: number;
  charId: number;
  name: string;
  job: number;
  level: number;
  online: boolean;
  position: number;
}

export interface ClientEvents {
  "auth:login": (p: { username: string; password: string }) => void;
  "char:select": (p: { slot: number }) => void;
  "char:create": (p: { slot: number; name: string; hair: number; hairColor: number }) => void;
  "char:delete": (p: { gid: number; email: string }) => void;
  "world:ready": () => void;
  "move:to": (p: Cell) => void;
  "action:attack": (p: { gid: number; continuous: boolean }) => void;
  /** `scope` escolhe o canal (party/guild/global/trade); omitido = fala de mapa */
  "chat:send": (p: { text: string; scope?: string }) => void;
  "item:use": (p: { index: number }) => void;
  "item:equip": (p: { index: number; position?: number }) => void;
  "item:unequip": (p: { index: number }) => void;
  "item:pickup": (p: { gid: number }) => void;
  "item:drop": (p: { index: number; amount: number }) => void;
  "card:list": (p: { index: number }) => void;
  "card:insert": (p: { cardIndex: number; equipIndex: number }) => void;
  "stat:raise": (p: { stat: "str" | "agi" | "vit" | "int" | "dex" | "luk" }) => void;
  "skill:use": (p: { skillId: number; level: number; targetGid: number }) => void;
  "skill:use-ground": (p: { skillId: number; level: number; x: number; y: number }) => void;
  "npc:talk": (p: { gid: number }) => void;
  "npc:next": (p: { gid: number }) => void;
  "npc:menu": (p: { gid: number; choice: number }) => void;
  "npc:close": (p: { gid: number }) => void;
  "entity:info": (p: { gid: number }) => void;
  "friend:add": (p: { name: string }) => void;
  "friend:remove": (p: { accountId: number; charId: number }) => void;
  "friend:answer": (p: { accountId: number; charId: number; accept: boolean }) => void;
  "guild:request": () => void;
  "ignore:add": (p: { name: string }) => void;
  "ignore:remove": (p: { name: string }) => void;
  /** gasta 1 ponto de habilidade (CZ_UPGRADE_SKILLLEVEL); o servidor valida */
  "skill:raise": (p: { skillId: number }) => void;
}

export type GatewaySocket = Socket<ServerEvents, ClientEvents>;

let socket: GatewaySocket | null = null;

/**
 * Conexão única para a aba inteira: a sessão do rAthena vive presa a ESTE
 * socket no gateway (login → char → map). Reconectar significa relogar, por
 * isso `autoConnect` fica ligado e nunca derrubamos ao trocar de rota.
 */
export function gateway(): GatewaySocket {
  if (!socket) {
    socket = io(GATEWAY_URL, { transports: ["websocket"] });
    // `typeof window` porque este módulo é alcançado por TESTE (ambiente node),
    // onde `import.meta.env.DEV` é verdadeiro e `window` não existe — a mesma
    // guarda que o `net/movDebug` já usa
    if (import.meta.env.DEV && typeof window !== "undefined") {
      // console do navegador fala com o servidor: útil para @comandos de GM e
      // para testar um pacote sem passar pela UI
      (window as unknown as { __gateway?: GatewaySocket }).__gateway = socket;
      instalarPingSimulado(socket);
      instalarGravadorDeRede(socket);
    }
  }
  return socket;
}

/**
 * Espelha o tráfego de MOVIMENTO no flight recorder (DEV).
 *
 * Usa `onAny`/`onAnyOutgoing` em vez de embrulhar `on`/`emit`, e a razão é
 * concreta: quem embrulha `on` tem de manter o mapa original→embrulhado para o
 * `off` conseguir remover o handler certo (é o que o `pingSimulado` faz, e é a
 * única regra de verdade daquele módulo). Dois embrulhos empilhados dobrariam
 * essa armadilha — um `off` que falhasse deixaria o mundo processando cada
 * pacote duas vezes, que é bem pior que não ter medida. `onAny` é um caminho
 * separado e não interfere em registro nenhum.
 *
 * O PREÇO disso, e ele está anotado no dado: com ping simulado, `onAny` vê o
 * pacote ANTES do atraso de descida, porque o atraso mora no handler embrulhado.
 * Então este evento é "chegou no socket"; "foi processado pelo mundo" é o que o
 * `worldStore` registra. Quando os dois estiverem no mesmo caso, a diferença
 * entre eles É o atraso simulado — e é assim que se confere que ele está agindo.
 *
 * Só entra o que diz respeito ao PRÓPRIO personagem. `entity:move` chega
 * dezenas de vezes por segundo com `area_size: 60` e encheria o anel de 512
 * eventos em poucos segundos, empurrando para fora justamente o que interessa.
 */
function instalarGravadorDeRede(s: GatewaySocket): void {
  /** o que o próprio personagem faz — o resto é ruído para esta investigação */
  const INTERESSA = new Set(["self:move", "self:warp", "world:enter", "self:status"]);
  /** chegada do pacote de movimento anterior, para o intervalo entre eles */
  let ultimoMove = 0;
  /** maior `startTime` já visto: um menor é pacote FORA DE ORDEM */
  let maiorTick = 0;

  s.onAny((evento: string, ...args: unknown[]) => {
    if (!ativo() || !INTERESSA.has(evento)) return;
    const agora = performance.now();
    const p = args[0] as { from?: Cell; to?: Cell; startTime?: number } | undefined;

    if (evento === "self:move" && p) {
      const dt = ultimoMove > 0 ? agora - ultimoMove : NaN;
      ultimoMove = agora;
      quadro().dtEntreSnapshots = dt;
      const tick = p.startTime ?? 0;
      // o rAthena manda um pacote por TRECHO, então o tick só pode crescer;
      // menor que o maior visto é reordenação no caminho (ou relógio virado)
      if (tick > 0 && tick < maiorTick) {
        registrarEvento("network", "fora-de-ordem", { tick, maiorTick, atraso: maiorTick - tick }, agora);
      }
      if (tick > maiorTick) maiorTick = tick;
      registrarEvento(
        "network",
        "self:move",
        { de: `${p.from?.x},${p.from?.y}`, para: `${p.to?.x},${p.to?.y}`, tick, dtMs: dt },
        agora,
      );
      return;
    }
    registrarEvento("network", evento, undefined, agora);
  });

  s.onAnyOutgoing((evento: string, ...args: unknown[]) => {
    if (!ativo() || evento !== "move:to") return;
    const alvo = args[0] as Cell | undefined;
    registrarEvento("network", "move:to", { alvo: `${alvo?.x},${alvo?.y}` }, performance.now());
  });
}

/**
 * Ping falso, para poder DESENVOLVER netcode com o servidor a zero ms daqui.
 *
 * Predição, reconciliação e interpolação são remédios para latência: no WSL
 * local o RTT é ~0 e nenhuma delas se manifesta, então o código pode estar
 * errado e parecer perfeito. `?ping=120&jitter=40` na URL liga o banco de
 * provas, e `__ping(rtt, jitter)` no console muda ao vivo — a configuração é
 * lida POR REFERÊNCIA a cada evento, então não é preciso reconectar nem
 * re-registrar handler nenhum.
 *
 * Embrulha o socket UMA vez, aqui, porque este é o único ponto de contato com o
 * servidor. Só em DEV; em produção nada disto existe.
 */
function instalarPingSimulado(s: GatewaySocket): void {
  /**
   * A URL manda quando traz `?ping`; senão, vale o que ficou guardado.
   *
   * O socket nasce no LOGIN — é lá que `gateway()` é chamado primeiro —, então
   * `?ping=150` na URL do `/play` chegava tarde demais e não fazia nada. Com o
   * valor guardado, o parâmetro vale a partir de qualquer tela e sobrevive à
   * navegação; `?ping=0` limpa.
   */
  const daUrl = window.location.search.includes("ping=") ? pingDaUrl(window.location.search) : null;
  const cfg = daUrl ?? lerPingGuardado() ?? { ...SEM_PING };
  if (daUrl) guardarPing(daUrl);
  aplicarPingSimulado(s as unknown as SocketEmbrulhavel, cfg);
  // sem isto, um JSON exportado não diz se foi colhido com ping simulado — e a
  // mesma sessão lida com 0 e com 120 ms de RTT conta histórias diferentes
  registrarMeta({ pingSimulado: { ...cfg } });
  const w = window as unknown as { __ping?: (rtt?: number, jitter?: number) => PingSimulado };
  w.__ping = (rtt, jitter) => {
    if (rtt !== undefined) {
      cfg.subida = Math.max(0, rtt / 2);
      cfg.descida = Math.max(0, rtt / 2);
    }
    if (jitter !== undefined) cfg.jitter = Math.max(0, jitter);
    guardarPing(cfg);
    return { ...cfg };
  };
  if (cfg.subida > 0 || cfg.jitter > 0) {
    // eslint-disable-next-line no-console
    console.info(`[gateway] ping simulado: ${cfg.subida + cfg.descida} ms RTT, jitter ${cfg.jitter} ms`);
  }
}

export function disconnectGateway(): void {
  socket?.disconnect();
  socket = null;
}
