import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as THREE from "three";
import {
  INTERVALO_CONTADORES_MS,
  VIDA_MINIMA_MS,
  acumularContador,
  amostrarContadores,
  instantaneoDoRenderer,
  observarCriacaoDeContexto,
  observarRenderer,
  somarCustoDeModelo,
  talvezEmitirContadores,
  zerarSonda,
} from "./rendererProbe";
import { configurarGatilho, confirmarQuadro, estado, eventosOrdenados, forcarFlag, limpar, quadro } from "./flightRecorder";

/**
 * NÃO HÁ WebGL no vitest, e é justamente por isso que este arquivo existe.
 *
 * A parte que toca a GPU de verdade (timer query, extensão de memória) é fina e
 * fica de fora — a guarda dela é o F9, a mesma regra que o projeto já pratica
 * para vazamento de textura. O que se testa aqui são as REGRAS, que são onde os
 * erros ficam escondidos:
 *
 * - a recriação do renderer não pode disparar no remonte do StrictMode, senão
 *   toda sessão de desenvolvimento abre com uma captura falsa e o gatilho vira
 *   ruído que ninguém olha;
 * - os contadores não podem virar um evento por mudança, senão a carga de mapa
 *   (169 chunks, dezenas de shaders) expulsa do anel de 512 tudo o que a
 *   captura existe para correlacionar;
 * - canvas e renderer são identidades separadas.
 */

/** um `gl` de mentira: só o que a sonda toca */
function falsoGl(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  return {
    domElement: canvas,
    info: {
      memory: { geometries: 0, textures: 0 },
      programs: [],
      render: { calls: 0, triangles: 0 },
    },
    render: () => {},
    dispose: () => {},
    // sem `createQuery` e sem extensão: o caminho de GPU sai cedo, como num
    // navegador sem a extensão
    getContext: () => ({ getExtension: () => null }),
  } as unknown as THREE.WebGLRenderer;
}

function falsoCanvas(): HTMLCanvasElement {
  return {
    // conectado: a checagem de "canvas-destruido" sai cedo e não polui os
    // eventos dos testes que não são sobre isso
    isConnected: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
}

/** os tipos de evento gravados, na ordem */
function tipos(): string[] {
  return eventosOrdenados().map((e) => e.tipo);
}

let relogio: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  limpar();
  zerarSonda();
  forcarFlag(true);
  configurarGatilho("rendererRecriado", true, 1);
  configurarGatilho("contextoPerdido", true, 0);
  relogio = vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recriação do renderer", () => {
  it("NÃO dispara quando o anterior viveu milissegundos — é o StrictMode", () => {
    const soltar = observarRenderer(falsoGl(falsoCanvas()), { nome: "jogo", principal: true });
    // o React monta, desmonta e remonta: o renderer descartado vive um piscar
    relogio.mockReturnValue(3);
    soltar();
    observarRenderer(falsoGl(falsoCanvas()), { nome: "jogo", principal: true });

    expect(estado().capturando).toBe(false);
  });

  it("dispara quando o anterior estava VIVO de verdade", () => {
    const soltar = observarRenderer(falsoGl(falsoCanvas()), { nome: "jogo", principal: true });
    relogio.mockReturnValue(VIDA_MINIMA_MS + 1);
    soltar();
    observarRenderer(falsoGl(falsoCanvas()), { nome: "jogo", principal: true });

    expect(estado().capturando).toBe(true);
  });

  it("canvas SECUNDÁRIO nunca dispara — abrir a janela de Status não é defeito", () => {
    const soltar = observarRenderer(falsoGl(falsoCanvas()), { nome: "retrato" });
    relogio.mockReturnValue(30_000);
    soltar();
    observarRenderer(falsoGl(falsoCanvas()), { nome: "retrato" });

    expect(estado().capturando).toBe(false);
    // …mas o evento fica registrado: é ele que denuncia o churn no laudo
    expect(tipos().filter((t) => t === "renderer-criado")).toHaveLength(2);
  });

  it("o primeiro renderer é NASCIMENTO, não recriação", () => {
    observarRenderer(falsoGl(falsoCanvas()), { nome: "jogo", principal: true });
    expect(estado().capturando).toBe(false);
  });

  /**
   * O falso-positivo que o PRIMEIRO dump de verdade pegou
   * (`voo-1785932685455.json`): o `<Canvas>` fica fora do `<Suspense>` do
   * `PlayView`, mas o `PerfProbe` fica dentro — re-suspender destrói e recria o
   * efeito com o MESMO `gl`, e isso era lido como renderer recriado.
   */
  it("o MESMO gl remontado não é recriação — é o efeito, não o renderer", () => {
    const gl = falsoGl(falsoCanvas());
    const soltar = observarRenderer(gl, { nome: "jogo", principal: true });
    relogio.mockReturnValue(20_000); // viveu de sobra: só a identidade segura
    soltar();
    observarRenderer(gl, { nome: "jogo", principal: true });

    expect(estado().capturando).toBe(false);
    // e o remonte fica REGISTRADO, porque ele derruba a cena junto
    expect(tipos()).toContain("sonda-remontada");
    expect(tipos().filter((t) => t === "renderer-criado")).toHaveLength(1);
  });

  it("a GERAÇÃO conta renderers, não montagens", () => {
    const gl = falsoGl(falsoCanvas());
    const soltar = observarRenderer(gl, { nome: "jogo", principal: true });
    soltar();
    const soltar2 = observarRenderer(gl, { nome: "jogo", principal: true });
    soltar2();
    observarRenderer(gl, { nome: "jogo", principal: true });

    amostrarContadores(gl, 0);
    // subindo a cada remonte, o `rendererId` da coluna não identificaria nada
    expect(instantaneoDoRenderer().rendererId).toBe(1);
  });
});

describe("destruição do renderer", () => {
  it("quem diz que ele morreu é `dispose()`, não a limpeza do efeito", () => {
    const gl = falsoGl(falsoCanvas());
    const soltar = observarRenderer(gl, { nome: "jogo", principal: true });

    soltar();
    // a limpeza sozinha não afirma destruição: o efeito pode só ter remontado
    expect(tipos()).toContain("sonda-desligada");
    expect(tipos()).not.toContain("renderer-destruido");
  });

  it("`dispose()` emite a destruição e o original continua sendo chamado", () => {
    let disposeReal = 0;
    const gl = falsoGl(falsoCanvas());
    (gl as unknown as { dispose: () => void }).dispose = () => {
      disposeReal++;
    };
    observarRenderer(gl, { nome: "jogo", principal: true });

    gl.dispose();
    expect(disposeReal).toBe(1);
    expect(tipos()).toContain("renderer-destruido");
  });

  it("a limpeza devolve o `dispose` original — a sonda não fica pendurada", () => {
    let disposeReal = 0;
    const gl = falsoGl(falsoCanvas());
    (gl as unknown as { dispose: () => void }).dispose = () => {
      disposeReal++;
    };
    const soltar = observarRenderer(gl, { nome: "jogo", principal: true });
    soltar();

    gl.dispose();
    expect(disposeReal).toBe(1);
    expect(tipos()).not.toContain("renderer-destruido");
  });
});

describe("canvas × renderer", () => {
  it("o mesmo elemento não conta como canvas novo na segunda vez", () => {
    const canvas = falsoCanvas();
    const soltar = observarRenderer(falsoGl(canvas), { nome: "retrato" });
    soltar();
    observarRenderer(falsoGl(canvas), { nome: "retrato" });

    expect(tipos().filter((t) => t === "canvas-criado")).toHaveLength(1);
    expect(tipos().filter((t) => t === "renderer-criado")).toHaveLength(2);
  });

  it("conta os contextos VIVOS — o número que denunciou o Context Lost", () => {
    const gl = falsoGl(falsoCanvas());
    const a = observarRenderer(gl, { nome: "jogo", principal: true });
    const b = observarRenderer(falsoGl(falsoCanvas()), { nome: "retrato" });
    const c = observarRenderer(falsoGl(falsoCanvas()), { nome: "retrato-alvo" });

    amostrarContadores(gl, 0);
    expect(instantaneoDoRenderer().contextos).toBe(3);
    expect(quadro().contextosVivos).toBe(3);

    c();
    b();
    amostrarContadores(gl, INTERVALO_CONTADORES_MS + 1);
    expect(instantaneoDoRenderer().contextos).toBe(1);
    a();
  });
});

describe("contadores coalescidos", () => {
  it("juntam as mudanças da janela num evento só, com o delta somado", () => {
    acumularContador("textura", 10);
    acumularContador("textura", 40);
    expect(talvezEmitirContadores(0)).toBe(1);

    const ev = eventosOrdenados().at(-1)!;
    expect(ev.cat).toBe("renderer");
    expect(ev.tipo).toBe("textura");
    expect(ev.dados).toMatchObject({ delta: 40, total: 40 });
  });

  it("nada muda, nada é emitido — em regime o anel fica limpo", () => {
    acumularContador("geometria", 5);
    talvezEmitirContadores(0);
    const antes = eventosOrdenados().length;
    // o mesmo valor de novo: delta 0
    acumularContador("geometria", 5);
    expect(talvezEmitirContadores(10_000)).toBe(0);
    expect(eventosOrdenados()).toHaveLength(antes);
  });

  it("respeita o intervalo: 169 chunks não viram 169 eventos", () => {
    talvezEmitirContadores(0); // abre a janela
    for (let i = 1; i <= 169; i++) {
      acumularContador("geometria", i);
      // dentro do intervalo, nenhum evento sai
      expect(talvezEmitirContadores(i)).toBe(0);
    }
    expect(talvezEmitirContadores(INTERVALO_CONTADORES_MS + 1)).toBe(1);
    expect(eventosOrdenados().at(-1)!.dados).toMatchObject({ delta: 169, total: 169 });
  });

  it("programa subindo é RECOMPILAÇÃO de shader; descendo, descarte", () => {
    acumularContador("programa", 12);
    talvezEmitirContadores(0);
    expect(eventosOrdenados().at(-1)!.tipo).toBe("shader-compilado");

    acumularContador("programa", 4);
    talvezEmitirContadores(INTERVALO_CONTADORES_MS + 1);
    const ev = eventosOrdenados().at(-1)!;
    expect(ev.tipo).toBe("shader-descartado");
    expect(ev.dados).toMatchObject({ delta: -8 });
  });
});

describe("desligado", () => {
  it("com o gravador parado, o overlay continua tendo número", () => {
    const gl = falsoGl(falsoCanvas());
    const soltar = observarRenderer(gl, { nome: "jogo", principal: true });
    gl.info.memory.textures = 99;
    const antes = eventosOrdenados().length;

    forcarFlag(false);
    amostrarContadores(gl, 10_000);

    // a coluna não é escrita e nenhum evento entra — o anel está parado…
    expect(eventosOrdenados()).toHaveLength(antes);
    expect(quadro().texturas).toBe(0);
    // …mas o F9 continua tendo número: quem desliga a gravação quer parar de
    // CAPTURAR, não de medir
    expect(instantaneoDoRenderer().contextos).toBe(1);
    soltar();
  });
});

/**
 * A DECOMPOSIÇÃO do quadro longo.
 *
 * O `frameLongo` de 378 ms do `voo-1785938553239.json` tinha chunks, props,
 * visibilidade e draw calls inalterados — não era a cena. Havia um
 * `renderer/canvas-criado {nome:"retrato"}` 6 ms antes, mas "um canvas nasceu
 * por perto" não é "criar o canvas custou 378 ms": entre as duas coisas cabem a
 * criação do CONTEXTO, o descarte do renderer velho, o clone do MODELO, o
 * remonte do React e uma pausa do coletor.
 *
 * Estas três colunas medem os três primeiros. O que sobra do `quadroMs` é dos
 * dois últimos — e é essa subtração que o teste protege.
 */
describe("custo decomposto do quadro", () => {
  it("os três acumuladores ZERAM a cada quadro — eles descrevem o quadro", () => {
    const gl = falsoGl(falsoCanvas());
    const soltar = observarRenderer(gl, { nome: "jogo", principal: true });

    somarCustoDeModelo(12);
    amostrarContadores(gl, 0);
    expect(quadro().modeloMs).toBe(12);

    // o quadro seguinte não pode herdar: seria custo contado duas vezes
    confirmarQuadro();
    amostrarContadores(gl, 16);
    expect(quadro().modeloMs).toBe(0);
    soltar();
  });

  it("o total do overlay ACUMULA, ao contrário da coluna", () => {
    const antes = instantaneoDoRenderer().modeloMsTotal;
    somarCustoDeModelo(5);
    somarCustoDeModelo(7);
    // o overlay responde "quanto já se gastou nisto na sessão", que é outra
    // pergunta — e é ela que denuncia churn
    expect(instantaneoDoRenderer().modeloMsTotal).toBe(antes + 12);
  });

  it("`descarteMs` sai do `dispose`, separado da criação do próximo", () => {
    const gl = falsoGl(falsoCanvas());
    const soltar = observarRenderer(gl, { nome: "jogo", principal: true });

    gl.dispose();
    amostrarContadores(gl, 0);
    // o valor exato é do relógio; o que importa é que ele foi PARA ESTA coluna
    // e não se misturou com `contextoMs`
    expect(quadro().descarteMs).toBeGreaterThanOrEqual(0);
    expect(quadro().contextoMs).toBe(0);
    const ev = eventosOrdenados().find((e) => e.tipo === "renderer-destruido");
    expect(ev!.dados).toHaveProperty("ms");
    soltar();
  });
});

describe("embrulho de getContext", () => {
  it("cronometra só WebGL e devolve o contexto do original", () => {
    const criados: string[] = [];
    const proto = { getContext(tipo: string) { criados.push(tipo); return { tipo }; } };
    // o embrulho é global (`HTMLCanvasElement.prototype`); aqui o alvo é um
    // protótipo de mentira, porque o vitest roda em node e não tem DOM
    const alvo = globalThis as unknown as { HTMLCanvasElement?: unknown };
    const tinha = alvo.HTMLCanvasElement;
    alvo.HTMLCanvasElement = function () {} as unknown;
    (alvo.HTMLCanvasElement as { prototype: unknown }).prototype = proto;

    const soltar = observarCriacaoDeContexto();
    const c1 = (proto as { getContext: (t: string) => unknown }).getContext("webgl2");
    const c2 = (proto as { getContext: (t: string) => unknown }).getContext("2d");

    // SEMPRE o original: quebrar isto pararia de desenhar o jogo inteiro
    expect(c1).toEqual({ tipo: "webgl2" });
    expect(c2).toEqual({ tipo: "2d" });
    expect(criados).toEqual(["webgl2", "2d"]);

    const eventos = eventosOrdenados().filter((e) => e.tipo === "contexto-criado");
    // o `2d` do minimapa e do gerador de textura NÃO entra: somá-lo ao mesmo
    // número tornaria a coluna ilegível
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.dados).toMatchObject({ tipo: "webgl2" });

    soltar();
    expect((proto as { getContext: unknown }).getContext).toBeTypeOf("function");
    alvo.HTMLCanvasElement = tinha;
  });
});
