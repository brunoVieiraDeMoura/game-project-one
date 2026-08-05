import { describe, expect, it, vi } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import {
  TERRAIN_LAYERS,
  aplicarEstilo,
  terrainArrayTexture,
  variantesCarregadas,
  varianteDe,
} from "./terrainTextures";

/**
 * A GRAMA ESCOLHIDA NO EDITOR NÃO PODE VOLTAR AO PADRÃO NO /play.
 *
 * O relato (next-change.txt): "alguma coisa está mudando a textura da grama no
 * /play (…) eu tinha escolhido a textura da grama 'Musgo escuro'".
 *
 * Não era o editor nem o round-trip da API — os dois guardam `terrainStyle`
 * certo. Era uma CORRIDA no carregador: duas chamadas de `aplicarEstilo`
 * acontecem sempre, e as duas escrevem no mesmo buffer.
 *
 *  1. `terrainArrayTexture()` dispara `aplicarEstilo(undefined)` ao criar a
 *     textura, para o chão nunca aparecer em cor chapada. Ela pede os PADRÕES.
 *  2. O `SquareTerrain` dispara `aplicarEstilo(map.terrainStyle)` no efeito
 *     dele. Ela pede o que o mapa escolheu.
 *
 * O `carregado[i]` só era escrito DEPOIS do `await`, então as duas passavam
 * pela conferência e vencia a que terminasse por último — a que baixou o PNG
 * mais leve, não a que o mapa pediu. E ficava assim até recarregar a página:
 * `carregado[0]` passava a dizer que a camada estava certa, e o efeito não roda
 * de novo sem o estilo mudar.
 *
 * O teste força a ordem PIOR (a chamada dos padrões termina por último) e exige
 * que a escolha do mapa continue de pé.
 */

const PADRAO_LENTO = 30;
const ESCOLHA_RAPIDA = 1;

/** um carregador falso com atraso controlado — o de verdade precisa de `canvas` */
function carregadorCom(atrasoPorUrl: (url: string) => number) {
  const pedidos: string[] = [];
  const carregar = async (url: string): Promise<Uint8ClampedArray> => {
    pedidos.push(url);
    await new Promise((r) => setTimeout(r, atrasoPorUrl(url)));
    // conteúdo não importa aqui: o que se testa é QUEM escreve por último
    return new Uint8ClampedArray(4);
  };
  return { carregar, pedidos };
}

const estiloDoMapa = {
  grass: { texture: "grass-musgo-escuro" },
} as unknown as GameMap["terrainStyle"];

describe("corrida entre o estilo do mapa e os padrões", () => {
  it("a escolha do mapa vence mesmo chegando ANTES dos padrões", async () => {
    // cria o buffer compartilhado (em node não dispara a carga automática — o
    // guard de `document` no terrainArrayTexture cuida disso)
    terrainArrayTexture();

    // o padrão da grama demora; a escolha do mapa chega logo. Sem a `geracao`,
    // o padrão escreveria por cima e a grama voltaria à procedural.
    const { carregar } = carregadorCom((url) =>
      url.includes("musgo") ? ESCOLHA_RAPIDA : PADRAO_LENTO,
    );

    const padroes = aplicarEstilo(undefined, carregar);
    const doMapa = aplicarEstilo(estiloDoMapa, carregar);
    await Promise.all([padroes, doMapa]);

    const camadas = variantesCarregadas();
    const iGrama = TERRAIN_LAYERS.indexOf("grass");
    expect(camadas[iGrama]).toBe("grass-musgo-escuro");
  });

  it("a última troca é a que vale, mesmo se a anterior demorar mais", async () => {
    terrainArrayTexture();
    // duas trocas do editor em sequência: a primeira demora, a segunda é
    // instantânea. O jogador vê o que escolheu POR ÚLTIMO.
    const { carregar } = carregadorCom((url) => (url.includes("areia") ? 25 : 1));
    const primeira = aplicarEstilo(
      { grass: { texture: "grass-areia-velha" } } as unknown as GameMap["terrainStyle"],
      carregar,
    );
    const segunda = aplicarEstilo(
      { grass: { texture: "grass-campo" } } as unknown as GameMap["terrainStyle"],
      carregar,
    );
    await Promise.all([primeira, segunda]);

    const iGrama = TERRAIN_LAYERS.indexOf("grass");
    expect(variantesCarregadas()[iGrama]).toBe("grass-campo");
  });

  it("PEDIDO ANTES DO BUFFER não se perde", async () => {
    /**
     * A causa de verdade do relato — e ela NÃO é uma corrida, é ordem fixa.
     *
     * `terrainArrayTexture()` é chamado dentro do `onBeforeCompile` do material
     * (`SquareTerrain`), ou seja, só quando o shader COMPILA — e isso acontece
     * no primeiro quadro DESENHADO. O `useEffect` do `SquareTerrain`, que pede
     * `map.terrainStyle`, roda antes disso, no commit do React.
     *
     * Ou seja, a ordem real é sempre esta:
     *   1. efeito → aplicarEstilo(estilo do mapa) → buffer não existe
     *   2. 1º quadro → onBeforeCompile → cria o buffer → carrega
     *
     * Antes, o passo 1 caía num `return` mudo (`if (!tex || !data) return`) e o
     * passo 2 carregava os PADRÕES. A grama escolhida no editor virava
     * procedural no /play e ficava assim até recarregar a página, porque o
     * efeito não roda de novo sem o estilo mudar.
     *
     * A tela de carregamento piorou isto de intermitente para certo: com a cena
     * oculta nada compila, então o buffer nem chegava a existir enquanto o mapa
     * era montado.
     */
    // instância limpa do módulo: os testes acima já deixaram camadas carregadas,
    // e o que se quer medir aqui é justamente o estado ZERO
    vi.resetModules();
    const mod = await import("./terrainTextures");
    const { carregar, pedidos } = carregadorCom(() => 1);

    // 1. o mapa pede, e AINDA NÃO HÁ BUFFER
    await mod.aplicarEstilo(estiloDoMapa, carregar);
    // 2. só agora o shader compila e chama o criador
    mod.terrainArrayTexture();

    const iGrama = mod.TERRAIN_LAYERS.indexOf("grass");
    expect(mod.variantesCarregadas()[iGrama]).toBe("grass-musgo-escuro");
    // e o padrão da grama não chegou a ser buscado
    expect(pedidos).not.toContain("/assets/terrain/grass.png");
  });

  it("sem escolha no mapa, a camada usa o id da própria superfície", () => {
    // é o contrato que faz "Procedural (gerada)" ser o padrão: `varianteDe`
    // devolve o nome da superfície, e `<superficie>.png` é a receita procedural
    expect(varianteDe("grass", undefined)).toBe("grass");
    expect(varianteDe("grass", estiloDoMapa)).toBe("grass-musgo-escuro");
  });
});
