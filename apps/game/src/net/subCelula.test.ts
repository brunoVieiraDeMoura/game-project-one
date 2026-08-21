import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { interpolatedCell, setPathfinder, useWorldStore } from "./worldStore";
import type { Cell } from "./pathfind";

/**
 * MUDAR DE ESTADO NÃO REPOSICIONA NINGUÉM.
 *
 * O relato: ao castar uma skill o personagem dá um mini-teleporte. A causa não
 * é a representação da posição — ela já é fracionária de ponta a ponta — e sim
 * o `ZC_STOPMOVE`, que o rAthena dispara ao interromper a caminhada carregando
 * SÓ a célula inteira. E não é acidente: `unit_stop_walking` com `USW_FIXPOS`
 * (unit.cpp:1732) faz `ud->sx = 8; ud->sy = 8;` com o comentário "Stop on cell
 * center".
 *
 * A divisão que estes testes travam:
 *
 *  • a CÉLULA é do servidor, sempre, sem tolerância nenhuma;
 *  • o deslocamento DENTRO da célula é do cliente, e parar/castar/atacar não
 *    têm o direito de tocá-lo.
 *
 * O caso "não mover" não é uma exceção escrita à mão: mesma célula ⇒ o alvo é a
 * própria posição.
 */

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

/** anda até ficar ENTRE duas células e devolve a posição fracionária */
function andarAteOMeioDoPasso(): { x: number; y: number } {
  st().selfMove({ x: 10, y: 10 }, { x: 20, y: 10 });
  vi.advanceTimersByTime(450); // 4,5 células a 100 ms cada
  const p = pos();
  // a premissa dos testes: o personagem NÃO está no centro de uma célula
  expect(Math.abs(p.x - Math.round(p.x))).toBeGreaterThan(0.1);
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  setPathfinder(rotaReta);
  st().clear();
  st().setSelfCell(10, 10);
  st().setSelfSpeed(100);
});

afterEach(() => {
  vi.useRealTimers();
  setPathfinder(null);
});

describe("o personagem: castar/parar não move um pixel", () => {
  it("fixpos na célula em que ele JÁ está não muda nada", () => {
    const antes = andarAteOMeioDoPasso();
    // é o que o rAthena manda ao castar: a célula em que ele está, e só ela
    st().aplicarFixpos(Math.round(antes.x), Math.round(antes.y));
    const depois = pos();
    expect(depois.x).toBeCloseTo(antes.x, 6);
    expect(depois.y).toBeCloseTo(antes.y, 6);
    expect(depois.moving).toBe(false);
  });

  it("e o alvo NÃO é o centro do tile", () => {
    /**
     * A prova direta do defeito antigo: `toX/toY` eram a célula inteira, então a
     * correção deslizava para o CENTRO mesmo sem divergência nenhuma.
     */
    const antes = andarAteOMeioDoPasso();
    st().aplicarFixpos(Math.round(antes.x), Math.round(antes.y));
    expect(st().self.toX).toBeCloseTo(antes.x, 6);
    expect(Math.abs(st().self.toX - Math.round(st().self.toX))).toBeGreaterThan(0.1);
  });

  it("divergência de uma célula corrige, PRESERVANDO o offset", () => {
    const antes = andarAteOMeioDoPasso();
    const celula = Math.round(antes.x);
    const off = antes.x - celula;
    // o servidor diz uma célula ADIANTE (para frente, senão a guarda de
    // `servidorAtras` segura e nada se move — o que é outra regra)
    st().aplicarFixpos(celula + 1, 10);

    expect(st().self.toX).toBeCloseTo(celula + 1 + off, 6);
    // desliza, não salta
    expect(st().self.durationMs).toBeGreaterThan(0);
    // e a CÉLULA lógica no fim é a do servidor
    vi.advanceTimersByTime(200);
    expect(Math.round(pos().x)).toBe(celula + 1);
  });

  it("teleporte continua snapando, e no CENTRO", () => {
    andarAteOMeioDoPasso();
    st().aplicarFixpos(60, 60); // @jump / Asa: muito além do corte
    const depois = pos();
    expect(depois.x).toBe(60);
    expect(depois.y).toBe(60);
    expect(st().self.durationMs).toBe(0);
  });

  it("a célula LÓGICA nunca discorda do servidor", () => {
    /**
     * A preocupação do pedido: preservar o offset não pode virar "ignorar
     * diferenças menores que uma célula", que deixaria os dois divergentes para
     * sempre. Como o offset é limitado a meia célula por construção, o
     * `Math.round` da posição física — que é o que A*, alcance e colisão leem —
     * continua sendo a célula do servidor.
     */
    const antes = andarAteOMeioDoPasso();
    for (const alvo of [Math.round(antes.x), Math.round(antes.x) + 1, Math.round(antes.x) + 2]) {
      st().aplicarFixpos(alvo, 10);
      vi.advanceTimersByTime(200);
      expect(Math.round(pos().x)).toBe(alvo);
    }
  });
});

describe("as outras entidades: o mob também para onde está", () => {
  const MOB = 5001;
  const nascer = () =>
    st().spawn({ gid: MOB, kind: "mob", job: 1002, x: 10, y: 10, dir: 0, speed: 100 });

  /** põe o mob entre duas células e devolve a posição desenhada */
  function mobNoMeioDoPasso(): { x: number; y: number } {
    nascer();
    st().move(MOB, { x: 10, y: 10 }, { x: 20, y: 10 }, 100);
    // o mundo dos outros é desenhado no passado (ATRASO_DE_INTERPOLACAO)
    vi.advanceTimersByTime(550);
    const p = interpolatedCell(st().entities[MOB]!, performance.now());
    expect(Math.abs(p.x - Math.round(p.x))).toBeGreaterThan(0.1);
    return p;
  }

  it("stop na célula atual não move o mob", () => {
    const antes = mobNoMeioDoPasso();
    st().stop(MOB, Math.round(antes.x), Math.round(antes.y));
    const depois = interpolatedCell(st().entities[MOB]!, performance.now());
    expect(depois.x).toBeCloseTo(antes.x, 6);
    expect(depois.moving).toBe(false);
  });

  it("stop preserva o offset numa correção curta", () => {
    const antes = mobNoMeioDoPasso();
    const celula = Math.round(antes.x);
    const off = antes.x - celula;
    st().stop(MOB, celula + 1, 10);
    expect(st().entities[MOB]!.toX).toBeCloseTo(celula + 1 + off, 6);
    expect(st().entities[MOB]!.durationMs).toBeGreaterThan(0);
  });

  it("knockback longo continua sendo salto seco", () => {
    mobNoMeioDoPasso();
    st().stop(MOB, 40, 40);
    const depois = interpolatedCell(st().entities[MOB]!, performance.now());
    expect(depois.x).toBe(40);
    expect(depois.y).toBe(40);
  });

  it("o trecho em fila e a rota velha morrem no stop", () => {
    const antes = mobNoMeioDoPasso();
    st().stop(MOB, Math.round(antes.x), Math.round(antes.y));
    expect(st().entities[MOB]!.proximo).toBeUndefined();
    // sem isto o `interpolatedCell` seguiria os `stepEnds` do caminho velho
    expect(st().entities[MOB]!.path).toBeUndefined();
  });
});

describe("aplicarFixpos(forcarTeleporte): skill de deslocamento tipo Blink", () => {
  /**
   * `ZC_HIGHJUMP` chega como `self:warp` com `teleporte: true`. Sem a flag,
   * um empurrão CURTO (bem abaixo de `FIXPOS_DERIVA_MAX`) que aponta PRA
   * TRÁS em relação ao rumo do passo em andamento cai no ramo
   * `servidorAtras` — construído para segurar reconciliações atrasadas do
   * fixpos normal — e o personagem simplesmente não se move. Isso é errado
   * pra um deslocamento de verdade: o servidor está afirmando uma posição
   * NOVA, não uma correção de rota velha.
   */
  it("empurrão curto pra trás SEM a flag não move (o bug que a flag existe pra evitar)", () => {
    st().selfMove({ x: 10, y: 10 }, { x: 20, y: 10 }); // rumo +x
    vi.advanceTimersByTime(450);
    const antes = pos();
    st().aplicarFixpos(antes.x - 3, antes.y); // 3 células pra trás, gap << 8
    const depois = pos();
    expect(depois.x).toBeCloseTo(antes.x, 6); // não moveu — servidorAtras segurou
  });

  it("o MESMO empurrão COM forcarTeleporte snapa de verdade", () => {
    st().selfMove({ x: 10, y: 10 }, { x: 20, y: 10 }); // rumo +x
    vi.advanceTimersByTime(450);
    const antes = pos();
    const alvo = antes.x - 3;
    st().aplicarFixpos(alvo, antes.y, true);
    const depois = pos();
    expect(depois.x).toBe(alvo);
    expect(depois.y).toBe(antes.y);
    expect(st().self.durationMs).toBe(0); // snap seco, não deslize
  });

  it("forcarTeleporte também vence o gap curto pra FRENTE (sem depender do rumo)", () => {
    st().setSelfCell(10, 10);
    st().aplicarFixpos(13, 10, true); // 3 células, bem abaixo de FIXPOS_DERIVA_MAX
    const depois = pos();
    expect(depois.x).toBe(13);
    expect(st().self.durationMs).toBe(0);
  });
});
