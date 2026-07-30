import type { MapProp } from "@ragnarok/map-format";
import { isSolidProp, propHull, propRadius } from "./registry";

/**
 * Onde os PROPS bloqueiam a passagem — independente da forma da grade.
 *
 * Isto vivia dentro do `hexTerrainQuery`, mas não tem nada de hexagonal: o
 * índice espacial é um hash grid QUADRADO e o teste é um polígono convexo em
 * coordenadas de mundo. Como a grade quadrada precisa exatamente do mesmo
 * comportamento, o código mora aqui e as duas queries de terreno o usam.
 *
 * A forma vem do modelo: o polígono da base medido do glTF (`propHull`, ver
 * scripts/measure-props.mjs), girado e escalado pelo transform do prop, com uma
 * folga do tamanho do personagem. Círculo só como broad-phase — era o círculo
 * sozinho que deixava entrar na lateral do castelo e, na árvore, barrava pela
 * copa em vez do tronco.
 */

/** um prop que bloqueia: centro no mundo, raio envolvente (broad-phase) e o
 * polígono da base em coordenadas LOCAIS + o transform pra chegar nelas */
interface Blocker {
  x: number;
  z: number;
  r: number;
  hull?: readonly (readonly [number, number])[];
  cos: number;
  sin: number;
  scale: number;
}

/** meia-largura do personagem (unidades de mundo). O teste é do PONTO onde ele
 * pisa, então sem essa folga ele encosta a barriga dentro do modelo antes de
 * ser barrado — era a queixa de "entra um pouco no objeto". */
export const ACTOR_RADIUS = 0.25;

/** o ponto (px,pz), já em coordenadas LOCAIS do prop, está dentro do polígono
 * (ou a menos de `margin` dele)? Hull convexo → todos os produtos vetoriais têm
 * o mesmo sinal quando está dentro. */
export function hullHit(
  hull: readonly (readonly [number, number])[],
  px: number,
  pz: number,
  margin: number,
): boolean {
  const n = hull.length;
  if (n < 3) return false;
  let pos = false, neg = false;
  let minDist2 = Infinity;
  for (let i = 0; i < n; i++) {
    const a = hull[i]!, b = hull[(i + 1) % n]!;
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const cross = ex * (pz - a[1]) - ez * (px - a[0]);
    if (cross > 0) pos = true;
    else if (cross < 0) neg = true;
    // distância ao segmento (pra margem quando está fora)
    const len2 = ex * ex + ez * ez || 1;
    let t = ((px - a[0]) * ex + (pz - a[1]) * ez) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (a[0] + ex * t), dz = pz - (a[1] + ez * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < minDist2) minDist2 = d2;
  }
  if (!(pos && neg)) return true; // dentro do convexo
  return minDist2 <= margin * margin; // fora, mas encostando
}

export interface PropBlockers {
  hits(x: number, z: number): boolean;
}

/**
 * Índice espacial (hash grid) dos props sólidos, pra `isWalkable` ser O(1) por
 * consulta mesmo com dezenas de milhares de props. O bucket usa o MAIOR raio do
 * mapa, então basta olhar as 9 células ao redor pra não perder nenhum blocker.
 */
export function buildPropBlockers(props: MapProp[]): PropBlockers {
  const list: Blocker[] = [];
  let maxR = 0;
  for (const p of props) {
    // colliderType do prop manda (editável no Inspector); sem ele, cai na regra
    // de categoria — mapas salvos antes do campo continuam colidindo certo.
    const solid = p.colliderType ? p.colliderType !== "none" : isSolidProp(p.assetId);
    if (!solid) continue;
    const scale = p.scale[0] ?? 1;
    const r = propRadius(p.assetId, scale);
    if (r <= 0) continue;
    const ry = p.rotation[1] ?? 0;
    list.push({
      x: p.position[0],
      z: p.position[2],
      r,
      hull: propHull(p.assetId),
      cos: Math.cos(ry),
      sin: Math.sin(ry),
      scale: scale || 1,
    });
    if (r > maxR) maxR = r;
  }
  const cell = Math.max(4, maxR * 2);
  const grid = new Map<string, Blocker[]>();
  for (const b of list) {
    const k = `${Math.floor(b.x / cell)},${Math.floor(b.z / cell)}`;
    const arr = grid.get(k);
    if (arr) arr.push(b);
    else grid.set(k, [b]);
  }
  return {
    hits(x: number, z: number): boolean {
      if (list.length === 0) return false;
      const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.get(`${gx + dx},${gz + dz}`);
          if (!arr) continue;
          for (const b of arr) {
            // broad-phase: círculo envolvente + folga do personagem
            const ex = x - b.x, ez = z - b.z;
            const reach = b.r + ACTOR_RADIUS;
            if (ex * ex + ez * ez >= reach * reach) continue;
            if (!b.hull) return true; // sem forma medida: círculo mesmo
            // narrow-phase: leva o ponto pro espaço local do prop (desfaz
            // rotação Y e escala) e testa contra o polígono da base
            const lx = (ex * b.cos - ez * b.sin) / b.scale;
            const lz = (ex * b.sin + ez * b.cos) / b.scale;
            if (hullHit(b.hull, lx, lz, ACTOR_RADIUS / b.scale)) return true;
          }
        }
      return false;
    },
  };
}
