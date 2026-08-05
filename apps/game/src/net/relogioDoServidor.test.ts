import { beforeEach, describe, expect, it } from "vitest";
import {
  amostrarRelogio,
  desvioDoRelogio,
  paraRelogioLocal,
  zerarRelogioDoServidor,
} from "./relogioDoServidor";

/**
 * A tradução `gettick()` do servidor → `performance.now()` do navegador.
 *
 * O valor certo não existe: cada amostra (`chegada − tick`) carrega junto a
 * latência daquele pacote, então toda estimativa é um pouco alta. O que se
 * exige aqui é que ela seja ROBUSTA — que um pacote atrasado não a destrua — e
 * que ela nunca produza um instante no FUTURO, porque um trecho que ainda não
 * começou faz a entidade ser desenhada antes da origem, ou seja, para trás.
 */

beforeEach(zerarRelogioDoServidor);

/**
 * Magnitudes de verdade: `gettick()` é ms desde o BOOT do map-server (grande) e
 * `performance.now()` é ms desde a carga da página (pequeno). Logo o desvio
 * (`local − tick`) é bem NEGATIVO — é isso que o módulo tem de aguentar.
 */
const DESVIO = -4_999_000;
const DESVIO_OUTRO = -7_777_000;
/** o tick que o servidor mandaria para um evento que aconteceu em `local` */
const tickDe = (localMs: number, desvio = DESVIO) => localMs - desvio;

describe("relógio do servidor", () => {
  it("sem amostra, tudo cai no relógio LOCAL — degrada para o que já funcionava", () => {
    expect(desvioDoRelogio()).toBeNull();
    expect(paraRelogioLocal(12345, 1000)).toBe(1000);
  });

  it("estima o desvio a partir das amostras", () => {
    for (let i = 0; i < 10; i++) {
      const local = 1000 + i * 100;
      amostrarRelogio(tickDe(local), local);
    }
    expect(desvioDoRelogio()).toBe(DESVIO);
    // um trecho que começou 200 ms atrás é traduzido para 200 ms atrás
    const agora = 3000;
    expect(paraRelogioLocal(tickDe(agora - 200), agora)).toBe(agora - 200);
  });

  it("um pacote MUITO atrasado não move a estimativa — é mediana, não média", () => {
    /**
     * O caso que a média perderia: 9 pacotes bons e 1 que demorou 400 ms. A
     * média subiria 40 ms e TODO trecho passaria a ser ancorado 40 ms adiantado;
     * a mediana não se move.
     */
    for (let i = 0; i < 9; i++) {
      const local = 1000 + i * 100;
      amostrarRelogio(tickDe(local), local);
    }
    const bom = desvioDoRelogio();
    // este chegou 400 ms tarde: a amostra dele diz "desvio + 400"
    amostrarRelogio(tickDe(2000) - 400, 2000);
    expect(desvioDoRelogio()).toBe(bom);
  });

  it("NUNCA devolve um instante no futuro", () => {
    /**
     * Se a estimativa estiver adiantada, `tick + desvio` cai depois de agora — e
     * aí `interpolatedCell` calcularia `decorrido < 0` e desenharia a entidade
     * ANTES da origem do trecho, ou seja, andando de ré. O certo é tratar o
     * trecho como começando agora.
     */
    for (let i = 0; i < 5; i++) amostrarRelogio(tickDe(1000 + i * 10), 1000 + i * 10);
    const agora = 2000;
    // tick de um trecho que "começa" 300 ms no futuro
    expect(paraRelogioLocal(tickDe(agora + 300), agora)).toBe(agora);
  });

  it("tick ausente ou zero cai no relógio local", () => {
    for (let i = 0; i < 5; i++) amostrarRelogio(tickDe(1000 + i * 10), 1000 + i * 10);
    expect(paraRelogioLocal(0, 4242)).toBe(4242);
    expect(amostrarRelogio(0, 1000)).toBe(desvioDoRelogio());
  });

  it("reconexão (contador do servidor recomeça) refaz a estimativa em vez de misturar", () => {
    // sem isto, a mediana ficaria presa entre dois mundos e nenhum trecho
    // cairia no lugar certo
    for (let i = 0; i < 10; i++) amostrarRelogio(tickDe(1000 + i * 10), 1000 + i * 10);
    expect(desvioDoRelogio()).toBe(DESVIO);

    // outro map-server: `gettick()` conta desde OUTRO boot, o desvio é outro
    amostrarRelogio(tickDe(2000, DESVIO_OUTRO), 2000);
    expect(desvioDoRelogio()).toBe(DESVIO_OUTRO);
  });

  it("a janela é finita — a estimativa acompanha o servidor, não a história toda", () => {
    // 40 amostras num desvio e depois 40 noutro, dentro do plausível: a
    // estimativa tem de terminar no segundo
    for (let i = 0; i < 40; i++) amostrarRelogio(tickDe(1000 + i, DESVIO), 1000 + i);
    for (let i = 0; i < 40; i++) amostrarRelogio(tickDe(2000 + i, DESVIO + 200), 2000 + i);
    expect(desvioDoRelogio()).toBe(DESVIO + 200);
  });
});
