import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
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
 * qualquer parede/penhasco. Uma janela de meio passo não cobria o
 * suficiente; o passo inteiro (ida e volta) garante que o vale entre dois
 * pontos decimados AINDA seja visto por pelo menos um deles dos dois lados.
 *
 * A medição original foi feita com `PASSO_HORIZONTE = 8` (janela ±8 = 17×17
 * células por vértice); depois da otimização de renderização (prioridade 8,
 * ver o comentário de `PASSO_HORIZONTE` acima) o passo caiu pra 4, e a
 * janela — que é DEFINIDA em cima dele, não um número fixo — encolheu junto,
 * pra ±4 = 9×9. A regra ("passo inteiro, não metade") continua a mesma; só
 * o valor concreto do passo mudou.
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
 * Geometria da grade decimada (passo, franja, contagem de colunas/linhas) —
 * fatorado para fora de `buildHorizonGeometry` porque `alturaDoHorizonte`
 * (mais abaixo) precisa da MESMA grade para saber quais 4 vértices cercam um
 * ponto arbitrário do mundo. Uma função só, não duas fórmulas que podem
 * divergir silenciosamente se `PASSO_HORIZONTE`/`PADDING_MUNDO` mudar.
 */
interface GradeHorizonte {
  passoMundo: number;
  padSteps: number;
  cols: number;
  rows: number;
}

function gradeHorizonte(map: GameMap): GradeHorizonte {
  const { width, height } = map.size;
  const passoMundo = PASSO_HORIZONTE * SQUARE_SIZE;
  // franja além da borda real, em PASSOS decimados (arredondado pra cima —
  // é melhor sobrar um pouco de padding que faltar o suficiente pra cunha
  // de vazio voltar a aparecer)
  const padSteps = Math.ceil(PADDING_MUNDO / passoMundo);
  const cols = Math.max(2, Math.floor(width / PASSO_HORIZONTE) + 1 + 2 * padSteps);
  const rows = Math.max(2, Math.floor(height / PASSO_HORIZONTE) + 1 + 2 * padSteps);
  return { passoMundo, padSteps, cols, rows };
}

/**
 * Altura (Y) que o vértice decimado (j,k) da grade recebe — MESMA fórmula que
 * o laço de `buildHorizonGeometry` usa por dentro (nível mínimo da vizinhança
 * + `OFFSET_Y`), fatorada para ser chamada tanto na construção da geometria
 * quanto em `alturaDoHorizonte` (consulta pontual, sem construir malha).
 */
function alturaNaGrade(map: GameMap, grade: GradeHorizonte, j: number, k: number): number {
  const { width, height } = map.size;
  const localX = (j - grade.padSteps) * grade.passoMundo;
  const localZ = (k - grade.padSteps) * grade.passoMundo;
  const col = Math.min(width - 1, Math.max(0, Math.round(localX / SQUARE_SIZE)));
  const row = Math.min(height - 1, Math.max(0, Math.round(localZ / SQUARE_SIZE)));
  return squareLevelToY(nivelMinimoNaVizinhanca(map, col, row, width, height)) + OFFSET_Y;
}

/**
 * A altura (Y) da SUPERFÍCIE QUE DE FATO É DESENHADA em `(x,z)` fora do raio
 * de detalhe — o que `HorizonMesh` mostra ali, não o Y autorado do heightmap.
 *
 * Existe para consertar o "impostor voando" (causa raiz documentada em
 * `render-tecnic.txt`, seção 25): `TreeImpostors` ancorava a árvore/arbusto
 * distante no Y AUTORADO do prop, que é a altura do CHÃO DETALHADO — mas além
 * do raio de detalhe quem está desenhado ali é esta malha decimada, cujo Y é
 * sistematicamente mais BAIXO (o mínimo da vizinhança, de propósito — ver
 * `nivelMinimoNaVizinhanca`). Numa borda de platô/penhasco/morro estreito essa
 * diferença passa de uma unidade inteira, e a árvore fica boiando sobre o
 * vazio ou sobre a névoa.
 *
 * **Bilinear, não vizinho mais próximo**: interpola os 4 vértices decimados
 * que cercam `(x,z)` — é EXATAMENTE a mesma interpolação que a GPU já faz
 * entre os vértices do triângulo ao rasterizar `HorizonMesh` (mesmo esquema
 * `PlaneGeometry` com 2 triângulos por quad). Usar o vizinho mais próximo em
 * vez disso reintroduziria um degrau que a malha real não tem.
 *
 * **Mesma fonte, não uma segunda conta**: usa `gradeHorizonte`/`alturaNaGrade`,
 * os DOIS helpers que `buildHorizonGeometry` também usa — se `PASSO_HORIZONTE`,
 * `PADDING_MUNDO` ou `OFFSET_Y` mudarem, as duas funções mudam juntas. O
 * round-trip (`HorizonMesh.test.ts`) confere que este valor bate com o
 * atributo `position` da geometria construída, nos próprios vértices.
 */
export function alturaDoHorizonte(map: GameMap, x: number, z: number): number {
  const grade = gradeHorizonte(map);
  const jf = x / grade.passoMundo + grade.padSteps;
  const kf = z / grade.passoMundo + grade.padSteps;
  const j0 = Math.min(grade.cols - 2, Math.max(0, Math.floor(jf)));
  const k0 = Math.min(grade.rows - 2, Math.max(0, Math.floor(kf)));
  const tx = Math.min(1, Math.max(0, jf - j0));
  const tz = Math.min(1, Math.max(0, kf - k0));
  const h00 = alturaNaGrade(map, grade, j0, k0);
  const h10 = alturaNaGrade(map, grade, j0 + 1, k0);
  const h01 = alturaNaGrade(map, grade, j0, k0 + 1);
  const h11 = alturaNaGrade(map, grade, j0 + 1, k0 + 1);
  return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
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
  const { passoMundo, padSteps, cols, rows } = gradeHorizonte(map);

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

/**
 * FOG DA BORDA — reforço LOCALIZADO da fog exatamente onde a fog normal (por
 * distância de câmera) não dá conta: quando o PERSONAGEM está perto do
 * limite físico do mapa, mas o pedaço "logo depois da borda" (a franja de
 * `PADDING_MUNDO`) ainda está PERTO DEMAIS da câmera para a fog normal
 * (`scene/skyFog.ts`, `smoothstep(fogNear, fogFar, distânciaDoFragmento)`)
 * ter começado a desbotar — `fogNear` é uma fração de `renderDistance`
 * (`play/viewRadius.ts`), tipicamente 90+ unidades, bem mais longe que a
 * franja fica de um jogador parado a poucas células do limite.
 *
 * Dois efeitos DIFERENTES, que coexistem sem um substituir o outro:
 *  • fog NORMAL: `smoothstep(fogNear, fogFar, distância câmera→FRAGMENTO)` —
 *    inalterada, roda depois desta, no chunk `fog_fragment` (`scene/skyFog.ts`).
 *  • fog da BORDA (aqui): função da distância PERSONAGEM→LIMITE DO MAPA, não
 *    da câmera nem do fragmento — só se aplica a fragmentos FORA do
 *    retângulo do mapa (`vHorizMundo` fora de `[0,uMapSize]`), escrita em
 *    `color_fragment`, ANTES da fog normal — a normal ainda roda por cima
 *    depois, então o resultado final nunca fica MENOS enevoado que qualquer
 *    um dos dois sozinho, só mais (ou igual).
 *
 * **Por que PERSONAGEM, não câmera (correção — a v1 usava `camera.position`
 * e só funcionava nas bordas laterais/de trás)**: a `FollowCamera` fica
 * ATRÁS do personagem, na direção oposta ao azimute de movimento (até
 * `distance × maxZoom` = 91 unidades por padrão) — andando NA DIREÇÃO de uma
 * borda, a câmera fica do lado de DENTRO do mapa, longe daquela borda
 * específica, então a distância câmera→limite nunca ficava pequena bem na
 * hora em que o jogador estava de fato entrando nela; numa borda ao LADO ou
 * atrás dele, a câmera calhava de estar mais perto por acaso — daí "só
 * funciona nas laterais". O personagem (`playerPos`, o mesmo ref que
 * `FollowCamera`/`SunRig` já usam) não tem esse deslocamento: a distância
 * até qualquer um dos 4 lados reflete de verdade o quanto falta pra sair do
 * mapa, seja pra onde for que ele esteja andando.
 *
 * `intensidadeFogDaBorda` é pura e testável sem GPU — o valor calculado em
 * JS (não uma fórmula reescrita em GLSL) é o que vai pro uniform, então o
 * shader só faz um `mix`, sem repetir a conta.
 */

/**
 * Distância (unidades de mundo) até a margem em que a fog da borda passa a
 * contribuir. Além disso, a fog normal governa sozinha (contribuição = 0).
 *
 * 4,5 unidades = 2,25 células (`SQUARE_SIZE = 2`): a 1 célula (2 unidades) já
 * dá `1 - 2/4,5 ≈ 0,56` — acima da "opacidade média" (0,5) pedida, com folga
 * pra não cair abaixo por arredondamento. A 2,25 células a contribuição some
 * e a fog normal, que já cobre distâncias maiores corretamente, assume.
 */
export const LIMIAR_BORDA_FOG = 4.5;

/**
 * 0 (sem contribuição extra) a 1 (fog da borda no máximo) — pura, mesmo
 * padrão de `nivelMinimoNaVizinhanca` nesta arquivo: sem `<Canvas>`, sem GPU.
 */
export function intensidadeFogDaBorda(distanciaPersonagemAteLimite: number): number {
  return Math.min(1, Math.max(0, 1 - distanciaPersonagemAteLimite / LIMIAR_BORDA_FOG));
}

/** distância (unidades de mundo) do ponto (x,z) até a margem MAIS PRÓXIMA do
 * retângulo `[0,largura] × [0,altura]` — 0 se já está EM CIMA ou além da
 * margem em algum eixo (ponto fora do mapa conta como "na borda", não some a
 * distância negativa). Testa os 4 lados por igual: `margemX` cobre
 * Oeste/Leste, `margemZ` cobre Norte/Sul, e o `min` dos dois pega qual dos
 * quatro está mais perto — não assume nenhuma direção preferencial. */
export function distanciaAteLimiteDoMapa(x: number, z: number, largura: number, altura: number): number {
  const margemX = Math.min(x, largura - x);
  const margemZ = Math.min(z, altura - z);
  return Math.max(0, Math.min(margemX, margemZ));
}

type MaterialComFogDaBorda = THREE.Material & { uIntensidadeBordaFog?: { value: number } };

export function HorizonMesh({
  map,
  playerPos,
}: {
  map: GameMap;
  /**
   * Posição do PERSONAGEM (não da câmera) — quem decide a intensidade da fog
   * da borda.
   *
   * BUG corrigido: a primeira versão usava `state.camera.position`. A
   * `FollowCamera` posiciona a câmera ATRÁS do personagem, na direção OPOSTA
   * ao azimute (`play/FollowCamera.tsx`: `t.x + r·sin(az)`, `r` até
   * `distance × maxZoom` = 13×7 = 91 unidades por padrão) — andando NA
   * DIREÇÃO de uma borda, a câmera fica ATRÁS, ou seja, do lado de DENTRO do
   * mapa, longe daquela borda; numa borda ao LADO ou atrás do personagem
   * (fora da linha de visão), a câmera calha de ficar mais perto dela por
   * acaso. Resultado medido: a fog da borda pegava bem os lados/trás e
   * falhava bem na borda que o jogador estava efetivamente enfrentando —
   * exatamente o "só funciona nas laterais" relatado. Opcional só porque
   * `HorizonMesh` não tem outro consumidor hoje (só `PlayView`); sem o ref, a
   * fog da borda fica desligada (intensidade sempre 0) em vez de adivinhar.
   */
  playerPos?: React.MutableRefObject<THREE.Vector3>;
}) {
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
      shader.uniforms.uIntensidadeBordaFog = { value: 0 };
      shader.uniforms.uMapSize = { value: new THREE.Vector2(map.size.width * SQUARE_SIZE, map.size.height * SQUARE_SIZE) };
      // guarda o shader para o `useFrame` atualizar a intensidade a cada
      // quadro (mesmo padrão de `uTempo` da água em `SquareTerrain.tsx`)
      (mat as MaterialComFogDaBorda).uIntensidadeBordaFog = shader.uniforms.uIntensidadeBordaFog;

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vHorizMundo;`)
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\nvHorizMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\nvarying vec3 vHorizMundo;\nuniform float uIntensidadeBordaFog;\nuniform vec2 uMapSize;\n${GROUND_NOISE_GLSL}`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  // mesma frequência/amplitude de mancha larga do chão detalhado
  // (\`groundTextureScale\`/\`groundTextureStrength\` default), sem uniform
  // configurável: esta malha não tem UI de ajuste, é só para não ficar lisa
  float n = groundFbm(vHorizMundo.xz * 0.4 * 0.35);
  diffuseColor.rgb *= 1.0 + (n - 0.5) * 0.35 * 0.8;
}
#ifdef USE_FOG
{
  // FOG DA BORDA (ver doc acima do componente): só nos fragmentos FORA do
  // retângulo físico do mapa, e só quando o PERSONAGEM está perto o bastante
  // do limite pra fog normal (por distância até o FRAGMENTO, não até a borda)
  // ainda não ter desbotado essa franja. \`corDoCeu\` e \`vDirCeu\` já existem
  // aqui — são os mesmos que \`scene/skyFog.ts\` injeta em fog_pars_fragment,
  // que compila ANTES de color_fragment no template do three.
  bool foraDoMapa = vHorizMundo.x < 0.0 || vHorizMundo.x > uMapSize.x || vHorizMundo.z < 0.0 || vHorizMundo.z > uMapSize.y;
  if (foraDoMapa && uIntensidadeBordaFog > 0.0) {
    diffuseColor.rgb = mix(diffuseColor.rgb, corDoCeu(normalize(vDirCeu).y), uIntensidadeBordaFog);
  }
}
#endif`,
        );
    };
    return mat;
  }, []);

  /**
   * Atualiza a intensidade da fog da borda a cada quadro — um `float` só,
   * mesmo custo de `uTempo` da água (`SquareTerrain.tsx`); não é a mesma
   * classe de trabalho que o comentário do arquivo diz que esta malha evita
   * (rebuild de geometria por movimento do jogador). Hook REGISTRADO sempre
   * (mesmo padrão de sempre neste projeto) — o corpo sai cedo se isolado.
   */
  useFrame(() => {
    if (isolado("semHorizonte")) return;
    const u = (material as MaterialComFogDaBorda).uIntensidadeBordaFog;
    if (!u) return; // fog desligada (sem `scene.fog`) — onBeforeCompile nunca correu esse ramo
    if (!playerPos) return; // sem ref de personagem, sem intensidade — nunca adivinha pela câmera
    const largura = map.size.width * SQUARE_SIZE;
    const altura = map.size.height * SQUARE_SIZE;
    const p = playerPos.current;
    const dist = distanciaAteLimiteDoMapa(p.x, p.z, largura, altura);
    u.value = intensidadeFogDaBorda(dist);
  });
  useEffect(() => () => material.dispose(), [material]);

  // isolamento (Fase C, `?iso=semHorizonte`): checado DEPOIS dos hooks —
  // hook registrado é hook que roda; o corpo é que sai cedo, mesmo padrão
  // já usado em `AimPreview`/`AttackRangeCircle`
  if (isolado("semHorizonte")) return null;

  return <mesh name="horizonte" geometry={build.geometry} material={material} receiveShadow={false} />;
}
