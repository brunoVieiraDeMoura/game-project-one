import { io, type Socket } from "socket.io-client";

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
  "self:stat": (p: { name: string; id: number; value: number; bonus?: number }) => void;
  "self:status": (p: Record<string, number>) => void;
  "inv:list": (p: InventoryItemPayload[]) => void;
  "inv:add": (p: InventoryItemPayload) => void;
  "inv:remove": (p: { index: number; amount: number }) => void;
  "skill:list": (p: SkillPayload[]) => void;
  "skill:cast": (p: { skillId: number; level: number; sourceGid: number; targetGid: number; damage: number; count: number; kind: "target" | "buff" }) => void;
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
  "session:closed": (p: { stage: string; reason: string }) => void;
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
  "stat:raise": (p: { stat: "str" | "agi" | "vit" | "int" | "dex" | "luk" }) => void;
  "skill:use": (p: { skillId: number; level: number; targetGid: number }) => void;
  "skill:use-ground": (p: { skillId: number; level: number; x: number; y: number }) => void;
  "npc:talk": (p: { gid: number }) => void;
  "npc:next": (p: { gid: number }) => void;
  "npc:menu": (p: { gid: number; choice: number }) => void;
  "npc:close": (p: { gid: number }) => void;
  "entity:info": (p: { gid: number }) => void;
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
    if (import.meta.env.DEV) {
      // console do navegador fala com o servidor: útil para @comandos de GM e
      // para testar um pacote sem passar pela UI
      (window as unknown as { __gateway?: GatewaySocket }).__gateway = socket;
    }
  }
  return socket;
}

export function disconnectGateway(): void {
  socket?.disconnect();
  socket = null;
}
