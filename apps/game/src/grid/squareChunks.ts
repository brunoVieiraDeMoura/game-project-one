import * as THREE from "three";
import type { GameMap, SurfaceType } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import { SQUARE_SIZE, squareLevelToY } from "./squareGrid";
import { cellGroup, cornerLevel, cornerLevelSaia, cornerNormal, isBlockedCell, type CellGroup } from "./heightField";
import { TERRAIN_BASE_HEX, TERRAIN_LAYER, TERRAIN_LAYERS } from "./terrainTextures";

/**
 * O chão do mapa do rAthena, montado em pedaços.
 *
 * Um mapa do servidor tem 160.000 células (prt_fild08 = 400×400). Desenhar uma
 * peça por célula — como o mundo hexagonal faz — significaria 160 mil objetos
 * para um terreno que é, na prática, plano. Aqui o mapa é fatiado em CHUNKS e
 * cada chunk vira UMA malha: 13×13 = 169 pedaços no mapa inteiro, dos quais uma
 * dúzia fica visível por vez.
 *
 * A cor vai no VÉRTICE, derivada da superfície (ou da colisão, quando o mapa
 * não traz superfície autorada — é o caso dos mapas recém-importados). Junto com
 * o ruído em coordenada de mundo (`scene/groundNoise.glsl`), é o que dá a cara
 * KayKit sem precisar de um tile .gltf quadrado, que não existe em pack nenhum
 * do projeto.
 *
 * Não há costura entre chunks: os vértices da borda de dois chunks vizinhos são
 * calculados pela mesma fórmula, a partir dos mesmos dados de célula.
 */

/** lado do chunk em células (32 × 2 unidades = 64 unidades de mundo) */
export const CHUNK_CELLS = 32;

/**
 * Cores por tipo de terreno.
 *
 * As cinco superfícies texturizadas vêm de `terrainTextures.TERRAIN_BASE_HEX`,
 * que é a mesma tabela em cima da qual `scripts/make-terrain-textures.mjs`
 * pinta os PNGs — o shader divide o texel por essa base para usar a textura
 * como PADRÃO, então divergir aqui tingiria o chão inteiro.
 */
const COLOR_GRASS = new THREE.Color(TERRAIN_BASE_HEX.grass);
const COLOR_DIRT = new THREE.Color(TERRAIN_BASE_HEX.dirt);
const COLOR_STONE = new THREE.Color(TERRAIN_BASE_HEX.stone);
const COLOR_SAND = new THREE.Color(TERRAIN_BASE_HEX.sand);
const COLOR_SNOW = new THREE.Color(TERRAIN_BASE_HEX.snow);
const COLOR_WATER = new THREE.Color("#2f6ea8");
const COLOR_CLIFF = new THREE.Color("#6b5a43");
/**
 * Parede: no campo aberto do RO é mata/moita, não muro. Verde mais fechado que
 * o do chão — escuro demais (o primeiro palpite foi #4f6330) e o mapa vira um
 * tabuleiro de caixas pretas, porque 38% de `prt_fild08` é parede.
 */
const COLOR_WALL = new THREE.Color("#61803a");

/**
 * Cor de uma célula.
 *
 * `surface` é a superfície autorada no editor e manda **no chão em que se anda**.
 * Sem ela (mapas vindos do `map_cache.dat`, que só trazem colisão), a cor sai do
 * TIPO DE COLISÃO — é a única informação que o servidor tem sobre aquele pedaço
 * de chão.
 *
 * Em célula BLOQUEADA quem manda é o tipo — MENOS quando a superfície autorada
 * é diferente de "grass". A razão da regra é concreta: `paintCell` materializa
 * `surface` inteira na PRIMEIRA pincelada de um mapa importado (o array vem
 * vazio do `map_cache`), e com a superfície mandando em tudo, mata, penhasco e
 * água perdiam a cor no mesmo instante — o mapa inteiro virava um verde chapado
 * ao encostar o pincel numa célula só. Era o "está bugando todo o mapa".
 *
 * Mas `surfaceFromCollision` só emite "grass" e "water", então uma superfície
 * MATERIALIZADA nunca é `stone`/`dirt`/`sand`/`snow`/`river`: se uma delas está
 * ali, alguém pintou de propósito. Excluir só o "grass" preserva a mata e o
 * penhasco importados e ainda deixa a montanha (parede + `stone`) e o leito de
 * rio (parede + `river`) aparecerem com a cor certa, em vez de verde de mata.
 */
function cellColor(map: GameMap, idx: number): THREE.Color {
  const surface = map.surface[idx];
  if (surface && surface !== "grass") {
    switch (surface) {
      case "dirt": return COLOR_DIRT;
      case "stone": return COLOR_STONE;
      case "sand": return COLOR_SAND;
      case "snow": return COLOR_SNOW;
      default: return COLOR_WATER; // water | river
    }
  }
  const col = map.collision[idx];
  if (col === "wall") return COLOR_WALL;
  if (col === "cliff") return COLOR_CLIFF;
  return col === "water" ? COLOR_WATER : COLOR_GRASS;
}

/**
 * Camada de textura de uma célula (índice dentro do `DataArrayTexture`).
 *
 * Segue a MESMA precedência de `cellColor` — senão o padrão desenhado e a tinta
 * seriam de terrenos diferentes. Sem superfície autorada, o tipo de colisão
 * decide: mata (`wall`) é vegetação, então usa a textura de grama tingida de
 * verde escuro; barranco (`cliff`) e leito de água usam terra.
 */
export function cellLayer(map: GameMap, idx: number): number {
  const surface = map.surface[idx];
  if (surface && surface !== "grass") return TERRAIN_LAYER[surface];
  return map.collision[idx] === "cliff" || map.collision[idx] === "water"
    ? TERRAIN_LAYER.dirt
    : TERRAIN_LAYER.grass;
}

/**
 * Nível DESENHADO de uma célula.
 *
 * O `map_cache.dat` não guarda altura (ela só existe no .gat do cliente, que
 * não está no repo), então o heightmap dos mapas importados vem todo zero. Mas
 * ele guarda o TIPO da célula, e no Ragnarok um `wall` de campo aberto é mata,
 * rocha ou barranco — coisa que se vê de longe. Desenhado no mesmo nível do
 * chão, vira uma mancha escura chapada e o mapa parece um tabuleiro pintado.
 *
 * Então o relevo sai do que o servidor REALMENTE diz: parede sobe um nível,
 * buraco (`cliff`, o tipo 5 "gap" do rAthena) afunda. Nada é inventado no chão
 * andável — lá o nível continua sendo o do heightmap, que é o que o servidor
 * usa para andar.
 */
export function visualLevel(map: GameMap, idx: number): number {
  const base = map.heightmap[idx] ?? 0;
  // Altura AUTORADA manda. O ajuste por tipo abaixo é só o palpite inicial para
  // um mapa recém-importado (heightmap todo zero); assim que alguém pinta a
  // altura daquela célula, é a escolha dela que vale — é assim que o mesmo
  // "gap" do rAthena vira encosta num mapa e ravina noutro.
  if (base !== 0) return base;
  switch (map.collision[idx]) {
    case "wall": return 1;
    case "cliff": return -1;
    // água afunda um pouco: no RO ela é andável (tipo 3), mas afundada lê como
    // lago em vez de mancha azul pintada no chão
    case "water": return -0.35;
    default: return 0;
  }
}

export interface ChunkKey {
  cx: number;
  cz: number;
}

/** quantos chunks o mapa tem em cada eixo */
export function chunkCounts(map: GameMap): { cols: number; rows: number } {
  return {
    cols: Math.ceil(map.size.width / CHUNK_CELLS),
    rows: Math.ceil(map.size.height / CHUNK_CELLS),
  };
}

/**
 * Superfície inicial de um mapa que veio sem ela (`map_cache.dat` só traz
 * colisão), derivada da COLISÃO — nunca "grass" para tudo.
 *
 * Quem materializa é o editor, na primeira edição: `surface` precisa existir como
 * array cheio para receber a pincelada. Preenchendo com grama, a água andável do
 * mapa original (tipo 3 do rAthena) perdia o azul no mesmo instante, sem ninguém
 * ter pintado nada. Célula bloqueada não entra na conta: a cor dela sai sempre do
 * tipo (ver cellColor).
 */
export function surfaceFromCollision(map: GameMap): SurfaceType[] {
  const n = map.collision.length;
  const out = new Array<SurfaceType>(n);
  for (let i = 0; i < n; i++) out[i] = map.collision[i] === "water" ? "water" : "grass";
  return out;
}

/** dados de célula de que a geometria de um chunk depende */
export interface ChunkSource {
  collision: unknown[];
  surface: unknown[];
  heightmap: unknown[];
}

/**
 * Chaves ("cx,cz") dos chunks cujas células mudaram entre dois estados do mapa.
 *
 * O editorStore é imutável: qualquer edição recria `collision`/`surface`/
 * `heightmap` inteiros, então comparar a identidade do array só diz QUE algo
 * mudou, não ONDE. Sem saber onde, a alternativa era descartar as 169
 * geometrias a cada pincelada (198 ms medidos). Aqui a varredura é de
 * referências — 160.000 comparações, ~1 ms — e devolve só os pedaços a refazer.
 *
 * Compara pelo array MAIS CURTO quando um deles está vazio: `surface` é opcional
 * no schema, e mapas recém-importados vêm sem ela.
 */
export function chunksSujos(map: GameMap, antes: ChunkSource, depois: ChunkSource): string[] {
  const { width, height } = map.size;
  const { cols, rows } = chunkCounts(map);
  const sujos = new Set<string>();
  const marca = (i: number) => {
    const col = i % width;
    const row = (i - col) / width;
    sujos.add(`${Math.floor(col / CHUNK_CELLS)},${Math.floor(row / CHUNK_CELLS)}`);
  };
  const varre = (a: unknown[], b: unknown[]) => {
    if (a === b) return;
    // trocou de tamanho (mapa novo): tudo sujo, e nem vale comparar célula a célula
    if (a.length !== b.length) {
      for (let cz = 0; cz < rows; cz++) for (let cx = 0; cx < cols; cx++) sujos.add(`${cx},${cz}`);
      return;
    }
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) marca(i);
  };
  varre(antes.collision, depois.collision);
  varre(antes.surface, depois.surface);
  varre(antes.heightmap, depois.heightmap);
  return [...sujos];
}

/** centro do chunk em coordenadas de mundo (para o teste de distância) */
export function chunkCenter(cx: number, cz: number): { x: number; z: number } {
  const half = (CHUNK_CELLS * SQUARE_SIZE) / 2;
  return { x: cx * CHUNK_CELLS * SQUARE_SIZE + half, z: cz * CHUNK_CELLS * SQUARE_SIZE + half };
}

/**
 * Quanta memória de GPU uma geometria de chunk ocupa, em bytes.
 *
 * Existe para a PRÉ-CARGA do mapa inteiro decidir se cabe: construir os 169
 * chunks de um 400×400 plano custa ~35 MB e some com o soluço de andar, mas o
 * mesmo mapa cheio de relevo emite muito mais vértice (o orçamento admite até
 * 20.000 por chunk) e a conta passa de 170 MB. Sem medir, a pré-carga trocaria
 * um engasgo por falta de memória.
 *
 * Soma os atributos de verdade em vez de assumir "48 bytes por vértice": a
 * lista de atributos do chão já mudou uma vez (as duas camadas de textura e o
 * peso da mistura entraram depois) e uma constante escrita à mão teria ficado
 * para trás sem ninguém notar.
 */
export function bytesDaGeometria(geo: THREE.BufferGeometry): number {
  let total = 0;
  for (const attr of Object.values(geo.attributes)) {
    const a = attr as THREE.BufferAttribute;
    total += a.count * a.itemSize * (a.array as ArrayLike<number> & { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
  }
  const idx = geo.getIndex();
  if (idx) total += idx.count * (idx.array as ArrayLike<number> & { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
  return total;
}

/** quanto a lâmina fica ACIMA da parte mais rasa do corpo d'água, em níveis */
export const LAMINA_ACIMA_DO_RASO = 0.25;

/**
 * Nível da lâmina de CADA CORPO d'água, em nível de mundo.
 *
 * Água parada tem UM nível por corpo — não um valor global. Com uma constante
 * para o mapa inteiro (era `WATER_LEVEL_Y = -0,1`), afundar o terreno de um lago
 * deixava a lâmina BOIANDO no ar sobre o leito rebaixado: é o vão que a
 * referência `afundei.jpg` mede com a barra vermelha.
 *
 * O nível de um corpo sai do ponto mais RASO dele (o maior `visualLevel` entre
 * suas células) mais uma folga. Pelo mais raso, e não pela média: é a margem que
 * define até onde a água sobe, e usando a média um canal fundo puxaria a lâmina
 * para baixo do próprio barranco. Assim, afundar o lago inteiro afunda a lâmina
 * junto, afundar só o meio dele apenas aprofunda — que é o que a água faz.
 *
 * Corpos são achados por flood fill de 4 vizinhos, então lago e rio ligados
 * compartilham um nível só e a emenda entre eles não tem degrau.
 */
function nivelDosCorpos(map: GameMap): Float32Array {
  const { width, height } = map.size;
  const n = width * height;
  const nivel = new Float32Array(n).fill(NaN);
  const pilha: number[] = [];

  /**
   * Rio CORRE, lago está PARADO — e isso muda o nível da lâmina.
   *
   * Água parada tem uma superfície horizontal; água corrente desce junto com o
   * leito. Dar um nível plano ao rio inteiro fazia a lâmina cortar a encosta:
   * na parte alta ela ficava ENTERRADA e na baixa BOIANDO, e o que sobrava era
   * uma lasca de água subindo o morro (referência `agua-bugada.jpg`).
   *
   * A distinção já existe no dado — `surface: "water"` é massa parada e
   * `"river"` é canal corrente (ver skill-map-format) —, então não é preciso
   * inventar nada: o rio segue o leito célula a célula, o lago continua achando
   * um nível único por corpo.
   */
  const ehRio = (i: number) => map.surface[i] === "river";

  for (let inicio = 0; inicio < n; inicio++) {
    if (!Number.isNaN(nivel[inicio]!) || !ehCelulaDeAgua(map, inicio)) continue;

    if (ehRio(inicio)) {
      nivel[inicio] = squareLevelToY(visualLevel(map, inicio) + LAMINA_ACIMA_DO_RASO);
      continue;
    }

    // LAGO: junta o corpo (só células paradas) e acha a parte rasa dele
    const corpo: number[] = [];
    const leitos: number[] = [];
    pilha.push(inicio);
    nivel[inicio] = 0; // marca como visitado; o valor certo entra na 2ª passada
    while (pilha.length > 0) {
      const i = pilha.pop()!;
      corpo.push(i);
      leitos.push(visualLevel(map, i));
      const col = i % width;
      const row = (i - col) / width;
      if (col > 0) empilhar(i - 1);
      if (col < width - 1) empilhar(i + 1);
      if (row > 0) empilhar(i - width);
      if (row < height - 1) empilhar(i + width);
    }
    const y = squareLevelToY(rasoDoCorpo(leitos) + LAMINA_ACIMA_DO_RASO);
    for (const i of corpo) nivel[i] = y;
  }
  return nivel;

  function empilhar(i: number) {
    // o corpo do lago não atravessa para dentro do rio: são regimes diferentes,
    // e juntá-los devolveria o nível plano ao canal
    if (!Number.isNaN(nivel[i]!) || !ehCelulaDeAgua(map, i) || ehRio(i)) return;
    nivel[i] = 0;
    pilha.push(i);
  }
}

/**
 * A parte RASA do corpo d'água — percentil 90 dos leitos, não o máximo.
 *
 * Pelo máximo, UMA célula erguida levantava a lâmina inteira: subir o chão de um
 * pedaço do lago (uma ilha, uma pedra, ou só corrigir o relevo) fazia a água do
 * corpo todo saltar para aquela altura e ficar boiando sobre o resto — é a
 * "textura de água flutuando" da referência `agua-bugada.jpg`.
 *
 * Continua sendo a parte rasa, e não a média: é a margem que define até onde a
 * água sobe, e pela média um trecho fundo puxaria a lâmina para baixo do próprio
 * barranco, secando a beirada. O percentil 90 dá as duas coisas — a beira de um
 * lago normal é a maior parte das células rasas e continua mandando, enquanto um
 * punhado de células erguidas deixa de mandar (e vira ILHA, ver
 * `buildWaterGeometry`).
 */
function rasoDoCorpo(leitos: number[]): number {
  if (leitos.length === 0) return 0;
  if (leitos.length < 10) return Math.max(...leitos); // corpo minúsculo: o máximo é a beira
  const ordenado = [...leitos].sort((a, b) => a - b);
  return ordenado[Math.floor(ordenado.length * 0.9)]!;
}

/**
 * Cache do nível por corpo, chaveado pelos três arrays que o definem.
 *
 * O flood fill varre o mapa inteiro (160.000 células), e a geometria é montada
 * por chunk — sem cache, cada um dos 169 chunks refaria a varredura. O
 * editorStore é imutável, então a identidade dos arrays serve de chave e uma
 * pincelada invalida sozinha.
 */
const cacheNivel = new WeakMap<GameMap["collision"], { s: GameMap["surface"]; h: GameMap["heightmap"]; n: Float32Array }>();
function nivelDaAgua(map: GameMap): Float32Array {
  const guardado = cacheNivel.get(map.collision);
  if (guardado && guardado.s === map.surface && guardado.h === map.heightmap) return guardado.n;
  const n = nivelDosCorpos(map);
  cacheNivel.set(map.collision, { s: map.surface, h: map.heightmap, n });
  return n;
}

/**
 * Lâmina d'água do chunk: um quad por célula de água, todos no MESMO nível.
 *
 * Água é uma superfície separada do chão de propósito. Pintada como cor no
 * terreno, ela virava uma mancha azul chapada acompanhando o relevo; como
 * lâmina única sobre o leito afundado (ver `visualLevel`), ela lê como lago —
 * e pode ser translúcida sem afetar o resto do terreno.
 *
 * Devolve `null` quando o chunk não tem água, para não criar malha vazia.
 */
export function ehCelulaDeAgua(map: GameMap, idx: number): boolean {
  const surf = map.surface[idx];
  return surf === "water" || surf === "river" || (!surf && map.collision[idx] === "water");
}

export function buildWaterGeometry(map: GameMap, cx: number, cz: number): THREE.BufferGeometry | null {
  const { width, height } = map.size;
  const col0 = cx * CHUNK_CELLS;
  const row0 = cz * CHUNK_CELLS;
  const cols = Math.min(CHUNK_CELLS, width - col0);
  const rows = Math.min(CHUNK_CELLS, height - row0);

  const nivel = nivelDaAgua(map);

  /**
   * Célula que de fato tem LÂMINA — água cujo leito está ABAIXO da superfície
   * do corpo.
   *
   * Erguer o chão de um pedaço do lago (com o pincel de relevo) não apaga a
   * `surface: "water"` daquela célula, e o quad continuava sendo desenhado no
   * nível do corpo: sobrava uma tira de água BOIANDO sobre a areia, sem leito
   * embaixo — a marcação 2 da referência `agua-bugada.jpg`. Uma célula erguida
   * acima da lâmina não é água, é ILHA, e ilha não desenha água.
   *
   * O mesmo predicado vale para o contorno e para a profundidade: se a célula
   * não tem lâmina, ela também não pode contar como água na hora de decidir
   * onde a margem passa — senão a espuma contornaria terra seca.
   */
  const temLamina = (col: number, row: number): boolean => {
    if (col < 0 || col >= width || row < 0 || row >= height) return false;
    const i = cellIndex(map, col, row);
    if (!ehCelulaDeAgua(map, i)) return false;
    const y = nivel[i]!;
    if (Number.isNaN(y)) return false;
    return squareLevelToY(visualLevel(map, i)) < y - 1e-4;
  };
  const aguaEm = temLamina;

  /**
   * Profundidade e proximidade da margem, medidas nos CANTOS.
   *
   * A lâmina é plana, então a única coisa que diferencia poça de canal é o
   * quanto o leito afunda embaixo dela (`visualLevel`) — e isso muda de célula
   * para célula. Amostrado por canto e interpolado no quad, o degradê de fundo
   * e a faixa de espuma ficam contínuos; por célula sairiam em blocos, que é
   * exatamente o aspecto de "mancha azul chapada" que a lâmina existe para
   * evitar.
   *
   * `margem` é a fração das quatro células do canto que são água: 1 no meio da
   * massa, 0,25 numa quina de praia.
   */
  /**
   * "Quanto isto é água" num canto — BORRADO num raio de 2 células.
   *
   * A fração crua das 4 células do canto só assume cinco valores (0; 0,25; 0,5;
   * 0,75; 1), e o contorno de nível 0,5 de um campo tão grosso é um zigue-zague
   * de 45°: melhor que a escada de 90° do quad, mas ainda facetado no tamanho da
   * célula — foi o que sobrou na referência `olha.jpg`.
   *
   * Com um kernel de raio 2 e peso caindo com a distância, o campo passa a ser
   * contínuo e a isolinha vira CURVA. É o mesmo princípio de um signed distance
   * field: quem decide a forma da margem deixa de ser a célula e passa a ser a
   * vizinhança.
   */
  const RAIO_BORRAO = 2;
  const pesos: number[] = [];
  for (let dr = -RAIO_BORRAO; dr <= RAIO_BORRAO - 1; dr++) {
    for (let dc = -RAIO_BORRAO; dc <= RAIO_BORRAO - 1; dc++) {
      // distância do CENTRO da célula ao canto (as células ficam meio a meio)
      pesos.push(1 / (1 + (dc + 0.5) * (dc + 0.5) + (dr + 0.5) * (dr + 0.5)));
    }
  }
  const somaPesos = pesos.reduce((a, b) => a + b, 0);

  const dadosCanto = (col: number, row: number, laminaY: number): [number, number] => {
    /**
     * Profundidade — borrada no MESMO raio que a margem, e por um motivo que
     * só apareceu com o rio LARGO (`riverWidth`/`larguraEstrada`-like slider,
     * `next-change.txt`): o miolo fundo e o ombro raso de um canal largo se
     * tocam numa fronteira que é um CÍRCULO por distância num grid quadrado —
     * uma escada, igual qualquer fronteira diagonal. A média crua de 4
     * células fazia essa escada aparecer como listras escuras alternando com
     * claras na COR da água (o "serrilhado residual" de `agua-bugada.jpg`
     * depois da correção do relevo — sem montanha, sem saia, só a lâmina
     * mudando de tom em ziguezague). Com raio 1 (rio de 1 célula) o resultado
     * não muda: só há uma célula de água no kernel, então a média é ela
     * mesma, borrada ou não.
     *
     * O receio antigo era plausível ("arrastar a cor de fundo pra margem
     * rasa"), mas media só as 4 células do CANTO, sem peso — um raio maior
     * com peso decrescente (o mesmo `pesos[]` da margem) suaviza a transição
     * em vez de apagá-la: a margem rasa ainda lê como rasa, só não pula de
     * canto a canto.
     */
    let somaProf = 0;
    let pesoProf = 0;
    let acc = 0;
    let k = 0;
    for (let dr = -RAIO_BORRAO; dr <= RAIO_BORRAO - 1; dr++) {
      for (let dc = -RAIO_BORRAO; dc <= RAIO_BORRAO - 1; dc++) {
        const c2 = col + dc;
        const r2 = row + dr;
        if (aguaEm(c2, r2)) {
          acc += pesos[k]!;
          const p = laminaY - squareLevelToY(visualLevel(map, cellIndex(map, c2, r2)));
          somaProf += p * pesos[k]!;
          pesoProf += pesos[k]!;
        }
        k++;
      }
    }
    return [pesoProf === 0 ? 0 : somaProf / pesoProf, acc / somaPesos];
  };

  /**
   * Altura da lâmina NO CANTO: média das células de água que se encontram nele.
   *
   * O quad inteiro num nível só é o certo para lago, mas num rio em declive cada
   * quad viraria um degrau — a água desceria a encosta em escada. Pelo canto, a
   * superfície fica contínua, e na junção rio/lago a média dos dois lados costura
   * os regimes sem emenda.
   */
  const laminaNoCanto = (col: number, row: number, padrao: number): number => {
    let soma = 0;
    let n = 0;
    for (let dr = -1; dr <= 0; dr++) {
      for (let dc = -1; dc <= 0; dc++) {
        const c2 = col + dc;
        const r2 = row + dr;
        if (c2 < 0 || c2 >= width || r2 < 0 || r2 >= height) continue;
        if (!temLamina(c2, r2)) continue;
        const i = cellIndex(map, c2, r2);
        soma += nivel[i]!;
        n++;
      }
    }
    return n === 0 ? padrao : soma / n;
  };

  const positions: number[] = [];
  const indices: number[] = [];
  const prof: number[] = [];
  const margem: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = col0 + c;
      const row = row0 + r;
      const idx = cellIndex(map, col, row);
      if (!temLamina(col, row)) continue;

      const x0 = col * SQUARE_SIZE;
      const z0 = row * SQUARE_SIZE;
      const x1 = x0 + SQUARE_SIZE;
      const z1 = z0 + SQUARE_SIZE;
      const base = positions.length / 3;
      const cantos: Array<[number, number]> = [
        [col, row],
        [col + 1, row],
        [col + 1, row + 1],
        [col, row + 1],
      ];
      const xz: Array<[number, number]> = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ];
      for (let k = 0; k < 4; k++) {
        const [cc, rr] = cantos[k]!;
        const laminaY = laminaNoCanto(cc, rr, nivel[idx]!);
        positions.push(xz[k]![0], laminaY, xz[k]![1]);
        const [p, m] = dadosCanto(cc, rr, laminaY);
        prof.push(p);
        margem.push(m);
      }
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  if (positions.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("aProfundidade", new THREE.Float32BufferAttribute(prof, 1));
  geo.setAttribute("aMargem", new THREE.Float32BufferAttribute(margem, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Malha de um chunk: um quad por célula, com a cor da célula nos quatro cantos.
 *
 * Quad por célula (em vez de uma grade de vértices compartilhados) é o que
 * mantém a borda entre dois terrenos NÍTIDA — é assim que o Ragnarok se parece,
 * e é assim que o KayKit se parece. Vértices compartilhados iriam interpolar
 * grama com água num degradê que não existe no original.
 *
 * A ALTURA, porém, vem dos CANTOS (`grid/heightField`): cada vértice fica na
 * média das células que se encontram nele, e a normal sai do gradiente do campo.
 * Assim a cor continua trocando de uma célula para a outra sem degradê, mas a
 * superfície é contínua — encosta lê como encosta, não como escada. Antes cada
 * célula era um quad plano na sua própria altura, e todo relevo saía em degraus
 * de 90°.
 *
 * O degrau seco sobrevive onde ele é a verdade do mapa: na fronteira entre chão
 * e BLOQUEIO. Parede e buraco não se misturam com o chão andável na média, então
 * ali continua havendo saia vertical — se virasse rampa, o jogador veria ladeira
 * onde o servidor não deixa passar.
 */
export function buildChunkGeometry(map: GameMap, cx: number, cz: number): THREE.BufferGeometry {
  const { width, height } = map.size;
  const col0 = cx * CHUNK_CELLS;
  const row0 = cz * CHUNK_CELLS;
  const cols = Math.min(CHUNK_CELLS, width - col0);
  const rows = Math.min(CHUNK_CELLS, height - row0);

  // topo de cada célula + até 4 laterais (uma por vizinho mais baixo)
  const maxQuads = cols * rows * 5;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  // camada de textura A/B e o peso da B (ver `camadaVizinha`/`pesoCanto`)
  const layerA: number[] = [];
  const layerB: number[] = [];
  const blend: number[] = [];

  const nivelEm = (col: number, row: number): number | null => {
    if (col < 0 || col >= width || row < 0 || row >= height) return null;
    return visualLevel(map, cellIndex(map, col, row));
  };

  /**
   * Grade de cantos do chunk, calculada UMA VEZ.
   *
   * Cada célula usa quatro cantos e cada canto é compartilhado por até quatro
   * células, então calcular sob demanda repetia a mesma média quatro vezes — e a
   * normal, que lê mais quatro cantos, dezesseis vezes. Medido no `prt_fild08`:
   * 433 ms para montar os 177 chunks visíveis contra 170 ms antes do relevo
   * suave. Com a grade pronta, o custo volta ao patamar anterior.
   *
   * São TRÊS grades porque chão, bloqueio e água RASA não se misturam (ver
   * heightField: `CellGroup`) — o mesmo canto tem uma altura "de chão", uma
   * "de bloqueio" e uma "de água" (senão erguer um morro do lado de um lago
   * puxa a lâmina/leito da água para cima do próprio barranco).
   */
  const lado = CHUNK_CELLS + 2; // +2: uma folga de canto em cada ponta
  const GRUPOS: CellGroup[] = ["land", "water", "blocked"];
  const yCanto = GRUPOS.map(() => new Float32Array(lado * lado));
  const nCanto = GRUPOS.map(() => new Float32Array(lado * lado * 3));
  for (let g = 0; g < GRUPOS.length; g++) {
    const grupo = GRUPOS[g]!;
    for (let r = 0; r < lado; r++) {
      for (let c = 0; c < lado; c++) {
        const col = col0 + c;
        const row = row0 + r;
        const k = r * lado + c;
        yCanto[g]![k] = squareLevelToY(cornerLevel(map, col, row, grupo));
      }
    }
    // normal pelo gradiente da grade já calculada (diferença central)
    for (let r = 0; r < lado; r++) {
      for (let c = 0; c < lado; c++) {
        const k = r * lado + c;
        const hL = yCanto[g]![r * lado + Math.max(0, c - 1)]!;
        const hR = yCanto[g]![r * lado + Math.min(lado - 1, c + 1)]!;
        const hD = yCanto[g]![Math.max(0, r - 1) * lado + c]!;
        const hU = yCanto[g]![Math.min(lado - 1, r + 1) * lado + c]!;
        const dx = (hR - hL) / (2 * SQUARE_SIZE);
        const dz = (hU - hD) / (2 * SQUARE_SIZE);
        const len = Math.hypot(dx, 1, dz);
        nCanto[g]![k * 3] = -dx / len;
        nCanto[g]![k * 3 + 1] = 1 / len;
        nCanto[g]![k * 3 + 2] = -dz / len;
      }
    }
  }
  /** altura do canto (col,row) já convertida para mundo */
  const alturaCanto = (col: number, row: number, grupo: CellGroup): number => {
    const c = col - col0;
    const r = row - row0;
    if (c < 0 || r < 0 || c >= lado || r >= lado) return squareLevelToY(cornerLevel(map, col, row, grupo));
    return yCanto[GRUPOS.indexOf(grupo)]![r * lado + c]!;
  };
  const normalCanto = (col: number, row: number, grupo: CellGroup): [number, number, number] => {
    const c = col - col0;
    const r = row - row0;
    if (c < 0 || r < 0 || c >= lado || r >= lado) return cornerNormal(map, col, row, grupo);
    const g = GRUPOS.indexOf(grupo);
    const k = (r * lado + c) * 3;
    return [nCanto[g]![k]!, nCanto[g]![k + 1]!, nCanto[g]![k + 2]!];
  };

  /**
   * Grade de CAMADAS de textura, com um anel de folga em volta do chunk.
   *
   * `lCell[r * lado + c]` = camada da célula `(col0 + c − 1, row0 + r − 1)`;
   * `-1` = fora do mapa. A folga existe porque cada célula precisa olhar os 8
   * vizinhos (para saber com quem se mistura) e cada canto lê as 4 células que
   * o tocam — sem o anel, a borda do chunk se misturaria com nada e apareceria
   * uma linha de transição em cada emenda de chunk.
   */
  /**
   * Grade de COR por canto — o que dissolve a fronteira entre duas superfícies.
   *
   * Antes a cor era constante nos quatro vértices do quad, então grama do lado
   * de terra dava um degrau seco na linha da célula: a textura já se misturava
   * (ver `pesoCanto`), mas a tinta pulava, e é a tinta que se enxerga. Aqui cada
   * canto recebe a MÉDIA das células que se encontram nele — exatamente o que
   * `cornerLevel` faz com a altura.
   *
   * O centro da célula continua com a cor pura: a média só existe nos cantos, e
   * o rasterizador interpola entre eles. Ou seja, a mistura acontece SÓ na
   * interseção — o mapa continua sendo quadriculado, a emenda é que deixa de ser
   * um degrau.
   *
   * A média junta as quatro células do canto SEM olhar grupo de passagem — ao
   * contrário da altura. A altura tem de separar (senão vira rampa para dentro
   * de uma parede, e o jogador vê ladeira onde o servidor não deixa subir), mas
   * a COR não: separando, o pé da montanha e a beira da mata voltavam a ser um
   * degrau de tinta em escada de 90°, que é o que a referência `square-form`
   * aponta. Quem sinaliza "aqui não se anda" continua sendo o DESNÍVEL e a saia
   * de terra exposta — sinal geométrico, mais forte que o de cor.
   */
  const cCanto = new Float32Array(lado * lado * 3);
  {
    const cor = new THREE.Color();
    for (let r = 0; r < lado; r++) {
      for (let c = 0; c < lado; c++) {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        // as até 4 células que tocam o canto (col0 + c, row0 + r)
        for (let dr = -1; dr <= 0; dr++) {
          for (let dc = -1; dc <= 0; dc++) {
            const col = col0 + c + dc;
            const row = row0 + r + dr;
            if (col < 0 || col >= width || row < 0 || row >= height) continue;
            cor.copy(cellColor(map, cellIndex(map, col, row)));
            sr += cor.r;
            sg += cor.g;
            sb += cor.b;
            n++;
          }
        }
        const k = (r * lado + c) * 3;
        // canto fora do mapa inteiro: marca para o quad usar a cor da própria
        // célula, senão pintaria de preto
        if (n === 0) {
          cCanto[k] = -1;
          continue;
        }
        cCanto[k] = sr / n;
        cCanto[k + 1] = sg / n;
        cCanto[k + 2] = sb / n;
      }
    }
  }
  /** cor do canto; cai na cor da própria célula quando o canto está fora do mapa */
  const corCanto = (col: number, row: number, propria: THREE.Color): [number, number, number] => {
    const c = col - col0;
    const r = row - row0;
    if (c < 0 || r < 0 || c >= lado || r >= lado) return [propria.r, propria.g, propria.b];
    const k = ((r * lado + c) * 3) | 0;
    if (cCanto[k]! < 0) return [propria.r, propria.g, propria.b];
    return [cCanto[k]!, cCanto[k + 1]!, cCanto[k + 2]!];
  };

  const lCell = new Int8Array(lado * lado).fill(-1);
  for (let r = 0; r < lado; r++) {
    for (let c = 0; c < lado; c++) {
      const col = col0 + c - 1;
      const row = row0 + r - 1;
      if (col < 0 || col >= width || row < 0 || row >= height) continue;
      lCell[r * lado + c] = cellLayer(map, cellIndex(map, col, row));
    }
  }

  /**
   * Com que camada esta célula se mistura: a mais comum entre os 8 vizinhos que
   * for diferente da dela.
   *
   * Precisa ser UMA só por célula, constante nos quatro vértices do quad: o
   * índice da camada viaja como atributo e é INTERPOLADO no rasterizador — se
   * dois cantos do mesmo quad pedissem camadas diferentes, o meio do quad
   * receberia um índice fracionário, que não é camada nenhuma. Quem varia entre
   * os cantos é só o PESO.
   */
  const cont = new Int32Array(TERRAIN_LAYERS.length);
  const camadaVizinha = (c: number, r: number, propria: number): number => {
    cont.fill(0);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const v = lCell[(r + 1 + dr) * lado + (c + 1 + dc)]!;
        if (v >= 0 && v !== propria) cont[v]!++;
      }
    }
    let melhor = propria;
    let qtd = 0;
    for (let i = 0; i < cont.length; i++) {
      if (cont[i]! > qtd) {
        qtd = cont[i]!;
        melhor = i;
      }
    }
    return melhor;
  };

  /**
   * Peso da camada `alvo` num canto: a fração das células que se encontram ali
   * e são dessa camada.
   *
   * É o que dá a transição CONTÍNUA entre duas células vizinhas sem compartilhar
   * vértice. Num canto onde duas células são grama e duas são terra, o quad da
   * grama pede 0,5 de terra e o quad da terra pede 0,5 de grama — os dois
   * desenham a mesma mistura naquele ponto, e a costura some. No miolo de uma
   * região uniforme o peso é 0 e a textura sai pura.
   */
  const pesoCanto = (c: number, r: number, dc: number, dr: number, alvo: number, propria: number): number => {
    if (alvo === propria) return 0;
    let n = 0;
    let k = 0;
    for (let a = -1; a <= 0; a++) {
      for (let b = -1; b <= 0; b++) {
        const v = lCell[(r + dr + a + 1) * lado + (c + dc + b + 1)]!;
        if (v < 0) continue;
        n++;
        if (v === alvo) k++;
      }
    }
    return n === 0 ? 0 : k / n;
  };

  /** um quad qualquer, com os quatro cantos em sentido anti-horário visto de fora */
  const quad = (
    pts: number[][],
    nx: number,
    ny: number,
    nz: number,
    color: THREE.Color,
    la: number,
    lb: number,
  ) => {
    const base = positions.length / 3;
    for (const p of pts) {
      positions.push(p[0]!, p[1]!, p[2]!);
      normals.push(nx, ny, nz);
      colors.push(color.r, color.g, color.b);
      layerA.push(la);
      layerB.push(lb);
      // saia é a face exposta da própria célula: textura pura, sem mistura
      blend.push(0);
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };

  /** quad do TOPO: cada canto com sua altura e sua normal (superfície contínua) */
  const quadTopo = (
    pts: number[][],
    ns: Array<[number, number, number]>,
    cores: Array<[number, number, number]>,
    la: number,
    lb: number,
    pesos: number[],
  ) => {
    const base = positions.length / 3;
    for (let k = 0; k < 4; k++) {
      const p = pts[k]!;
      const n = ns[k]!;
      const c = cores[k]!;
      positions.push(p[0]!, p[1]!, p[2]!);
      normals.push(n[0], n[1], n[2]);
      colors.push(c[0], c[1], c[2]);
      layerA.push(la);
      layerB.push(lb);
      blend.push(pesos[k]!);
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = col0 + c;
      const row = row0 + r;
      const idx = cellIndex(map, col, row);
      const level = visualLevel(map, idx);
      const y = squareLevelToY(level);
      const x0 = col * SQUARE_SIZE;
      const z0 = row * SQUARE_SIZE;
      const x1 = x0 + SQUARE_SIZE;
      const z1 = z0 + SQUARE_SIZE;
      const color = cellColor(map, idx);
      const bloqueada = isBlockedCell(map, idx);
      // grupo de canto (3 vias: chão/água/bloqueio) — usado nas consultas de
      // altura/normal do PRÓPRIO quad. `bloqueada` continua existindo à parte:
      // a saia (mais abaixo) é uma decisão de PASSAGEM (chão↔bloqueio), não de
      // chão↔água — água rasa é andável, então nunca ganha saia.
      const grupo = cellGroup(map, idx);
      const la = lCell[(r + 1) * lado + (c + 1)]!;
      const lb = camadaVizinha(c, r, la);

      // Topo: altura e normal de CANTO. Os cantos são compartilhados com as
      // células vizinhas do MESMO grupo, então a superfície não tem costura e a
      // inclinação existe de verdade — e água nunca puxa nem é puxada pelo chão
      // vizinho, então erguer um morro do lado do lago não faz a água "subir".
      const yc = (c2: number, r2: number) => alturaCanto(c2, r2, grupo);
      const nc = (c2: number, r2: number) => normalCanto(c2, r2, grupo);
      const y00 = yc(col, row);
      const y10 = yc(col + 1, row);
      const y11 = yc(col + 1, row + 1);
      const y01 = yc(col, row + 1);
      quadTopo(
        [
          [x0, y00, z0],
          [x1, y10, z0],
          [x1, y11, z1],
          [x0, y01, z1],
        ],
        [nc(col, row), nc(col + 1, row), nc(col + 1, row + 1), nc(col, row + 1)],
        [
          corCanto(col, row, color),
          corCanto(col + 1, row, color),
          corCanto(col + 1, row + 1, color),
          corCanto(col, row + 1, color),
        ],
        la,
        lb,
        [
          pesoCanto(c, r, 0, 0, lb, la),
          pesoCanto(c, r, 1, 0, lb, la),
          pesoCanto(c, r, 1, 1, lb, la),
          pesoCanto(c, r, 0, 1, lb, la),
        ],
      );

      /**
       * Saia: SÓ na fronteira entre grupos (chão ↔ bloqueio) e só descendo.
       *
       * Dentro do mesmo grupo os cantos já são compartilhados, a superfície é
       * contínua e não há vão para tapar — emitir saia ali era justamente o que
       * produzia a escada. A condição de "vizinho mais baixo" continua para duas
       * células não desenharem a mesma parede duas vezes.
       */
      const lados: Array<{ c: number; r: number; pts: number[][]; nx: number; nz: number }> = [
        { c: col, r: row - 1, pts: [[x0, 0, z0], [x1, 0, z0]], nx: 0, nz: -1 },
        { c: col + 1, r: row, pts: [[x1, 0, z0], [x1, 0, z1]], nx: 1, nz: 0 },
        { c: col, r: row + 1, pts: [[x1, 0, z1], [x0, 0, z1]], nx: 0, nz: 1 },
        { c: col - 1, r: row, pts: [[x0, 0, z1], [x0, 0, z0]], nx: -1, nz: 0 },
      ];
      // Fora do cache do chunk (`alturaCanto` lê `yCanto`, construído com
      // `cornerLevel` puro) DE PROPÓSITO: a saia perto de água precisa da
      // variante borrada (`cornerLevelSaia`), e recalcular na hora é barato
      // aqui — skirt só roda nas células de fronteira, uma fração pequena do
      // chunk (ao contrário do topo, que é TODO vértice de TODA célula).
      const alturaDoCanto = (px: number, pz: number) => {
        const cc = Math.round(px / SQUARE_SIZE);
        const rr = Math.round(pz / SQUARE_SIZE);
        return { meu: squareLevelToY(cornerLevelSaia(map, cc, rr, grupo)), cc, rr };
      };
      for (const lado of lados) {
        const nivelViz = nivelEm(lado.c, lado.r);
        if (nivelViz == null) continue; // borda do mapa: nada a fechar
        const idxViz = cellIndex(map, lado.c, lado.r);
        // mesmo grupo de PASSAGEM (chão↔bloqueio) = superfície contínua, sem
        // degrau para tapar. Continua em 2 vias de propósito: água rasa é
        // andável, então uma borda chão↔água nunca ganha saia — só vira saia
        // na fronteira com bloqueio de verdade.
        if (isBlockedCell(map, idxViz) === bloqueada) continue;
        if (nivelViz >= level) continue;
        const [a, b] = lado.pts as [number[], number[]];
        const topoA = alturaDoCanto(a[0]!, a[2]!);
        const topoB = alturaDoCanto(b[0]!, b[2]!);
        // a BASE da saia é o canto no grupo do VIZINHO de verdade (chão OU
        // água, o que ele for) — não um genérico "o oposto de bloqueio", que
        // deixou de fazer sentido com três grupos.
        const grupoViz = cellGroup(map, idxViz);
        const baseA = alturaCanto(topoA.cc, topoA.rr, grupoViz);
        const baseB = alturaCanto(topoB.cc, topoB.rr, grupoViz);
        /**
         * Só há saia se houver VÃO de verdade.
         *
         * A condição de cima olha o nível da CÉLULA; esta olha o canto, que é o
         * que a malha realmente desenha. Onde os dois grupos concordam na altura
         * — o caso de um relevo autorado que atravessa a fronteira de passagem —
         * o vão é zero, e emitir a saia assim mesmo plantava uma face vertical
         * dentro de uma superfície contínua: a prateleira de `craquelado-square`.
         */
        if (baseA >= topoA.meu - 1e-4 && baseB >= topoB.meu - 1e-4) continue;
        /**
         * A face vertical é TERRA EXPOSTA, não o topo escurecido.
         *
         * É o que se vê em qualquer barranco de verdade e nas referências
         * (`Desktop/ref/ref2.png`, marcações "2"): o platô é de grama, mas onde
         * ele foi cortado aparece o solo por baixo. Escurecendo a cor do topo,
         * um desnível de campo virava uma parede de grama escura — a leitura de
         * "aqui a terra foi cortada" some, e com ela a profundidade do relevo.
         *
         * Rocha e areia continuam se expondo como elas mesmas: cortar pedra
         * mostra pedra. Quem tem solo por baixo é o que é vegetação ou neve.
         */
        const exposto = la === TERRAIN_LAYER.grass || la === TERRAIN_LAYER.snow;
        const lateral = (exposto ? COLOR_DIRT : color).clone().multiplyScalar(0.82);
        const laLateral = exposto ? TERRAIN_LAYER.dirt : la;
        // ORDEM INVERTIDA em relação ao topo (b antes de a): o `quad` fecha os
        // triângulos sempre igual, e com a ordem do topo a normal geométrica da
        // saia apontava para DENTRO do bloco — o bloco aparecia vazado.
        quad(
          [
            [b[0]!, topoB.meu, b[2]!],
            [a[0]!, topoA.meu, a[2]!],
            [a[0]!, baseA, a[2]!],
            [b[0]!, baseB, b[2]!],
          ],
          lado.nx,
          0,
          lado.nz,
          lateral,
          laLateral,
          laLateral,
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("aLayerA", new THREE.Float32BufferAttribute(layerA, 1));
  geo.setAttribute("aLayerB", new THREE.Float32BufferAttribute(layerB, 1));
  geo.setAttribute("aBlend", new THREE.Float32BufferAttribute(blend, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  if (import.meta.env.DEV && positions.length / 3 > maxQuads * 4) {
    console.warn("[squareChunks] mais vértices que o previsto", positions.length / 3, maxQuads * 4);
  }
  return geo;
}
