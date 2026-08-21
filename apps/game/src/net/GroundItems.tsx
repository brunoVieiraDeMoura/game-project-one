import { useEffect, useRef, useState } from "react";
import { Billboard, Text } from "@react-three/drei";
import { create } from "zustand";
import type { GameMap } from "@ragnarok/map-format";
import { gateway } from "./gateway";
import { cellToWorld, type LegacyMapping } from "./legacyCells";
import { useCursorStore } from "../ui/cursorStore";
import { BOOK } from "../ui/travelbook";
import { GlowChao } from "./GlowChao";
import { GEO_CAIXA, GEO_PLANO, MATERIAL_INVISIVEL, materialDeIcone, materialOpaco } from "./recursosCompartilhados";
import { pegar } from "./acoes";
import { useItemCatalog, getItemDisplayName } from "./itemCatalog";
import { itemIconUrl } from "./itemIcons";

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

/**
 * Área de clique do item, em fração de CÉLULA.
 *
 * A caixinha desenhada tem 0,22 de célula de lado — na distância de câmera do
 * jogo é um alvo de poucos pixels, e errar o clique manda o personagem ANDAR
 * até ali em vez de pegar. A área invisível é quase a célula inteira; quem
 * desenha continua sendo o cubo pequeno.
 */
const PEGAR_RAIO = 0.45;
const PEGAR_ALTURA = 0.7;

/**
 * Dourado do realce de item.
 *
 * É o `BOOK.gold` da paleta do TravelBook — o mesmo tom do preenchimento das
 * barras e da moldura da UI. Inventar um amarelo novo faria o brilho destoar de
 * tudo o que já está na tela.
 */
const GLOW_LOOT = BOOK.gold;

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
      {Object.values(items).map((item) => (
        <ItemNoChao key={item.gid} item={item} map={map} mapping={mapping} cellSize={cellSize} />
      ))}
    </>
  );
}

/**
 * Um item no chão.
 *
 * Componente próprio por causa do CURSOR: quando alguém pega o drop ele some da
 * cena sem disparar `pointerout`, e o pedido de "mão" ficaria pendurado para
 * sempre — o cursor travava na mão aberta. Só um componente tem desmontagem
 * para desfazer isso.
 */
function ItemNoChao({
  item,
  map,
  mapping,
  cellSize,
}: {
  item: { gid: number; itemId: number; x: number; y: number; subX: number; subY: number };
  map: GameMap;
  mapping: LegacyMapping;
  cellSize: number;
}) {
  const sobre = useRef(false);
  /** o mesmo, mas em estado — o brilho e o nome são desenho e precisam de render */
  const [realce, setRealce] = useState(false);
  /**
   * O nome de verdade, do catálogo (`net/itemCatalog`).
   *
   * O `ensure` é pedido na MONTAGEM do item, não no hover: buscar só ao passar o
   * mouse deixaria o nome chegar depois do ponteiro já ter saído. Ele só busca o
   * que falta, então um chão com vinte poções vermelhas custa uma requisição.
   */
  // NUNCA id como nome provisório (regra absoluta, auditoria 2026-08-14) —
  // `undefined` enquanto o catálogo não respondeu; a plaquinha (abaixo) só
  // aparece quando há nome de verdade pra mostrar.
  const nome = useItemCatalog((s) => getItemDisplayName(s.byId[item.itemId]));
  const iconUrl = useItemCatalog((s) => itemIconUrl(s.byId[item.itemId]?.icon));
  useEffect(() => {
    useItemCatalog.getState().ensure([item.itemId]);
  }, [item.itemId]);
  useEffect(
    () => () => {
      if (sobre.current) useCursorStore.getState().pedir("hand", false);
    },
    [],
  );

  const world = cellToWorld(map, mapping, item.x, item.y);
  // subX/subY espalham itens dentro da mesma célula (0..15 no protocolo)
  const offX = ((item.subX - 8) / 16) * cellSize * 0.6;
  const offZ = ((item.subY - 8) / 16) * cellSize * 0.6;
  const size = cellSize * 0.22;

  return (
    <group position={[world.x + offX, world.y, world.z + offZ]}>
      {/**
       * Área de clique SEPARADA da caixinha desenhada.
       *
       * O item é um cubo de 0,22 de célula — na distância de câmera do jogo, um
       * alvo de poucos pixels, e errar o clique manda o personagem andar em vez
       * de pegar. Esta caixa invisível é bem maior e some pelo material (sem
       * `visible={false}`, que faria o raycaster pular ela — a mesma armadilha
       * do cilindro do mob).
       */}
      <mesh
        position={[0, (cellSize * PEGAR_ALTURA) / 2, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (sobre.current) return;
          sobre.current = true;
          setRealce(true);
          useCursorStore.getState().pedir("hand", true);
        }}
        onPointerOut={() => {
          if (!sobre.current) return;
          sobre.current = false;
          setRealce(false);
          useCursorStore.getState().pedir("hand", false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          // "ir até e pegar" mora em `net/acoes`: clicar EM CIMA do item e
          // clicar PERTO dele (assistência de mira) têm de fazer o mesmo
          pegar(item.gid, item.x, item.y);
        }}
        scale={[cellSize * PEGAR_RAIO * 2, cellSize * PEGAR_ALTURA, cellSize * PEGAR_RAIO * 2]}
        geometry={GEO_CAIXA}
        material={MATERIAL_INVISIVEL}
      />

      {/* brilho dourado de leve enquanto o ponteiro está em cima */}
      <GlowChao cor={GLOW_LOOT} raio={cellSize * PEGAR_RAIO * 1.3} aceso={realce} />

      {/* o desenho em si: só visual, sem handler — quem recebe o clique é a
          área invisível acima, que é bem maior. Com sprite (`net/itemIcons`),
          um plano sempre de frente pra câmera (`Billboard`); sem sprite, a
          caixinha colorida por id de sempre. */}
      {iconUrl ? (
        <Billboard position={[0, size * 0.6, 0]}>
          <mesh scale={size * 1.6} raycast={() => null} geometry={GEO_PLANO} material={materialDeIcone(iconUrl)} />
        </Billboard>
      ) : (
        // caixa unitária escalada + material cacheado por COR: sem isso um campo
        // depois de uma caçada aloca um par de objetos por item caído, e dezenas
        // deles são do mesmo tipo
        <mesh
          position={[0, size * 0.6, 0]}
          rotation={[0, Math.PI / 5, 0]}
          scale={size}
          raycast={() => null}
          geometry={GEO_CAIXA}
          material={materialOpaco(colorFor(item.itemId))}
        />
      )}

      {/**
       * O nome, ABAIXO do item, só com o ponteiro em cima.
       *
       * Abaixo e não acima de propósito: acima é onde moram as plaquinhas de
       * monstro, e num chão cheio de drop as duas fileiras de texto se
       * embaralhariam. Só no hover porque um campo depois de uma caçada tem
       * dezenas de itens — todos nomeados de uma vez viraria uma parede de
       * letras.
       */}
      {realce && nome && (
        <Billboard position={[0, -cellSize * 0.06, 0]}>
          <Text
            fontSize={cellSize * 0.1}
            color={BOOK.parchmentLight}
            outlineWidth={cellSize * 0.009}
            outlineColor="#000000"
            anchorX="center"
            anchorY="top"
          >
            {nome}
          </Text>
        </Billboard>
      )}
    </group>
  );
}
