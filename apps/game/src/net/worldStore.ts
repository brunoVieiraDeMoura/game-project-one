import { create } from "zustand";
import type { EntityKind } from "./gateway";
import { pathDurationMs, type Cell } from "./pathfind";

/**
 * O mundo como o SERVIDOR o descreve: entidades e o caminho que cada uma está
 * percorrendo, em célula do rAthena. Nada aqui é decidido pelo cliente — a cena
 * só interpola entre o que chegou.
 *
 * Posição interpolada NÃO mora no store: ela muda todo frame e passar por
 * setState mataria o render. O store guarda o segmento (de onde, para onde,
 * quando começou) e a cena calcula a posição no useFrame.
 */

export interface NetEntity {
  gid: number;
  kind: EntityKind;
  /** mobId para monstro; classe para jogador */
  job: number;
  name?: string;
  /** célula atual (origem do segmento em andamento) */
  x: number;
  y: number;
  /** destino do segmento; igual a x/y quando parado */
  toX: number;
  toY: number;
  /** ms (performance.now) em que o segmento começou */
  movedAt: number;
  /** duração estimada do segmento, em ms */
  durationMs: number;
  dir: number;
  /** velocidade do rAthena: ms para andar UMA célula (menor = mais rápido) */
  speed: number;
  hp?: number;
  maxHp?: number;
  /** nível do mob — vem junto do nome quando `show_mob_info` está ligado */
  level?: number;
  /** caminho célula a célula (ver `Motion.path`) */
  path?: Cell[];
  stepEnds?: number[];
}

/**
 * Segmento de caminhada do próprio personagem (mesma ideia do NetEntity).
 *
 * `path` é o caminho que o SERVIDOR percorreu entre origem e destino, calculado
 * no cliente pelo mesmo A* dele (net/pathfind). O pacote de movimento traz só as
 * duas pontas; sem refazer o caminho, o cliente cortava em diagonal por cima das
 * paredes. `stepEnds` guarda o instante (ms desde `movedAt`) em que cada passo
 * termina — a diagonal demora 40% a mais que o passo reto, então não dá para
 * dividir a duração igualmente.
 */
export interface SelfMotion {
  x: number;
  y: number;
  toX: number;
  toY: number;
  movedAt: number;
  durationMs: number;
  speed: number;
  path?: Cell[];
  stepEnds?: number[];
}

/**
 * Como o cliente descobre o caminho entre duas células.
 *
 * A cena registra isto quando o mapa carrega (`setPathfinder`), porque é ela
 * que tem a colisão. Sem pathfinder registrado — preview do editor, mapa ainda
 * carregando — o movimento cai no passo de rei de antes, que é o certo em
 * terreno livre.
 */
type Pathfinder = (from: Cell, to: Cell) => Cell[] | null;
let pathfinder: Pathfinder | null = null;

export function setPathfinder(fn: Pathfinder | null): void {
  pathfinder = fn;
}

/**
 * Caminho entre duas células DO SERVIDOR, pelo mesmo A* que o rAthena usa.
 *
 * Passa pelo pathfinder registrado pela cena (que sabe converter para a grade
 * local e conhece a colisão). Devolve `null` quando não há rota — ou quando
 * ninguém registrou nada, caso do preview do editor.
 */
export function serverPath(from: Cell, to: Cell): Cell[] | null {
  return pathfinder?.(from, to) ?? null;
}

/** monta o segmento (caminho + tempos) a partir das duas pontas do pacote */
function buildMotion(
  from: Cell,
  to: Cell,
  speed: number,
): { path?: Cell[]; stepEnds?: number[]; durationMs: number } {
  const path = pathfinder?.(from, to) ?? null;
  if (!path || path.length === 0) {
    // sem caminho conhecido: mantém o comportamento antigo (passo de rei)
    return { durationMs: cellDistance(from, to) * speed };
  }
  const stepEnds: number[] = [];
  let acc = 0;
  let anterior = from;
  for (const c of path) {
    acc += c.x !== anterior.x && c.y !== anterior.y ? (speed * 14) / 10 : speed;
    stepEnds.push(acc);
    anterior = c;
  }
  return { path, stepEnds, durationMs: pathDurationMs(path, from, speed) };
}

interface WorldState {
  /** gid do próprio personagem */
  selfGid: number;
  /**
   * O personagem do jogador NÃO chega por pacote de spawn (o servidor não
   * anuncia você para você mesmo): a posição inicial vem do ZC.ACCEPT_ENTER e
   * cada passo do ZC.NOTIFY_PLAYERMOVE. Por isso mora num campo próprio.
   */
  self: SelfMotion;
  entities: Record<number, NetEntity>;
  /** gid do alvo selecionado (clique/TAB); null = sem alvo */
  target: number | null;

  setSelfGid: (gid: number) => void;
  setTarget: (gid: number | null) => void;
  setSelfCell: (x: number, y: number) => void;
  selfMove: (from: { x: number; y: number }, to: { x: number; y: number }) => void;
  setSelfSpeed: (speed: number) => void;
  spawn: (e: Omit<NetEntity, "toX" | "toY" | "movedAt" | "durationMs">) => void;
  move: (gid: number, from: { x: number; y: number }, to: { x: number; y: number }, speed?: number) => void;
  stop: (gid: number, x: number, y: number) => void;
  vanish: (gid: number) => void;
  rename: (gid: number, name: string) => void;
  setLevel: (gid: number, level: number) => void;
  setHp: (gid: number, hp: number, maxHp: number) => void;
  clear: () => void;
}

/** Distância em células de um passo do rAthena (diagonal conta como 1). */
function cellDistance(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
}

/** 150 ms/célula é o walk speed padrão do rAthena (mmo.hpp DEFAULT_WALK_SPEED). */
const DEFAULT_WALK_SPEED = 150;

const IDLE_SELF: SelfMotion = {
  x: 0,
  y: 0,
  toX: 0,
  toY: 0,
  movedAt: 0,
  durationMs: 0,
  speed: DEFAULT_WALK_SPEED,
};

export const useWorldStore = create<WorldState>((set) => ({
  selfGid: 0,
  self: IDLE_SELF,
  entities: {},
  target: null,

  setSelfGid: (selfGid) => set({ selfGid }),
  setTarget: (target) => set({ target }),

  setSelfCell: (x, y) =>
    set((s) => {
      // Célula inválida joga o personagem para (0,0) — o canto do mapa —, e de
      // lá nada mais funciona. Melhor ignorar o pacote estranho que reposicionar
      // no vazio.
      if (!Number.isFinite(x) || !Number.isFinite(y)) return s;
      return { self: { ...s.self, x, y, toX: x, toY: y, movedAt: performance.now(), durationMs: 0 } };
    }),

  selfMove: (from, to) =>
    set((s) => {
      const now = performance.now();
      // De onde COMEÇAR a desenhar: se o personagem já estava andando, do ponto
      // exato onde ele está na tela — não da célula que o pacote traz. O
      // servidor manda a célula em que ele considera o personagem, que fica
      // atrás da posição visual; recomeçar dali dava o solavanco de "travadinha"
      // ao clicar num novo destino no meio do caminho.
      const atual = interpolatedCell(s.self, now);
      const origem = atual.moving ? { x: atual.x, y: atual.y } : from;
      return {
        self: {
          ...s.self,
          x: origem.x,
          y: origem.y,
          toX: to.x,
          toY: to.y,
          movedAt: now,
          ...buildMotion(from, to, s.self.speed),
        },
      };
    }),

  setSelfSpeed: (speed) => set((s) => ({ self: { ...s.self, speed: speed > 0 ? speed : s.self.speed } })),

  spawn: (e) =>
    set((s) => ({
      entities: {
        ...s.entities,
        [e.gid]: {
          ...e,
          // spawn pode chegar com a entidade já andando; sem o pacote de
          // movimento junto, tratamos como parada até o próximo NOTIFY_MOVE.
          toX: e.x,
          toY: e.y,
          movedAt: performance.now(),
          durationMs: 0,
          // nome/HP/nível só sobrescrevem se vieram: os pacotes de spawn antigos
          // não trazem e o ACK_REQNAME chega depois. Um re-spawn (o replay do
          // gateway ao entrar na cena) não pode apagar o que já se sabe.
          name: e.name ?? s.entities[e.gid]?.name,
          // HP negativo = "não sei" no protocolo do rAthena; não pode apagar o
          // valor que a plaquinha já tinha.
          hp: e.hp !== undefined && e.hp >= 0 ? e.hp : s.entities[e.gid]?.hp,
          maxHp: e.maxHp !== undefined && e.maxHp > 0 ? e.maxHp : s.entities[e.gid]?.maxHp,
          level: e.level ?? s.entities[e.gid]?.level,
        },
      },
    })),

  move: (gid, from, to, speed) =>
    set((s) => {
      const prev = s.entities[gid];
      if (!prev) return s;
      const stepSpeed = speed && speed > 0 ? speed : prev.speed;
      const now = performance.now();
      // mesma continuidade do próprio personagem: mob que muda de rumo no meio
      // do caminho continua de onde está desenhado
      const atual = interpolatedCell(prev, now);
      const origem = atual.moving ? { x: atual.x, y: atual.y } : from;
      return {
        entities: {
          ...s.entities,
          [gid]: {
            ...prev,
            x: origem.x,
            y: origem.y,
            toX: to.x,
            toY: to.y,
            movedAt: now,
            speed: stepSpeed,
            ...buildMotion(from, to, stepSpeed),
          },
        },
      };
    }),

  stop: (gid, x, y) =>
    set((s) => {
      const prev = s.entities[gid];
      if (!prev) return s;
      return {
        entities: {
          ...s.entities,
          [gid]: { ...prev, x, y, toX: x, toY: y, movedAt: performance.now(), durationMs: 0 },
        },
      };
    }),

  vanish: (gid) =>
    set((s) => {
      if (!s.entities[gid]) return s;
      const next = { ...s.entities };
      delete next[gid];
      // morreu/sumiu de vista: o alvo tem que cair junto, senão o HUD segura a
      // barra de vida de um mob que não existe mais.
      return { entities: next, target: s.target === gid ? null : s.target };
    }),

  rename: (gid, name) =>
    set((s) => (s.entities[gid] ? { entities: { ...s.entities, [gid]: { ...s.entities[gid]!, name } } } : s)),

  setLevel: (gid, level) =>
    set((s) => (s.entities[gid] ? { entities: { ...s.entities, [gid]: { ...s.entities[gid]!, level } } } : s)),

  setHp: (gid, hp, maxHp) =>
    set((s) => (s.entities[gid] ? { entities: { ...s.entities, [gid]: { ...s.entities[gid]!, hp, maxHp } } } : s)),

  clear: () => set({ entities: {}, self: IDLE_SELF, target: null }),
}));

// Espelho do estado do mundo no console, no mesmo espírito do __playStats do
// PlayView: sem isso, depurar "o servidor mandou o mob?" vira adivinhação.
if (import.meta.env.DEV) {
  (window as unknown as { __world?: () => unknown }).__world = () => {
    const s = useWorldStore.getState();
    return {
      selfGid: s.selfGid,
      self: s.self,
      alvo: s.target,
      entidades: Object.values(s.entities).map((e) => ({
        gid: e.gid,
        tipo: e.kind,
        job: e.job,
        nome: e.name,
        nivel: e.level,
        hp: e.hp !== undefined ? `${e.hp}/${e.maxHp}` : undefined,
        celula: [e.x, e.y],
        destino: [e.toX, e.toY],
      })),
    };
  };
}

/**
 * Célula interpolada no instante `now` (fracionária — a cena converte para
 * posição de mundo).
 *
 * O caminho NÃO é uma reta entre origem e destino: o Ragnarok anda de célula em
 * célula, oito direções, uma por vez. Interpolar em linha reta fazia o
 * personagem cortar diagonal por cima de tudo e chegar "deslizando"; aqui ele
 * percorre os mesmos passos que o servidor percorreu, cada um durando
 * `speed` ms — que é exatamente o que o rAthena quer dizer com velocidade
 * (ms por célula, menor = mais rápido).
 */
export function interpolatedCell(
  e: NetEntity | SelfMotion,
  now: number,
): { x: number; y: number; moving: boolean } {
  if (e.durationMs <= 0) {
    return { x: e.toX, y: e.toY, moving: false };
  }
  const decorrido = now - e.movedAt;
  const t = decorrido / e.durationMs;
  if (t >= 1) {
    return { x: e.toX, y: e.toY, moving: false };
  }

  // CAMINHO conhecido (o mesmo A* do servidor): segue passo a passo, cada um
  // com a sua duração — a diagonal leva 40% a mais. É isto que impede o
  // personagem de cortar reto por cima de uma parede.
  if (e.path && e.path.length > 0 && e.stepEnds && e.stepEnds.length === e.path.length) {
    let i = 0;
    while (i < e.stepEnds.length && decorrido > e.stepEnds[i]!) i++;
    if (i >= e.path.length) return { x: e.toX, y: e.toY, moving: false };
    const inicioPasso = i === 0 ? 0 : e.stepEnds[i - 1]!;
    const duracaoPasso = e.stepEnds[i]! - inicioPasso;
    const frac = duracaoPasso > 0 ? (decorrido - inicioPasso) / duracaoPasso : 1;
    const de = i === 0 ? { x: e.x, y: e.y } : e.path[i - 1]!;
    const para = e.path[i]!;
    return {
      x: de.x + (para.x - de.x) * frac,
      y: de.y + (para.y - de.y) * frac,
      moving: true,
    };
  }

  const steps = cellDistance({ x: e.x, y: e.y }, { x: e.toX, y: e.toY });
  if (steps <= 1) {
    return { x: e.x + (e.toX - e.x) * t, y: e.y + (e.toY - e.y) * t, moving: true };
  }

  // Passo "de rei": anda na diagonal enquanto os dois eixos têm distância, e
  // reto no que sobrar — é o caminho que o rAthena traça em terreno livre.
  const progress = t * steps;
  const done = Math.floor(progress);
  const frac = progress - done;

  const from = stepTowards({ x: e.x, y: e.y }, { x: e.toX, y: e.toY }, done);
  const next = stepTowards({ x: e.x, y: e.y }, { x: e.toX, y: e.toY }, done + 1);

  return {
    x: from.x + (next.x - from.x) * frac,
    y: from.y + (next.y - from.y) * frac,
    moving: true,
  };
}

/** posição depois de `steps` passos de rei de `from` em direção a `to` */
function stepTowards(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
): { x: number; y: number } {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const n = Math.min(steps, cellDistance(from, to));
  return {
    x: from.x + dx * Math.min(n, Math.abs(to.x - from.x)),
    y: from.y + dy * Math.min(n, Math.abs(to.y - from.y)),
  };
}
