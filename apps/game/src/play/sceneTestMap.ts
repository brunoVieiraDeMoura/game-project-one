import { cellIndex, createBlankMap, type GameMap, type MapProp } from "@ragnarok/map-format";
import { SQUARE_SIZE, squareToWorld } from "../grid/squareGrid";
import { propDefaultScale } from "../props/registry";
import type { ParticleKind } from "../vfx/AmbientParticles";

/**
 * Mapa sintético de teste pra iluminação/céu/água/sombra/partículas (ver
 * pedido de auditoria) — `?map=scenetest`, mesmo mecanismo local do
 * `hexdemo`/`windtest` (`PlayView.tsx`).
 *
 * `terrainMode: "square"` DE PROPÓSITO — diferente do `windTestMap.ts`
 * (`"smooth"`, sem água nem culling): água animada só existe hoje no caminho
 * `SquareTerrain` (`squareChunks.ts: ehCelulaDeAgua`), e este teste PRECISA de
 * lago de verdade, sombra caindo em chão de verdade, e culling por chunk de
 * verdade (a seção "teste de chunk" do pedido pede pra atravessar fronteira
 * de chunk e ver os efeitos sumir/reaparecer — `"smooth"` não teria isso pra
 * mostrar, é sempre tudo desenhado).
 *
 * 140×100 células (280×200 unidades) = 5×4 chunks de 32 células — andar do
 * spawn até o lago cruza 2 fronteiras de chunk.
 */

const GRASS_IDS = ["grass_2_a", "grass_1_a", "grass_1_d"];
const TREE_IDS = ["tree_2_a", "tree_1_a", "tree_1_c"];
const BUILDING_IDS = ["hex_building_barracks_blue", "hex_building_archeryrange_green"];

const POND_CENTER = { x: 140, z: 100 };
const POND_RADIUS = 18;
const SPAWN = { x: 60, z: 100 };

/** onde `PlayView` monta `<AmbientParticles>` pro cenário — mesmas coordenadas
 * do gerador, exportadas daqui pra nunca desalinhar dos dois lados. */
export const PARTICLE_SPOTS: { kind: ParticleKind; origin: [number, number, number]; count?: number; radius?: number }[] = [
  // fogueira perto da vila (brasa sobe + faísca rápida por cima)
  { kind: "ember", origin: [60, 0.3, 72], count: 30, radius: 1.2 },
  { kind: "spark", origin: [60, 0.5, 72], count: 20, radius: 0.8 },
  // clareira funda na floresta
  { kind: "magic", origin: [60, 0.6, 150], count: 18, radius: 3 },
  // trecho seco a sudeste, sem vegetação nenhuma
  { kind: "dust", origin: [220, 0.2, 150], count: 26, radius: 10 },
  // margem do lago
  { kind: "mist", origin: [122, 0.15, 100], count: 16, radius: 6 },
];

export function buildSceneTestMap(): GameMap {
  const map = createBlankMap("scenetest", "Teste de cena", 140, 100, 2);
  map.terrainMode = "square";

  // lago: círculo de células "water" em torno de POND_CENTER — heightmap
  // fica em 0 (a água AFUNDA sozinha, ver squareChunks.ts: visualLevel)
  const { width, height } = map.size;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const { x, z } = squareToWorld(col, row);
      const dx = x - POND_CENTER.x;
      const dz = z - POND_CENTER.z;
      if (dx * dx + dz * dz <= POND_RADIUS * POND_RADIUS) {
        map.collision[cellIndex(map, col, row)] = "water";
      }
    }
  }

  const props: MapProp[] = [];
  let seed = 71717;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  /** true = célula livre pra prop (dentro do mapa, não é água) */
  function livre(x: number, z: number): boolean {
    const col = Math.floor(x / SQUARE_SIZE);
    const row = Math.floor(z / SQUARE_SIZE);
    if (col < 0 || col >= width || row < 0 || row >= height) return false;
    return map.collision[cellIndex(map, col, row)] !== "water";
  }

  function area(label: string, cx: number, cz: number, raio: number, count: number, grassRatio: number) {
    let colocados = 0;
    let tentativas = 0;
    while (colocados < count && tentativas < count * 8) {
      tentativas++;
      const ang = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * raio;
      const wx = cx + Math.cos(ang) * r;
      const wz = cz + Math.sin(ang) * r;
      if (!livre(wx, wz)) continue;
      const ids = rnd() < grassRatio ? GRASS_IDS : TREE_IDS;
      const assetId = ids[Math.floor(rnd() * ids.length)]!;
      const escala = propDefaultScale(assetId) * (0.85 + rnd() * 0.3);
      props.push({
        id: `cena-${label}-${props.length}`,
        assetId,
        position: [wx, 0, wz],
        rotation: [0, rnd() * Math.PI * 2, 0],
        scale: [escala, escala, escala],
        colliderType: "none",
      });
      colocados++;
    }
  }

  // floresta (árvores predominam)
  area("floresta", 60, 150, 30, 350, 0.25);
  // campo (grama predomina)
  area("campo", 220, 100, 34, 500, 0.85);
  // mistura densa (a "grande concentração" deste cenário)
  area("mistura", 140, 40, 34, 900, 0.5);
  // margem do lago — só um pouco de vegetação rasteira bem perto d'água
  area("margem", 120, 100, 14, 60, 0.9);

  // "vila": 2 construções fixas perto do spawn (não é scatter aleatório)
  for (const [i, pos] of ([[58, 72], [70, 78]] as [number, number][]).entries()) {
    const assetId = BUILDING_IDS[i]!;
    const sc = propDefaultScale(assetId);
    props.push({
      id: `cena-vila-${i}`,
      assetId,
      position: [pos[0], 0, pos[1]],
      rotation: [0, i * Math.PI * 0.5, 0],
      scale: [sc, sc, sc],
      colliderType: "hull",
    });
  }

  map.props = props;
  map.spawns = [{ id: "sp_player", kind: "player_start", position: [SPAWN.x, 0, SPAWN.z] }];
  return map;
}
