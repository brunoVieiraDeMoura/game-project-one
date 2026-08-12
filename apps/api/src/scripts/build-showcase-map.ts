/**
 * Constrói o conteúdo do mapa de showcase (`gpqa01` — já existe, já hospedado
 * pelo map-server real, ver `rathena-conf/map_conf.txt: map: gpqa01`) com as
 * 5 áreas pedidas (iluminação/sombra/água/partículas/névoa) + um hub central.
 *
 * `gpqa01` é IDENTIDADE (`net/legacyMaps.ts: map3dFor` cai no próprio id
 * quando não há apelido) — 128×128 células reais, arena aberta, sem props
 * hoje. Diferente do `sceneTestMap.ts`/`windTestMap.ts` (mundos sintéticos,
 * sem sessão), este É o mapa real: um personagem de verdade pode ser
 * levado até aqui pelo servidor de verdade.
 *
 *   pnpm --filter @ragnarok/api build:showcase-map
 *
 * Roda direto no Supabase (service role), mesmo padrão de `link-legacy-map.ts`
 * e dos `seed:*` — não precisa de token de admin.
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../env.js";
import { rowToMap, mapToRow, type MapRow } from "../store/map-row.js";
import type { MapProp, GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em apps/api/.env");
  process.exit(1);
}

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

const { data, error } = await supabase.from("maps").select("*").eq("id", "gpqa01").single();
if (error || !data) {
  console.error(`mapa "gpqa01" não encontrado:`, error?.message);
  process.exit(1);
}

const map = rowToMap(data as MapRow);
if (map.terrainMode !== "square") {
  console.error(`gpqa01 é terrainMode "${map.terrainMode}", esperava "square" — abortando`);
  process.exit(1);
}

const SQUARE_SIZE = 2; // grid/squareGrid.ts — fixo, não passa por cellSize
const cellToWorld = (col: number, row: number) => ({ x: (col + 0.5) * SQUARE_SIZE, z: (row + 0.5) * SQUARE_SIZE });

const GRASS_IDS = ["grass_2_a", "grass_1_a", "grass_1_d"];
const TREE_IDS = ["tree_1_a", "tree_1_b", "tree_1_c", "tree_2_a"];
const BUILDING_ID = "hex_building_barracks_blue";

let seed = 424242;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const props: MapProp[] = [];
let propSeq = 0;
function addProp(assetId: string, x: number, z: number, scale = 1, rotY?: number) {
  props.push({
    id: `showcase-${propSeq++}`,
    assetId,
    position: [x, 0, z],
    rotation: [0, rotY ?? rnd() * Math.PI * 2, 0],
    scale: [scale, scale, scale],
    colliderType: "none",
  });
}

// ---- centro do mapa (célula 64,64 → mundo 128,128) ----
const CX = 64, CZ = 64;
const world = cellToWorld(CX, CZ);

/**
 * LAGO PEQUENO no hub (raio 6 células / 12 unidades) — parte do "vários
 * efeitos ao mesmo tempo" pedido na seção 8. Um segundo lago, bem maior,
 * fica na área dedicada de água (mais abaixo) para inspeção de perto.
 */
function carvePond(centerCol: number, centerRow: number, radiusCells: number) {
  const { width, height } = map.size;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const dc = col - centerCol, dr = row - centerRow;
      if (dc * dc + dr * dr <= radiusCells * radiusCells) {
        map.collision[cellIndex(map, col, row)] = "water";
      }
    }
  }
}
carvePond(CX, CZ, 6);
carvePond(CX, CZ + 50, 15); // lago grande — área de água dedicada (ver abaixo)

/** true = célula livre pra prop (dentro do mapa, sem ser água) */
function livre(x: number, z: number): boolean {
  const col = Math.floor(x / SQUARE_SIZE);
  const row = Math.floor(z / SQUARE_SIZE);
  if (col < 0 || col >= map.size.width || row < 0 || row >= map.size.height) return false;
  return map.collision[cellIndex(map, col, row)] !== "water";
}

function scatter(cx: number, cz: number, radius: number, count: number, grassRatio: number) {
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 8) {
    tries++;
    const ang = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    const x = cx + Math.cos(ang) * r;
    const z = cz + Math.sin(ang) * r;
    if (!livre(x, z)) continue;
    const ids = rnd() < grassRatio ? GRASS_IDS : TREE_IDS;
    const assetId = ids[Math.floor(rnd() * ids.length)]!;
    addProp(assetId, x, z, 0.85 + rnd() * 0.3);
    placed++;
  }
}

// ---- HUB (centro do mapa): lago pequeno + 4 árvores flanqueando + 1 construção ----
addProp(BUILDING_ID, world.x, world.z - 24, 1);
addProp("tree_1_c", world.x - 16, world.z - 12, 1.3);
addProp("tree_1_c", world.x + 16, world.z - 12, 1.3);
addProp("tree_1_a", world.x - 14, world.z + 16, 1.1);
addProp("tree_1_a", world.x + 14, world.z + 16, 1.1);
scatter(world.x, world.z, 20, 40, 0.9); // grama rala em volta do lago do hub

// ---- N: ÁREA DE ILUMINAÇÃO (célula 64,20 → mundo 128,40) — vazia de
//      propósito, só 1 árvore grande + 1 pedra, pra sol×sombra×ambiente
//      ficarem óbvios num chão limpo, sem nada mais competindo pela vista ----
{
  const p = cellToWorld(64, 20);
  addProp("tree_1_c", p.x, p.z, 1.6, 0);
  addProp("rock_1_c", p.x + 10, p.z + 3, 2);
}

// ---- E: ÁREA DE SOMBRAS (célula 108,64 → mundo 216,128) — grade de
//      árvores ESPAÇADAS (não scatter denso): sombras individuais
//      legíveis, não uma mancha escura só ----
{
  const p = cellToWorld(108, 64);
  for (let gx = -3; gx <= 3; gx++) {
    for (let gz = -2; gz <= 2; gz++) {
      const jitterX = (rnd() - 0.5) * 3;
      const jitterZ = (rnd() - 0.5) * 3;
      const id = TREE_IDS[Math.floor(rnd() * TREE_IDS.length)]!;
      addProp(id, p.x + gx * 7 + jitterX, p.z + gz * 7 + jitterZ, 1 + rnd() * 0.5);
    }
  }
}

// ---- S: ÁREA DE ÁGUA (célula 64,114 → mundo 128,228 — lago grande já
//      escavado acima) — moitas de grama na margem, pra dar escala ----
{
  const p = cellToWorld(64, 114);
  scatter(p.x, p.z, 22, 50, 1);
}

// ---- W: ÁREA DE PARTÍCULAS (célula 20,64 → mundo 40,128) — sem decoração
//      de planta (partícula tem que ser a única coisa chamando atenção);
//      posições ficam em `showcaseParticleSpots` (client) ----
// (nenhum prop aqui — ver PARTICLE_SPOTS no client)

// ---- spawn do jogador: borda sul do lago do hub, olhando pro hub inteiro ----
map.spawns = [{ id: "sp_player", kind: "player_start", position: [world.x, 0, world.z + 30] }];

const updated: GameMap = { ...map, props, name: "Showcase de efeitos (QA)" };
const row = mapToRow(updated);
const { error: saveError } = await supabase.from("maps").update(row).eq("id", "gpqa01");
if (saveError) {
  console.error("falha ao salvar:", saveError.message);
  process.exit(1);
}

console.log(`gpqa01 atualizado: ${props.length} props, lago hub r=6 em (${CX},${CZ}), lago grande r=15 em (${CX},${CZ + 50})`);
console.log("zonas (célula → mundo):");
console.log("  hub        ", CX, CZ, "→", world);
console.log("  iluminação ", 64, 20, "→", cellToWorld(64, 20));
console.log("  sombras    ", 108, 64, "→", cellToWorld(108, 64));
console.log("  água       ", 64, 114, "→", cellToWorld(64, 114));
console.log("  partículas ", 20, 64, "→", cellToWorld(20, 64));
console.log("  spawn      ", "→", { x: world.x, z: world.z + 30 });
