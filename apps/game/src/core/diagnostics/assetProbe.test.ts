import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_LENTO_MS,
  INTERVALO_ASSETS_MS,
  LIMIAR_REDE_MS,
  assetsEmVoo,
  diagnosticoDeCache,
  observarCarregamento,
  quantosEmVoo,
  ultimoAssetResolvido,
  zerarAssets,
  type GerenciadorObservavel,
} from "./assetProbe";
import { eventosOrdenados, forcarFlag, limpar } from "./flightRecorder";

/**
 * Esta sonda é a única peça que consegue NOMEAR o `.glb` que apagou o mundo — o
 * React não conta o que suspendeu, só que suspendeu. Se ela mentir, o laudo
 * acusa o arquivo errado.
 *
 * Duas coisas a inutilizariam em silêncio, e as duas estão aqui: o embrulho
 * parar de chamar o original (o jogo pararia de carregar) e a url ficar
 * pendurada no `emVoo` depois de um erro (todo retrato seguinte acusaria um
 * asset em voo que já morreu).
 */

/** um `LoadingManager` de mentira — não há three nem rede no vitest */
function falsoGerenciador() {
  const chamadas: string[] = [];
  const g: GerenciadorObservavel = {
    itemStart: (url) => chamadas.push(`start:${url}`),
    itemEnd: (url) => chamadas.push(`end:${url}`),
    itemError: (url) => chamadas.push(`error:${url}`),
  };
  return { g, chamadas };
}

function tipos(): string[] {
  return eventosOrdenados().map((e) => e.tipo);
}

let relogio: ReturnType<typeof vi.spyOn>;
let soltar: () => void;

beforeEach(() => {
  limpar();
  zerarAssets();
  forcarFlag(true);
  relogio = vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  soltar?.();
  vi.restoreAllMocks();
});

describe("embrulho do gerenciador", () => {
  it("SEMPRE chama o original — quebrar isto pararia o carregamento do jogo", () => {
    const { g, chamadas } = falsoGerenciador();
    soltar = observarCarregamento(g);

    g.itemStart("a.glb");
    g.itemEnd("a.glb");
    g.itemError("b.glb");

    expect(chamadas).toEqual(["start:a.glb", "end:a.glb", "error:b.glb"]);
  });

  it("a limpeza devolve os métodos originais", () => {
    const { g } = falsoGerenciador();
    const antes = g.itemStart;
    soltar = observarCarregamento(g);
    expect(g.itemStart).not.toBe(antes);
    soltar();
    expect(g.itemStart).toBe(antes);
  });

  it("registrar duas vezes não empilha embrulho (contaria cada asset em dobro)", () => {
    const { g } = falsoGerenciador();
    soltar = observarCarregamento(g);
    observarCarregamento(g);

    g.itemStart("a.glb");
    expect(quantosEmVoo()).toBe(1);
  });
});

describe("em voo", () => {
  it("entra no start e sai no end", () => {
    const { g } = falsoGerenciador();
    soltar = observarCarregamento(g);

    g.itemStart("arvore.glb");
    g.itemStart("pedra.glb");
    expect(assetsEmVoo().map((a) => a.url)).toEqual(["arvore.glb", "pedra.glb"]);

    g.itemEnd("arvore.glb");
    expect(assetsEmVoo().map((a) => a.url)).toEqual(["pedra.glb"]);
  });

  it("`itemError` não deixa a url pendurada para sempre", () => {
    const { g } = falsoGerenciador();
    soltar = observarCarregamento(g);

    g.itemStart("quebrado.glb");
    g.itemError("quebrado.glb");

    // pendurada, ela faria TODO retrato seguinte acusar um asset em voo morto
    expect(quantosEmVoo()).toBe(0);
    expect(tipos()).toContain("asset-erro");
  });
});

describe("diagnóstico de cache", () => {
  /**
   * São DOIS caches, e confundi-los daria a conclusão errada — ver o comentário
   * em `diagnosticoDeCache`.
   */
  it("asset em voo = MISS do cache do drei, com as urls nomeadas", () => {
    const { g } = falsoGerenciador();
    soltar = observarCarregamento(g);
    g.itemStart("arvore.glb");

    expect(diagnosticoDeCache()).toEqual({ cache: "miss", emVoo: ["arvore.glb"] });
  });

  it("nada em voo = `sem-asset`, e ISSO é o que derruba a hipótese", () => {
    const { g } = falsoGerenciador();
    soltar = observarCarregamento(g);

    // suspender sem carga nenhuma aponta para fora da hipótese do asset, e o
    // dado tem de dizer isso em vez de sair vazio e parecer falha da sonda
    expect(diagnosticoDeCache()).toEqual({ cache: "sem-asset", emVoo: [] });
  });

  it("a duração separa rede de cache HTTP, e conta as repetições", () => {
    const { g } = falsoGerenciador();
    soltar = observarCarregamento(g);

    g.itemStart("rapido.glb");
    relogio.mockReturnValue(LIMIAR_REDE_MS - 1);
    g.itemEnd("rapido.glb");
    expect(ultimoAssetResolvido()).toMatchObject({ url: "rapido.glb", origem: "cache-http", vezes: 1 });

    relogio.mockReturnValue(1_000);
    g.itemStart("lento.glb");
    relogio.mockReturnValue(1_000 + LIMIAR_REDE_MS + 1);
    g.itemEnd("lento.glb");
    expect(ultimoAssetResolvido()).toMatchObject({ url: "lento.glb", origem: "rede" });

    // a MESMA url pedida de novo ao carregador: o cache do drei não a reteve
    relogio.mockReturnValue(2_000);
    g.itemStart("rapido.glb");
    relogio.mockReturnValue(2_001);
    g.itemEnd("rapido.glb");
    expect(ultimoAssetResolvido()).toMatchObject({ url: "rapido.glb", vezes: 2 });
  });
});

describe("eventos", () => {
  it("asset LENTO sai individual, com url — ele é o suspeito e não pode ser diluído", () => {
    const { g } = falsoGerenciador();
    soltar = observarCarregamento(g);

    g.itemStart("gorda.glb");
    relogio.mockReturnValue(ASSET_LENTO_MS + 5);
    g.itemEnd("gorda.glb");

    const ev = eventosOrdenados().find((e) => e.tipo === "asset-lento");
    expect(ev).toBeDefined();
    expect(ev!.cat).toBe("cena");
    expect(ev!.dados).toMatchObject({ url: "gorda.glb", origem: "rede" });
  });

  it("asset rápido NÃO vira evento individual — só entra na soma", () => {
    const { g } = falsoGerenciador();
    soltar = observarCarregamento(g);

    g.itemStart("magra.glb");
    relogio.mockReturnValue(2);
    g.itemEnd("magra.glb");

    expect(tipos()).not.toContain("asset-lento");
  });

  it("a carga do mapa é COALESCIDA — dezenas de assets não inundam o anel", () => {
    const { g } = falsoGerenciador();
    soltar = observarCarregamento(g);

    // o primeiro flush abre a janela
    for (let i = 0; i < 40; i++) {
      relogio.mockReturnValue(1 + i);
      g.itemStart(`p${i}.glb`);
      g.itemEnd(`p${i}.glb`);
    }
    const naJanela = eventosOrdenados().filter((e) => e.tipo === "assets").length;
    expect(naJanela).toBe(1);

    relogio.mockReturnValue(INTERVALO_ASSETS_MS + 100);
    g.itemStart("depois.glb");
    expect(eventosOrdenados().filter((e) => e.tipo === "assets")).toHaveLength(2);
  });
});

describe("desligado", () => {
  it("com o gravador parado não entra evento, mas o `emVoo` continua correto", () => {
    const { g } = falsoGerenciador();
    soltar = observarCarregamento(g);
    forcarFlag(false);

    g.itemStart("a.glb");
    // o retrato do F9 e o próprio `emVoo` não dependem do voo estar gravando
    expect(quantosEmVoo()).toBe(1);
    expect(eventosOrdenados()).toHaveLength(0);
  });
});
