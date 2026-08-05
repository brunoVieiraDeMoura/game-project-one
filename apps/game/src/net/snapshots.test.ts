import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATRASO_DE_INTERPOLACAO,
  interpolatedCell,
  setPathfinder,
  useWorldStore,
} from "./worldStore";
import { amostrarRelogio, zerarRelogioDoServidor } from "./relogioDoServidor";
import type { Cell } from "./pathfind";

/**
 * INTERPOLAÇÃO DE SNAPSHOTS — o mundo dos OUTROS desenhado um pouco no passado.
 *
 * O defeito que ela corrige: cada `entity:move` era ancorado na hora de
 * CHEGADA. Sob ping com jitter, o trecho acaba antes de o próximo pacote
 * chegar, `interpolatedCell` devolve `moving: false`, o mob CONGELA e entra em
 * `idle` — e o pacote atrasado o faz SALTAR. É o "anda aos trancos".
 *
 * A solução clássica é renderizar em `now − atraso`. Aqui a conta é feita do
 * outro lado — atrasando a ÂNCORA do trecho —, o que é idêntico e não exige
 * fila de snapshots por entidade nem busca por quadro.
 *
 * O que estes testes exigem: que a folga exista de verdade, que ela NUNCA valha
 * para o jogador local, e que sem tick do servidor tudo caia no comportamento
 * anterior (que nunca dependeu disso).
 */

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
const GID = 77;
const VELOCIDADE = 100; // ms por célula
/** `gettick()` é ms desde o boot do servidor; o local é ms desde a página */
const DESVIO = -4_999_000;
const tickDe = (localMs: number) => localMs - DESVIO;

/** onde o mob está desenhado agora */
const visual = () => interpolatedCell(st().entities[GID]!, performance.now());

function nascerMob() {
  st().spawn({
    gid: GID,
    kind: "mob",
    job: 1002,
    x: 10,
    y: 10,
    dir: 0,
    speed: VELOCIDADE,
  });
}

/** forma a estimativa de relógio com amostras limpas */
function sincronizarRelogio() {
  const agora = performance.now();
  for (let i = 0; i < 8; i++) amostrarRelogio(tickDe(agora - i), agora - i);
}

beforeEach(() => {
  vi.useFakeTimers();
  setPathfinder(rotaReta);
  zerarRelogioDoServidor();
  st().clear();
  nascerMob();
});

afterEach(() => {
  vi.useRealTimers();
  setPathfinder(null);
  zerarRelogioDoServidor();
});

describe("o mundo dos outros é desenhado no passado", () => {
  it("com tick do servidor, o trecho começa ATRASADO — é a folga", () => {
    sincronizarRelogio();
    const agora = performance.now();
    // o servidor começou o movimento AGORA e o pacote chegou instantâneo
    st().move(GID, { x: 10, y: 10 }, { x: 20, y: 10 }, VELOCIDADE, tickDe(agora));

    // ainda não saiu do lugar: está esperando a hora
    expect(visual()).toMatchObject({ x: 10, y: 10, moving: false });

    // passado o atraso, começa a andar
    vi.advanceTimersByTime(ATRASO_DE_INTERPOLACAO + 50);
    expect(visual().moving).toBe(true);
    expect(visual().x).toBeGreaterThan(10);
  });

  it("um pacote ATRASADO ainda cai no lugar certo", () => {
    /**
     * O caso que a técnica existe para resolver. O servidor começou o trecho
     * há 60 ms; o pacote só chegou agora. Sem a âncora do servidor, o mob
     * recomeçaria o caminho do zero, 60 ms atrás do mundo — e essa diferença se
     * SOMA a cada trecho, porque o rAthena manda um pacote por trecho.
     */
    sincronizarRelogio();
    const agora = performance.now();
    st().move(GID, { x: 10, y: 10 }, { x: 20, y: 10 }, VELOCIDADE, tickDe(agora - 60));

    // o atraso de interpolação já foi parcialmente consumido pela viagem
    vi.advanceTimersByTime(ATRASO_DE_INTERPOLACAO - 60 + 100);
    // 100 ms de caminhada = 1 célula
    const pos = visual();
    expect(pos.x).toBeGreaterThan(10.8);
    expect(pos.x).toBeLessThan(11.2);
  });

  it("o mob NÃO congela entre um trecho e o seguinte", () => {
    /**
     * O sintoma do relato. Dois trechos encadeados como o servidor os manda
     * (`S_k = S_{k-1} + D_{k-1}`), com o segundo pacote chegando TARDE.
     * A folga do atraso é o que impede o buraco.
     */
    sincronizarRelogio();
    const t0 = performance.now();
    st().move(GID, { x: 10, y: 10 }, { x: 12, y: 10 }, VELOCIDADE, tickDe(t0)); // 2 células = 200 ms

    // o segundo pacote sai do servidor em t0+200, mas só chega em t0+260
    vi.advanceTimersByTime(260);
    st().move(GID, { x: 12, y: 10 }, { x: 14, y: 10 }, VELOCIDADE, tickDe(t0 + 200));

    // varre o encontro dos dois trechos: em nenhum instante ele pode ficar parado
    let parou = false;
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(15);
      if (!visual().moving) parou = true;
    }
    expect(parou).toBe(false);
  });

  it("posição só avança — atraso nenhum faz o mob andar de ré", () => {
    sincronizarRelogio();
    const t0 = performance.now();
    st().move(GID, { x: 10, y: 10 }, { x: 20, y: 10 }, VELOCIDADE, tickDe(t0));
    vi.advanceTimersByTime(ATRASO_DE_INTERPOLACAO);

    let anterior = visual().x;
    // pacotes chegando com atrasos IRREGULARES (jitter), como na vida real
    for (const [avanco, atrasoDoPacote] of [
      [100, 40],
      [100, 90],
      [100, 10],
      [100, 70],
    ] as const) {
      vi.advanceTimersByTime(avanco);
      const pos = visual();
      expect(pos.x).toBeGreaterThanOrEqual(anterior - 0.01);
      anterior = pos.x;
      const inicio = performance.now() - atrasoDoPacote;
      st().move(GID, { x: Math.round(pos.x), y: 10 }, { x: 30, y: 10 }, VELOCIDADE, tickDe(inicio));
      const depois = visual();
      expect(depois.x).toBeGreaterThanOrEqual(anterior - 0.01);
      anterior = depois.x;
    }
  });
});

describe("os limites do atraso", () => {
  it("SEM tick do servidor, vale o comportamento de antes", () => {
    // pacote antigo, ou estimativa ainda não formada: nada pode depender disso
    zerarRelogioDoServidor();
    const agora = performance.now();
    st().move(GID, { x: 10, y: 10 }, { x: 20, y: 10 }, VELOCIDADE, tickDe(agora));
    // começa NA HORA, sem atraso nenhum
    expect(visual().moving).toBe(true);
  });

  it("o jogador LOCAL nunca é atrasado — seria desfazer a predição", () => {
    /**
     * Estruturalmente garantido: `selfMove` é outra ação e não passa por nada
     * disto. O teste existe porque a garantia é fácil de perder — bastaria
     * alguém "unificar" as duas ações achando que são a mesma coisa.
     */
    sincronizarRelogio();
    st().setSelfCell(10, 10);
    st().setSelfSpeed(VELOCIDADE);
    st().selfMove({ x: 10, y: 10 }, { x: 20, y: 10 });
    expect(interpolatedCell(st().self, performance.now()).moving).toBe(true);
  });

  it("o atraso é constante — não se acumula a cada pacote", () => {
    /**
     * O erro que arruinaria tudo: somar o atraso sobre a âncora ANTERIOR em vez
     * de sobre a do servidor. Aí cada pacote empurraria o mob mais 100 ms para
     * trás e ele acabaria minutos atrás do mundo.
     */
    sincronizarRelogio();
    const t0 = performance.now();
    for (let k = 0; k < 6; k++) {
      st().move(GID, { x: 10 + k, y: 10 }, { x: 11 + k, y: 10 }, VELOCIDADE, tickDe(t0 + k * 100));
      vi.advanceTimersByTime(100);
    }
    // depois de 6 trechos, o desvio entre a âncora e o tick tem de continuar
    // sendo UM atraso, não seis. A âncora que vale é a do trecho mais recente —
    // que pode estar na FILA, esperando a hora (é o normal em regime).
    const e = st().entities[GID]!;
    const ancora = e.proximo?.movedAt ?? e.movedAt;
    const esperado = t0 + 5 * 100 + ATRASO_DE_INTERPOLACAO;
    expect(Math.abs(ancora - esperado)).toBeLessThan(5);
  });
});
