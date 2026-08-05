import * as THREE from "three";
import type { GameMap, SurfaceType, TerrainStyle } from "@ragnarok/map-format";

/**
 * As texturas de chão do terreno quadrado, num `DataArrayTexture`.
 *
 * Uma CAMADA por tipo de superfície, e não um atlas: o chão amostra a textura
 * por coordenada de MUNDO e ladrilha infinitas vezes, e num atlas o `fract()` de
 * cada repetição quebraria a derivada da UV — o mip escolhido saltaria na
 * emenda e apareceria uma linha em cada ladrilho. Num array texture cada camada
 * tem o próprio `RepeatWrapping` e o mip sai certo de graça.
 *
 * Os PNGs são gerados por `scripts/make-terrain-textures.mjs` a partir das
 * MESMAS cores base declaradas aqui — é isso que permite o shader dividir o
 * texel pela cor base e usar a textura como PADRÃO, deixando a tinta da célula
 * (`attribute color`, de `cellColor`) continuar mandando na cor.
 *
 * Qual VARIANTE cada superfície usa é escolha do mapa (`GameMap.terrainStyle`),
 * feita no editor. O array texture é um só e as camadas são recarregadas quando
 * a escolha muda — trocar a grama não reconstrói geometria nem material.
 */

/** ordem das camadas dentro do array texture (= ordem no shader) */
export const TERRAIN_LAYERS = ["grass", "dirt", "stone", "sand", "snow"] as const;
export type TerrainLayer = (typeof TERRAIN_LAYERS)[number];

/**
 * Paleta base — fonte única.
 *
 * `squareChunks.cellColor` pinta o vértice com estas cores e o gerador de
 * textura constrói cada PNG em cima delas. Se as duas pontas divergirem, o
 * shader dividiria por uma base errada e a textura tingiria o chão.
 */
export const TERRAIN_BASE_HEX: Record<TerrainLayer, string> = {
  grass: "#7d9b3f",
  dirt: "#8a6b45",
  stone: "#7c7f86",
  sand: "#c9b380",
  snow: "#e8ecef",
};

/**
 * Superfície → camada.
 *
 * Água e rio caem em `dirt` de propósito: a lâmina d'água é uma malha separada
 * (`buildWaterGeometry`) e o que a textura desenha ali é o LEITO visto por baixo
 * dela — leito é terra, não água. A textura da água é outra coisa, e vive no
 * material da lâmina.
 */
export const TERRAIN_LAYER: Record<SurfaceType, number> = {
  grass: 0,
  dirt: 1,
  stone: 2,
  sand: 3,
  snow: 4,
  water: 1,
  river: 1,
};

export const TEX_SIZE = 512;

/**
 * Unidades de MUNDO por repetição, quando o mapa não diz outra coisa.
 *
 * A célula do rAthena mede 2 unidades e o personagem ocupa ~1 célula. Com as 8
 * unidades que valiam para tudo, o padrão repetia a cada 4 personagens: na
 * distância de câmera do jogo isso vira granulado, e granulado a essa escala lê
 * como COR SÓLIDA. Não é o mesmo número para todas porque o conteúdo é outro —
 * rocha tem estrutura grande, areia é quase uniforme e aguenta repetir miúdo.
 */
export const ESCALA_PADRAO: Record<SurfaceType, number> = {
  grass: 24,
  dirt: 20,
  stone: 28,
  sand: 18,
  snow: 24,
  water: 12,
  river: 12,
};

/** uma variante disponível para uma superfície (lida do manifesto) */
export interface VarianteTextura {
  id: string;
  rotulo: string;
  fonte: string;
}

export interface ManifestoTerreno {
  escalaPadrao: Record<string, number>;
  superficies: Partial<Record<SurfaceType, VarianteTextura[]>>;
}

let arrayTexture: THREE.DataArrayTexture | null = null;
let dados: Uint8Array | null = null;
/** id da variante carregada em cada camada — evita recarregar o que já está lá */
const carregado: Record<number, string> = {};
/**
 * Qual troca de estilo é a VÁLIDA. Cada `aplicarEstilo` pega um número novo, e
 * uma imagem que termine de carregar depois de outra troca ter começado é
 * DESCARTADA. Ver o comentário da corrida em `aplicarEstilo`.
 */
let geracao = 0;
/**
 * O último estilo PEDIDO, mesmo que ainda não tenha dado para aplicá-lo.
 *
 * Existe porque o pedido chega ANTES do buffer. O `terrainArrayTexture()` é
 * chamado dentro do `onBeforeCompile` do material (`SquareTerrain`), ou seja, só
 * quando o shader compila — e isso acontece no primeiro quadro DESENHADO. O
 * `useEffect` do `SquareTerrain`, que pede o estilo do mapa, roda antes disso,
 * no commit do React. Sem esta memória, aquele pedido caía num `return` mudo (o
 * buffer não existia) e o único que sobrava era o `aplicarEstilo(undefined)` que
 * a própria criação dispara — os PADRÕES. Resultado: a grama escolhida no editor
 * aparecia como procedural no /play, e ficava assim até recarregar, porque o
 * efeito não roda de novo sem o estilo mudar.
 */
let ultimoEstilo: GameMap["terrainStyle"] | undefined;

/** o que está em cada camada agora — para depuração e para o teste da corrida */
export function variantesCarregadas(): string[] {
  return TERRAIN_LAYERS.map((_, i) => carregado[i] ?? "");
}

/**
 * O array texture, criado na primeira chamada e compartilhado.
 *
 * Nasce PREENCHIDO com a cor base de cada camada e as imagens entram depois, de
 * forma assíncrona, no mesmo buffer. Com base chapada o shader calcula
 * `texel / base == 1`, ou seja, o chão fica exatamente como era antes das
 * texturas — não há quadro com o terreno preto ou branco enquanto carrega, e não
 * é preciso suspender a cena.
 */
export function terrainArrayTexture(): THREE.DataArrayTexture {
  const jaExistia = arrayTexture !== null;
  criarSeFaltar();
  // Só a CRIAÇÃO dispara carga, e ela carrega o que já foi PEDIDO — não os
  // padrões. Quem chama isto é o `onBeforeCompile` do material, que roda no
  // primeiro quadro desenhado, DEPOIS do efeito que pede o estilo do mapa.
  if (!jaExistia && typeof document !== "undefined") void aplicarEstilo(ultimoEstilo);
  return arrayTexture as THREE.DataArrayTexture;
}

/** cria o buffer compartilhado, se ainda não existir. NÃO carrega nada. */
function criarSeFaltar(): void {
  if (arrayTexture) return;

  const layers = TERRAIN_LAYERS.length;
  const data = new Uint8Array(TEX_SIZE * TEX_SIZE * 4 * layers);
  const porCamada = TEX_SIZE * TEX_SIZE * 4;
  TERRAIN_LAYERS.forEach((nome, i) => {
    const hex = parseInt(TERRAIN_BASE_HEX[nome].slice(1), 16);
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    for (let p = 0; p < porCamada; p += 4) {
      const o = i * porCamada + p;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  });

  const tex = new THREE.DataArrayTexture(data, TEX_SIZE, TEX_SIZE, layers);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  arrayTexture = tex;
  dados = data;
}

/** id da variante que uma superfície usa, dado o estilo do mapa */
export function varianteDe(superficie: TerrainLayer, estilo?: GameMap["terrainStyle"]): string {
  return (estilo?.[superficie] as TerrainStyle | undefined)?.texture ?? superficie;
}

/**
 * Variante da ÁGUA — que não é camada do array texture.
 *
 * A lâmina é material próprio, então a textura dela é uma `Texture` comum. Rio e
 * lago compartilham a escolha: é a mesma água, muda só a profundidade do leito.
 */
export function varianteDeAgua(estilo?: GameMap["terrainStyle"]): string {
  return (
    (estilo?.water as TerrainStyle | undefined)?.texture ??
    (estilo?.river as TerrainStyle | undefined)?.texture ??
    "water"
  );
}

/** unidades de mundo por repetição de uma superfície, dado o estilo do mapa */
export function escalaDe(superficie: SurfaceType, estilo?: GameMap["terrainStyle"]): number {
  const s = (estilo?.[superficie] as TerrainStyle | undefined)?.scale;
  return s && s > 0 ? s : ESCALA_PADRAO[superficie];
}

/** as escalas, na ORDEM DAS CAMADAS — é assim que o shader as recebe */
export function escalasPorCamada(estilo?: GameMap["terrainStyle"]): number[] {
  return TERRAIN_LAYERS.map((n) => escalaDe(n, estilo));
}

/**
 * Carrega, em cada camada, a variante que o mapa pediu.
 *
 * Só busca o que MUDOU: trocar a grama não rebaixa as outras quatro. Um id que
 * não existe cai no padrão da superfície em vez de deixar a camada na cor
 * chapada — mapa com textura removida do disco continua desenhando.
 *
 * ## A corrida que trocava a grama escolhida pela padrão
 *
 * O `carregado[i]` parece proteger contra carga repetida, mas ele só era escrito
 * DEPOIS do `await` — então duas chamadas simultâneas passavam as duas pela
 * conferência e as duas escreviam no MESMO buffer. Vencia a que terminasse por
 * último, que é a que baixou o PNG mais leve, não a que o mapa pediu.
 *
 * E havia sempre duas: `terrainArrayTexture()` dispara
 * `aplicarEstilo(undefined)` ao criar a textura (para o chão nunca ficar em cor
 * chapada), e o `SquareTerrain` dispara `aplicarEstilo(map.terrainStyle)` no
 * efeito dele. A primeira pede os PADRÕES. Quando ela chegava por último, a
 * grama escolhida no editor ("Musgo escuro") era sobrescrita pela procedural —
 * e ficava assim até recarregar a página, porque `carregado[0]` passava a dizer
 * que a camada já estava certa e o efeito não roda de novo sem o estilo mudar.
 *
 * A `geracao` resolve: quem chega atrasado não escreve. Como toda chamada
 * descreve TODAS as camadas, descartar a antiga por inteiro não deixa buraco —
 * a nova cobre o mesmo conjunto.
 *
 * `carregar` é injetável só para o teste conseguir controlar a ordem de chegada
 * sem um DOM (o carregador de verdade usa `canvas`).
 */
export async function aplicarEstilo(
  estilo: GameMap["terrainStyle"] | undefined,
  carregar: (url: string) => Promise<Uint8ClampedArray> = carregarPixels,
): Promise<void> {
  // Guarda o PEDIDO antes de qualquer coisa: se o buffer ainda não existisse e
  // este pedido se perdesse, o único que sobraria seria o dos padrões.
  ultimoEstilo = estilo;
  // e garante o buffer, em vez de desistir calado — era este `return` mudo que
  // fazia a grama escolhida no editor virar procedural no /play
  criarSeFaltar();
  const tex = arrayTexture;
  const data = dados;
  if (!tex || !data) return;
  const porCamada = TEX_SIZE * TEX_SIZE * 4;
  const minhaGeracao = ++geracao;
  /** esta chamada ainda é a mais recente? */
  const atual = () => minhaGeracao === geracao;

  let mudou = false;
  await Promise.all(
    TERRAIN_LAYERS.map(async (nome, i) => {
      const id = varianteDe(nome, estilo);
      if (carregado[i] === id) return;
      try {
        const px = await carregar(`/assets/terrain/${id}.png`);
        if (!atual()) return;
        data.set(px, i * porCamada);
        carregado[i] = id;
        mudou = true;
      } catch (err) {
        if (!atual()) return;
        console.warn(`[terrainTextures] ${id}.png não carregou`, err);
        if (id !== nome) {
          try {
            const px = await carregar(`/assets/terrain/${nome}.png`);
            if (!atual()) return;
            data.set(px, i * porCamada);
            carregado[i] = nome;
            mudou = true;
          } catch {
            /* fica na cor base */
          }
        }
      }
    }),
  );
  if (mudou && atual()) tex.needsUpdate = true;
}

/** cor base de cada camada em espaço LINEAR, para o shader dividir o texel */
export function terrainBaseColors(): THREE.Color[] {
  // `new THREE.Color(hex)` já converte de sRGB para o espaço de trabalho linear
  // (ColorManagement ligado por padrão), que é onde o texel também chega depois
  // do decode do `SRGBColorSpace` — os dois lados da divisão no mesmo espaço.
  return TERRAIN_LAYERS.map((n) => new THREE.Color(TERRAIN_BASE_HEX[n]));
}

let manifesto: Promise<ManifestoTerreno> | null = null;

/** o catálogo de variantes, para o seletor do editor (buscado uma vez) */
export function manifestoTerreno(): Promise<ManifestoTerreno> {
  manifesto ??= fetch("/assets/terrain/manifest.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .catch((err) => {
      console.warn("[terrainTextures] manifesto não carregou", err);
      return { escalaPadrao: ESCALA_PADRAO, superficies: {} } as ManifestoTerreno;
    });
  return manifesto;
}

async function carregarPixels(url: string): Promise<Uint8ClampedArray> {
  const bitmap = await carregarBitmap(url);
  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("sem canvas 2d");
  ctx.drawImage(bitmap, 0, 0, TEX_SIZE, TEX_SIZE);
  return ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
}

function carregarBitmap(url: string): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    return fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        return r.blob();
      })
      .then((b) => createImageBitmap(b));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`falhou ${url}`));
    img.src = url;
  });
}
