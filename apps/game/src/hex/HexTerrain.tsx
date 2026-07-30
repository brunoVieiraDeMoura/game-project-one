import { useLayoutEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import { hexToWorld, worldToHex, levelToY, getHexScale, HEX_W, HEX_V } from "./hexGrid";
import { pickTileFor, rampMap } from "./tilePick";
import {
  ALL_TILE_URLS,
  BASE_TILES,
  TILE_ROT_STEP,
  urlForFile,
} from "./hexTiles";
import { groundKey, makeGroundMaterial, type GroundSettings } from "./groundMaterial";

/**
 * Renderiza o mapa hexagonal INTEIRO com os tiles do KayKit Hexagon — chão,
 * estrada, rio, costa e rampa saem todos da MESMA família de peças, todas de
 * tamanho nativo (escala 1), então encaixam exatamente umas nas outras.
 *
 * A peça de cada célula é DERIVADA do mapa, não guardada: olha a superfície da
 * célula e a dos 6 vizinhos, monta o conjunto de bordas conectadas e pergunta a
 * `hexTiles` qual peça+rotação casa (reta/curva/T/cruz/ponta). Isso mantém rio e
 * estrada sempre contínuos e coerentes — inclusive depois de editar à mão — sem
 * nenhum dado extra pra persistir.
 *
 * Um InstancedMesh por peça usada (só as visíveis na janela de culling), então
 * o custo é ~1 draw call por tipo de peça, não por célula.
 */

interface Placement { x: number; y: number; z: number; rot: number }

/** cai aqui quando o chamador não passa config (testes, usos antigos) */
const DEFAULT_GROUND: GroundSettings = {
  groundMode: "atlas",
  groundColor: "#bfc537",
  groundTextureScale: 2.5,
  groundTextureStrength: 0.35,
};

/**
 * SOLDA A BORDA DOS TILES — tira o contorno hexagonal e deixa o chão contínuo.
 *
 * O vinco não é gap entre tiles: é um CHANFRO de 45° na borda de cima da peça
 * (a superfície só vai até ~95% do hexágono e desce ~0.05 até a borda real).
 * Como o chanfro tem normal inclinada, pega luz diferente da superfície e vira
 * aquele traço escuro em volta de cada hexágono.
 *
 * Como colapsa: cada vértice do ANEL EXTERNO (apótema ≈ 1.0, virado pra cima)
 * é levantado até o Y — e recebe a normal — do vértice do ANEL INTERNO mais
 * próximo em XZ. O chanfro vira uma faixa horizontal na altura da superfície e
 * some no sombreamento; a superfície passa a chegar na borda real do hexágono.
 *
 * Por que pelo par interno e não "achatar tudo no topo" (como era antes): nos
 * tiles `*_sloped_*` a borda NÃO está toda na mesma altura — a superfície é uma
 * rampa, e cada ponto da borda tem seu próprio Y. Empurrar tudo pro topY colava
 * só a tampa alta e deixava a costura em toda a volta da parte inclinada (foi
 * exatamente o que apareceu nas estradas "sloped high"). Copiando do vizinho
 * interno, plano e rampa funcionam com o mesmo código, e a normal continua a da
 * superfície (inclinada na rampa) em vez de um (0,1,0) forçado.
 *
 * O anel é identificado pela norma HEXAGONAL (apótema), não pela euclidiana —
 * em apótema a separação é limpa: anel externo 1.000, interno ~0.95, detalhes
 * internos da peça bem abaixo disso.
 */
const APO_SIN60 = Math.sqrt(3) / 2;
const hexApothem = (x: number, z: number) =>
  Math.max(Math.abs(x), Math.abs(x * 0.5 + z * APO_SIN60), Math.abs(-x * 0.5 + z * APO_SIN60));

/** normais das 3 direções de apótema do hexágono pointy-top (as 6 arestas são
 * ±essas). `hexApothem` é o maior |p·n| entre elas. */
const EDGE_NORMALS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.5, APO_SIN60],
  [-0.5, APO_SIN60],
];
/** deslocamento que leva (x,z), de apótema `apo`, até a BORDA (apótema 1),
 * perpendicular à aresta mais próxima. Perto do canto (duas arestas empatadas)
 * não há perpendicular única — ali o certo é crescer radialmente. */
function edgePush(x: number, z: number, apo: number): { x: number; z: number } {
  let bestI = 0, best = -Infinity, second = -Infinity;
  for (let i = 0; i < 3; i++) {
    const v = Math.abs(x * EDGE_NORMALS[i]![0] + z * EDGE_NORMALS[i]![1]);
    if (v > best) { second = best; best = v; bestI = i; }
    else if (v > second) second = v;
  }
  if (best - second < 0.02) {
    const k = 1 / apo - 1; // escala radial: apótema apo → 1
    return { x: x * k, z: z * k };
  }
  const n = EDGE_NORMALS[bestI]!; // unitária: empurrar (1-apo) põe a projeção em 1
  const sign = x * n[0] + z * n[1] < 0 ? -1 : 1;
  return { x: n[0] * sign * (1 - apo), z: n[1] * sign * (1 - apo) };
}

const RING_OUTER = 0.99; // apótema mínimo do anel externo (borda real = 1.0)
const RING_INNER = 0.92; // apótema mínimo do anel interno (medido: 0.950–0.965)
const MAX_PAIR_DIST = 0.15; // largura do chanfro em XZ (medido: ≤0.086)

/** exportado só pra teste (HexTerrain.test.ts) — uso normal é interno */
export function weldTopFace(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const p0 = src.getAttribute("position"), n0 = src.getAttribute("normal");
  if (!p0 || !n0) return src;
  const outer: number[] = [], inner: number[] = [], wallTop: number[] = [];
  for (let i = 0; i < p0.count; i++) {
    const a = hexApothem(p0.getX(i), p0.getZ(i));
    if (n0.getY(i) <= 0.05) {
      // parede lateral: guarda os da borda pro passo 3 (o topo dela precisa
      // acompanhar a superfície, senão sobra um vão)
      if (a >= RING_OUTER) wallTop.push(i);
      continue;
    }
    if (a >= RING_OUTER) outer.push(i);
    else if (a >= RING_INNER) inner.push(i);
  }
  // sem chanfro (hex_water, hex_grass_bottom: a borda já É a superfície)
  if (outer.length === 0 || inner.length === 0) return src;

  const g = src.clone();
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const n = g.getAttribute("normal") as THREE.BufferAttribute;

  // 1) cada vértice do anel EXTERNO assume a altura e a normal da superfície
  //    naquele ponto — o vizinho interno mais próximo. Na rampa cada ponto da
  //    borda tem seu próprio Y, e é isso que mata a costura em volta da parte
  //    inclinada. Pareia ANTES de mexer em qualquer posição.
  // Y de cada vértice do anel externo ANTES do passo 1 — o passo 3 precisa
  // saber onde a parede encostava pra não puxar a base do bloco junto.
  const outerY0 = new Map<number, number>();
  for (const o of outer) outerY0.set(o, p.getY(o));

  for (const o of outer) {
    const ox = p.getX(o), oz = p.getZ(o);
    let best = -1, bestD = MAX_PAIR_DIST * MAX_PAIR_DIST, bestNy = -1;
    for (const j of inner) {
      const dx = p.getX(j) - ox, dz = p.getZ(j) - oz;
      const d = dx * dx + dz * dz;
      if (d > bestD + 1e-8) continue;
      const ny = n.getY(j);
      // EMPATE importa: o vértice da tampa (ny≈1) e o do chanfro (ny≈0.707)
      // ficam na MESMA posição XZ, separados só por normal/UV. Copiar o do
      // chanfro dava uma normal inclinada na borda e o tile ficava com um tom
      // diferente do vizinho — a estrada/rio saíam "listrados" tile a tile.
      // Em distância igual, vence a normal mais vertical: é a superfície.
      if (best < 0 || d < bestD - 1e-8 || ny > bestNy) { bestD = Math.min(bestD, d); best = j; bestNy = ny; }
    }
    if (best < 0) continue; // borda sem superfície por perto (leito do rio,
    // praia da costa): não há o que copiar, deixa como está
    p.setY(o, p.getY(best));
    n.setXYZ(o, n.getX(best), n.getY(best), n.getZ(best));
  }

  // 2) TODO o anel interno é empurrado até a borda real do hexágono. Tem que ser
  //    todos, não só os que viraram par no passo 1: o vértice da tampa e o do
  //    chanfro ocupam a MESMA posição XZ (diferem em normal/UV), então o
  //    pareamento pega um só — esticar apenas ele deixava a tampa parando em
  //    95% do hexágono e abria um vão de verdade entre os tiles.
  //
  //    O empurrão é PERPENDICULAR À ARESTA, não radial a partir do centro.
  //    Radial (escalar XZ) desloca o vértice também ao longo da aresta, e quanto
  //    mais perto do canto, mais torto: a faixa de terra da estrada e o leito do
  //    rio saíam afinados e serrilhados. Perpendicular, o vértice só sai dos 5%
  //    que faltam e a textura mantém a largura. No CANTO (duas arestas
  //    empatadas) não há perpendicular única — ali o radial é o certo.
  for (const j of inner) {
    const x = p.getX(j), z = p.getZ(j);
    const a = hexApothem(x, z);
    if (a <= 0 || a >= 1) continue;
    const d = edgePush(x, z, a);
    p.setX(j, x + d.x);
    p.setZ(j, z + d.z);
  }

  // 3) O TOPO DA PAREDE sobe junto. A parede lateral tem vértices próprios
  //    (normal horizontal) que ficavam 0.05 abaixo do topo — a altura do
  //    chanfro. Depois que a superfície subiu no passo 1, essa diferença vira
  //    um vão aberto entre a lateral e o tampo: invisível em escala 1, mas
  //    hexScale 10 multiplica pra meia unidade e o bloco parece "descolado"
  //    do próprio topo. Sobe só o topo (a base, ~1 abaixo, fica onde está) e
  //    NÃO mexe na normal: a parede tem que continuar sombreando de lado.
  for (const w of wallTop) {
    const wx = p.getX(w), wz = p.getZ(w), wy = p.getY(w);
    let best = -1, bestD = MAX_PAIR_DIST * MAX_PAIR_DIST;
    for (const o of outer) {
      const oy0 = outerY0.get(o)!;
      if (Math.abs(oy0 - wy) > 0.15) continue; // outro andar do bloco (base)
      const dx = p.getX(o) - wx, dz = p.getZ(o) - wz;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best >= 0) p.setY(w, p.getY(best));
  }
  p.needsUpdate = true;
  n.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

function TileLayer({
  geometry,
  material,
  cells,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  cells: Placement[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const inst = ref.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    // escala do bloco (hexScale): a peça é nativa (nível 1) — pra continuar
    // encaixando sem gaps/sobreposição no novo espaçamento, o MESH em si
    // precisa crescer junto (não é só a posição que muda).
    const s = getHexScale();
    const scale = new THREE.Vector3(s, s, s);
    cells.forEach((c, i) => {
      m.makeRotationY(c.rot * TILE_ROT_STEP);
      m.scale(scale);
      m.setPosition(c.x, c.y, c.z);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.count = cells.length;
    inst.computeBoundingSphere();
    // geometry/material entram nas deps porque trocar qualquer um deles RECRIA
    // o InstancedMesh (são `args`): sem isso o mesh novo nasce com as matrizes
    // zeradas e o mapa inteiro colapsa na origem.
  }, [cells, geometry, material]);
  return <instancedMesh ref={ref} args={[geometry, material, Math.max(1, cells.length)]} castShadow receiveShadow />;
}

/** geometria+material de cada .gltf, indexado por url (1 hook só, lista fixa).
 * `ground` troca o visual da grama (cor/textura) — ver hex/groundMaterial.ts. */
function useTileParts(ground: GroundSettings): Record<string, { geometry: THREE.BufferGeometry; material: THREE.Material }> {
  const gltfs = useGLTF(ALL_TILE_URLS) as unknown as { scene: THREE.Object3D }[];
  const gkey = groundKey(ground);
  const raw = useMemo(() => {
    const out: Record<string, { geometry: THREE.BufferGeometry; material: THREE.Material }> = {};
    ALL_TILE_URLS.forEach((url, i) => {
      const scene = gltfs[i]?.scene;
      if (!scene) return;
      // rampa TAMBÉM solda, e na volta inteira: a tampa alta e a faixa
      // inclinada usam o mesmo chanfro de 45°, e o weld por pareamento leva
      // cada ponto da borda pra altura da superfície ali (ver weldTopFace).
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !out[url]) out[url] = { geometry: weldTopFace(m.geometry), material: m.material as THREE.Material };
      });
    });
    return out;
  }, [gltfs]);

  // aplica o visual do chão por cima (clona o material só quando não é "atlas")
  return useMemo(() => {
    const out: Record<string, { geometry: THREE.BufferGeometry; material: THREE.Material }> = {};
    for (const [url, part] of Object.entries(raw)) {
      out[url] = { geometry: part.geometry, material: makeGroundMaterial(part.material, ground) };
    }
    return out;
    // gkey resume os campos do `ground` que mexem no material
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, gkey]);
}

export function HexTerrain({
  map,
  center,
  radius,
  ground = DEFAULT_GROUND,
}: {
  map: GameMap;
  center?: { x: number; z: number };
  radius?: number;
  /** visual da grama (server_config.gameplay) — ver hex/groundMaterial.ts */
  ground?: GroundSettings;
}) {
  const parts = useTileParts(ground);
  const cx = center?.x, cz = center?.z;

  const layers = useMemo(() => {
    const { width, height } = map.size;
    const out = new Map<string, Placement[]>();
    const push = (url: string, p: Placement) => {
      const arr = out.get(url);
      if (arr) arr.push(p); else out.set(url, [p]);
    };

    const ramps = rampMap(map);

    // culling por distância: com center+radius (modo play) itera SÓ a janela de
    // células ao redor do player — O(raio²), não O(mapa).
    let colStart = 0, colEnd = width, rowStart = 0, rowEnd = height;
    const cull = cx != null && cz != null && radius != null;
    if (cull) {
      const c = worldToHex(cx!, cz!);
      const rW = Math.ceil(radius! / HEX_W()) + 2;
      const rR = Math.ceil(radius! / HEX_V()) + 2;
      colStart = Math.max(0, c.col - rW); colEnd = Math.min(width, c.col + rW + 1);
      rowStart = Math.max(0, c.row - rR); rowEnd = Math.min(height, c.row + rR + 1);
    }
    const r2 = cull ? radius! * radius! : 0;

    for (let row = rowStart; row < rowEnd; row++) {
      for (let col = colStart; col < colEnd; col++) {
        const idx = cellIndex(map, col, row);
        const { x, z } = hexToWorld(col, row);
        if (cull) {
          const dx = x - cx!, dz = z - cz!;
          if (dx * dx + dz * dz > r2) continue;
        }
        const level = map.heightmap[idx] ?? 0;
        const y = levelToY(level);

        // corpo dos níveis abaixo do topo (fecha a lateral de hexágonos altos)
        for (let k = 0; k < level; k++) push(BASE_TILES.grassBottom, { x, y: levelToY(k), z, rot: 0 });

        // a peça do topo sai do MESMO lugar que a colisão consulta (tilePick),
        // pra o chão que se vê e o chão que se pisa nunca divergirem
        const tile = pickTileFor(map, col, row, ramps);
        push(urlForFile(tile.file), { x, y, z, rot: tile.rot });
      }
    }
    const entries = [...out.entries()];
    if (import.meta.env.DEV && typeof window !== "undefined")
      (window as unknown as { __terrainStats?: unknown }).__terrainStats = {
        camadas: entries.length,
        tiles: entries.reduce((n, [, arr]) => n + arr.length, 0),
        janela: { colStart, colEnd, rowStart, rowEnd },
        primeiro: entries[0]?.[1]?.[0],
      };
    return entries;
  }, [map, cx, cz, radius]);

  if (!parts[BASE_TILES.grass]) return null;
  return (
    <group>
      {layers.map(([url, cells]) => {
        const p = parts[url];
        if (!p || cells.length === 0) return null;
        return <TileLayer key={url} geometry={p.geometry} material={p.material} cells={cells} />;
      })}
    </group>
  );
}

useGLTF.preload(ALL_TILE_URLS);
