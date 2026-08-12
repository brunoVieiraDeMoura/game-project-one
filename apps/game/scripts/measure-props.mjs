/**
 * Mede o BLOCO DE COLISÃO de cada asset dos catálogos e grava no JSON:
 *   • `hull`   — polígono convexo (XZ, unidades locais) da BASE do modelo
 *   • `radius` — raio do círculo que envolve esse polígono (broad-phase)
 *   • `spread` — raio VISUAL do modelo inteiro (copa/telhado), usado só pelo
 *                gerador procedural pra não empilhar assets
 *
 * Por que offline: a colisão do jogo (hexTerrainQuery) precisa da forma real do
 * modelo, mas o TerrainQuery é criado antes de qualquer glTF carregar. Medir
 * aqui e persistir no catálogo mantém o runtime síncrono e barato.
 *
 * Por que a BASE e não o modelo inteiro: o personagem é baixo perto dos assets
 * (KayKit hex sai em escala ~5). O que ele encosta é o tronco da árvore, não a
 * copa; a planta do castelo, não o telhado. Então o hull sai da fatia de altura
 * que vai do chão até ~a altura do personagem (BODY_WORLD_HEIGHT convertida pra
 * unidades locais pela escala default do asset).
 *
 * Por que hull CONVEXO: teste ponto-em-polígono O(n) e sem buracos. Em planta
 * côncava (castelo em L) ele bloqueia um naco a mais do vazio — preferível a
 * deixar atravessar a parede, que era a reclamação.
 *
 * Uso: node scripts/measure-props.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src/props");
const PUBLIC = resolve(HERE, "../public/assets");

const CATALOGS = [
  { json: `${SRC}/hex-decor-catalog.json`, base: PUBLIC },
  { json: `${SRC}/hex-tiles-catalog.json`, base: PUBLIC },
  { json: `${SRC}/forest-catalog.json`, base: `${PUBLIC}/props` },
  { json: `${SRC}/nature-catalog.json`, base: `${PUBLIC}/nature` },
];

const COMP = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** multiplica 4x4 column-major (convenção glTF) */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** TRS do nó → matriz (ou a `matrix` explícita, se houver) */
function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** altura (mundo) do corpo que colide — o personagem tem ~0.6 com charScale
 * default; 0.8 dá folga sem alcançar copa de árvore (que fica bem acima). */
const BODY_WORLD_HEIGHT = 0.8;
/** fatia mínima do modelo a considerar, se a conta acima der fino demais */
const MIN_SLICE_FRACTION = 0.12;
/** o hull é simplificado até no máximo isto (poligono leve pro runtime) */
const MAX_HULL_POINTS = 10;

/** convex hull 2D (monotone chain), sentido anti-horário */
function convexHull(pts) {
  if (pts.length < 3) return pts;
  const s = [...pts].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (arr) => {
    const out = [];
    for (const p of arr) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(s), ...half([...s].reverse())];
}

/** joga fora os vértices que menos mudam a área até caber em MAX_HULL_POINTS */
function simplifyHull(h) {
  const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  const out = [...h];
  while (out.length > MAX_HULL_POINTS) {
    let worst = 0, worstA = Infinity;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const s = area(a, b, c);
      if (s < worstA) { worstA = s; worst = i; }
    }
    out.splice(worst, 1);
  }
  return out;
}

function bbox(file) {
  const gltf = JSON.parse(readFileSync(file, "utf8"));
  const base = dirname(file);
  const buffers = (gltf.buffers ?? []).map((b) =>
    b.uri.startsWith("data:")
      ? Buffer.from(b.uri.slice(b.uri.indexOf(",") + 1), "base64")
      : readFileSync(resolve(base, decodeURIComponent(b.uri))),
  );
  const positions = (accIdx) => {
    const acc = gltf.accessors[accIdx];
    const bv = gltf.bufferViews[acc.bufferView];
    const buf = buffers[bv.buffer];
    const T = COMP[acc.componentType];
    const n = SIZE[acc.type];
    const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    return new T(buf.buffer, buf.byteOffset + off, acc.count * n);
  };
  // 1º passo: todos os vértices em coordenadas locais do asset
  const verts = [];
  const walk = (idx, parent) => {
    const node = gltf.nodes[idx];
    const m = mul(parent, nodeMatrix(node));
    if (node.mesh != null) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        if (prim.attributes.POSITION == null) continue;
        const p = positions(prim.attributes.POSITION);
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i], y = p[i + 1], z = p[i + 2];
          verts.push([
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
          ]);
        }
      }
    }
    for (const c of node.children ?? []) walk(c, m);
  };
  const scene = gltf.scenes[gltf.scene ?? 0];
  for (const n of scene.nodes) walk(n, IDENT);
  if (verts.length === 0) return null;
  return verts;
}

/** raio VISUAL do modelo inteiro (copa/telhado incluídos), em unidades locais.
 * Não é colisão: é o espaço que o objeto ocupa na cena, usado pelo gerador
 * procedural pra não empilhar um asset em cima do outro. Menor lado do bbox
 * horizontal / 2 — o maior lado deixaria o mapa vazio demais. */
function visualSpread(verts) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of verts) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[2] < minZ) minZ = v[2];
    if (v[2] > maxZ) maxZ = v[2];
  }
  return round(Math.min(maxX - minX, maxZ - minZ) / 2);
}

/**
 * TABULEIRO de uma ponte: altura e vão da superfície em que se anda.
 *
 * A ponte é o único prop em que o chão NÃO é o terreno embaixo — é o próprio
 * modelo. Sem isto, atravessar o rio exigia adivinhar a altura (o nível da
 * margem) e cobria só a célula do centro do prop, então a travessia continuava
 * bloqueada nas células do meio do rio.
 *
 * `y` é o topo da face virada pra cima mais alta, e `hx`/`hz` são as meias-
 * medidas do vão dessa face — tudo em unidades LOCAIS (multiplicar pela escala
 * do prop). Só a face de cima entra: o guarda-corpo é mais alto e mais estreito.
 */
function bridgeDeck(verts) {
  let maxY = -Infinity;
  for (const v of verts) if (v[1] > maxY) maxY = v[1];
  // a faixa do topo: tudo a menos de 6% da altura do ponto mais alto do piso.
  // Pega o piso e ignora o corrimão, que fica bem acima.
  let minY = Infinity;
  for (const v of verts) if (v[1] < minY) minY = v[1];
  const banda = (maxY - minY) * 0.06;
  // piso = maior superfície horizontal contínua; procura o Y mais alto que
  // ainda tem largura de travessia (pelo menos metade do vão total em X)
  let spanX = 0;
  for (const v of verts) spanX = Math.max(spanX, Math.abs(v[0]));
  let deckY = null, hx = 0, hz = 0;
  for (let corte = maxY; corte > minY; corte -= banda || 0.01) {
    const faixa = verts.filter((v) => Math.abs(v[1] - corte) <= banda);
    if (faixa.length < 3) continue;
    let lx = 0, lz = 0;
    for (const v of faixa) { lx = Math.max(lx, Math.abs(v[0])); lz = Math.max(lz, Math.abs(v[2])); }
    if (lx >= spanX * 0.5) { deckY = corte; hx = lx; hz = lz; break; }
  }
  if (deckY == null) return null;
  return { y: round(deckY), hx: round(hx), hz: round(hz) };
}

/** hull da BASE + raio envolvente, em unidades locais do asset */
function collisionShape(verts, defaultScale) {
  let minY = Infinity, maxY = -Infinity;
  for (const v of verts) {
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
  }
  const height = maxY - minY || 1;
  const slice = Math.max(BODY_WORLD_HEIGHT / (defaultScale || 1), height * MIN_SLICE_FRACTION);
  const cut = minY + Math.min(slice, height);
  const base = verts.filter((v) => v[1] <= cut).map((v) => [v[0], v[2]]);
  // modelo flutuante/degenerado: cai no corpo inteiro em vez de devolver nada
  const pts = base.length >= 3 ? base : verts.map((v) => [v[0], v[2]]);
  const hull = simplifyHull(convexHull(pts)).map(([x, z]) => [round(x), round(z)]);
  let radius = 0;
  for (const [x, z] of hull) radius = Math.max(radius, Math.hypot(x, z));
  return { hull, radius: round(radius) };
}

const round = (v) => Math.round(v * 1000) / 1000;

let total = 0;
for (const { json, base } of CATALOGS) {
  const entries = JSON.parse(readFileSync(json, "utf8"));
  for (const e of entries) {
    const verts = bbox(resolve(base, e.file));
    if (!verts) {
      console.warn(`sem geometria: ${e.id}`);
      continue;
    }
    const shape = collisionShape(verts, e.defaultScale ?? 1);
    e.radius = shape.radius;
    e.hull = shape.hull;
    e.spread = visualSpread(verts);
    // só ponte tem tabuleiro: é o único prop em que se anda POR CIMA
    if (e.cat === "bridge") {
      const deck = bridgeDeck(verts);
      if (deck) e.deck = deck; else console.warn(`ponte sem tabuleiro medido: ${e.id}`);
    }
    total++;
  }
  writeFileSync(json, JSON.stringify(entries), "utf8");
  console.log(`${json.split(/[\\/]/).pop()}: ${entries.length} entradas`);
}
console.log(`ok — ${total} assets medidos`);
