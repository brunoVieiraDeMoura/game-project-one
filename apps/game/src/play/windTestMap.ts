import { createBlankMap, type GameMap, type MapProp } from "@ragnarok/map-format";
import { propDefaultScale } from "../props/registry";

/**
 * Mapa sintético só para medir o custo do vento (seção 8 do pedido de
 * auditoria) — usado por `PlayView` quando `?map=windtest`, mesmo mecanismo
 * de mapa local que já existia para `?map=hexdemo` (`hex/hexPrefab.ts`).
 *
 * `terrainMode: "smooth"` de propósito: é o único modo em que `PlayView` NÃO
 * aplica o corte por distância (`culled = terrainMode !== "smooth"`), então
 * TODO prop do array desenha todo quadro — é o cenário certo pra medir o
 * custo bruto por planta, sem o culling escondendo parte da conta. Mapas de
 * verdade (`square`, vindos do rAthena) continuam cortados por distância como
 * sempre — este arquivo não muda nada lá.
 */

/** 3 tipos de grama, do catálogo Forest (`props/forest-catalog.json`) —
 * escolhidos por radius crescente (tufo pequeno → touceira grande), e cada
 * um já tem um perfil de vento diferente em `props/wind.ts:SPECIES_OVERRIDE`. */
const GRASS_IDS = ["grass_2_a", "grass_1_a", "grass_1_d"];
/** 3 tipos de árvore, do menor porte ao de copa mais larga (mesma lógica) */
const TREE_IDS = ["tree_2_a", "tree_1_a", "tree_1_c"];

export type WindTestStage = "low" | "medium" | "high" | "extreme";

/** contagem de props por estágio do teste de estresse (seção 11 do pedido) */
export const STAGE_COUNTS: Record<WindTestStage, number> = {
  low: 60,
  medium: 500,
  high: 2000,
  extreme: 6000,
};

export interface WindTestOptions {
  /** acrescenta uma 6ª área, bem mais densa que "alta densidade" — teste de
   * estresse artificial (seção 11), não faz parte do cenário de gameplay */
  extreme?: boolean;
  /** em vez do cenário de 5 áreas, gera UM campo uniforme no tamanho do
   * estágio pedido — números limpos e comparáveis para o teste A/B */
  stage?: WindTestStage;
}

export function buildWindTestMap(opts: WindTestOptions = {}): GameMap {
  const map = createBlankMap("windtest", "Teste de vento", 400, 400, 2);
  map.terrainMode = "smooth";

  const props: MapProp[] = [];
  // LCG determinístico (mesmo padrão de `play/demoProps.ts`) — o cenário é
  // sempre igual entre recarregamentos, condição do teste A/B (seção 10)
  let seed = 90210;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  function area(label: string, cx: number, cz: number, raio: number, count: number, grassRatio: number) {
    for (let i = 0; i < count; i++) {
      const ang = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * raio; // amostragem uniforme no disco, não só no raio
      const wx = cx + Math.cos(ang) * r;
      const wz = cz + Math.sin(ang) * r;
      const ids = rnd() < grassRatio ? GRASS_IDS : TREE_IDS;
      const assetId = ids[Math.floor(rnd() * ids.length)]!;
      const escala = propDefaultScale(assetId) * (0.85 + rnd() * 0.3);
      props.push({
        id: `wind-${label}-${props.length}`,
        assetId,
        position: [wx, 0, wz],
        rotation: [0, rnd() * Math.PI * 2, 0],
        scale: [escala, escala, escala],
        colliderType: "none",
      });
    }
  }

  if (opts.stage) {
    // campo único, centrado no spawn — LOW/MEDIUM/HIGH/EXTREME (seção 11)
    area(opts.stage, 400, 400, 70, STAGE_COUNTS[opts.stage], 0.6);
  } else {
    // as 5 áreas do cenário de comparação visual/gameplay (seção 8)
    area("baixa-densidade", 480, 400, 25, 60, 0.75);
    area("media-densidade", 580, 400, 35, 400, 0.6);
    area("alta-densidade", 400, 520, 45, 1400, 0.55);
    area("mistura", 300, 400, 35, 500, 0.5);
    area("grande-concentracao", 400, 280, 55, 3000, 0.65);
    if (opts.extreme) area("extreme", 600, 600, 60, 6000, 0.6);
  }

  map.props = props;
  return map;
}
