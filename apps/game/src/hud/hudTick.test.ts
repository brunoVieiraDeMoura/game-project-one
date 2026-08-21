import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeHudTick } from "./hudTick";

/**
 * `requestAnimationFrame` de mentira: guarda o callback pendente e deixa o
 * teste avançar quadro a quadro chamando `tick(agoraMs)` manualmente, em vez
 * de depender de tempo real — mesmo espírito de `perf/orcamento.ts`: um
 * teste de timing que depende de relógio de verdade é um teste que falha
 * sem motivo.
 */
let pendente: ((t: number) => void) | null = null;
let idSeq = 0;

function tick(agoraMs: number) {
  const fn = pendente;
  pendente = null;
  fn?.(agoraMs);
}

beforeEach(() => {
  pendente = null;
  idSeq = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    pendente = cb;
    return ++idSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  // esvazia qualquer callback agendado que o teste tenha deixado pendurado,
  // senão o `rafId`/`ultimoMs` do módulo vaza estado de um teste pro outro
  while (pendente) tick(0);
  vi.unstubAllGlobals();
});

describe("hudTick — sem throttle (hz omitido / hz >= 60)", () => {
  it("chama o assinante em TODO quadro, sem gate — mesmo comportamento de requestAnimationFrame cru", () => {
    const fn = vi.fn();
    const unsub = subscribeHudTick(fn);
    tick(0);
    tick(16);
    tick(32);
    expect(fn).toHaveBeenCalledTimes(3);
    unsub();
  });

  it("hz explicitamente >= 60 também não tem gate", () => {
    const fn = vi.fn();
    const unsub = subscribeHudTick(fn, 144);
    tick(0);
    tick(6.9);
    tick(13.8);
    expect(fn).toHaveBeenCalledTimes(3);
    unsub();
  });
});

describe("hudTick — com throttle (0 < hz < 60)", () => {
  it("só chama quando o intervalo da taxa já passou (Minimap: 12fps → ~83.3ms)", () => {
    const fn = vi.fn();
    const unsub = subscribeHudTick(fn, 12);
    tick(0); // primeiro quadro: dt=0, mas ainda não completou o intervalo — não chama
    expect(fn).toHaveBeenCalledTimes(0);
    tick(50); // dt=50, acumulado 50 < 83.3 — ainda não
    expect(fn).toHaveBeenCalledTimes(0);
    tick(84); // dt=34, acumulado 84 >= 83.3 — chama
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("reseta o acumulado ao disparar, não subtrai o intervalo — sem rajada de recuperação após pausa longa", () => {
    const fn = vi.fn();
    const unsub = subscribeHudTick(fn, 12);
    tick(0);
    tick(1000); // aba ficou em segundo plano — dt gigante, muito mais que 1 intervalo
    expect(fn).toHaveBeenCalledTimes(1); // uma vez só, não N vezes pra "recuperar" o tempo perdido
    unsub();
  });
});

describe("hudTick — ciclo de vida do requestAnimationFrame compartilhado", () => {
  it("o loop nasce no primeiro inscrito e morre quando o último se desinscreve", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    const fn = vi.fn();
    expect(pendente).toBe(null);
    const unsub = subscribeHudTick(fn);
    expect(rafSpy).toHaveBeenCalledTimes(1); // 1 chamada pro primeiro inscrito
    unsub();
    tick(16); // o `passo` que já estava agendado ainda roda uma vez...
    // ...mas como `assinantes` está vazio, ele NÃO reagenda: sem 2ª chamada de rAF
    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it("remount: desinscrever e inscrever de novo (mesmo componente remontando) pede um NOVO rAF, sem reaproveitar estado velho", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    const fn = vi.fn();
    const unsub1 = subscribeHudTick(fn);
    expect(rafSpy).toHaveBeenCalledTimes(1);
    unsub1(); // desmonta — scheduler ainda tem 1 rAF pendente, não cancelado
    tick(16); // esse rAF pendente roda, vê `assinantes` vazio, NÃO reagenda
    expect(pendente).toBe(null);

    // remonta: entra um assinante NOVO depois do scheduler ter ficado órfão
    const unsub2 = subscribeHudTick(fn);
    expect(rafSpy).toHaveBeenCalledTimes(2); // pediu um rAF NOVO, não achou um velho sobrando
    tick(32);
    expect(fn).toHaveBeenCalledTimes(1); // só a chamada do remount, nenhuma "fantasma" do unmount
    unsub2();
  });

  it("entrada de novo consumidor depois que o scheduler ficou totalmente sem assinantes reinicia `dt` do zero (sem salto)", () => {
    const a = vi.fn();
    const unsubA = subscribeHudTick(a);
    tick(100);
    unsubA();
    tick(200); // drena o rAF pendente — scheduler fica órfão

    // se o `dt` do reinício herdasse "5000 - 200" (tempo real que passou
    // enquanto ninguém escutava), uma taxa baixa dispararia na hora — não deve
    const b = vi.fn();
    const unsubB = subscribeHudTick(b, 12);
    tick(5000);
    expect(b).toHaveBeenCalledTimes(0); // primeiro quadro do novo início: dt=0, não dispara
    unsubB();
  });

  it("dois assinantes simultâneos compartilham o MESMO requestAnimationFrame — não um por assinante", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeHudTick(a);
    const unsubB = subscribeHudTick(b, 12);
    expect(rafSpy).toHaveBeenCalledTimes(1); // não 2
    tick(16);
    expect(a).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });

  it("desinscrever um assinante não afeta os outros que continuam inscritos", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeHudTick(a);
    const unsubB = subscribeHudTick(b);
    tick(0);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA();
    tick(16);
    expect(a).toHaveBeenCalledTimes(1); // não chamado de novo
    expect(b).toHaveBeenCalledTimes(2); // continua rodando
    unsubB();
  });
});
