import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import type { TerrainQuery } from "@ragnarok/engine-core";
import { worldToHex, hexToWorld, levelToY, LEVEL_HEIGHT, getHexScale, HEX_W, HEX_V } from "./hexGrid";
import { pickTileFor, rampMap, type TileChoice } from "./tilePick";
import { sampleTileHeight } from "./tileHeight";
import { isBridgeProp, propDeck } from "../props/registry";
import { buildPropBlockers } from "../props/propBlockers";

/**
 * TerrainQuery pra mapas hexagonais: traduz (x,z) de mundo → célula hex →
 * altura (topo do tile no nível) e andabilidade. Mesmo contrato do
 * createMapTerrainQuery quadrado, então os MovementControllers (free/grid)
 * funcionam sem mudança — o player sobe nos tiles porque getHeight devolve o
 * topo do nível da célula.
 *
 * A altura DENTRO da célula vem da geometria real da peça que está desenhada
 * ali: descobre-se a peça pelo mesmo caminho do render (tilePick) e amostra-se
 * o heightfield medido do .gltf (tileHeight). Assim o chão segue literalmente
 * cada caimento — a faixa escavada da estrada só é mais baixa ONDE a faixa
 * passa, e a rampa acompanha a inclinação real inclusive no começo, no fim e
 * fora do eixo. As aproximações antigas (queda fixa por superfície + curva 1D
 * na rampa) faziam o personagem flutuar na estrada e afundar/vazar na rampa.
 *
 * PROPS SÓLIDOS também bloqueiam aqui (montanha/árvore/rocha/colina/construção/
 * árvore seca) pela FORMA do modelo: o polígono da base medido do glTF
 * (propHull, ver scripts/measure-props.mjs), girado e escalado pelo transform
 * do prop, com uma folga do tamanho do personagem. Círculo só como broad-phase
 * — era o círculo sozinho que deixava entrar na lateral do castelo e, na
 * árvore, barrava pela copa em vez do tronco. Tem que ser nesta query e não em
 * colliders do Rapier porque o movimento (player, monstros e NPCs) roda pelo
 * MovementController do engine-core, que só enxerga TerrainQuery — um RigidBody
 * de prop não teria efeito nenhum sobre eles.
 */
export function createHexTerrainQuery(map: GameMap): TerrainQuery {
  const { width, height } = map.size;
  const blockers = buildPropBlockers(map.props);
  const bridges = buildBridgeDecks(map);
  const ramps = rampMap(map);
  // qual peça está em cada célula — calculado sob demanda e guardado, porque
  // getHeight roda várias vezes por frame (player + monstros + npcs + marcador)
  const tiles = new Map<number, TileChoice>();
  const tileAt = (idx: number, col: number, row: number): TileChoice => {
    let t = tiles.get(idx);
    if (!t) { t = pickTileFor(map, col, row, ramps); tiles.set(idx, t); }
    return t;
  };
  const cellOf = (x: number, z: number) => {
    const { col, row } = worldToHex(x, z);
    if (col < 0 || col >= width || row < 0 || row >= height) return null;
    return { col, row, idx: cellIndex(map, col, row) };
  };
  return {
    getHeight(x, z) {
      const c = cellOf(x, z);
      if (!c) return 0;
      // PONTE: anda no tabuleiro, na altura da margem — não no fundo do rio
      const deck = bridges.get(c.idx);
      if (deck != null) return deck;
      const level = map.heightmap[c.idx] ?? 0;
      // relevo da peça desenhada nesta célula, amostrado na posição exata
      const tile = tileAt(c.idx, c.col, c.row);
      const o = hexToWorld(c.col, c.row);
      const s = getHexScale();
      const local = sampleTileHeight(tile.file, tile.rot, (x - o.x) / s, (z - o.z) / s);
      return levelToY(level) + local * LEVEL_HEIGHT();
    },
    // água (lago/rio) BLOQUEIA sempre — a estrada nunca atravessa, morre na
    // margem. Depois do terreno, a forma dos props sólidos (rampa/estrada/
    // ponte/grama/arbusto não entram — colliderType "none").
    isWalkable(x, z) {
      const c = cellOf(x, z);
      if (!c) return false;
      // ponte colocada sobre a água: a célula passa a ser travessia
      if (bridges.has(c.idx)) return !blockers.hits(x, z);
      if (map.collision[c.idx] !== "walkable") return false;
      return !blockers.hits(x, z);
    },
  };
}

/**
 * Células cobertas por uma PONTE → viram passagem (mesmo sobre água) na altura
 * do TABULEIRO.
 *
 * A altura e o vão do tabuleiro são MEDIDOS do modelo (`propDeck`, gravado no
 * catálogo por scripts/measure-props.mjs) e transformados pelo scale/rotation
 * do prop. Antes isto usava o nível da margem mais alta e marcava só a célula
 * do CENTRO do prop: uma ponte de vários hexágonos continuava com o meio do rio
 * bloqueado, então dava pra encostar mas não pra atravessar — que é a queixa.
 *
 * Todas as células cujo centro cai no vão entram, com a mesma altura: o piso é
 * plano, e ter um valor só evita degrau no meio da travessia.
 */
function buildBridgeDecks(map: GameMap): Map<number, number> {
  const out = new Map<number, number>();
  const { width: W, height: H } = map.size;
  for (const p of map.props) {
    if (!isBridgeProp(p.assetId)) continue;
    const deck = propDeck(p.assetId);
    if (!deck) continue; // ponte sem medida: sem travessia inventada
    const [px, py, pz] = p.position;
    const [sx, sy, sz] = p.scale;
    const ang = p.rotation[1] ?? 0;
    const cos = Math.cos(-ang), sin = Math.sin(-ang); // mundo → local do prop
    const hx = deck.hx * sx, hz = deck.hz * sz;
    const y = py + deck.y * sy;

    // janela de células a testar: raio do vão convertido pro passo do grid
    const c0 = worldToHex(px, pz);
    const alcance = Math.max(hx, hz);
    const rc = Math.ceil(alcance / HEX_W()) + 1;
    const rr = Math.ceil(alcance / HEX_V()) + 1;
    for (let row = c0.row - rr; row <= c0.row + rr; row++) {
      for (let col = c0.col - rc; col <= c0.col + rc; col++) {
        if (col < 0 || col >= W || row < 0 || row >= H) continue;
        const o = hexToWorld(col, row);
        const dx = o.x - px, dz = o.z - pz;
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        if (Math.abs(lx) > hx || Math.abs(lz) > hz) continue;
        out.set(cellIndex(map, col, row), y);
      }
    }
  }
  return out;
}
