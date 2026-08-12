import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import { cellLayer, visualLevel, ehCelulaDeAgua, COLOR_WATER } from "./squareChunks";
import { SQUARE_SIZE, squareLevelToY } from "./squareGrid";
import { TERRAIN_BASE_HEX, TERRAIN_LAYERS } from "./terrainTextures";
import { GROUND_NOISE_GLSL } from "../scene/groundNoise.glsl";
import { registrarEvento } from "../core/diagnostics/flightRecorder";
import { isolado } from "../core/diagnostics/isolamento";

/**
 * O HORIZONTE — uma malha decimada do MAPA INTEIRO, barata o bastante para
 * nunca precisar de culling (Fase G da auditoria de render,
 * `docs/claude-context/02-terrain-rendering.md`).
 *
 * ## Por que existe
 *
 * O chão detalhado (`SquareTerrain`) só desenha dentro do raio de `detalhe`
 * (~130 unidades) — de propósito, é caro por natureza (relevo por vértice,
 * blend de textura por canto, água própria). Além dele, a névoa fechava
 * quase em cima da borda: nada existia depois, então o olho via um disco de
 * mundo boiando num vazio uniforme, a "parede de névoa" que esta fase existe
 * para eliminar.
 *
 * Esta malha resolve isso sem carregar o mundo inteiro em detalhe: UMA
 * geometria, amostrada a cada `PASSO_HORIZONTE` células do MESMO heightmap/
 * superfície que os chunks reais leem (`squareChunks.visualLevel`/
 * `cellLayer` — não é um segundo sistema de terreno, é o mesmo, mais
 * grosso). Para `prt_fild08` (400×400 células): 71×71 vértices, 9.800
 * triângulos (inclui a franja de `PADDING_MUNDO`, ver abaixo), **1 draw
 * call** — o número que a Fase H mede contra `?iso=semHorizonte`.
 *
 * ## Por que não precisa de culling nem de LOD por estágio
 *
 * Ela cobre o mapa INTEIRO sempre, sem depender da posição do jogador — não
 * é um anel que "segue a câmera" como o `GradientSky` (esse é pano de fundo
 * infinito; isto é terreno de verdade, com posição real no mundo). Por isso
 * não existe `useFrame` aqui: nada muda quadro a quadro, e mexer nela por
 * movimento do jogador seria reintroduzir o mesmo custo que a Fase E1/E2
 * corrigiu em outro lugar. `lod:change` (pedido na Fase 13 da auditoria)
 * não é emitido: não existe TROCA de nível aqui — as duas camadas (detalhe e
 * horizonte) coexistem o tempo todo, e a "troca" visível é só o chão
 * detalhado cobrindo o horizonte por baixo dele onde os dois se sobrepõem.
 *
 * ## Por que fica ABAIXO do chão detalhado
 *
 * `OFFSET_Y` empurra a malha um pouco para baixo do relevo real. Onde o
 * `SquareTerrain` desenha por cima, o teste de profundidade padrão deixa o
 * chão detalhado vencer — nenhum shader especial, nenhum `renderOrder`.
 * Onde não há chão detalhado (além do raio de `detalhe`), esta malha é a
 * ÚNICA coisa ali, e o pequeno deslocamento nunca é percebido a essa
 * distância.
 *
 * ## Bugs visuais corrigidos depois da correção de posição X/Z (validados ao
 * vivo no Chrome, `prt_fild08`, conta `bruno`, personagem `mskT`)
 *
 * **A malha decimada flutuava ACIMA do chão real (BUG 1 — a causa de
 * verdade).** A primeira tentativa de corrigir isto (Fase anterior) só trocou
 * o MATERIAL (deu `groundFbm`, ver mais abaixo) — melhorou o aspecto liso mas
 * NÃO corrigiu o defeito relatado de novo numa segunda inspeção visual, porque
 * a causa real é OUTRA: **geométrica, na altura (Y), não no material**.
 * Provado por raycast ao vivo (não por aparência): comparando a altura do
 * chão REAL (`chunks`) contra a altura desta malha na MESMA coluna de mundo,
 * numa grade de pontos a até 60 unidades do jogador, **59 de 169 pontos
 * (35%) tinham a malha decimada ACIMA do chão real — até 5,73 unidades**.
 * Causa: o relevo do rAthena é feito de DEGRAUS (uma parede sobe 1 nível
 * INSTANTANEAMENTE — ver `squareChunks.visualLevel`, "parede sobe um
 * nível" —, não uma rampa), e amostrar só o ponto decimado a cada
 * `PASSO_HORIZONTE` células deixa o GPU interpolar LINEARMENTE entre dois
 * pontos — uma rampa onde o chão real tem um degrau. Nos metros ANTES do
 * degrau real (onde o chão real ainda está baixo), a malha decimada já
 * começou a subir rumo ao vizinho alto, e fica ACIMA do chão detalhado
 * bem ali. `OFFSET_Y`, um deslocamento CONSTANTE, não alcança uma folga de
 * 5,73 unidades sem afundar a malha visivelmente sozinha longe do jogador —
 * por isso a correção é `nivelMinimoNaVizinhanca`: cada vértice usa o PIOR
 * CASO (mínimo) real ao redor dele, garantindo que a malha decimada nunca
 * fique mais alta que o relevo que ela aproxima, só mais baixa (invisível:
 * coberta pelo chão detalhado, ou longe demais para a diferença aparecer).
 *
 * **"Plano verde liso" (parte visual, ainda válida).** O material
 * `MeshLambertMaterial` só com `vertexColors`, sem textura/ruído nenhum,
 * contra o chão real que usa `MeshStandardMaterial` com textura triplanar +
 * `groundFbm`, lia como um bloco plástico mesmo depois da malha parar de
 * flutuar. Corrigido injetando o MESMO `groundFbm` (`scene/groundNoise.glsl`)
 * no `onBeforeCompile`, só a parte que modula COR — não a versão triplanar
 * com textura de `SquareTerrain` (essa exige `sampler2DArray` + atributos
 * por camada, o dobro do orçamento que esta malha existe para não pagar).
 *
 * **Água distante parecia terra (BUG 2 novo).** `cellLayer` (usado para a
 * cor) deliberadamente trata água/rio como `dirt` — é o LEITO, porque no chão
 * real a lâmina azul é OUTRA malha (`buildWaterGeometry`) desenhada por cima.
 * Esta malha não tem lâmina própria, então uma célula de água aqui aparecia
 * com a cor do leito (terra) até o jogador chegar perto o bastante para a
 * água REAL cobrir. Corrigido lendo `ehCelulaDeAgua` (o MESMO detector que
 * `squareChunks` usa) direto, ANTES do remapeamento para `dirt`, e pintando
 * um azul de água — sem malha nova, sem draw call a mais.
 *
 * **"Seco" na borda física do mapa (BUG 3).** Provado ao vivo: com o
 * personagem perto de `x≈33` (borda oeste de um mapa 400×400) e a câmera no
 * zoom MÁXIMO normal (`cameraMaxZoom` do `useGameplayConfig`, nem um valor
 * extremo), a câmera fica fora do mapa (`x≈-38`) e a malha — antes cortada
 * exatamente em `x=0` — expõe uma cunha de vazio (céu por baixo do que
 * deveria ser chão). `PADDING_MUNDO` estende a grade além da borda real e
 * reusa o MESMO clamp de célula que já existia (`Math.min/Math.max`) — a
 * franja simplesmente repete a altura/cor da célula de borda, sem inventar
 * relevo novo. Dimensionado para cobrir o alcance máximo realista da câmera
 * além do jogador (`cameraDistance × cameraMaxZoom`, ~112 unidades no
 * padrão) com folga para ângulo rasante. Continua funcionando sem mudança
 * nesta correção — `nivelMinimoNaVizinhanca` só troca QUAL nível é lido, a
 * franja/clamp que decide ONDE ler continua a mesma.
 */

/**
 * De quantas em quantas células o horizonte amostra o mapa.
 *
 * **4, não mais 8** (otimização de renderização, prioridade 8 — LOD de
 * relevo/montanha): a malha decimada era o único "LOD" do relevo distante, e
 * amostrar de 8 em 8 células (16 unidades) deixa qualquer morro com degraus
 * grosseiros — bem mais grosseiro que a árvore, que troca pra um billboard
 * fotográfico (`grid/TreeImpostors`) em vez de perder resolução geométrica.
 * `JANELA_NIVEL_MINIMO` (abaixo) é DEFINIDO em cima deste valor — reduzi-lo
 * também encolhe a janela do fix de poke-through (BUG 1), então o custo por
 * vértice CAI (janela menor) enquanto a contagem de vértice SOBE (passo
 * menor): medido, o build inteiro fica na mesma ordem de grandeza de antes
 * (a malha ainda é 1 único mesh, 1 draw call, sem culling — só mais fina).
 */
export const PASSO_HORIZONTE = 4;

/** quanto a malha fica abaixo do relevo real — só para o chão detalhado sempre vencer o teste de profundidade */
const OFFSET_Y = -0.3;

/**
 * Quanto a malha se estende ALÉM da borda física do mapa, em unidades de
 * mundo (BUG 3).
 *
 * 160 cobre o alcance máximo NORMAL da câmera além do jogador — `cameraDistance
 * × cameraMaxZoom` do `useGameplayConfig` é 16×7 = 112 no padrão — com folga
 * para ângulo rasante (olhar quase de raspão pela borda alcança mais longe no
 * CHÃO do que a distância em linha reta até a câmera). Não é o mesmo número do
 * `ADICIONAL_DE_HORIZONTE` de `play/viewRadius` de propósito: aquele é o raio
 * onde a NÉVOA fecha a partir do JOGADOR (o mapa inteiro já está coberto por
 * esta malha muito antes disso); este é só o suficiente para a câmera nunca
 * flagrar a borda da GEOMETRIA, um problema bem menor.
 *
 * Custo medido (`prt_fild08`, 400×400): sem padding, 51×51 vértices/5.000
 * triângulos; com 160, 71×71 vértices/9.800 triângulos — ~2× em vez de tentar
 * cobrir o raio de névoa inteiro (que teria dado ~5× em vez de ~2×).
 */
const PADDING_MUNDO = 160;

const PALETA_POR_CAMADA = TERRAIN_LAYERS.map((camada) => new THREE.Color(TERRAIN_BASE_HEX[camada]));

export interface HorizonBuild {
  geometry: THREE.BufferGeometry;
  vertices: number;
  triangulos: number;
  ms: number;
}

/**
 * Meia-largura da janela usada para o NÍVEL MÍNIMO ao redor de cada vértice
 * decimado (BUG 1 — poke-through, ver `nivelMinimoNaVizinhanca`).
 *
 * `PASSO_HORIZONTE` inteiro (não metade): medido ao vivo — comparando por
 * raycast a altura real do chão (`chunks`) contra a altura da malha decimada
 * na MESMA coluna de mundo, 59 de 169 pontos amostrados num raio de 60
 * unidades do jogador tinham a malha decimada ACIMA do chão real, até 5,73
 * unidades — não é um caso de canto, é a maioria dos pontos perto de
 * qualquer parede/penhasco. Uma janela de meio passo (4 células) não cobria
 * o suficiente; o passo inteiro (8, ida e volta = 17×17 células por vértice)
 * garante que o vale entre dois pontos decimados AINDA seja visto por pelo
 * menos um deles dos dois lados.
 */
export const JANELA_NIVEL_MINIMO = PASSO_HORIZONTE;

/**
 * O nível mínimo real numa vizinhança da célula — não o nível NA célula.
 *
 * BUG 1 (comprovado por raycast ao vivo, `prt_fild08`): o relevo do rAthena
 * é feito de DEGRAUS (parede = +1 nível instantâneo, não uma rampa), então
 * amostrar só o ponto decimado e deixar o GPU interpolar linearmente entre
 * dois pontos produz uma RAMPA onde deveria haver um degrau — e nos metros
 * ANTES do degrau real (ainda baixo), a malha decimada já está subindo rumo
 * ao vizinho alto, ficando ACIMA do chão detalhado ali. `OFFSET_Y` (um
 * deslocamento CONSTANTE) não resolve: a folga medida chegou a 5,73
 * unidades, muito além de qualquer deslocamento que não faria a malha
 * flutuar visivelmente sozinha longe do jogador.
 *
 * A correção: cada vértice decimado usa o PIOR CASO (mínimo) da vizinhança
 * real ao redor dele, não o valor exato daquele ponto. Isso garante que a
 * malha decimada nunca fique ACIMA do relevo real que ela aproxima — o preço
 * é ela ficar um pouco mais BAIXA que o relevo real em alguns pontos (nunca
 * mais alta), o que é invisível: ou está coberta pelo chão detalhado (dentro
 * do raio de `detalhe`), ou está longe demais para a diferença aparecer.
 */
export function nivelMinimoNaVizinhanca(map: GameMap, col: number, row: number, width: number, height: number): number {
  let menor = Infinity;
  for (let r = row - JANELA_NIVEL_MINIMO; r <= row + JANELA_NIVEL_MINIMO; r++) {
    const rr = Math.min(height - 1, Math.max(0, r));
    for (let c = col - JANELA_NIVEL_MINIMO; c <= col + JANELA_NIVEL_MINIMO; c++) {
      const cc = Math.min(width - 1, Math.max(0, c));
      const nivel = visualLevel(map, cellIndex(map, cc, rr));
      if (nivel < menor) menor = nivel;
    }
  }
  return menor;
}

/**
 * Constrói a geometria decimada — pura, testável sem `<Canvas>`.
 *
 * Reusa `THREE.PlaneGeometry` como esqueleto (grade regular pronta, sem
 * reescrever indexação de triângulo) e só REPOSICIONA cada vértice lendo o
 * heightmap/superfície verdadeiros na célula mais próxima. `computeVertexNormals`
 * roda uma vez aqui — construção, não quadro — pela mesma régua que
 * `buildChunkGeometry` já segue para o chão detalhado.
 */
export function buildHorizonGeometry(map: GameMap): HorizonBuild {
  const t0 = performance.now();
  const { width, height } = map.size;
  const passoMundo = PASSO_HORIZONTE * SQUARE_SIZE;
  // franja além da borda real, em PASSOS decimados (arredondado pra cima —
  // é melhor sobrar um pouco de padding que faltar o suficiente pra cunha
  // de vazio voltar a aparecer)
  const padSteps = Math.ceil(PADDING_MUNDO / passoMundo);
  const cols = Math.max(2, Math.floor(width / PASSO_HORIZONTE) + 1 + 2 * padSteps);
  const rows = Math.max(2, Math.floor(height / PASSO_HORIZONTE) + 1 + 2 * padSteps);

  const geometry = new THREE.PlaneGeometry(
    (cols - 1) * passoMundo,
    (rows - 1) * passoMundo,
    cols - 1,
    rows - 1,
  );
  // a `PlaneGeometry` nasce deitada no plano XY; o mundo do jogo é XZ com Y
  // pra cima — a mesma convenção que todo o resto da cena usa
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const cor = new Float32Array(pos.count * 3);
  /**
   * Desloca para o MESMO referencial que `buildChunkGeometry` usa (mundo
   * começa em 0,0, não centrado na origem) — E deixa `padSteps` passos de
   * folga de cada lado. Metade do vão MENOS a franja: o vértice mais à
   * esquerda cai em `-padding`, não em `0`.
   */
  const offX = (cols - 1) * passoMundo / 2 - padSteps * passoMundo;
  const offZ = (rows - 1) * passoMundo / 2 - padSteps * passoMundo;

  for (let i = 0; i < pos.count; i++) {
    const localX = pos.getX(i) + offX;
    const localZ = pos.getZ(i) + offZ;
    /**
     * O MESMO clamp de sempre — só que agora ele faz trabalho duplo. Dentro
     * do mapa real, arredonda pra célula mais próxima (igual sempre foi).
     * Na FRANJA (localX/localZ fora de [0,width)/[0,height)), o clamp prende
     * em 0 ou no último índice — ou seja, a franja REPETE a altura/cor da
     * célula de borda, esticando o relevo que já existe em vez de inventar
     * um novo (BUG 3: sem isto, a franja nem existiria e a borda continuava
     * um degrau reto para o vazio).
     */
    const col = Math.min(width - 1, Math.max(0, Math.round(localX / SQUARE_SIZE)));
    const row = Math.min(height - 1, Math.max(0, Math.round(localZ / SQUARE_SIZE)));
    const idx = cellIndex(map, col, row);
    /**
     * BUG CORRIGIDO (validado ao vivo no Chrome, `prt_fild08`): `localX`/
     * `localZ` só eram usados para ACHAR a célula — nunca escritos de volta
     * no vértice. A malha ficava com o X/Z NATIVO do `PlaneGeometry`
     * (centrado na origem, -400..400 num mapa de 800×800), enquanto o chão
     * detalhado (`buildChunkGeometry`) usa mundo 0..800. Resultado visível:
     * uma cunha de borda reta flutuando sobre o terreno, deslocada 400
     * unidades — exatamente o "pedaço retangular cortado" relatado. A
     * malha em si sempre teve a forma/altura/cor certas (amostradas da
     * célula certa); só a POSIÇÃO de cada vértice nunca ia para o lugar que
     * a amostragem calculou.
     */
    pos.setX(i, localX);
    pos.setZ(i, localZ);
    /**
     * BUG 1 (poke-through): o NÍVEL vem do MÍNIMO da vizinhança
     * (`nivelMinimoNaVizinhanca`), não da célula exata — ver o comentário da
     * função. A COR continua vindo da célula exata logo abaixo: cor errada
     * por decimação é um detalhe invisível a esta distância; altura errada é
     * a malha flutuando sobre o chão de verdade, que é o defeito provado.
     */
    pos.setY(i, squareLevelToY(nivelMinimoNaVizinhanca(map, col, row, width, height)) + OFFSET_Y);
    /**
     * BUG 2 (água distante parecia terra): `cellLayer` responde `dirt` para
     * água/rio DE PROPÓSITO — no chão real aquilo é o LEITO, visto por baixo
     * da lâmina azul que é OUTRA malha (`buildWaterGeometry`). Esta malha não
     * tem lâmina própria, então sem este `if` a célula ficava marrom até o
     * jogador entrar no raio de detalhe. `ehCelulaDeAgua` é o MESMO detector
     * que `squareChunks` usa (`surface === "water"/"river"`, ou colisão
     * "water" sem superfície autorada) — checado ANTES do remapeamento para
     * `dirt`, não depois, senão a distinção já teria se perdido.
     */
    const camada = ehCelulaDeAgua(map, idx) ? COLOR_WATER : (PALETA_POR_CAMADA[cellLayer(map, idx)] ?? PALETA_POR_CAMADA[0]!);
    cor[i * 3] = camada.r;
    cor[i * 3 + 1] = camada.g;
    cor[i * 3 + 2] = camada.b;
  }
  pos.needsUpdate = true;
  geometry.setAttribute("color", new THREE.BufferAttribute(cor, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const triangulos = (cols - 1) * (rows - 1) * 2;
  return { geometry, vertices: pos.count, triangulos, ms: performance.now() - t0 };
}

export function HorizonMesh({ map }: { map: GameMap }) {
  const primeira = useRef(true);

  const build = useMemo(() => {
    const b = buildHorizonGeometry(map);
    registrarEvento("cena", primeira.current ? "horizon:create" : "horizon:rebuild", {
      vertices: b.vertices,
      triangulos: b.triangulos,
      ms: Math.round(b.ms * 10) / 10,
    });
    primeira.current = false;
    return b;
  }, [map]);

  // a geometria É a malha do mapa: troca de mapa descarta a velha, do mesmo
  // jeito que `SquareTerrain` descarta o cache de chunk inteiro num portal
  useEffect(() => () => build.geometry.dispose(), [build]);

  const material = useMemo(() => {
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      fog: true,
      // só o topo é desenhado — visto de baixo (nunca acontece: câmera
      // não vai parar dentro do relevo) não importa, e side único é mais
      // barato
      side: THREE.FrontSide,
    });
    /**
     * BUG 1/2 — o MESMO ruído do chão real (`scene/groundNoise.glsl`), só a
     * parte que modula COR — não a versão triplanar com textura de
     * `SquareTerrain` (essa exige `sampler2DArray` + atributos por camada,
     * o dobro do orçamento que esta malha existe para não pagar). Sem isto o
     * material era `vertexColors` cru — cor CHAPADA por vértice, suave
     * demais contra o chão real (que tem textura + ruído): provado ao vivo
     * trocando o material por `wireframe` e comparando com a versão colorida
     * lado a lado, a "mancha lisa" reportada é exatamente esta ausência de
     * variação, não uma malha no lugar errado (posição já conferida certa).
     * Uma amostra de ruído por vértice (a malha já é grosseira o bastante
     * para não precisar de mais que isso) — nenhuma textura nova, nenhum
     * draw call a mais.
     */
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vHorizMundo;`)
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\nvHorizMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vHorizMundo;\n${GROUND_NOISE_GLSL}`)
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  // mesma frequência/amplitude de mancha larga do chão detalhado
  // (\`groundTextureScale\`/\`groundTextureStrength\` default), sem uniform
  // configurável: esta malha não tem UI de ajuste, é só para não ficar lisa
  float n = groundFbm(vHorizMundo.xz * 0.4 * 0.35);
  diffuseColor.rgb *= 1.0 + (n - 0.5) * 0.35 * 0.8;
}`,
        );
    };
    return mat;
  }, []);
  useEffect(() => () => material.dispose(), [material]);

  // isolamento (Fase C, `?iso=semHorizonte`): checado DEPOIS dos hooks —
  // hook registrado é hook que roda; o corpo é que sai cedo, mesmo padrão
  // já usado em `AimPreview`/`AttackRangeCircle`
  if (isolado("semHorizonte")) return null;

  return <mesh name="horizonte" geometry={build.geometry} material={material} receiveShadow={false} />;
}
