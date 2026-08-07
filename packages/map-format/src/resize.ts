import type { GameMap, MapProp, MapSpawn, MapTrigger, SurfaceType } from "./index";

/**
 * Redimensionar um `GameMap` preservando dados — extraído de
 * `apps/game/src/editor/editorStore.ts` (`resizeMap`) para ser reusado pelo
 * admin (que edita ID/nome/tamanho de um mapa ANTES de abrir o editor 3D, sem
 * depender do pacote do jogo nem do zustand).
 *
 * heightmap/collision/surface/ramps: preserva a sobreposição pelo canto
 * SUPERIOR-ESQUERDO (célula (0,0) continua sendo (0,0)) — encolher corta o
 * excesso, crescer preenche com o padrão (nível 0, "walkable", "grass").
 *
 * props/spawns/triggers: posição é coordenada de MUNDO CONTÍNUA, não índice
 * de célula, então eles NUNCA são realocados nem apagados por um resize — só
 * ficam com posição fora da nova grade se ela encolher. `foraDosLimites`
 * relata quem ficou de fora para o CHAMADOR decidir o que fazer (avisar,
 * pedir confirmação) — esta função nunca apaga nada sozinha.
 *
 * O limite de mundo usa `map.cellSize`, a mesma convenção que já valia em
 * `ProceduralPanel.tsx` (`foraAoEncolher`) antes desta extração — manter os
 * dois cálculos iguais é o que importa aqui: o editor e o admin têm que
 * concordar em quantos objetos "saem fora" do mesmo resize.
 */
export interface ResizeMapResult {
  map: GameMap;
  foraDosLimites: { props: MapProp[]; spawns: MapSpawn[]; triggers: MapTrigger[] };
}

function rampMap(flat: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i + 1 < flat.length; i += 2) m.set(flat[i]!, flat[i + 1]!);
  return m;
}

function flattenRamps(m: Map<number, number>): number[] {
  const out: number[] = [];
  for (const [cell, edge] of m) out.push(cell, edge);
  return out;
}

/** quais props/spawns/triggers de um mapa caem fora de `[0,W) × [0,H)` em
 * células, na convenção de mundo `célula × cellSize` — sem alterar nada, só
 * relatando. Usado tanto para "encolher vai deixar isto de fora" quanto,
 * depois do resize, para conferir o resultado. */
export function objetosForaDosLimites(
  map: Pick<GameMap, "props" | "spawns" | "triggers" | "cellSize">,
  width: number,
  height: number,
): ResizeMapResult["foraDosLimites"] {
  const limX = width * map.cellSize;
  const limZ = height * map.cellSize;
  const fora = (x: number, z: number) => x < 0 || z < 0 || x >= limX || z >= limZ;
  return {
    props: map.props.filter((p) => fora(p.position[0], p.position[2])),
    spawns: map.spawns.filter((sp) => fora(sp.position[0], sp.position[2])),
    triggers: (map.triggers ?? []).filter((t) => {
      // gatilho é uma ÁREA em células, não um ponto — qualquer canto fora conta
      const x1 = (t.area.col + t.area.w) * map.cellSize;
      const z1 = (t.area.row + t.area.h) * map.cellSize;
      return fora(t.area.col * map.cellSize, t.area.row * map.cellSize) || x1 > limX || z1 > limZ;
    }),
  };
}

/**
 * Redimensiona a grade preservando o canto superior-esquerdo. `width`/`height`
 * são usados como vieram — quem chama já validou os limites (o editor do
 * jogo aceita 4..500, o admin 16..1024; um teto só nesta função obrigaria os
 * dois a concordar em um número que nenhum dos dois pediu).
 */
export function resizeGameMap(map: GameMap, width: number, height: number): ResizeMapResult {
  const W = Math.round(width);
  const H = Math.round(height);
  const foraDosLimites = objetosForaDosLimites(map, W, H);
  if (W === map.size.width && H === map.size.height) return { map, foraDosLimites };

  const n = W * H;
  const heightmap = new Array<number>(n).fill(0);
  const collision = new Array<GameMap["collision"][number]>(n).fill("walkable");
  const surface = new Array<SurfaceType>(n).fill("grass");
  const oldSurface = map.surface.length ? map.surface : new Array(map.heightmap.length).fill("grass");
  const oldRamps = rampMap(map.ramps);
  const ramps = new Map<number, number>();

  for (let row = 0; row < Math.min(H, map.size.height); row++) {
    for (let col = 0; col < Math.min(W, map.size.width); col++) {
      const oi = row * map.size.width + col;
      const ni = row * W + col;
      heightmap[ni] = map.heightmap[oi] ?? 0;
      collision[ni] = map.collision[oi] ?? "walkable";
      surface[ni] = (oldSurface[oi] as SurfaceType) ?? "grass";
      const r = oldRamps.get(oi);
      if (r != null) ramps.set(ni, r); // índice muda com a largura: remapeia
    }
  }

  return {
    map: { ...map, size: { width: W, height: H }, heightmap, collision, surface, ramps: flattenRamps(ramps) },
    foraDosLimites,
  };
}
