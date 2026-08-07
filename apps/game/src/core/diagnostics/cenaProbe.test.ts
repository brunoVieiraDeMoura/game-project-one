import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as THREE from "three";
import {
  PASSO_DA_VARREDURA,
  amostrarCena,
  avaliarMundoVazio,
  contarPorCategoria,
  marcarChunk,
  marcarDesmontagemDaCena,
  marcarPropsVisiveis,
  marcarRevelacao,
  marcarSuspensao,
  retratoDaCena,
  zerarCena,
} from "./cenaProbe";
import { zerarAssets, observarCarregamento, type GerenciadorObservavel } from "./assetProbe";
import { medir, zerarMedidas } from "./medir";
import { casosCapturados, configurarGatilho, estado, eventosOrdenados, forcarFlag, limpar, quadro } from "./flightRecorder";

/**
 * O que este arquivo protege é a capacidade de DERRUBAR a hipótese.
 *
 * A leitura de partida é que o `<Suspense>` re-suspende e o R3F esconde os
 * filhos (`hideInstance` → `visible = false`), o que explicaria 0 draw calls com
 * a geometria toda alocada. Mas se a instrumentação só souber confirmar isso,
 * ela não serve: o valor está em separar as quatro leituras possíveis, e é isso
 * que os testes de `retratoDaCena` fazem.
 *
 * A outra metade é o gatilho não virar ruído: durante a tela de carregamento os
 * draw calls ficam em zero por centenas de quadros DE PROPÓSITO, e um gatilho
 * por valor queimaria os quatro slots antes de o jogo começar.
 */

interface NoFalso {
  visible: boolean;
  name?: string;
  children?: NoFalso[];
  isMesh?: boolean;
  geometry?: unknown;
}

const malha = (nome?: string): NoFalso => ({ visible: true, isMesh: true, geometry: {}, name: nome });
const grupo = (name: string, filhos: NoFalso[], visible = true): NoFalso => ({ visible, name, children: filhos });

/** uma cena parecida com a do /play: terreno, props, entidades, efeitos */
function cenaFalsa(visible = true): THREE.Scene {
  return {
    visible,
    children: [
      grupo("editor-terrain", [grupo("chunks", [malha(), malha(), grupo("agua", [malha()])])]),
      grupo("map-props", [malha(), malha(), malha()]),
      grupo("net-entidades", [malha(), malha()]),
      grupo("skill-vfx", [malha()]),
      malha("ceu"), // sem grupo nomeado → "outros"
    ],
  } as unknown as THREE.Scene;
}

function cameraFalsa(ok = true): THREE.Camera {
  const finita = new Array(16).fill(1);
  const quebrada = new Array(16).fill(NaN);
  return {
    id: 7,
    matrixWorld: { elements: finita },
    projectionMatrix: { elements: ok ? finita : quebrada },
    near: 0.5,
    far: 4000,
  } as unknown as THREE.Camera;
}

const glFalso = { getContext: () => ({ isContextLost: () => false }) } as unknown as THREE.WebGLRenderer;

function tipos(): string[] {
  return eventosOrdenados().map((e) => e.tipo);
}

let relogio: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  limpar();
  zerarCena();
  zerarAssets();
  zerarMedidas();
  forcarFlag(true);
  configurarGatilho("mundoVazio", true, 0);
  relogio = vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gatilho mundoVazio", () => {
  it("dispara na TRANSIÇÃO de desenhando para zero", () => {
    const cena = cenaFalsa();
    avaliarMundoVazio(glFalso, cena, cameraFalsa(), 200);
    expect(estado().capturando).toBe(false);

    avaliarMundoVazio(glFalso, cena, cameraFalsa(), 0);
    expect(estado().capturando).toBe(true);
  });

  it("NÃO dispara numa sequência de zeros — é a tela de carregamento", () => {
    const cena = cenaFalsa(false);
    /**
     * `OcultarCena` apaga a cena de propósito enquanto o mapa monta, e ali os
     * draw calls ficam em zero por centenas de quadros. Um gatilho por VALOR
     * queimaria os quatro slots antes de o jogador ganhar o controle.
     */
    for (let i = 0; i < 50; i++) avaliarMundoVazio(glFalso, cena, cameraFalsa(), 0);
    expect(casosCapturados()).toHaveLength(0);
    expect(estado().capturando).toBe(false);
  });

  /**
   * O falso positivo do `voo-1785940564494.json`: DOIS casos `mundoVazio` em
   * portais, com `sceneVisivel: false` e `filhosDepois: 0`. Queimaram metade
   * dos slots — a mesma história dos rollbacks de troca de mapa.
   */
  it("cena DESMONTADA não captura: trocar de mapa é para não desenhar mesmo", () => {
    const viva = cenaFalsa();
    const vazia = { visible: true, children: [] } as unknown as THREE.Scene;
    avaliarMundoVazio(glFalso, viva, cameraFalsa(), 200);
    avaliarMundoVazio(glFalso, vazia, cameraFalsa(), 0);

    expect(estado().capturando).toBe(false);
    // mas a informação NÃO se perde — trocar falso positivo por ponto cego
    // seria pior, e a tela de carregamento demorando é coisa de se ler
    expect(tipos()).toContain("vazio-esperado");
  });

  it("cena OCULTA não captura — é o `OcultarCena` da tela de carregamento", () => {
    avaliarMundoVazio(glFalso, cenaFalsa(), cameraFalsa(), 200);
    avaliarMundoVazio(glFalso, cenaFalsa(false), cameraFalsa(), 0);

    expect(estado().capturando).toBe(false);
    expect(tipos()).toContain("vazio-esperado");
  });

  it("…mas cena VIVA que para de desenhar CAPTURA — é o defeito de verdade", () => {
    // o `mundoVazio` original tinha `sceneVisivel: true` e dez filhos: cena
    // montada, visível, e mesmo assim zero draw calls
    avaliarMundoVazio(glFalso, cenaFalsa(), cameraFalsa(), 200);
    avaliarMundoVazio(glFalso, cenaFalsa(), cameraFalsa(), 0);

    expect(estado().capturando).toBe(true);
    expect(tipos()).not.toContain("vazio-esperado");
  });

  it("o caso leva o retrato junto, no evento do gatilho", () => {
    const cena = cenaFalsa();
    avaliarMundoVazio(glFalso, cena, cameraFalsa(), 200);
    avaliarMundoVazio(glFalso, cena, cameraFalsa(), 0);

    const ev = eventosOrdenados().find((e) => e.tipo === "gatilho");
    expect(ev!.dados).toMatchObject({ motivo: "mundoVazio", rendererOk: true, contextoOk: true });
  });
});

describe("retrato — as quatro leituras", () => {
  it("cena ESCONDIDA: filhos presentes, `sceneVisivel` falso, nada renderizável", () => {
    const r = retratoDaCena(glFalso, cenaFalsa(false), cameraFalsa());
    expect(r.filhosDepois).toBe(5);
    expect(r.sceneVisivel).toBe(false);
    expect(r.objetosRender).toBe(0);
  });

  it("cena DESMONTADA: sem filhos", () => {
    const vazia = { visible: true, children: [] } as unknown as THREE.Scene;
    const r = retratoDaCena(glFalso, vazia, cameraFalsa());
    expect(r.filhosDepois).toBe(0);
    expect(r.objetosRender).toBe(0);
  });

  it("tudo CULLADO: filhos presentes e visíveis, mas nada para desenhar", () => {
    const cullada = {
      visible: true,
      children: [grupo("map-props", [], true), grupo("chunks", [], true)],
    } as unknown as THREE.Scene;
    const r = retratoDaCena(glFalso, cullada, cameraFalsa());
    expect(r.filhosDepois).toBe(2);
    expect(r.sceneVisivel).toBe(true);
    expect(r.objetosRender).toBe(0);
  });

  it("câmera inválida é acusada", () => {
    expect(retratoDaCena(glFalso, cenaFalsa(), cameraFalsa(false)).cameraOk).toBe(false);
    expect(retratoDaCena(glFalso, cenaFalsa(), null).cameraOk).toBe(false);
  });

  it("`filhosAntes` é o último quadro que DESENHOU, não o quadro anterior", () => {
    const cena = cenaFalsa();
    amostrarCena(cena, cameraFalsa(), 200); // desenhou: 5 filhos
    const vazia = { visible: true, children: [] } as unknown as THREE.Scene;
    // vários quadros vazios seguidos
    amostrarCena(vazia, cameraFalsa(), 0);
    amostrarCena(vazia, cameraFalsa(), 0);

    const r = retratoDaCena(glFalso, vazia, cameraFalsa());
    // pelo "quadro anterior" isto seria 0 contra 0, e a comparação não diria nada
    expect(r.filhosAntes).toBe(5);
    expect(r.filhosDepois).toBe(0);
  });
});

describe("contagem por categoria", () => {
  it("atribui pelo ancestral NOMEADO, e o solto cai em `outros`", () => {
    const { total, porCategoria } = contarPorCategoria(cenaFalsa() as never);
    // 2 chunks + 1 água + 3 props + 2 entidades + 1 efeito + 1 solto
    expect(total).toBe(10);
    expect(porCategoria).toEqual({ chunks: 2, agua: 1, props: 3, entidades: 2, efeitos: 1, outros: 1 });
  });

  it("não desce por nó invisível — pai oculto esconde a subárvore no three", () => {
    const cena = {
      visible: true,
      children: [grupo("map-props", [malha(), malha()], false), grupo("chunks", [malha()])],
    } as unknown as THREE.Scene;
    const { porCategoria } = contarPorCategoria(cena as never);
    expect(porCategoria.props).toBeUndefined();
    expect(porCategoria.chunks).toBe(1);
  });
});

describe("suspensão", () => {
  it("nomeia o boundary e as urls em voo — a hipótese, com o .glb apontado", () => {
    const g: GerenciadorObservavel = { itemStart: () => {}, itemEnd: () => {}, itemError: () => {} };
    const soltar = observarCarregamento(g);
    g.itemStart("assets/props/arvore.glb");

    marcarSuspensao("cena");
    const ev = eventosOrdenados().find((e) => e.tipo === "suspendeu");
    expect(ev!.dados).toMatchObject({ boundary: "cena", cache: "miss", emVoo: ["assets/props/arvore.glb"] });
    soltar();
  });

  it("suspender SEM asset em voo é um resultado previsto — e derruba a hipótese", () => {
    marcarSuspensao("cena");
    const ev = eventosOrdenados().find((e) => e.tipo === "suspendeu");
    expect(ev!.dados).toMatchObject({ cache: "sem-asset", emVoo: [] });
  });

  it("a revelação mede a duração e aponta o candidato que resolveu", () => {
    const g: GerenciadorObservavel = { itemStart: () => {}, itemEnd: () => {}, itemError: () => {} };
    const soltar = observarCarregamento(g);

    g.itemStart("arvore.glb");
    marcarSuspensao("cena");
    relogio.mockReturnValue(140);
    g.itemEnd("arvore.glb");
    marcarRevelacao("cena");

    const ev = eventosOrdenados().find((e) => e.tipo === "revelou");
    expect(ev!.dados).toMatchObject({ boundary: "cena", ms: 140, candidato: "arvore.glb", cargaMs: 140 });
    soltar();
  });

  it("`suspensoMs` corre enquanto o boundary está caído e zera na revelação", () => {
    marcarSuspensao("cena");
    relogio.mockReturnValue(50);
    amostrarCena(cenaFalsa(), cameraFalsa(), 0);
    expect(quadro().suspensoMs).toBe(50);

    marcarRevelacao("cena");
    relogio.mockReturnValue(80);
    amostrarCena(cenaFalsa(), cameraFalsa(), 0);
    expect(quadro().suspensoMs).toBe(0);
  });

  it("o retrato distingue suspensão de DESMONTE", () => {
    marcarSuspensao("cena");
    let r = retratoDaCena(glFalso, cenaFalsa(false), cameraFalsa());
    expect(r.suspensoAgora).toBe(true);
    expect(r.desmontagemHaMs).toBeNull();

    relogio.mockReturnValue(10);
    marcarDesmontagemDaCena();
    r = retratoDaCena(glFalso, cenaFalsa(false), cameraFalsa(), 25);
    expect(r.desmontagemHaMs).toBe(15);
    expect(r.desmontagens).toBe(1);
  });
});

describe("chunks e props", () => {
  it("chunk coalescido, mas o CARIMBO é sempre — é ele que responde 'no mesmo instante?'", () => {
    marcarChunk(3, 0, 10, 0);
    expect(eventosOrdenados().filter((e) => e.tipo === "chunks")).toHaveLength(1);

    // dentro da janela: soma, não emite
    marcarChunk(2, 1, 12, 100);
    expect(eventosOrdenados().filter((e) => e.tipo === "chunks")).toHaveLength(1);
    expect(retratoDaCena(glFalso, cenaFalsa(), cameraFalsa(), 130).chunkHaMs).toBe(30);

    marcarChunk(1, 0, 13, 700);
    const ev = eventosOrdenados().filter((e) => e.tipo === "chunks").at(-1)!;
    expect(ev.dados).toMatchObject({ criadas: 3, removidas: 1, cache: 13 });
  });

  it("props só emitem quando MUDAM", () => {
    marcarPropsVisiveis(12);
    marcarPropsVisiveis(12);
    expect(eventosOrdenados().filter((e) => e.tipo === "props")).toHaveLength(1);

    marcarPropsVisiveis(15, 200);
    const ev = eventosOrdenados().filter((e) => e.tipo === "props").at(-1)!;
    expect(ev.dados).toMatchObject({ de: 12, para: 15 });
    expect(retratoDaCena(glFalso, cenaFalsa(), cameraFalsa(), 250).propsMudouHaMs).toBe(50);
  });
});

describe("o acumulado do `medir` não sobrevive ao voo desligado", () => {
  it("zera mesmo com o gravador PARADO — senão o primeiro quadro gravado mente", () => {
    /**
     * O `medir()` acumula sempre que roda em DEV; quem ZERA é a escrita da
     * coluna, dentro do `amostrarCena`. Enquanto essa escrita ficou dentro do
     * `if (ativo())`, um período com o voo desligado empilhava tudo e despejava
     * o total no PRIMEIRO quadro gravado.
     *
     * Foi o que aconteceu: o `voo-1785966296680.json` saiu com
     * `trocaMs.max = 514,5 ms` num dump **sem um único evento `cena/custo` e
     * sem portal nenhum**. Um pico fantasma — exatamente o tipo de coisa que já
     * mandou esta investigação atrás de causa errada.
     */
    let t = 0;
    relogio.mockImplementation(() => t);

    forcarFlag(false); // voo parado
    medir("carga antes de gravar", () => {
      t += 500;
    });
    amostrarCena(cenaFalsa(), cameraFalsa(), 100); // não grava, mas TEM de zerar

    forcarFlag(true); // agora sim
    amostrarCena(cenaFalsa(), cameraFalsa(), 100);
    expect(quadro().trocaMs).toBe(0);
  });

  it("…e continua contando o que acontece DURANTE a gravação", () => {
    let t = 0;
    relogio.mockImplementation(() => t);
    medir("trabalho de verdade", () => {
      t += 40;
    });
    amostrarCena(cenaFalsa(), cameraFalsa(), 100);
    expect(quadro().trocaMs).toBe(40);
  });
});

describe("custo da varredura", () => {
  it("é AMOSTRADA, não por quadro — o medidor não paga o custo que ele acusa", () => {
    /**
     * O espião fica num nó PROFUNDO de propósito.
     *
     * Na raiz ele contaria também os `scene.children.length` do caminho O(1),
     * que roda todo quadro e deve rodar mesmo. Quem só é alcançado descendo a
     * árvore é um neto — e descer a árvore É a varredura.
     */
    let visitas = 0;
    const fundo = new Proxy(grupo("map-props", [malha(), malha()]), {
      get(alvo, chave, receptor) {
        if (chave === "children") visitas++;
        return Reflect.get(alvo, chave, receptor);
      },
    });
    const cena = { visible: true, children: [fundo] } as unknown as THREE.Scene;

    const quadros = PASSO_DA_VARREDURA * 3;
    for (let i = 0; i < quadros; i++) amostrarCena(cena, cameraFalsa(), 100);

    expect(visitas).toBe(3);
    expect(quadro().objetosRender).toBe(2);
  });
});
