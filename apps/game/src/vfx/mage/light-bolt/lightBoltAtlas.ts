import { registerAtlas } from "../../core/assets/manifest";

/**
 * Atlas REAL de Eletrocutar (2026-08-19-r, retomado após confirmar que não
 * há custo de performance relevante — mesmo `SpriteRenderer`/
 * `InstancedMesh` compartilhado que toda skill já usa, 1 textura pequena
 * carregada 1 vez, nenhum draw call novo). PRIMEIRA skill do projeto a
 * usar um atlas de verdade — o mecanismo (`core/assets/manifest.ts:
 * registerAtlas`, `SpriteRenderer`/`animation.frames`/`frameToUv`) já
 * existia pronto desde a Fase 5, só nunca tinha um asset real registrado
 * (invariante leia1.txt: "nenhum atlas fictício é criado", documentado em
 * `manifest.ts`).
 *
 * `lightning-sheet.png` (384×64, `public/assets/skill_effects/mage/
 * light_bolt/`) tem 5 raios DISTINTOS lado a lado, cada um numa célula de
 * 64×64px (`lightning-sheet.json`, medido a partir do canal alfa da
 * imagem — 5 clusters de pixel opaco espaçados uniformemente a cada 64px).
 * O driver (`lightBoltMultiHit.ts`) sorteia qual frame (`bolt0`..`bolt4`)
 * usar em CADA hit — a "distorção a cada vez que bate" vem da arte de
 * verdade, não de geometria procedural.
 */
export const LIGHT_BOLT_ATLAS_KEY = "light_bolt_lightning";
export const LIGHT_BOLT_FRAME_NAMES = ["bolt0", "bolt1", "bolt2", "bolt3", "bolt4"] as const;

registerAtlas(LIGHT_BOLT_ATLAS_KEY, {
  metadataUrl: "/assets/skill_effects/mage/light_bolt/lightning-sheet.json",
  imageUrl: "/assets/skill_effects/mage/light_bolt/lightning-sheet.png",
});
