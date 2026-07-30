import * as THREE from "three";
import type { GameMap, SurfaceType } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import { SQUARE_SIZE, squareLevelToY } from "./squareGrid";
import { cornerLevel, cornerNormal, isBlockedCell } from "./heightField";

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

/** cores por tipo de terreno, na paleta chapada do KayKit */
const COLOR_GRASS = new THREE.Color("#7d9b3f");
const COLOR_DIRT = new THREE.Color("#8a6b45");
const COLOR_STONE = new THREE.Color("#7c7f86");
const COLOR_SAND = new THREE.Color("#c9b380");
const COLOR_SNOW = new THREE.Color("#e8ecef");
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
 * Célula BLOQUEADA é a exceção e sempre se pinta pelo tipo. A razão é concreta:
 * `paintCell` materializa `surface` inteira com "grass" na PRIMEIRA pincelada de
 * um mapa importado (o array vem vazio do `map_cache`), e com a superfície
 * mandando em tudo, mata, penhasco e água perdiam a cor no mesmo instante — o
 * mapa inteiro virava um verde chapado ao encostar o pincel numa célula só. Era
 * o "está bugando todo o mapa".
 */
function cellColor(map: GameMap, idx: number): THREE.Color {
  const col = map.collision[idx];
  if (col === "wall") return COLOR_WALL;
  if (col === "cliff") return COLOR_CLIFF;
  const surface = map.surface[idx];
  if (surface) {
    switch (surface) {
      case "dirt": return COLOR_DIRT;
      case "stone": return COLOR_STONE;
      case "sand": return COLOR_SAND;
      case "snow": return COLOR_SNOW;
      case "water":
      case "river": return COLOR_WATER;
      default: return COLOR_GRASS;
    }
  }
  return col === "water" ? COLOR_WATER : COLOR_GRASS;
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

/** onde a lâmina d'água fica, em nível de mundo (o leito afunda abaixo disso) */
export const WATER_LEVEL_Y = squareLevelToY(-0.1);

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
export function buildWaterGeometry(map: GameMap, cx: number, cz: number): THREE.BufferGeometry | null {
  const { width, height } = map.size;
  const col0 = cx * CHUNK_CELLS;
  const row0 = cz * CHUNK_CELLS;
  const cols = Math.min(CHUNK_CELLS, width - col0);
  const rows = Math.min(CHUNK_CELLS, height - row0);

  const positions: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = col0 + c;
      const row = row0 + r;
      const idx = cellIndex(map, col, row);
      const surf = map.surface[idx];
      const ehAgua = surf === "water" || surf === "river" || (!surf && map.collision[idx] === "water");
      if (!ehAgua) continue;

      const x0 = col * SQUARE_SIZE;
      const z0 = row * SQUARE_SIZE;
      const x1 = x0 + SQUARE_SIZE;
      const z1 = z0 + SQUARE_SIZE;
      const base = positions.length / 3;
      positions.push(x0, WATER_LEVEL_Y, z0, x1, WATER_LEVEL_Y, z0, x1, WATER_LEVEL_Y, z1, x0, WATER_LEVEL_Y, z1);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  if (positions.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
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
   * São duas grades porque chão e bloqueio não se misturam (ver heightField): o
   * mesmo canto tem uma altura "de chão" e uma "de bloqueio".
   */
  const lado = CHUNK_CELLS + 2; // +2: uma folga de canto em cada ponta
  const yCanto = [new Float32Array(lado * lado), new Float32Array(lado * lado)];
  const nCanto = [new Float32Array(lado * lado * 3), new Float32Array(lado * lado * 3)];
  for (let g = 0; g < 2; g++) {
    const bloq = g === 1;
    for (let r = 0; r < lado; r++) {
      for (let c = 0; c < lado; c++) {
        const col = col0 + c;
        const row = row0 + r;
        const k = r * lado + c;
        yCanto[g]![k] = squareLevelToY(cornerLevel(map, col, row, bloq));
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
  const alturaCanto = (col: number, row: number, bloq: boolean): number => {
    const c = col - col0;
    const r = row - row0;
    if (c < 0 || r < 0 || c >= lado || r >= lado) return squareLevelToY(cornerLevel(map, col, row, bloq));
    return yCanto[bloq ? 1 : 0]![r * lado + c]!;
  };
  const normalCanto = (col: number, row: number, bloq: boolean): [number, number, number] => {
    const c = col - col0;
    const r = row - row0;
    if (c < 0 || r < 0 || c >= lado || r >= lado) return cornerNormal(map, col, row, bloq);
    const g = bloq ? 1 : 0;
    const k = (r * lado + c) * 3;
    return [nCanto[g]![k]!, nCanto[g]![k + 1]!, nCanto[g]![k + 2]!];
  };

  /** um quad qualquer, com os quatro cantos em sentido anti-horário visto de fora */
  const quad = (pts: number[][], nx: number, ny: number, nz: number, color: THREE.Color) => {
    const base = positions.length / 3;
    for (const p of pts) {
      positions.push(p[0]!, p[1]!, p[2]!);
      normals.push(nx, ny, nz);
      colors.push(color.r, color.g, color.b);
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };

  /** quad do TOPO: cada canto com sua altura e sua normal (superfície contínua) */
  const quadTopo = (pts: number[][], ns: Array<[number, number, number]>, color: THREE.Color) => {
    const base = positions.length / 3;
    for (let k = 0; k < 4; k++) {
      const p = pts[k]!;
      const n = ns[k]!;
      positions.push(p[0]!, p[1]!, p[2]!);
      normals.push(n[0], n[1], n[2]);
      colors.push(color.r, color.g, color.b);
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

      // Topo: altura e normal de CANTO. Os cantos são compartilhados com as
      // células vizinhas do mesmo grupo, então a superfície não tem costura e a
      // inclinação existe de verdade.
      const yc = (c2: number, r2: number) => alturaCanto(c2, r2, bloqueada);
      const nc = (c2: number, r2: number) => normalCanto(c2, r2, bloqueada);
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
        color,
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
      const alturaDoCanto = (px: number, pz: number) => {
        const cc = Math.round(px / SQUARE_SIZE);
        const rr = Math.round(pz / SQUARE_SIZE);
        return { meu: alturaCanto(cc, rr, bloqueada), cc, rr };
      };
      for (const lado of lados) {
        const nivelViz = nivelEm(lado.c, lado.r);
        if (nivelViz == null) continue; // borda do mapa: nada a fechar
        const idxViz = cellIndex(map, lado.c, lado.r);
        // mesmo grupo = superfície contínua, sem degrau para tapar
        if (isBlockedCell(map, idxViz) === bloqueada) continue;
        if (nivelViz >= level) continue;
        const [a, b] = lado.pts as [number[], number[]];
        const topoA = alturaDoCanto(a[0]!, a[2]!);
        const topoB = alturaDoCanto(b[0]!, b[2]!);
        const baseA = alturaCanto(topoA.cc, topoA.rr, !bloqueada);
        const baseB = alturaCanto(topoB.cc, topoB.rr, !bloqueada);
        // a saia é um pouco mais escura que o topo — o degradê autoral do KayKit
        const lateral = color.clone().multiplyScalar(0.72);
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
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  if (import.meta.env.DEV && positions.length / 3 > maxQuads * 4) {
    console.warn("[squareChunks] mais vértices que o previsto", positions.length / 3, maxQuads * 4);
  }
  return geo;
}
