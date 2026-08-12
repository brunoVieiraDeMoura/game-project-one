import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { buildChunkGeometry, buildWaterGeometry, chunkCounts, chunksSujos } from "../grid/squareChunks";
import { findPath } from "../net/pathfind";
import { destinoAlcancavel } from "../net/moveTarget";
import { GameplayConfigSchema } from "@ragnarok/game-data";
import { raiosDeVisao } from "../play/viewRadius";
import { afterAll } from "vitest";
import { calibrar, custoRelativo, imprimirRelatorio, relatorio } from "./orcamento";

/**
 * ORÇAMENTO DE DESEMPENHO — a rede de proteção contra "ficou lerdo".
 *
 * Um teste de correção diz que a conta está certa; este diz que ela ainda cabe
 * no quadro. Sem ele, uma mudança inocente no shader, no chunk ou no A* só
 * aparece como engasgo semanas depois, e aí ninguém liga uma coisa à outra —
 * foi exatamente o que aconteceu com a construção de chunk em rajada (25 ms num
 * quadro que tem 16,6).
 *
 * ## Por que não medir em milissegundos crus
 *
 * Milissegundo depende da máquina, e um teste que passa aqui e falha noutro PC
 * é um teste que vai ser desligado na primeira sexta-feira. Aqui cada custo é
 * dividido pela CALIBRAÇÃO (um trabalho fixo, medido na mesma rodada), então o
 * limite é uma RAZÃO — "montar um chunk custa no máximo X vezes o trabalho de
 * referência". Máquina lenta faz os dois lados crescerem juntos.
 *
 * ## Como usar quando este teste falhar
 *
 * Ele não diz "não faça isso". Ele diz "isto ficou N× mais caro do que era" —
 * o número sai no relatório impresso. Aí ou existe um jeito mais barato de
 * escrever a mesma coisa, ou o custo é justificado e o limite sobe COM um
 * comentário dizendo o que se ganhou em troca.
 *
 * Os limites de hoje têm folga de ~3× sobre o medido, para não ficarem
 * apitando por causa de ruído de medição ou de uma máquina com outra relação
 * entre memória e CPU. Eles pegam PIORA GRANDE, que é o que interessa.
 */

const W = 128;
const H = 128;
const idx = (col: number, row: number) => row * W + col;

/**
 * Um mapa parecido com o de verdade — variedade importa.
 *
 * Um mapa todo "walkable"/"grass" mediria o caminho fácil de tudo: sem
 * fronteira de superfície não há mistura de camada, sem água não há lâmina, sem
 * bloqueio o A* anda em linha reta. O padrão abaixo põe mata, ravina, um lago e
 * um rio, que é o que o `prt_fild08` editado tem.
 */
function mapaRealista(): GameMap {
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  const surface: string[] = new Array(n).fill("grass");
  const heightmap: number[] = new Array(n).fill(0);

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = idx(col, row);
      // cinturão de mata na borda, como nos mapas importados
      const naBorda = col < 6 || row < 6 || col >= W - 6 || row >= H - 6;
      if (naBorda) {
        collision[i] = "wall";
        continue;
      }
      // relevo suave: é ele que faz a malha ter saia e normal variada
      heightmap[i] = Math.sin(col * 0.11) * 1.7 + Math.cos(row * 0.09) * 1.3;
      // manchas de superfície diferente → fronteiras de camada de textura
      if ((col + row) % 37 < 6) surface[i] = "dirt";
      else if ((col * 3 + row) % 53 < 4) surface[i] = "stone";
      // ravina
      if (row > 40 && row < 44 && col > 20 && col < 100) {
        collision[i] = "cliff";
        heightmap[i] = -2.5;
      }
    }
  }
  // lago
  for (let row = 60; row < 76; row++)
    for (let col = 30; col < 50; col++) {
      const i = idx(col, row);
      collision[i] = "water";
      surface[i] = "water";
      heightmap[i] = -1.2;
    }
  // rio atravessando
  for (let col = 10; col < W - 10; col++) {
    const row = 90 + Math.round(Math.sin(col * 0.15) * 5);
    for (let d = -1; d <= 1; d++) {
      const i = idx(col, row + d);
      collision[i] = "water";
      surface[i] = "river";
      heightmap[i] = -0.85;
    }
  }

  return {
    id: "perf",
    name: "perf",
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

const map = mapaRealista();
const { cols, rows } = chunkCounts(map);

describe("orçamento de desempenho", () => {
  const calibracao = calibrar();
  afterAll(imprimirRelatorio);

  it("montar a geometria de UM chunk", () => {
    // É o custo que aparece ao andar: cada fronteira de visão traz uma fileira
    // nova de chunks. O orçamento por quadro do SquareTerrain é de 6 ms, então
    // um chunk que passe disso sozinho volta a engasgar a caminhada.
    const custo = custoRelativo("chunk de terreno", calibracao, 12, () => {
      const geo = buildChunkGeometry(map, 1, 1);
      geo.dispose();
    });
    // medido hoje: 1,45 da calibração. Teto com folga de ~3×.
    expect(custo).toBeLessThan(4.5);
  });

  it("montar a lâmina d'água de um chunk", () => {
    const custo = custoRelativo("lâmina d'água", calibracao, 12, () => {
      buildWaterGeometry(map, 1, 2)?.dispose();
    });
    // medido hoje: 0,56 da calibração
    expect(custo).toBeLessThan(1.8);
  });

  it("varrer o mapa atrás de chunk sujo (uma pincelada)", () => {
    // Roda a CADA edição do mapa no editor, sobre os três arrays inteiros.
    const depois = { collision: [...map.collision], surface: [...map.surface], heightmap: [...map.heightmap] };
    (depois.heightmap as number[])[idx(70, 70)] = 5;
    const antes = { collision: map.collision, surface: map.surface, heightmap: map.heightmap };
    const custo = custoRelativo("varredura de chunk sujo", calibracao, 20, () => {
      chunksSujos(map, antes, depois as never);
    });
    // medido hoje: 0,073 — é uma varredura linear em três arrays
    expect(custo).toBeLessThan(0.3);
  });

  it("A* de uma ponta à outra do mapa", () => {
    const custo = custoRelativo("A* longo", calibracao, 8, () => {
      findPath(map, { x: 10, y: 10 }, { x: W - 12, y: H - 12 });
    });
    // medido hoje: 0,10 — o A* é barato porque a heurística é gulosa
    expect(custo).toBeLessThan(0.6);
  });

  it("clique num alvo inalcançável (o caso caro do movimento)", () => {
    // Clicar no miolo da mata: o A* recusa rápido, mas a varredura em anéis
    // tenta muitas candidatas. É o pior caso do clique, e ele roda no QUADRO.
    const rota = (from: { x: number; y: number }, to: { x: number; y: number }) => findPath(map, from, to);
    const custo = custoRelativo("clique em alvo cercado", calibracao, 8, () => {
      destinoAlcancavel({ x: 20, y: 20 }, { x: 2, y: 2 }, rota);
    });
    // medido hoje: 0,021 — o A* recusa em O(1) quando o destino é parede
    expect(custo).toBeLessThan(0.4);
  });

  /**
   * As invariantes que NÃO dependem da velocidade da máquina.
   *
   * Estas são as que realmente seguram o projeto: um limite de tempo pega o
   * sintoma, mas uma contagem errada pega a CAUSA — e não tem ruído nenhum.
   */
  it("uma pincelada suja no máximo um punhado de chunks", () => {
    const depois = { collision: [...map.collision], surface: [...map.surface], heightmap: [...map.heightmap] };
    (depois.heightmap as number[])[idx(70, 70)] = 5;
    const sujos = chunksSujos(map, { collision: map.collision, surface: map.surface, heightmap: map.heightmap }, depois as never);
    // uma célula só toca UM chunk; mais que 2 significa invalidação larga demais
    expect(sujos.length).toBeLessThanOrEqual(2);
    // e o mapa inteiro tem muito mais que isso — a comparação existe para o dia
    // em que alguém trocar a varredura por um "joga tudo fora"
    expect(cols * rows).toBeGreaterThan(4);
  });

  it("a geometria de um chunk não estoura o tamanho esperado", () => {
    const geo = buildChunkGeometry(map, 1, 1);
    const vertices = geo.getAttribute("position").count;
    geo.dispose();
    // 32×32 células = 1.024 quads = 4.096 vértices de topo, mais as saias dos
    // desníveis. O teto pega quem passar a emitir face que não precisa existir.
    expect(vertices).toBeGreaterThan(4000);
    expect(vertices).toBeLessThan(20000);
  });

  it("nenhum chunk é MUITO mais caro que os outros", () => {
    /**
     * O orçamento por quadro (6 ms) espalha o custo, mas ele só funciona se
     * nenhum chunk sozinho estourar o quadro. Comparar o pior com a MEDIANA da
     * mesma rodada é o jeito de perguntar isso sem depender da máquina: um
     * chunk de água/relevo custa mais que um de campo liso, e tudo bem — o que
     * não pode é um caso patológico, do tipo "esta configuração de célula faz o
     * laço interno rodar mil vezes".
     */
    const custos: number[] = [];
    for (let cz = 0; cz < rows; cz++) {
      for (let cx = 0; cx < cols; cx++) {
        const t0 = performance.now();
        buildChunkGeometry(map, cx, cz).dispose();
        custos.push(performance.now() - t0);
      }
    }
    custos.sort((a, b) => a - b);
    const mediana = custos[Math.floor(custos.length / 2)]!;
    const pior = custos[custos.length - 1]!;
    relatorio.push({ nome: "pior chunk ÷ mediana", valor: Math.round((pior / mediana) * 100) / 100, limite: 8 });
    // medido hoje: ~4× (o pior é um chunk cheio de água e desnível)
    expect(pior / mediana).toBeLessThan(8);
  });
});

/**
 * A regra que a névoa e os raios de render têm de obedecer — REESCRITA na
 * Fase G da auditoria de render (`docs/claude-context/02-terrain-rendering.md`).
 *
 * A regra ORIGINAL ("a névoa fecha antes do chão detalhado acabar") existia só
 * como comentário no schema e foi violada por 116 unidades sem ninguém notar:
 * medido no jogo, 81% dos triângulos de chão desenhados estavam atrás de névoa
 * OPACA — 49 das 59 malhas, 84.552 triângulos invisíveis contra 19.912
 * visíveis. Isso continua vendo (`v.detalhe` é sempre `renderDistance` cru,
 * sem clamp de névoa — ela não limita mais o detalhe, limita o HORIZONTE).
 *
 * A regra NOVA, que substitui a antiga sem reabrir o mesmo bug: o mundo
 * simplificado (`grid/HorizonMesh`) precisa de espaço para existir ANTES da
 * névoa ficar opaca, e nenhuma leitura de entidade pode usar o raio da névoa
 * como raio de desenho — foi exatamente essa confusão que fazia `NetEntity`/
 * `AlvoPorTab`/`AssistenciaDeMira` ler `fogFar` como se fosse alcance de
 * combate.
 */
describe("o horizonte cobre onde a névoa fecha, e entidade nunca usa o raio da névoa", () => {
  const conferir = (bruto: Record<string, unknown>) => {
    const cfg = GameplayConfigSchema.parse(bruto);
    const v = raiosDeVisao(cfg);
    // o detalhe é o raio que o admin pediu, cru — a névoa não o limita mais
    expect(v.detalhe).toBe(cfg.renderDistance);
    // entidade usa o MESMO raio do detalhe, nunca o do horizonte — é a
    // regressão de custo que esta Fase existe para prevenir (monstro
    // renderizando/alvejável a centenas de unidades de distância)
    expect(v.entidades).toBe(v.detalhe);
    // o horizonte fica ALÉM do detalhe: é o espaço onde o mundo simplificado
    // existe antes da névoa fechar
    expect(v.horizonte).toBeGreaterThan(v.detalhe);
    // a névoa fecha ANTES do fim do horizonte — sem isto a malha decimada
    // apareceria com um degrau na borda, a mesma "parede" que a auditoria
    // original documentou para o chão detalhado
    expect(v.fogFar).toBeLessThan(v.horizonte);
    expect(v.fogNear).toBeLessThan(v.fogFar);
    return v;
  };

  it("vale para a config padrão", () => {
    const v = conferir({});
    expect(v.detalhe).toBeCloseTo(130, 0);
    // referência usada no resto da auditoria (ver play/viewRadius) — 390 desde
    // a otimização de renderização (ADICIONAL_DE_HORIZONTE 470→260): horizonte
    // mais perto, névoa fecha mais cedo, sem cortar geometria de golpe
    expect(v.horizonte).toBeCloseTo(390, 0);
  });

  it("vale para a config ANTIGA convertida (a que está salva no servidor)", () => {
    // `converterNevoaAntiga` (server-config.ts) RECALCULA `renderDistance` a
    // partir do `fogFar` legado (`round(120 * 1.08)` = 130) e descarta o 200
    // bruto — comportamento do schema, não desta função. `conferir()` já
    // confere `detalhe === cfg.renderDistance` (o valor PÓS-conversão, não o
    // literal de entrada), que é a garantia que interessa aqui.
    const v = conferir({ renderDistance: 200, fogNear: 90, fogFar: 120 });
    expect(v.detalhe).toBeCloseTo(130, 0);
  });

  it("vale em qualquer raio que o admin permita", () => {
    for (const raio of [10, 60, 130, 300, 700, 1000]) conferir({ renderDistance: raio });
  });
});
