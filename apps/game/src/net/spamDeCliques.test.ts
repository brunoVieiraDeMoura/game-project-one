import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { interpolatedCell, setPathfinder, useWorldStore } from "./worldStore";
import { retaLivre, tetoDeTrecho, MAX_WALK_PATH_DEFAULT, MAX_WALK_PATH_COM_OBSTACULO } from "./pathfind";
import type { Cell } from "./pathfind";
import type { GameMap } from "@ragnarok/map-format";

/**
 * SPAM DE CLIQUE — a deriva que o `fixpos` revela.
 *
 * O relato tinha duas caras e uma causa só:
 *
 *  • spammar clique travava e fazia o personagem voltar células;
 *  • **castar uma skill andando** fazia ele voltar 2 ou 3.
 *
 * A segunda é a que denuncia: usar skill chama `unit_stop_walking(USW_FIXPOS)`
 * no rAthena (unit.cpp:2477), que manda `clif_fixpos` — o ZC_STOPMOVE, "a
 * posição de verdade é esta". Não é ele que causa o recuo: é ele que COBRA um
 * recuo que já existia. As 2-3 células são a medida de quanto o desenho do
 * cliente já estava adiantado.
 *
 * A deriva nascia de o cliente ignorar por completo o `from` de cada pacote de
 * movimento: ele redesenhava sempre a partir da própria posição, então o erro
 * nunca era lido de volta — só acumulava, a cada clique e a cada emenda de
 * trecho.
 *
 * A correção NÃO é puxar o personagem de volta (isso é o mesmo recuo com outro
 * nome). É corrigir pelo TEMPO: o trecho passa a durar o que vai durar para o
 * servidor, o desenho anda um pouco mais devagar e os dois se reencontram no
 * fim do trecho.
 */

/** caminho reto, uma célula por passo — chega para o que se mede aqui */
function rotaReta(from: Cell, to: Cell): Cell[] | null {
  const out: Cell[] = [];
  let { x, y } = from;
  let guarda = 0;
  while ((x !== to.x || y !== to.y) && guarda++ < 400) {
    if (x < to.x) x++;
    else if (x > to.x) x--;
    if (y < to.y) y++;
    else if (y > to.y) y--;
    out.push({ x, y });
  }
  return out.length > 0 ? out : null;
}

const st = () => useWorldStore.getState();
const visual = () => interpolatedCell(st().self, performance.now());

beforeEach(() => {
  vi.useFakeTimers();
  setPathfinder(rotaReta);
  st().clear();
  st().setSelfCell(10, 10);
  st().setSelfSpeed(100); // 100 ms por célula
});

afterEach(() => {
  vi.useRealTimers();
  setPathfinder(null);
});

describe("a deriva não cresce", () => {
  it("o trecho do cliente não pode acabar ANTES do trecho do servidor", () => {
    /**
     * O MECANISMO, isolado. Ao redirecionar, o cliente traça o caminho a partir
     * da célula onde ele DESENHA (13), e o servidor a partir da dele (12) — uma
     * célula a mais. Cobrando do trecho o tempo do caminho CURTO, o cliente
     * chegava ao destino antes e ficava parado ali enquanto o servidor ainda
     * andava.
     *
     * É desse estacionamento que sai o recuo: o pacote seguinte chega com o
     * servidor atrás, encontra o cliente com `moving: false` e recomeça o
     * desenho na célula dele — um salto para trás visível, que é o que uma skill
     * (via `clif_fixpos`) tornava óbvio.
     */
    st().selfMove({ x: 10, y: 10 }, { x: 30, y: 10 });
    vi.advanceTimersByTime(250); // desenhado em ~12,5
    const v = visual();
    expect(v.x).toBeGreaterThan(12);

    // servidor uma célula atrás do caminho que o cliente vai desenhar
    const servidor = { x: Math.round(v.x) - 1, y: 10 };
    st().selfMove(servidor, { x: 20, y: 10 });

    const passosDoServidor = 20 - servidor.x;
    // o trecho tem de durar o que vai durar PARA O SERVIDOR, senão o cliente
    // estaciona no destino e o pacote seguinte o puxa de volta
    expect(st().self.durationMs).toBeGreaterThanOrEqual(passosDoServidor * 100 - 1);
  });

  it("trinta redirecionamentos e o desenho não foge do servidor", () => {
    st().selfMove({ x: 10, y: 10 }, { x: 200, y: 10 });
    let maiorDesvio = 0;

    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(150);
      const v = visual();
      // é assim que o servidor descreve a si mesmo: a célula já ultrapassada
      const servidor = { x: Math.floor(v.x), y: 10 };
      maiorDesvio = Math.max(maiorDesvio, Math.abs(v.x - servidor.x));
      st().selfMove(servidor, { x: 200, y: 10 });
    }

    // uma célula é o desvio LEGÍTIMO (contínuo × centro de célula); mais que
    // isso é erro acumulado, e é o que o `fixpos` transformava em recuo
    expect(maiorDesvio).toBeLessThan(1.5);
  });

  it("terminar o trecho e receber o pacote seguinte NÃO joga para trás", () => {
    /**
     * O caso completo, ponta a ponta: anda, redireciona, deixa o trecho acabar
     * inteiro e só então recebe o pacote seguinte com o servidor atrás. É a
     * sequência exata que produzia o salto.
     */
    st().selfMove({ x: 10, y: 10 }, { x: 30, y: 10 });
    vi.advanceTimersByTime(250);
    const v = visual();
    const servidor = { x: Math.round(v.x) - 1, y: 10 };
    st().selfMove(servidor, { x: 20, y: 10 });

    // deixa o trecho INTEIRO passar
    vi.advanceTimersByTime(st().self.durationMs + 50);
    const noFim = visual();

    // o servidor ainda estava uma célula atrás quando manda o próximo
    st().selfMove({ x: 19, y: 10 }, { x: 40, y: 10 });
    const depois = interpolatedCell(st().self, performance.now() + 1);
    expect(depois.x).toBeGreaterThanOrEqual(noFim.x - 1e-6);
  });

  it("o desenho NUNCA anda de ré durante o spam", () => {
    st().selfMove({ x: 10, y: 10 }, { x: 200, y: 10 });
    let anterior = visual().x;
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(90);
      const v = visual();
      expect(v.x).toBeGreaterThanOrEqual(anterior - 1e-6);
      anterior = v.x;
      st().selfMove({ x: Math.floor(v.x), y: 10 }, { x: 200, y: 10 });
    }
  });

  it("adiantado, o cliente anda mais DEVAGAR — é assim que a deriva se paga", () => {
    // sem desvio: o trecho dura o caminho puro
    st().selfMove({ x: 10, y: 10 }, { x: 20, y: 10 });
    const semDesvio = st().self.durationMs;

    // com o servidor duas células atrás, o mesmo trecho tem de durar MAIS
    st().setSelfCell(10, 10);
    st().selfMove({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(250);
    const v = visual();
    st().selfMove({ x: Math.round(v.x) - 2, y: 10 }, { x: 20, y: 10 });
    const comDesvio = st().self.durationMs;
    const passosRestantes = 20 - Math.round(v.x);

    expect(comDesvio).toBeGreaterThan((passosRestantes - 0.5) * 100);
    expect(semDesvio).toBeCloseTo(1000, -2);
  });
});

describe("fixpos: correção quando é perto, teleporte quando é longe", () => {
  it("skill no meio da caminhada NÃO joga o personagem para trás", () => {
    /**
     * O caso literal do relato. `unit_skilluse_id` chama
     * `unit_stop_walking(USW_FIXPOS)` e o servidor manda a célula onde a
     * caminhada parou. O personagem PARA — isso é certo.
     *
     * ## Esta expectativa MUDOU quando a predição entrou
     *
     * Antes ela exigia que o personagem CONVERGISSE para a célula do servidor
     * em ~120 ms: um deslize curto para trás, aceito porque sem predição o
     * cliente quase nunca estava à frente, e a diferença era um arredondamento.
     *
     * Com client-side prediction o cliente anda ~meio RTT à frente POR
     * CONSTRUÇÃO, e o `clif_fixpos` — que o rAthena manda ao atacar, ao usar
     * skill e ao parar — passou a apontar sistematicamente uma célula já
     * percorrida. Aquele deslize deixou de ser arredondamento e virou o "ainda
     * tem algo fazendo retroceder".
     *
     * A regra agora é a mesma que vale no resto do módulo: **o desenho não anda
     * de ré**. Se o ponto do fixpos está mais perto da ORIGEM do trecho do que o
     * personagem, o servidor é que está atrasado — o personagem para onde está e
     * a diferença é paga no pacote seguinte, pelo tempo. Empurrão para o lado e
     * teleporte continuam sendo aplicados (os dois testes abaixo).
     */
    st().selfMove({ x: 10, y: 10 }, { x: 40, y: 10 });
    vi.advanceTimersByTime(450);
    const antes = visual();

    // o servidor cancela a caminhada uma célula atrás do desenho
    st().aplicarFixpos(Math.floor(antes.x), 10);

    const logoDepois = interpolatedCell(st().self, performance.now() + 1);
    expect(logoDepois.x).toBeCloseTo(antes.x, 1);
    // e FICA onde está — nem salta, nem desliza de volta
    vi.advanceTimersByTime(200);
    expect(visual().x).toBeCloseTo(antes.x, 2);
  });

  it("teleporte de verdade continua sendo instantâneo", () => {
    // @jump / Asa de Borboleta: o mesmo pacote, distância grande
    st().selfMove({ x: 10, y: 10 }, { x: 40, y: 10 });
    vi.advanceTimersByTime(300);
    st().aplicarFixpos(300, 300);
    const p = visual();
    expect(p.x).toBe(300);
    expect(p.y).toBe(300);
    expect(st().self.path).toBeUndefined();
  });

  it("a rota velha morre no fixpos", () => {
    st().selfMove({ x: 10, y: 10 }, { x: 40, y: 10 });
    expect(st().self.path?.length).toBeGreaterThan(0);
    st().aplicarFixpos(15, 10);
    // sem isto, o `{ ...self }` de quem chama seguiria a rota de antes do
    // cancelamento — o personagem "escorregando" para um destino cancelado
    expect(st().self.path).toBeUndefined();
    expect(st().self.stepEnds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

const W = 60;
const H = 60;

function mapaCom(bloqueadas: Array<[number, number]>): GameMap {
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  for (const [c, r] of bloqueadas) collision[r * W + c] = "wall";
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
    collision,
    surface: new Array(n).fill("grass"),
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
  } as unknown as GameMap;
}

describe("o teto de um pedido tem DUAS regras", () => {
  /**
   * `OFFICIAL_WALKPATH` está LIGADO nesta árvore
   * (`rathena/src/config/core.hpp:26`), e com ele o `unit_walktoxy` (unit.cpp:865)
   * recusa — EM SILÊNCIO — qualquer caminho de mais de 14 células cuja LINHA
   * RETA cruze bloqueio. O `max_walk_path` (30) é só o outro teto.
   *
   * Hoje isto não morde porque o `prt_fild08` está 100% andável. Morde no
   * primeiro relevo autorado, e a falha é muda: o clique simplesmente não faz
   * nada.
   */
  it("campo aberto: a reta está livre e vale o teto grande", () => {
    const map = mapaCom([]);
    expect(retaLivre(map, { x: 5, y: 5 }, { x: 40, y: 5 })).toBe(true);
    expect(tetoDeTrecho(map, { x: 5, y: 5 }, { x: 40, y: 5 })).toBeLessThan(MAX_WALK_PATH_DEFAULT);
    expect(tetoDeTrecho(map, { x: 5, y: 5 }, { x: 40, y: 5 })).toBeGreaterThan(MAX_WALK_PATH_COM_OBSTACULO);
  });

  it("com bloqueio na reta, o teto cai para o pequeno", () => {
    // um muro atravessando a linha entre as duas pontas
    const map = mapaCom(Array.from({ length: 9 }, (_, i) => [20, 1 + i] as [number, number]));
    expect(retaLivre(map, { x: 5, y: 5 }, { x: 40, y: 5 })).toBe(false);
    expect(tetoDeTrecho(map, { x: 5, y: 5 }, { x: 40, y: 5 })).toBeLessThan(MAX_WALK_PATH_COM_OBSTACULO);
  });

  it("a margem existe e é maior que uma célula", () => {
    /**
     * A margem antiga era de UMA célula (29 contra 30) e foi dimensionada para
     * um desvio de uma célula. Com o desvio acumulado de 2-3 que o cliente
     * chegava a ter, o trecho pedido estourava o teto na conta do servidor e
     * sumia calado — o clique "não tinha alcance".
     */
    const map = mapaCom([]);
    const teto = tetoDeTrecho(map, { x: 5, y: 5 }, { x: 40, y: 5 });
    expect(MAX_WALK_PATH_DEFAULT - teto).toBeGreaterThanOrEqual(2);
  });

  it("a reta enxerga um bloqueio na diagonal", () => {
    const map = mapaCom([[12, 12]]);
    expect(retaLivre(map, { x: 5, y: 5 }, { x: 20, y: 20 })).toBe(false);
    expect(retaLivre(map, { x: 5, y: 6 }, { x: 20, y: 6 })).toBe(true);
  });
});
