import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { interpolatedCell, setPathfinder, useWorldStore } from "./worldStore";
import type { Cell } from "./pathfind";

/**
 * Redirecionar no MEIO do caminho — o caso comum, e o que estava quebrado.
 *
 * Acontece a cada clique novo enquanto o personagem anda e, desde a emenda
 * automática de trecho, a cada 16 células de uma caminhada longa. O relato era
 * "spammo clique de um lado para o outro e ele dá glitch, trava, se arrasta, ou
 * fica parado e depois anda".
 *
 * Dois defeitos independentes, os dois aqui travados:
 *
 * 1. a posição de desenho recomeçava na célula VISUAL, mas o A* era refeito a
 *    partir da célula do SERVIDOR (que fica atrás) — o primeiro passo ia da
 *    posição visual para uma célula ATRÁS dela, ou seja, o personagem andava de
 *    ré antes de seguir;
 * 2. quando não havia caminho, `buildMotion` devolvia só a duração, e o
 *    `{ ...self, ...buildMotion() }` de quem chamava PRESERVAVA o `path` da
 *    jogada anterior — o personagem seguia a rota velha com destino novo.
 */

/** caminho reto em X, uma célula por passo — chega para o que se testa aqui */
function rotaReta(from: Cell, to: Cell): Cell[] | null {
  const out: Cell[] = [];
  let { x, y } = from;
  let guarda = 0;
  while ((x !== to.x || y !== to.y) && guarda++ < 200) {
    if (x < to.x) x++;
    else if (x > to.x) x--;
    if (y < to.y) y++;
    else if (y > to.y) y--;
    out.push({ x, y });
  }
  return out.length > 0 ? out : null;
}

const st = () => useWorldStore.getState();

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

describe("redirecionar no meio do caminho", () => {
  it("o caminho começa onde o personagem está DESENHADO, não onde o servidor acha", () => {
    st().selfMove({ x: 10, y: 10 }, { x: 30, y: 10 });
    // meio segundo depois ele está desenhado perto da célula 15
    vi.advanceTimersByTime(500);
    const visual = interpolatedCell(st().self, performance.now());
    expect(visual.x).toBeGreaterThan(13);

    // o servidor manda um destino novo AINDA a partir da célula 12 (atrasado)
    st().selfMove({ x: 12, y: 10 }, { x: 12, y: 30 });

    const path = st().self.path!;
    expect(path.length).toBeGreaterThan(0);
    // o primeiro passo tem de sair de perto de ONDE ELE ESTÁ (≈15), não de 12
    expect(Math.abs(path[0]!.x - visual.x)).toBeLessThanOrEqual(1.5);
    // e nunca andar de ré: o primeiro passo não pode estar atrás da posição
    // visual em X quando o destino está à frente em Y
    expect(path[0]!.x).toBeGreaterThan(12);
  });

  it("o primeiro passo NÃO volta para trás", () => {
    st().selfMove({ x: 10, y: 10 }, { x: 40, y: 10 });
    vi.advanceTimersByTime(800);
    const antes = interpolatedCell(st().self, performance.now());

    st().selfMove({ x: 13, y: 10 }, { x: 40, y: 40 });
    // logo no começo do novo trecho, a posição desenhada não pode ter recuado
    const depois = interpolatedCell(st().self, performance.now() + 16);
    expect(depois.x).toBeGreaterThanOrEqual(antes.x - 0.05);
  });

  it("sem caminho, o caminho ANTIGO é descartado", () => {
    st().selfMove({ x: 10, y: 10 }, { x: 30, y: 10 });
    expect(st().self.path?.length).toBeGreaterThan(0);

    // agora não há rota nenhuma (parede em volta do destino)
    setPathfinder(() => null);
    st().selfMove({ x: 12, y: 10 }, { x: 12, y: 40 });

    expect(st().self.path).toBeUndefined();
    expect(st().self.stepEnds).toBeUndefined();
    // e o movimento vira passo de rei em direção ao destino NOVO
    vi.advanceTimersByTime(500);
    const p = interpolatedCell(st().self, performance.now());
    expect(p.y).toBeGreaterThan(12);
  });

  it("spam de cliques não faz o personagem andar de ré", () => {
    st().selfMove({ x: 10, y: 10 }, { x: 40, y: 10 });
    let anterior = interpolatedCell(st().self, performance.now()).x;
    // dez redirecionamentos seguidos, como um spam de cliques
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(120);
      const visual = interpolatedCell(st().self, performance.now());
      expect(visual.x).toBeGreaterThanOrEqual(anterior - 0.05);
      anterior = visual.x;
      // o servidor responde sempre com uma célula ATRÁS da visual
      st().selfMove({ x: Math.floor(visual.x) - 1, y: 10 }, { x: 40, y: 10 });
    }
    expect(anterior).toBeGreaterThan(11);
  });
});
