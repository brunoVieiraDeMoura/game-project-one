/**
 * Extrai o RELEVO REAL de cada tile do terreno para um heightfield e grava em
 * `src/hex/tile-heightfields.json`.
 *
 * Por quê: a altura que o jogo devolve para o personagem era uma aproximação
 * (constante por tipo de superfície, e uma curva 1D na rampa). O resultado é o
 * personagem flutuando sobre a faixa escavada da estrada, afundando no meio da
 * rampa e "vazando" nas pontas dela. A geometria já tem a resposta exata — só
 * não estava sendo lida.
 *
 * Como: para cada célula de uma grade N×N sobre o hexágono, lança um raio
 * vertical e pega o maior Y entre os triângulos VIRADOS PARA CIMA. É a mesma
 * altura que o olho vê. Fora do hexágono grava null.
 *
 * As alturas ficam em unidades locais do tile (1 = altura de um nível), então o
 * runtime só multiplica por LEVEL_HEIGHT(), que já embute o hexScale.
 *
 * Uso: node scripts/measure-tiles.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HEX_DIR = resolve(HERE, "../public/assets/hex");
const OUT = resolve(HERE, "../src/hex/tile-heightfields.json");

/** resolução da grade por tile. 24 dá ~0.09 de passo no hexágono nativo —
 * bem abaixo do detalhe das peças, e o arquivo fica pequeno. */
const N = 24;
const SQRT3 = Math.sqrt(3);
const APOTHEM = 1; // meia-largura (x) do tile nativo
const CORNER = 2 / SQRT3; // meia-altura (z) do tile nativo

const COMP = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function load(file) {
  const gltf = JSON.parse(readFileSync(file, "utf8"));
  const base = dirname(file);
  const bufs = gltf.buffers.map((b) => readFileSync(resolve(base, decodeURIComponent(b.uri))));
  const read = (i) => {
    const acc = gltf.accessors[i];
    const bv = gltf.bufferViews[acc.bufferView];
    const buf = bufs[bv.buffer];
    const n = SIZE[acc.type];
    const ta = new COMP[acc.componentType](buf.buffer, buf.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0), acc.count * n);
    const out = [];
    for (let k = 0; k < acc.count; k++) out.push(Array.from(ta.slice(k * n, k * n + n)));
    return out;
  };
  const prim = gltf.meshes[0].primitives[0];
  return { P: read(prim.attributes.POSITION), N: read(prim.attributes.NORMAL), I: read(prim.indices).flat() };
}

/** eixos das 3 famílias de bordas do hexágono pointy-top */
const AXES = [[1, 0], [0.5, SQRT3 / 2], [-0.5, SQRT3 / 2]];

/** norma hexagonal: <= 1 está dentro do hexágono pointy-top nativo */
const hexApothem = (x, z) => Math.max(...AXES.map(([ax, az]) => Math.abs(x * ax + z * az)));

/**
 * Onde a peça começa a chanfrar (bisel de 45° na borda). Fora daí a geometria
 * MERGULHA — mas o render solda essa faixa na altura da superfície de dentro
 * (weldTopFace em HexTerrain), então é a superfície de dentro que vale.
 * Medir o bisel cru fazia a rampa "descer" no fim e abria um degrau na junção
 * entre células vizinhas. O valor é a LARGURA real do bisel (ele é de 45° e
 * fundo ~0.03): puxar mais que isso inventaria altura na ponta baixa da rampa,
 * onde a superfície de verdade continua descendo até encontrar o vizinho.
 */
const CHAMFER = 0.95;

/** puxa o ponto pra dentro do chanfro, perpendicular à borda mais próxima —
 * mesmo movimento que o weld faz na geometria */
function unchamfer(x, z) {
  let bi = 0, bv = 0;
  for (let i = 0; i < 3; i++) {
    const v = x * AXES[i][0] + z * AXES[i][1];
    if (Math.abs(v) > Math.abs(bv)) { bv = v; bi = i; }
  }
  const a = Math.abs(bv);
  if (a <= CHAMFER) return [x, z];
  const d = (a - CHAMFER) * Math.sign(bv);
  return [x - d * AXES[bi][0], z - d * AXES[bi][1]];
}

/** maior altura de superfície em (x,z), ou null se não houver triângulo ali */
function heightAt(P, Nrm, I, x, z) {
  let best = null;
  for (let t = 0; t < I.length; t += 3) {
    const ia = I[t], ib = I[t + 1], ic = I[t + 2];
    // face pra cima: média das normais dos 3 vértices (evita pegar parede/fundo)
    const ny = (Nrm[ia][1] + Nrm[ib][1] + Nrm[ic][1]) / 3;
    if (ny <= 0.2) continue;
    const a = P[ia], b = P[ib], c = P[ic];
    const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(den) < 1e-9) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den;
    const l3 = 1 - l1 - l2;
    const eps = -1e-6;
    if (l1 < eps || l2 < eps || l3 < eps) continue;
    const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
    if (best === null || y > best) best = y;
  }
  return best;
}

/** heightfield N×N do tile, em ordem row-major (linha = z crescente) */
function heightfield(file) {
  const { P, N: Nrm, I } = load(file);
  const grid = [];
  for (let r = 0; r < N; r++) {
    const z = -CORNER + ((r + 0.5) / N) * (2 * CORNER);
    for (let c = 0; c < N; c++) {
      const x = -APOTHEM + ((c + 0.5) / N) * (2 * APOTHEM);
      if (hexApothem(x, z) > 1.001) {
        grid.push(null); // fora do hexágono
        continue;
      }
      const [sx, sz] = unchamfer(x, z);
      const y = heightAt(P, Nrm, I, sx, sz);
      grid.push(y === null ? null : Math.round(y * 1000) / 1000);
    }
  }
  return grid;
}

// mesmas peças que o HexTerrain desenha no chão
const FILES = [
  ["base", ["hex_grass", "hex_grass_bottom", "hex_water", "hex_grass_sloped_high", "hex_grass_sloped_low"]],
  ["roads", ["hex_road_A", "hex_road_B", "hex_road_C", "hex_road_D", "hex_road_E", "hex_road_F", "hex_road_G", "hex_road_H", "hex_road_I", "hex_road_J", "hex_road_K", "hex_road_L", "hex_road_M", "hex_road_A_sloped_high", "hex_road_A_sloped_low"]],
  ["rivers", ["hex_river_A", "hex_river_A_curvy", "hex_river_B", "hex_river_C", "hex_river_D", "hex_river_E", "hex_river_F", "hex_river_G", "hex_river_H", "hex_river_I", "hex_river_J", "hex_river_K", "hex_river_L"]],
  ["coast", ["hex_coast_A", "hex_coast_B", "hex_coast_C", "hex_coast_D", "hex_coast_E"]],
];

const out = { resolution: N, tiles: {} };
let total = 0;
for (const [dir, files] of FILES) {
  for (const f of files) {
    try {
      out.tiles[f] = heightfield(`${HEX_DIR}/${dir}/${f}.gltf`);
      total++;
    } catch (e) {
      console.warn(`pulou ${f}: ${e.message}`);
    }
  }
}
writeFileSync(OUT, JSON.stringify(out), "utf8");
const kb = Math.round(readFileSync(OUT).length / 1024);
console.log(`ok — ${total} tiles, grade ${N}×${N}, ${kb} KB`);
