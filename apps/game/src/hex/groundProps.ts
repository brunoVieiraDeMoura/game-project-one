import type { GameMap, MapProp } from "@ragnarok/map-format";
import type { TerrainQuery } from "@ragnarok/engine-core";
import { cellIndex } from "@ragnarok/map-format";
import { levelToY, worldToHex } from "./hexGrid";
import { isBridgeProp } from "../props/registry";

/**
 * Assenta os props no RELEVO real do tile embaixo deles.
 *
 * O editor grava o `y` do prop no topo do NÍVEL da célula, que era a única
 * altura que existia. Agora o chão segue a geometria da peça (tileHeight.ts):
 * a faixa da estrada é escavada e a rampa é inclinada, então uma árvore posta
 * ali fica pairando ou enterrada — só que agora com o erro visível, porque o
 * personagem está no chão certo.
 *
 * O que é preservado: quem foi colocado propositalmente ACIMA do topo do nível
 * (plataforma) mantém a mesma distância do chão — o deslocamento é aplicado
 * sobre a altura nova, não substituído por ela.
 *
 * PONTE fica de fora: ela não se apoia no terreno embaixo dela, e sim nas duas
 * margens — assentá-la no leito do rio afundaria o tabuleiro na água.
 */
export function groundProps(map: GameMap, terrain: TerrainQuery): GameMap {
  const { width, height } = map.size;
  let mudou = false;
  const props: MapProp[] = map.props.map((p) => {
    if (isBridgeProp(p.assetId)) return p;
    const [x, y, z] = p.position;
    const { col, row } = worldToHex(x, z);
    if (col < 0 || col >= width || row < 0 || row >= height) return p;
    const topoDoNivel = levelToY(map.heightmap[cellIndex(map, col, row)] ?? 0);
    const alturaReal = terrain.getHeight(x, z);
    const novoY = alturaReal + (y - topoDoNivel);
    if (Math.abs(novoY - y) < 1e-4) return p;
    mudou = true;
    return { ...p, position: [x, novoY, z] as [number, number, number] };
  });
  return mudou ? { ...map, props } : map;
}
