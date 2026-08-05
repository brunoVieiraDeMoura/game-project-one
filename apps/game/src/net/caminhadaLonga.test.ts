import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { interpolatedCell, previstosPendentes, setPathfinder, useWorldStore } from "./worldStore";
import type { Cell } from "./pathfind";

/**
 * A CAMINHADA LONGA — travar, VOLTAR células, seguir andando.
 *
 * O relato: andando continuamente por vários chunks, o personagem trava um
 * instante, recua algumas células e continua. A investigação (laudo em
 * `next-change-game2.txt`) mostrou que os chunks são só o fornecedor de
 * ENGASGO; quem produz o recuo é a predição, por quatro elos encadeados. Estes
 * testes travam os dois elos que moram no `worldStore` — os outros dois são do
 * `NetPlayer` (janela de resposta e dedupe da emenda) e estão em
 * `net/ordens.test.ts`.
 *
 * O engasgo é simulado com o relógio falso: avançar o tempo além da duração do
 * trecho é exatamente o que um quadro longo faz — `interpolatedCell` passa a
 * devolver `moving: false` com o servidor ainda andando.
 */

/** caminho reto, uma célula por passo */
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
const pos = () => interpolatedCell(st().self, performance.now());

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

describe("o desenho NUNCA anda de ré", () => {
  it("engasgo longo + servidor atrasado não faz o personagem voltar", () => {
    /**
     * O caso do relato, reproduzido: o trecho do cliente FECHA (engasgo maior
     * que a duração dele) e o pacote seguinte chega descrevendo uma célula bem
     * atrás. Antes, `manterDesenho` era falso (parado E desvio > 2) e a origem
     * virava a célula do servidor — salto seco para trás.
     */
    st().selfMove({ x: 10, y: 10 }, { x: 25, y: 10 });
    vi.advanceTimersByTime(3000); // muito além dos 1500 ms do trecho
    const antes = pos();
    expect(antes.moving).toBe(false);
    expect(antes.x).toBe(25);

    // o servidor ainda está lá atrás, na 18, e segue para a 40
    st().selfMove({ x: 18, y: 10 }, { x: 40, y: 10 });
    const depois = pos();
    expect(depois.x).toBeGreaterThanOrEqual(antes.x);
  });

  it("...e continua chegando ao destino do SERVIDOR", () => {
    // manter a origem desenhada muda o formato do caminho, não o ponto de
    // encontro: é o que torna a regra segura
    st().selfMove({ x: 10, y: 10 }, { x: 25, y: 10 });
    vi.advanceTimersByTime(3000);
    st().selfMove({ x: 18, y: 10 }, { x: 40, y: 10 });
    vi.advanceTimersByTime(10_000);
    expect(pos()).toMatchObject({ x: 40, y: 10, moving: false });
  });

  it("divergência de VERDADE ainda reposiciona", () => {
    /**
     * A porta continua aberta: se o servidor põe o personagem de LADO (não
     * atrás na rota), o desvio grande com ele parado ainda manda. Sem isso o
     * cliente nunca se recuperaria de uma dessincronia real.
     */
    st().selfMove({ x: 10, y: 10 }, { x: 25, y: 10 });
    vi.advanceTimersByTime(3000);
    // o servidor diz que ele está numa coluna completamente outra, e o destino
    // fica mais longe DALI do que da posição desenhada
    st().selfMove({ x: 25, y: 40 }, { x: 25, y: 60 });
    const p = pos();
    expect(p.y).toBeGreaterThan(30);
  });
});

describe("ack antigo reancora o trecho em vez de descartar o pacote", () => {
  it("a TRAJETÓRIA é a da predição mais nova", () => {
    /**
     * Dois pedidos no ar; o servidor responde o PRIMEIRO. Reconstruir para o
     * destino dele viraria o personagem no meio do caminho — é o zigzag que a
     * fila de pendentes existe para resolver, e ela continua resolvendo.
     */
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    vi.advanceTimersByTime(120);
    st().preverMovimento({ x: 12, y: 10 }, { x: 12, y: 40 });
    expect(previstosPendentes()).toBe(2);

    st().selfMove({ x: 10, y: 10 }, { x: 30, y: 10 }); // ack do PRIMEIRO
    // o destino continua sendo o do segundo pedido
    expect(st().self.toX).toBe(12);
    expect(st().self.toY).toBe(40);
    expect(previstosPendentes()).toBe(1);
  });

  it("mas o TEMPO do pacote é aplicado — a deriva volta a ser lida", () => {
    /**
     * Este é o elo que estava quebrado: com `return s` o pacote inteiro era
     * descartado, e junto com ele a reancoragem e o `extras`. Durante a emenda
     * há sempre pedido no ar, então a reconciliação ficava DESLIGADA justamente
     * quando mais importa, e a deriva crescia calada até um `clif_fixpos`
     * cobrar tudo de uma vez.
     *
     * A prova é o `movedAt`: um pacote aplicado reancora o trecho.
     */
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    vi.advanceTimersByTime(120);
    st().preverMovimento({ x: 12, y: 10 }, { x: 12, y: 40 });
    const antes = st().self.movedAt;

    vi.advanceTimersByTime(120);
    st().selfMove({ x: 10, y: 10 }, { x: 30, y: 10 });

    expect(st().self.movedAt).toBeGreaterThan(antes);
    // e o trecho deixa de ser palpite
    expect(st().self.predito).toBe(false);
  });

  it("nem por isso o personagem salta: a origem é a posição desenhada", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    vi.advanceTimersByTime(300);
    const visual = pos();
    st().preverMovimento({ x: 13, y: 10 }, { x: 13, y: 40 });
    vi.advanceTimersByTime(100);
    const antesDoAck = pos();

    st().selfMove({ x: 10, y: 10 }, { x: 30, y: 10 });
    const depois = pos();
    expect(visual.x).toBeGreaterThan(11);
    expect(Math.hypot(depois.x - antesDoAck.x, depois.y - antesDoAck.y)).toBeLessThan(0.5);
  });
});

describe("`predito` é fechado por quem fala pelo servidor", () => {
  /**
   * É o campo que a janela de resposta do `NetPlayer` consulta para não tomar a
   * própria predição por resposta. Quem escreve trecho autoritativo tem de
   * zerá-lo, senão a janela fica aberta e o timeout de 600 ms mata o destino de
   * uma caminhada perfeitamente boa.
   */
  it("selfMove zera", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    expect(st().self.predito).toBe(true);
    st().selfMove({ x: 10, y: 10 }, { x: 30, y: 10 });
    expect(st().self.predito).toBe(false);
  });

  it("fixpos zera", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    vi.advanceTimersByTime(200);
    st().aplicarFixpos(12, 10);
    expect(st().self.predito).toBe(false);
  });

  it("snap zera", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    st().setSelfCell(50, 50);
    expect(st().self.predito).toBe(false);
  });
});
