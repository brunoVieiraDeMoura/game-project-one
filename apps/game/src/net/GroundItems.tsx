import { create } from "zustand";
import type { GameMap } from "@ragnarok/map-format";
import { gateway } from "./gateway";
import { cellToWorld, type LegacyMapping } from "./legacyCells";

/**
 * Itens caídos no chão.
 *
 * Quem cria e quem tira é o servidor (drop de mob, item jogado, alguém pegou):
 * o cliente só desenha e manda `CZ.ITEM_PICKUP` no clique. Sem modelo por item
 * ainda, cada um é uma caixinha — o combinado do plano (tenta-entender §5).
 */

export interface GroundItemData {
  gid: number;
  itemId: number;
  amount: number;
  x: number;
  y: number;
  subX: number;
  subY: number;
}

interface GroundItemsState {
  items: Record<number, GroundItemData>;
  put: (item: GroundItemData) => void;
  remove: (gid: number) => void;
  clear: () => void;
}

export const useGroundItems = create<GroundItemsState>((set) => ({
  items: {},
  put: (item) => set((s) => ({ items: { ...s.items, [item.gid]: item } })),
  remove: (gid) =>
    set((s) => {
      if (!s.items[gid]) return s;
      const next = { ...s.items };
      delete next[gid];
      return { items: next };
    }),
  clear: () => set({ items: {} }),
}));

/** cor estável por id de item — dois itens diferentes não viram a mesma caixa */
function colorFor(itemId: number): string {
  return `hsl(${(itemId * 47) % 360}, 55%, 55%)`;
}

export function GroundItems({
  map,
  mapping,
  cellSize,
}: {
  map: GameMap;
  mapping: LegacyMapping;
  cellSize: number;
}) {
  const items = useGroundItems((s) => s.items);

  return (
    <>
      {Object.values(items).map((item) => {
        const world = cellToWorld(map, mapping, item.x, item.y);
        // subX/subY espalham itens dentro da mesma célula (0..15 no protocolo)
        const offX = ((item.subX - 8) / 16) * cellSize * 0.6;
        const offZ = ((item.subY - 8) / 16) * cellSize * 0.6;
        const size = cellSize * 0.22;

        return (
          <mesh
            key={item.gid}
            position={[world.x + offX, world.y + size * 0.6, world.z + offZ]}
            rotation={[0, Math.PI / 5, 0]}
            onClick={(e) => {
              e.stopPropagation();
              // pegar é PEDIDO: o servidor decide se está perto, se cabe no peso
              // e quem fica com o item quando dois clicam junto
              gateway().emit("item:pickup", { gid: item.gid });
            }}
          >
            <boxGeometry args={[size, size, size]} />
            <meshStandardMaterial color={colorFor(item.itemId)} roughness={0.6} />
          </mesh>
        );
      })}
    </>
  );
}
