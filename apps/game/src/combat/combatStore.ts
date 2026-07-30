import { create } from "zustand";
import * as THREE from "three";

/**
 * Estado de combate do modo LOCAL (preview do editor de mapas).
 *
 * NÃO é o combate do jogo: com sessão no rAthena, HP, dano, alvo e drop vêm do
 * servidor (`net/playerStore`, `net/worldStore`, `net/damageFeed`) e nada aqui
 * roda. O que sobrou tem um uso só: dar um HP fictício para o autor do mapa
 * testar gatilho de dano/cura (`play/TriggerRuntime`) sem subir servidor.
 *
 * O combate simulado de verdade (fórmulas, IA de mob, auto-ataque) foi
 * removido — ver CLAUDE.md, "Engine simulado removido".
 */

export interface MonsterCombat {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  alive: boolean;
  /** stats fracos (tipo Poring) pro cálculo de dano */
  atk: number;
  def: number;
}

export interface DamageNumber {
  id: number;
  x: number;
  y: number;
  z: number;
  value: number;
  crit: boolean;
  toPlayer: boolean;
}

export interface Drop {
  id: string;
  x: number;
  z: number;
  color: string;
}

export interface PlayerCombat {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  alive: boolean;
}

interface CombatState {
  player: PlayerCombat;
  monsters: Record<string, MonsterCombat>;
  target: string | null;
  /** auto-attack básico ligado (toggle do slot "1"): enquanto ligado e houver
   * alvo vivo, o player bate o hit base até o fim do combate. */
  basicAttack: boolean;
  damageNumbers: DamageNumber[];
  drops: Drop[];

  registerMonster: (id: string, m: MonsterCombat) => void;
  setTarget: (id: string | null) => void;
  toggleBasicAttack: () => void;
  setBasicAttack: (on: boolean) => void;
  /** aplica a ficha real (Swordman) no player: nome/level/HP/SP cheios */
  configurePlayer: (p: { name: string; level: number; maxHp: number; maxSp: number }) => void;
  hitMonster: (id: string, value: number, crit: boolean, pos: THREE.Vector3) => void;
  hitPlayer: (value: number, pos: THREE.Vector3) => void;
  healPlayer: (value: number) => void;
  addDrop: (drop: Drop) => void;
  removeDrop: (id: string) => void;
  respawnPlayer: () => void;
  clearDamageNumber: (id: number) => void;
  reset: () => void;
}

let dmgSeq = 1;

export const PLAYER_MAX_HP = 400;
export const PLAYER_MAX_SP = 150;

const freshPlayer = (): PlayerCombat => ({
  name: "Knight",
  level: 50,
  hp: PLAYER_MAX_HP,
  maxHp: PLAYER_MAX_HP,
  sp: PLAYER_MAX_SP,
  maxSp: PLAYER_MAX_SP,
  alive: true,
});

export const useCombatStore = create<CombatState>((set) => ({
  player: freshPlayer(),
  monsters: {},
  target: null,
  basicAttack: false,
  damageNumbers: [],
  drops: [],

  registerMonster: (id, m) => set((s) => ({ monsters: { ...s.monsters, [id]: m } })),

  setTarget: (id) => set({ target: id }),
  toggleBasicAttack: () => set((s) => ({ basicAttack: !s.basicAttack })),
  setBasicAttack: (on) => set({ basicAttack: on }),
  configurePlayer: (p) =>
    set((s) => ({
      player: { ...s.player, name: p.name, level: p.level, maxHp: p.maxHp, hp: p.maxHp, maxSp: p.maxSp, sp: p.maxSp },
    })),

  hitMonster: (id, value, crit, pos) =>
    set((s) => {
      const m = s.monsters[id];
      if (!m || !m.alive) return s;
      const hp = Math.max(0, m.hp - value);
      const alive = hp > 0;
      const monsters = { ...s.monsters, [id]: { ...m, hp, alive } };
      const damageNumbers = [
        ...s.damageNumbers,
        { id: dmgSeq++, x: pos.x, y: pos.y + 3, z: pos.z, value, crit, toPlayer: false },
      ];
      const drops = alive
        ? s.drops
        : [...s.drops, { id: `drop-${id}-${Date.now()}`, x: pos.x, z: pos.z, color: DROP_COLORS[(dmgSeq * 7) % DROP_COLORS.length]! }];
      // matar o alvo selecionado limpa o alvo E desliga o auto-ataque
      const killedTarget = !alive && s.target === id;
      const target = killedTarget ? null : s.target;
      const basicAttack = killedTarget ? false : s.basicAttack;
      return { monsters, damageNumbers, drops, target, basicAttack };
    }),

  hitPlayer: (value, pos) =>
    set((s) => {
      if (!s.player.alive) return s;
      const hp = Math.max(0, s.player.hp - value);
      return {
        player: { ...s.player, hp, alive: hp > 0 },
        damageNumbers: [
          ...s.damageNumbers,
          { id: dmgSeq++, x: pos.x, y: pos.y + 3, z: pos.z, value, crit: false, toPlayer: true },
        ],
      };
    }),

  healPlayer: (value) =>
    set((s) => {
      if (!s.player.alive) return s;
      const hp = Math.min(s.player.maxHp, s.player.hp + value);
      if (hp === s.player.hp) return s;
      return { player: { ...s.player, hp } };
    }),

  addDrop: (drop) => set((s) => ({ drops: [...s.drops, drop] })),
  removeDrop: (id) => set((s) => ({ drops: s.drops.filter((d) => d.id !== id) })),
  respawnPlayer: () => set((s) => ({ player: { ...s.player, hp: s.player.maxHp, sp: s.player.maxSp, alive: true } })),
  clearDamageNumber: (id) => set((s) => ({ damageNumbers: s.damageNumbers.filter((d) => d.id !== id) })),
  reset: () => set({ player: freshPlayer(), monsters: {}, target: null, basicAttack: false, damageNumbers: [], drops: [] }),
}));

const DROP_COLORS = ["#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#eab308"];

// aux de dev: inspecionar/dirigir combate no console (testes de comportamento)
if (import.meta.env.DEV) (window as unknown as { __combat?: unknown }).__combat = useCombatStore;
