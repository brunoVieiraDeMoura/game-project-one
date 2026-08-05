import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useWorldStore, interpolatedCell, setPathfinder } from "../net/worldStore";
import { fatiaDeRender, mesmaFatiaDeRender } from "../net/entityRenderSlice";
import { useDamageFeed } from "../net/damageFeed";
import { useGroundItems } from "../net/GroundItems";
import { findPath } from "../net/pathfind";
import { calibrar, custoRelativo, imprimirRelatorio } from "./orcamento";

/**
 * ORÇAMENTO POR CENÁRIO DE JOGO — "está fluido enquanto se JOGA?"
 *
 * O `desempenho.test.ts` mede PEÇAS (montar um chunk, um A*, uma varredura).
 * Este mede o que o jogador faz: andar, bater, pegar loot, ter mob em volta,
 * ter outros jogadores em volta. É outra pergunta, e ela pega outra classe de
 * regressão — nenhuma peça precisa piorar para o quadro engasgar, basta alguém
 * passar a fazer O(n) onde fazia O(1) por pacote de rede.
 *
 * ## O que é medido aqui, e o que NÃO é
 *
 * Medido: o custo de CPU que o cliente paga por pacote do servidor e por quadro
 * — o store, a interpolação, a resolução de caminho. É o que roda em Node e é o
 * que dá para travar num teste.
 *
 * Não medido: desenho. Draw call, passe de sombra e shader precisam de GPU e de
 * uma sessão aberta; quem responde por eles é o F9 (`scene/perfProbe`) com a
 * aba EM FOCO. Um teste que fingisse medir isso mentiria.
 *
 * ## As invariantes valem mais que os tempos
 *
 * Os limites de tempo têm folga (~3×) e pegam piora GRANDE. As invariantes de
 * contagem e de identidade não têm ruído nenhum e pegam a CAUSA: "um pacote de
 * movimento de um mob não pode tocar no objeto dos outros", "um pacote de
 * movimento não muda nada do que a entidade DESENHA". Quando uma delas quebra,
 * o quadro ainda não engasgou — mas vai.
 */

const W = 128;
const H = 128;

/** mapa com mata na borda e um paredão no meio: o A* tem que contornar */
function mapaDeTeste(): GameMap {
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  const surface: string[] = new Array(n).fill("grass");
  const heightmap: number[] = new Array(n).fill(0);
  const idx = (col: number, row: number) => row * W + col;
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      if (col < 4 || row < 4 || col >= W - 4 || row >= H - 4) collision[idx(col, row)] = "wall";
    }
  }
  // paredão com uma passagem só — obriga o A* a trabalhar de verdade
  for (let row = 30; row < 90; row++) if (row < 58 || row > 62) collision[idx(64, row)] = "wall";
  return {
    id: "cenarios",
    name: "cenarios",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap,
    collision,
    surface,
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
  } as unknown as GameMap;
}

const map = mapaDeTeste();

/**
 * Quantas entidades cada cenário simula.
 *
 * `area_size: 60` (rathena-conf/battle_conf.txt) faz o servidor anunciar tudo
 * num quadrado de 121×121 células. O `prt_fild08` tem 140 mobs de spawn base
 * espalhados em 400×400, então o que cai nessa janela é da ordem de algumas
 * dezenas — 40 é o caso comum e 120 é o campo cheio.
 */
const MOBS = 40;
const MOBS_LOTADO = 120;
const PLAYERS = 30;
const ITENS_NO_CHAO = 40;

let proximoGid = 1;

function povoar(qtd: number, kind: "mob" | "player"): number[] {
  const store = useWorldStore.getState();
  const gids: number[] = [];
  for (let i = 0; i < qtd; i++) {
    const gid = proximoGid++;
    gids.push(gid);
    store.spawn({
      gid,
      kind,
      job: kind === "mob" ? 1002 : 4054,
      // espalhados pelo lado andável do paredão
      x: 10 + (i % 45),
      y: 10 + Math.floor(i / 45) * 3,
      dir: 0,
      speed: 150,
      name: kind === "player" ? `Jogador${i}` : "Poring",
      hp: 100,
      maxHp: 100,
      level: 12,
    });
  }
  return gids;
}

/** um quadro: é o que o `useFrame` de cada NetEntity faz com a posição */
function umQuadroDeInterpolacao(): number {
  const { entities, gids } = useWorldStore.getState();
  let acc = 0;
  const agora = performance.now();
  for (const gid of gids) {
    const e = entities[gid];
    if (!e) continue;
    const c = interpolatedCell(e, agora);
    acc += c.x + c.y;
  }
  return acc;
}

/** move todo mundo uma célula, como o servidor faz num tick de caminhada */
function todosAndamUmPasso(gids: number[]): void {
  const { move, entities } = useWorldStore.getState();
  for (const gid of gids) {
    const e = entities[gid];
    if (!e) continue;
    move(gid, { x: e.x, y: e.y }, { x: e.x + 1, y: e.y }, 150);
  }
}

beforeEach(() => {
  useWorldStore.getState().clear();
  useDamageFeed.getState().reset();
  useGroundItems.getState().clear();
  setPathfinder(null);
});

describe("orçamento por cenário de jogo", () => {
  const calibracao = calibrar();
  afterAll(imprimirRelatorio);

  it("ANDAR: pedir caminho e interpolar o próprio personagem", () => {
    // O caminho é refeito a cada clique e a cada emenda de trecho (a cada 16
    // células andadas, ver net/pathfind). Interpolar é por QUADRO.
    setPathfinder((from, to) => findPath(map, from, to));
    const self = useWorldStore.getState();
    const custo = custoRelativo("andar (caminho + 60 quadros)", calibracao, 8, () => {
      self.selfMove({ x: 10, y: 10 }, { x: 110, y: 100 });
      for (let q = 0; q < 60; q++) {
        const s = useWorldStore.getState().self;
        interpolatedCell(
          { ...s, gid: 0, kind: "player", job: 0, dir: 0 } as never,
          performance.now() + q * 16,
        );
      }
    });
    // um segundo inteiro de caminhada tem de custar uma fração de quadro
    expect(custo).toBeLessThan(2.5);
  });

  it("BATER: rajada de dano e HP no alvo", () => {
    const [alvo] = povoar(1, "mob");
    const feed = useDamageFeed.getState();
    const mundo = useWorldStore.getState();
    // ASPD alto = ~4 golpes/s; 40 golpes é uma luta de dez segundos
    const custo = custoRelativo("bater (40 golpes)", calibracao, 8, () => {
      for (let i = 0; i < 40; i++) {
        mundo.setHp(alvo!, 100 - i, 100);
        feed.push({ gid: alvo!, value: 137 + i, crit: i % 7 === 0, miss: false, onSelf: false });
      }
      for (const n of useDamageFeed.getState().numbers) feed.clear(n.id);
    });
    expect(custo).toBeLessThan(1.5);
  });

  it("LOOT: itens caindo e sendo pegos", () => {
    const chao = useGroundItems.getState();
    const custo = custoRelativo("loot (40 caem, 40 pegos)", calibracao, 8, () => {
      for (let i = 0; i < ITENS_NO_CHAO; i++) {
        chao.put({ gid: 9000 + i, itemId: 501 + (i % 30), amount: 1, x: 20 + i, y: 30, subX: 4, subY: 4 });
      }
      for (let i = 0; i < ITENS_NO_CHAO; i++) chao.remove(9000 + i);
    });
    expect(custo).toBeLessThan(1.5);
  });

  it("COM MOB: 40 monstros andando e sendo interpolados", () => {
    const gids = povoar(MOBS, "mob");
    // um segundo de jogo: o servidor manda um passo por mob e o cliente desenha
    // 60 quadros. É o cenário mais comum do jogo inteiro.
    const custo = custoRelativo("40 mobs (1 s de jogo)", calibracao, 6, () => {
      todosAndamUmPasso(gids);
      for (let q = 0; q < 60; q++) umQuadroDeInterpolacao();
    });
    expect(custo).toBeLessThan(3);
  });

  it("CAMPO LOTADO: 120 monstros andando e sendo interpolados", () => {
    const gids = povoar(MOBS_LOTADO, "mob");
    const custo = custoRelativo("120 mobs (1 s de jogo)", calibracao, 6, () => {
      todosAndamUmPasso(gids);
      for (let q = 0; q < 60; q++) umQuadroDeInterpolacao();
    });
    expect(custo).toBeLessThan(8);
  });

  it("COM OUTROS JOGADORES: 30 players com nome, nível e HP", () => {
    const gids = povoar(PLAYERS, "player");
    const { rename, setLevel, setHp } = useWorldStore.getState();
    const custo = custoRelativo("30 players (1 s de jogo)", calibracao, 6, () => {
      todosAndamUmPasso(gids);
      // a ficha deles chega em pacotes separados, como a do mob
      for (const gid of gids) {
        rename(gid, `Jogador${gid}`);
        setLevel(gid, 50);
        setHp(gid, 900, 1000);
      }
      for (let q = 0; q < 60; q++) umQuadroDeInterpolacao();
    });
    expect(custo).toBeLessThan(3);
  });
});

/**
 * As invariantes. Sem ruído de medição — ou passam, ou há um defeito.
 */
describe("invariantes de custo do mundo", () => {
  it("um pacote de movimento NÃO muda o que a entidade desenha", () => {
    /**
     * Este é o que segura o custo de rede.
     *
     * O `NetEntityView` assina a entidade no store, e o `move` cria um objeto
     * NOVO por pacote — assinando a entidade inteira, cada passo de cada mob
     * re-renderizava a subárvore toda dele: hitbox, brilho de chão, plaquinha e
     * a barra de três malhas. Pior, o `<Text>` do drei chama `sync()` num
     * `useLayoutEffect` SEM array de dependências, então o atlas de glifo era
     * re-sincronizado em cada um desses renders.
     *
     * Posição não é coisa de render — ela é escrita num ref dentro do
     * `useFrame`. O que a entidade DESENHA é isto aqui, e um passo não pode
     * mexer em nada disso.
     */
    const [gid] = povoar(1, "mob");
    const antes = fatiaDeRender(useWorldStore.getState().entities[gid!]!);
    useWorldStore.getState().move(gid!, { x: 10, y: 10 }, { x: 11, y: 10 }, 150);
    const depois = fatiaDeRender(useWorldStore.getState().entities[gid!]!);
    expect(mesmaFatiaDeRender(antes, depois)).toBe(true);
  });

  it("o que MUDA o desenho continua sendo detectado", () => {
    // a rede de proteção da invariante acima: uma fatia que ignorasse tudo
    // passaria no teste anterior e esconderia HP e nome do jogador
    const [gid] = povoar(1, "mob");
    const antes = fatiaDeRender(useWorldStore.getState().entities[gid!]!);
    useWorldStore.getState().setHp(gid!, 20, 100);
    expect(mesmaFatiaDeRender(antes, fatiaDeRender(useWorldStore.getState().entities[gid!]!))).toBe(false);

    const comHp = fatiaDeRender(useWorldStore.getState().entities[gid!]!);
    useWorldStore.getState().rename(gid!, "Poring Bravo");
    expect(mesmaFatiaDeRender(comHp, fatiaDeRender(useWorldStore.getState().entities[gid!]!))).toBe(false);

    const comNome = fatiaDeRender(useWorldStore.getState().entities[gid!]!);
    useWorldStore.getState().setLevel(gid!, 99);
    expect(mesmaFatiaDeRender(comNome, fatiaDeRender(useWorldStore.getState().entities[gid!]!))).toBe(false);
  });

  it("mover UMA entidade não toca no objeto das OUTRAS", () => {
    // Se isto quebrar, o custo de um pacote passou a ser O(n) em objetos criados
    // — e com 120 mobs andando são 120 pacotes por segundo × n objetos.
    const gids = povoar(20, "mob");
    const outros = gids.slice(1);
    const antes = outros.map((g) => useWorldStore.getState().entities[g]);
    useWorldStore.getState().move(gids[0]!, { x: 10, y: 10 }, { x: 11, y: 10 }, 150);
    const depois = outros.map((g) => useWorldStore.getState().entities[g]);
    for (let i = 0; i < outros.length; i++) expect(depois[i]).toBe(antes[i]);
  });

  it("entidade que some não deixa nada para trás", () => {
    // gid órfão vira componente React montado sobre uma entidade inexistente;
    // alvo órfão vira barra de vida de um mob que morreu.
    const gids = povoar(5, "mob");
    useWorldStore.getState().setTarget(gids[2]!);
    useWorldStore.getState().vanish(gids[2]!);
    const s = useWorldStore.getState();
    expect(s.entities[gids[2]!]).toBeUndefined();
    expect(s.gids).not.toContain(gids[2]);
    expect(s.target).toBeNull();
  });

  it("número de dano não se acumula sem fim", () => {
    // cada número é um <Text> do drei (uma malha com atlas de glifo); esquecer
    // de limpar transforma uma luta longa em centenas de malhas vivas
    const feed = useDamageFeed.getState();
    for (let i = 0; i < 50; i++) feed.push({ gid: 1, value: i, crit: false, miss: false, onSelf: false });
    expect(useDamageFeed.getState().numbers).toHaveLength(50);
    for (const n of [...useDamageFeed.getState().numbers]) feed.clear(n.id);
    expect(useDamageFeed.getState().numbers).toHaveLength(0);
  });

  it("WARP no mesmo mapa esquece tudo que estava em volta", () => {
    /**
     * O vazamento que fazia o mapa parecer ter muito mais monstro do que tem.
     *
     * O rAthena NÃO manda `NOTIFY_VANISH` por entidade ao teleportar o jogador:
     * `pc_setpos` (pc.cpp) emite `clif_clearunit_area(*sd, CLR_TELEPORT)` — que
     * avisa os OUTROS de que este jogador sumiu — e depois manda
     * `ZC_NPCACK_MAPMOVE` para ele. Quem recebe MAPMOVE tem de limpar sozinho,
     * e é o que o cliente oficial faz.
     *
     * O gateway já limpava o snapshot dele (`this.entities.clear()`), mas o
     * store do navegador não limpava nada — e como o gateway acabara de
     * esquecer aquelas entidades, o `entity:vanish` delas NUNCA chegaria. Cada
     * `@jump`, warp de NPC dentro do mapa, Asa de Borboleta ou morte-e-respawn
     * no mesmo mapa deixava para trás as ~13 entidades que estavam à vista,
     * congeladas na última célula, para sempre.
     *
     * (Trocar de mapa escapava por acidente: o `mapId` muda, o `useMap` devolve
     * `null` enquanto busca, o `WorldEventsBridge` desmonta e o `clear()` da
     * limpeza do efeito roda. Warp de MESMO mapa não passa por nada disso.)
     */
    const gids = povoar(12, "mob");
    useWorldStore.getState().setSelfCell(50, 50);
    useWorldStore.getState().setTarget(gids[3]!);
    expect(useWorldStore.getState().gids).toHaveLength(12);

    useWorldStore.getState().limparEntidades();

    const s = useWorldStore.getState();
    expect(s.gids).toHaveLength(0);
    expect(Object.keys(s.entities)).toHaveLength(0);
    // alvo tem de cair junto: segurar a barra de vida de um mob que ficou no
    // outro canto do mapa é o mesmo defeito do `vanish`
    expect(s.target).toBeNull();
    // ...mas o PRÓPRIO personagem sobrevive: num warp de mesmo mapa quem o
    // reposiciona é o `self:warp` que vem logo atrás, e zerar aqui o jogaria
    // para a célula 0,0 por um quadro
    expect(s.self.x).toBe(50);
    expect(s.self.y).toBe(50);
  });

  it("esquecer o mundo AVISA quem compara posições entre quadros", () => {
    /**
     * O detector de rollback do `NetPlayer` guarda a última posição DESENHADA e
     * a compara com a do quadro seguinte. Num portal essa posição descreve o
     * mapa ANTERIOR, e o `self` volta para `0,0` — a comparação virava um
     * "rollback" do tamanho do mapa.
     *
     * Medido no `voo-1785938553239.json`: dois portais produziram rollbacks de
     * **424 e 101 células**, com `para: "0.00,0.00"` no próprio evento, e
     * queimaram 2 dos 4 slots de captura. `geracao` é o que deixa quem compara
     * saber que a referência ficou para trás.
     */
    const antes = useWorldStore.getState().geracao;
    useWorldStore.getState().limparEntidades();
    expect(useWorldStore.getState().geracao).toBe(antes + 1);

    // o fim de sessão conta pelo mesmo motivo
    useWorldStore.getState().clear();
    expect(useWorldStore.getState().geracao).toBe(antes + 2);

    // e ela NÃO se move num pacote comum: só "o mundo é outro" a incrementa,
    // senão o detector se cegaria a cada passo
    povoar(3, "mob");
    useWorldStore.getState().setSelfCell(10, 10);
    expect(useWorldStore.getState().geracao).toBe(antes + 2);
  });

  it("item pego sai do chão", () => {
    const chao = useGroundItems.getState();
    chao.put({ gid: 7001, itemId: 501, amount: 3, x: 5, y: 5, subX: 0, subY: 0 });
    expect(useGroundItems.getState().items[7001]).toBeDefined();
    chao.remove(7001);
    expect(useGroundItems.getState().items[7001]).toBeUndefined();
  });
});
