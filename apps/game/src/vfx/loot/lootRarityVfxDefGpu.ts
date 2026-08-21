import { defineVfx } from "../core/registry";
import type { VfxDefinition, VfxLayer } from "../core/types";
import type { LootRarityTier } from "./lootRarityTiers";

/**
 * As 6 auras de raridade de drop (pedido 2026-08-21) — mesma família visual
 * (glow + partículas subindo + coluna + disco no chão), progressão real de
 * intensidade/complexidade por tier, nunca só troca de cor no mesmo efeito
 * (regra explícita do pedido). Composição só com os 4 renderers que já
 * existem (`sprite`/`particle`/`ring`/`beam`) e só com campos de `payload`
 * que os renderers já leem — nenhum renderer/primitiva nova
 * (`skill-vfx-authoring`: "reusar a infraestrutura antes de inventar campo
 * novo").
 *
 * PERSISTENTE (`lifetimeMs` ausente): dura até `vfxManager.stop()` explícito
 * quando o item some do chão (pego ou expirou), dirigido por
 * `LootRarityAura.tsx`, nunca por timer local — mesmo padrão de
 * `freezeBodyVfxDefGpu.tsx`.
 *
 * `anchor:"cell"` com posição explícita (`VfxSpawnOptions.position`) — item
 * caído não é uma entidade do `worldStore`, então `anchor:"entity"` não
 * resolveria nada; a posição é fixa no spawn (item nunca se move), então
 * "cell" (que nunca re-resolve por quadro) é a âncora certa.
 *
 * Tiers COMUM/INCOMUM não ganham `ring` de propósito (regra de performance
 * do skill: `RingRenderer.onInstanceCreate` amostra 81 pontos de terreno —
 * pago 1x por drop persistente é aceitável para os tiers raros, mas a
 * imensa maioria dos drops de um campo é COMUM/INCOMUM, então manter esses
 * dois tiers baratos de verdade é o que mantém o custo agregado baixo).
 */

const COLOR = {
  common: "#d9dee6",
  uncommon: "#4ade80",
  rare: "#60a5fa",
  epic: "#b06bfa",
  legendary: "#f8c542",
  legendaryCore: "#fff4c2",
  mythic: "#ff5a36",
  mythicCore: "#fff1e0",
  mythicSpark: "#ffdd88",
} as const;

/** Tamanho geral das 6 auras (pedido do usuário 2026-08-21, teste in-game
 * ao vivo: "aumenta 2x o tamanho do vfx do drop") — multiplica TODA
 * dimensão espacial (escala/raio/altura/largura/offset), nunca contagem
 * de partícula nem cor/opacidade, que não são "tamanho". */
const SIZE_MULT = 2;

function glowLayer(color: string, opacity: number, scale: number, yOffset = 0.35): VfxLayer {
  // `yOffset` NÃO multiplica por SIZE_MULT de propósito (bug real, achado no
  // teste ao vivo 2026-08-21: dobrar a ALTURA do centro do brilho junto com
  // o tamanho fazia o blob flutuar bem acima do ícone do item — que não
  // cresce, fica sempre em `size*0.6` em `GroundItems.tsx`). Só a
  // EXTENSÃO (escala) dobra; a ÂNCORA vertical fica perto da altura real do
  // ícone, então o brilho maior continua centrado NO item, não flutuando
  // acima dele.
  return { renderer: "sprite", scale: { base: scale * SIZE_MULT }, offset: [0, yOffset - 0.2, 0], params: { color, opacity } };
}

function motesLayer(color: string, count: number, radius: number, heightMax: number, scale: number): VfxLayer {
  return {
    renderer: "particle",
    scale: { base: scale * SIZE_MULT },
    params: { particleCount: count, radius: radius * SIZE_MULT, heightMin: 0.1, heightMax: heightMax * SIZE_MULT, color },
  };
}

/**
 * Coluna oficial (decisão do usuário 2026-08-21, validada no preview
 * `vfx/loot` antes de portar): fio FINO, não pilar largo — width bem menor
 * que altura — com pulsação lenta ("elétrico", `payload.idleFlicker`,
 * suporte novo em `BeamRenderer.ts` só pra isto, mesmo envelope que
 * `SpriteRenderer` já usava). Frequência baixa de propósito (pedido
 * explícito "bem mais lento" durante a exploração) — não é o flicker
 * rápido em degraus do preview CSS (isso pediria uma curva de easing que
 * `idleFlicker.ts` não tem, e nenhum outro `beam` do jogo precisa dela
 * ainda; senoide lenta já lê como "elétrico" nesta velocidade).
 */
function thinLineLayer(color: string, width: number, height: number): VfxLayer {
  return {
    renderer: "beam",
    params: {
      width: width * SIZE_MULT,
      height: height * SIZE_MULT,
      color,
      idleFlicker: true,
      idleFlickerHz1: 0.35,
      idleFlickerHz2: 0.55,
      idleFlickerOpacityAmp: 0.35,
      idleFlickerScaleAmp: 0.12,
    },
  };
}

/** ponto branco-quente na METADE da altura do fio — `BeamRenderer` não tem
 * gradiente de cor ao longo do comprimento (só fade nas pontas, uniforme
 * no shader compartilhado com Thunder Storm/Light Bolt/Frost Diver — não
 * mexer nisso por um tier), então o "meio mais brilhante" do preview vira
 * um `sprite` pequeno sobreposto no meio do fio em vez de shader novo. */
function lineCoreLayer(color: string, height: number, scale: number): VfxLayer {
  return { renderer: "sprite", scale: { base: scale * SIZE_MULT }, offset: [0, height * SIZE_MULT * 0.5, 0], params: { color, opacity: 0.85 } };
}

function groundDiscLayer(color: string, radius: number): VfxLayer {
  return { renderer: "ring", params: { radius: radius * SIZE_MULT, mode: "disc", color } };
}

const TIER_LAYERS: Record<LootRarityTier, VfxLayer[]> = {
  // Comum — brilho curto e discreto, sem partícula/coluna/disco.
  common: [glowLayer(COLOR.common, 0.22, 0.42, 0.3)],

  // Incomum — brilho maior + poucas partículas subindo devagar.
  uncommon: [glowLayer(COLOR.uncommon, 0.38, 0.62, 0.35), motesLayer(COLOR.uncommon, 6, 0.35, 0.55, 0.12)],

  // Raro — já imediatamente perceptível: brilho forte + mais partículas +
  // 1º fio vertical de energia.
  rare: [
    glowLayer(COLOR.rare, 0.5, 0.8, 0.4),
    motesLayer(COLOR.rare, 10, 0.5, 0.9, 0.14),
    thinLineLayer(COLOR.rare, 0.1, 1.6),
    lineCoreLayer(COLOR.rare, 1.6, 0.12),
  ],

  // Épico — fio mais alto/aceso + disco de energia no chão.
  epic: [
    glowLayer(COLOR.epic, 0.58, 1.0, 0.45),
    motesLayer(COLOR.epic, 16, 0.65, 1.3, 0.16),
    thinLineLayer(COLOR.epic, 0.13, 2.2),
    lineCoreLayer(COLOR.epic, 2.2, 0.14),
    groundDiscLayer(COLOR.epic, 0.45),
  ],

  // Lendário — núcleo brilhante mais brilho pulsante, faíscas separadas das
  // partículas normais, fio mais alto, disco maior.
  legendary: [
    { ...glowLayer(COLOR.legendary, 0.68, 1.25, 0.5), params: { color: COLOR.legendary, opacity: 0.68, idleFlicker: true, idleFlickerOpacityAmp: 0.22, idleFlickerScaleAmp: 0.1 } },
    glowLayer(COLOR.legendaryCore, 0.9, 0.5, 0.5),
    motesLayer(COLOR.legendary, 22, 0.8, 1.8, 0.18),
    motesLayer(COLOR.legendaryCore, 6, 0.6, 1.2, 0.1),
    thinLineLayer(COLOR.legendary, 0.16, 2.8),
    lineCoreLayer(COLOR.legendaryCore, 2.8, 0.16),
    groundDiscLayer(COLOR.legendary, 0.55),
  ],

  // Mítico — o mais chamativo: núcleo branco-quente, brilho pulsante mais
  // intenso, partículas e faíscas abundantes, disco maior. UM fio só, mais
  // alto/aceso que o lendário (decisão do usuário: nunca 2 colunas — 1 fio
  // por item, em TODOS os tiers, sem exceção pro mítico).
  mythic: [
    { ...glowLayer(COLOR.mythic, 0.8, 1.6, 0.55), params: { color: COLOR.mythic, opacity: 0.8, idleFlicker: true, idleFlickerOpacityAmp: 0.3, idleFlickerScaleAmp: 0.14 } },
    glowLayer(COLOR.mythicCore, 0.95, 0.7, 0.55),
    motesLayer(COLOR.mythic, 28, 1.0, 2.4, 0.22),
    motesLayer(COLOR.mythicSpark, 10, 0.7, 1.6, 0.13),
    thinLineLayer(COLOR.mythic, 0.2, 3.6),
    lineCoreLayer(COLOR.mythicCore, 3.6, 0.18),
    groundDiscLayer(COLOR.mythic, 0.7),
  ],
};

const TIER_VFX_ID: Record<LootRarityTier, string> = {
  common: "loot_rarity_common",
  uncommon: "loot_rarity_uncommon",
  rare: "loot_rarity_rare",
  epic: "loot_rarity_epic",
  legendary: "loot_rarity_legendary",
  mythic: "loot_rarity_mythic",
};

export function lootRarityVfxId(tier: LootRarityTier): string {
  return TIER_VFX_ID[tier];
}

for (const tier of Object.keys(TIER_LAYERS) as LootRarityTier[]) {
  const def: VfxDefinition = {
    id: TIER_VFX_ID[tier],
    renderer: "sprite",
    anchor: "cell",
    layers: TIER_LAYERS[tier],
  };
  defineVfx(def);
}
