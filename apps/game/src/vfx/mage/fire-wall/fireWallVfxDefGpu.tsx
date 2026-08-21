import type { VfxDefinition, VfxLayer } from "../../core/types";
import type { VfxQualityTier } from "../../vfxQualityStore";

/**
 * Fire Wall em GPU — reconstrução visual (pedido "parede de fogo vivo",
 * substitui o protótipo original desta rodada: 2 sprites+embers fixos, sem
 * tier, sem brilho de chão, sem reação no alvo). `fireWallVfxDef.tsx` (DOM
 * real, produção) continua INTOCADA; `fireWallRenderMode.ts` troca a MESMA
 * técnica de sempre (`defineVfx` registra OU SUBSTITUI os ids "fire_wall"/
 * "fire_wall_impact").
 *
 * ## 1 célula → N instâncias, de graça
 *
 * Cada célula da parede é sua PRÓPRIA unidade no servidor (`skill:ground`
 * manda uma por célula, `migratedVfxBridge.ts` chama `vfxManager.play(
 * "fire_wall", ...)` uma vez por evento) — `SpriteRenderer`/`ParticleRenderer`
 * já compartilham UM `InstancedMesh` entre todas as instâncias do mesmo id.
 * Não existe "FireWallGroup" pra construir: o Core JÁ é o mecanismo de
 * agrupamento. `fireWallCellGpuDef(tier)` é a definição ÚNICA da célula;
 * 3 ou 5 replicações reais (decididas pelo servidor, layout reto ou
 * diagonal) nascem como 3 ou 5 chamadas de `play()` independentes, cada uma
 * na posição REAL que o servidor mandou (`anchor:"cell"`) — nunca um
 * espaçamento inventado no cliente.
 *
 * ## Fogo vivo, não um sprite escalando
 *
 * `payload.idleFlicker:true` (`core/renderers/idleFlicker.ts`) em cada
 * camada `sprite` — duas senoides somadas, fase seedada por
 * `instance.instanceId` (mesmo truque que `ParticleRenderer` já usa pros
 * embers) fazem cada célula subir/diminuir/inclinar levemente fora de
 * sincronia com as vizinhas, sem depender de duração conhecida (Fire Wall
 * vive até `skill:ground-gone`, `expiresAt` fica `null` no Core —
 * `castChargeEnvelope` não serviria aqui, ver docblock do próprio arquivo
 * novo). Cada camada tem sua PRÓPRIA `idleFlickerHz1/Hz2` — não pulsam em
 * uníssono, leem como fogo respirando de verdade.
 *
 * ## Forma de chama de verdade, não discos empilhados — rodada
 * "muito circular"/"tem que parecer mais com uma chama"/"altura 2x maior"
 *
 * A versão anterior empilhava 2-3 DISCOS coloridos (base grande embaixo,
 * núcleo pequeno em cima) — visualmente lia como "3 bolhas soltas", não uma
 * chama (o próprio pedido: "ficou desorganizada"). `payload.flameShape:true`
 * (`instancedBillboardBase.ts`, novo — modo opt-in do placeholder
 * procedural, zero custo/mudança pra qualquer skill que não passe o campo)
 * substitui o disco radial por uma forma calculada em `vUv.y` (0=base do
 * quad, 1=ponta): raio largo embaixo, afinando pra cima (`radiusAtY`) — UMA
 * única silhueta de língua de fogo, não vários círculos concêntricos.
 *
 * O gradiente de cor do pedido (vermelho escuro na BASE → laranja subindo →
 * amarelo na PONTA — a parada branca inicial foi removida, pedido "tira a
 * parte branca de baixo") está embutido no MESMO shader, também em função
 * de `vUv.y` — não são mais 3 camadas de cor FLAT, é 1 rampa contínua
 * dentro de cada sprite.
 *
 * `payload.noiseAmt` (junto com `flameShape`) pede o pedido "noise pra
 * balançar/crepitar": ruído 2D barato (hash+bilinear, sem textura),
 * DUAS frequências somadas — uma lenta perturbando a posição/raio (a chama
 * "respirando"), uma rápida perturbando só a borda (a chama "crepitando") —
 * desfasado por `aSeed` (`instance.instanceId`) pra cada célula nunca
 * crepitar em sincronia com a vizinha.
 *
 * UMA camada `flameShape` por célula (a língua principal) — uma 2ª língua
 * "accent" menor foi tentada e removida (pedido: "remove a duplicata do
 * efeito menor atrás", lia como um clone fantasma atrás da chama, não como
 * detalhe). Altura da língua (offset+stretch) dobrada em relação à primeira
 * versão desta rodada (topo ~2,9 unidades vs. ~1,5 do protótipo original) —
 * pedido explícito "altura 2x maior".
 *
 * ## Base: o efeito antigo (discos empilhados) voltou, como PÉ da chama
 *
 * Pedido seguinte: "aquele efeito antigo inteiro antes de eu pedir pra
 * aumentar 2x, deixa ele por baixo desse fogo atual, como se fosse a base
 * dele". `buildFireWallOldDiscBaseLayers` reconstrói BYTE A BYTE a
 * composição de antes do redesenho "muito circular" (base/mid/núcleo REDONDOS,
 * mesmas cores/escalas/offsets/`idleFlicker` de então: outer 1.7@0.65,
 * mid 1.1@0.55 só MED/HIGH, núcleo 0.7@0.45) — o mesmo visual "bolha
 * redonda" que motivou o redesenho, só que agora usado DE PROPÓSITO como
 * volume baixo/arredondado no PÉ, nunca mais como a chama inteira. Entra
 * ANTES da língua `flameShape` no array de `layers[]` (nasce "por baixo"),
 * a língua alta continua exatamente como estava.
 *
 * ## Sem brilho de chão (`ring`) — testado ao vivo, descartado de novo
 *
 * A rodada anterior já tinha testado e descartado um `ring` de chão (raio
 * grande o bastante pra ler como "poça de brilho" cobria a chama —
 * `ring`/`sprite` são `Mesh`/`InstancedMesh` SEPARADOS, ambos com
 * `depthTest:false` por padrão, ordenados por distância aproximada da
 * câmera). Esta rodada tentou o mesmo fix que `ghost-dome/
 * ghostDomeVfxDefGpu.tsx` usa (`payload.depthTest:true` + raio pequeno) —
 * checado ao vivo em `/vfx-bench` (screenshot real, não suposição): mesmo
 * pequeno e com profundidade real, o disco ainda dominava a leitura visual
 * como "um círculo vermelho" em vez de "brilho no pé da chama" (sem
 * textura/atlas real, o placeholder procedural do `ring` é um disco com
 * borda acesa — `RingRenderer.ts` `uMode>0.5`, sem forma de "poça" nenhuma
 * hoje). Removido — mantém a decisão original do arquivo (sem `ring` nesta
 * skill), agora confirmada de novo com evidência visual, não só teoria.
 *
 * ## Impacto no alvo — reage a um evento que já existe
 *
 * `useWorldEvents.ts: onSkillCast` já chama `vfxStore.spawn({kind:"impact",
 * skillId, gid: p.targetGid, ...})` pra QUALQUER `skill:cast`, genérico —
 * inclusive os ticks de Fire Wall (`skill.cpp: UNT_FIREWALL`, mesmo
 * `skill_attack`/pacote 0x114 de Cold Bolt). `fireWallImpactGpuDef` só
 * precisa existir e ser vinculada (`fireWallRenderMode.ts:
 * bindSkillVfx("MG_FIREWALL","impact",...)`) — nenhum listener novo, nenhum
 * polling por quadro. `coalesce:{by:"target",windowMs:400}` (MESMO valor já
 * tunado de Thunder Storm, outra AoE de tick — `skill_db.yml:
 * MG_FIREWALL.Unit.Interval:20` + `SKILLUNITTIMER_INTERVAL:100` do rAthena
 * significam até 5 `skill_attack` por 100ms parado no fogo; sem coalescer
 * isso seria um flash por tick) evita o spam, sem inventar timing novo.
 *
 * ## Sem rotação de parede
 *
 * O servidor nunca manda orientação da parede, só as posições REAIS das
 * células — e a chama é um billboard camera-facing com gradiente radial
 * (sem direção própria), então não existe o que rotacionar por "parede
 * horizontal vs vertical". As posições das células já bastam pra formar a
 * faixa contínua.
 */
export type FireWallGpuTier = VfxQualityTier;

// gradiente de cor real vive DENTRO do shader (`instancedBillboardBase.ts`,
// modo `flameShape`) — esta cor só tinge por CIMA (`vColor`), não substitui
// a rampa. Branco = sem tingir (rampa pura).
const FLAME_TINT = "#ffffff";
// cores do efeito ANTIGO (discos empilhados), trazidas de volta como base —
// mesmos valores de antes do redesenho "muito circular".
const OLD_OUTER_COLOR = "#ff8a2e";
const OLD_MID_COLOR = "#ff5f1a";
const OLD_CORE_COLOR = "#fff3c4";
const EMBER_COLOR = "#ffb347";
const IMPACT_FLASH_COLOR = "#fff2c2";
const IMPACT_SPARK_COLOR = "#ffb35c";

interface FireWallCellTierSpec {
  emberCount: number;
  /** amplitude de "respiração" (escala/opacidade) — sobe com o tier. */
  scaleAmp: number;
  opacityAmp: number;
  /** leve inclinação (radianos) — só entra em MED/HIGH, "vivo" mas sutil. */
  rotationAmp: number;
  /** intensidade do ruído (`payload.noiseAmt`) — LOW ainda balança/crepita,
   * só menos, nunca "chama lisa" (identidade do pedido, não cortada). */
  noiseAmt: number;
  /** camada MID do disco antigo (base do pé) — MED/HIGH só, mesmo corte de
   * tier de quando essa composição era a chama inteira. */
  hasOldMidLayer: boolean;
}

const CELL_TIER_SPECS: Record<FireWallGpuTier, FireWallCellTierSpec> = {
  low: { emberCount: 6, scaleAmp: 0.05, opacityAmp: 0.06, rotationAmp: 0.02, noiseAmt: 0.7, hasOldMidLayer: false },
  medium: { emberCount: 12, scaleAmp: 0.07, opacityAmp: 0.09, rotationAmp: 0.035, noiseAmt: 1.0, hasOldMidLayer: true },
  high: { emberCount: 18, scaleAmp: 0.08, opacityAmp: 0.11, rotationAmp: 0.045, noiseAmt: 1.2, hasOldMidLayer: true },
};

/** pedido "ocupar mais o espaço da célula, sem mudar a estética" — largura
 * (footprint no chão) sobe `WIDTH_MULT`× em TODA camada de chama (nova e
 * antiga), mas a ALTURA de cada uma fica exatamente como já estava
 * aprovada: `scale` (largura) e `stretchY` (compensação) mudam JUNTOS de
 * forma que `scale*stretchY` (a altura real) não muda — só o `scale`
 * sozinho (largura) cresce. Mesma identidade/proporção/cor, só mais largo. */
const WIDTH_MULT = 1.4;

/** altura total da língua (offset central + `stretchY`, quad de base
 * `MAIN_SCALE`) — pedido "altura 2x maior": topo em ~`MAIN_OFFSET_Y +
 * MAIN_SCALE*MAIN_STRETCH_Y/2` ≈ 2,9 unidades, o dobro do ~1,5 do
 * protótipo original desta rodada. `MAIN_OFFSET_Y` calculado pra a BASE do
 * quad (não o centro) ficar EXATAMENTE em y=0 (chão da célula) — pedido
 * seguinte "os 2 efeitos começarem na mesma base": `offsetY - scale*stretch/2 = 0`.
 * `MAIN_STRETCH_Y` dividido por `WIDTH_MULT` (compensação) — `MAIN_SCALE`
 * multiplicado por ele: altura final (`MAIN_SCALE*MAIN_STRETCH_Y`) idêntica
 * à de antes, só a largura cresce. */
const MAIN_SCALE = 1.05 * WIDTH_MULT;
const MAIN_STRETCH_Y = 2.7 / WIDTH_MULT;
const MAIN_OFFSET_Y = (MAIN_SCALE * MAIN_STRETCH_Y) / 2;

/** o efeito ANTIGO (discos redondos empilhados), agora ENCOLHIDO e
 * ANCORADO NO CHÃO (pedido "os 2 efeitos começarem na mesma base" + "tenta
 * mesclar bem suave") — as 3 escalas mantêm a MESMA proporção relativa de
 * antes (1.7:1.1:0.7 → aqui menores mas nas mesmas razões), e cada uma tem
 * `offset = altura/2` (a base do disco, não o centro, cai em y=0, IGUAL à
 * língua nova acima). Antes ficava alto o bastante (topo ~1,5) pra criar
 * uma 2ª silhueta competindo com o meio da língua — um degrau de brilho
 * visível onde a base antiga "acabava". Baixo e compacto (topo ~1,0) fica
 * inteiro dentro da região BASE (larga) da língua nova, então a mistura é
 * só brilho ADITIVO se somando — sem aresta/degrau visível. `WIDTH_MULT`
 * (mesmo `scale*stretchY` compensado da língua nova) alarga sem alterar a
 * altura já ajustada. */
function buildOldDiscBaseLayers(spec: FireWallCellTierSpec): VfxLayer[] {
  const outerHeight = 1.0;
  const midHeight = 0.65;
  const coreHeight = 0.4;
  const oldStretchY = 1 / WIDTH_MULT;
  const layers: VfxLayer[] = [
    {
      renderer: "sprite",
      scale: { base: outerHeight * WIDTH_MULT },
      offset: [0, outerHeight / 2, 0],
      params: {
        color: OLD_OUTER_COLOR,
        opacity: 0.8,
        stretchY: oldStretchY,
        idleFlicker: true,
        idleFlickerHz1: 2.0,
        idleFlickerHz2: 3.3,
        idleFlickerScaleAmp: spec.scaleAmp,
        idleFlickerOpacityAmp: spec.opacityAmp,
        idleFlickerRotationAmp: spec.rotationAmp,
      },
    },
  ];
  if (spec.hasOldMidLayer) {
    layers.push({
      renderer: "sprite",
      scale: { base: midHeight * WIDTH_MULT },
      offset: [0, midHeight / 2, 0],
      params: {
        color: OLD_MID_COLOR,
        opacity: 0.75,
        stretchY: oldStretchY,
        idleFlicker: true,
        idleFlickerHz1: 2.6,
        idleFlickerHz2: 4.1,
        idleFlickerScaleAmp: spec.scaleAmp * 0.8,
        idleFlickerOpacityAmp: spec.opacityAmp * 0.8,
      },
    });
  }
  layers.push({
    renderer: "sprite",
    scale: { base: coreHeight * WIDTH_MULT },
    offset: [0, coreHeight / 2, 0],
    params: {
      color: OLD_CORE_COLOR,
      opacity: 0.95,
      stretchY: oldStretchY,
      idleFlicker: true,
      idleFlickerHz1: 3.4,
      idleFlickerHz2: 5.2,
      idleFlickerScaleAmp: spec.scaleAmp * 0.5,
      idleFlickerOpacityAmp: spec.opacityAmp * 0.6,
    },
  });
  return layers;
}

function buildFireWallCellLayers(spec: FireWallCellTierSpec): VfxLayer[] {
  // base antiga PRIMEIRO no array — nasce "por baixo" da língua nova.
  const layers: VfxLayer[] = buildOldDiscBaseLayers(spec);

  // língua de fogo — ÚNICA camada de chama NOVA (a "accent" secundária foi
  // removida, lia como duplicata fantasma atrás da principal). Forma+
  // gradiente vêm do shader (`flameShape`); esta camada só decide tamanho/
  // posição/ruído.
  layers.push({
    renderer: "sprite",
    scale: { base: MAIN_SCALE },
    offset: [0, MAIN_OFFSET_Y, 0],
    params: {
      color: FLAME_TINT,
      opacity: 0.95,
      stretchY: MAIN_STRETCH_Y,
      flameShape: true,
      noiseAmt: spec.noiseAmt,
      idleFlicker: true,
      idleFlickerHz1: 1.6,
      idleFlickerHz2: 2.7,
      idleFlickerScaleAmp: spec.scaleAmp,
      idleFlickerOpacityAmp: spec.opacityAmp,
      idleFlickerRotationAmp: spec.rotationAmp,
    },
  });

  // brasas — sempre presentes; `ParticleRenderer` já seeda por
  // `instance.instanceId`, cada célula ganha distribuição própria de graça.
  // `heightMin/heightMax` acompanham a coluna nova (base~0.3 até ponta~2.8);
  // `radius` alargado por `WIDTH_MULT` junto com a chama, senão as brasas
  // ficariam apertadas mais estreitas que a língua nova.
  layers.push({
    renderer: "particle",
    scale: { base: 0.14 },
    params: { particleCount: spec.emberCount, radius: 0.28 * WIDTH_MULT, color: EMBER_COLOR, heightMin: 0.3, heightMax: 2.4 },
  });

  return layers;
}

export function fireWallCellGpuDef(tier: FireWallGpuTier): VfxDefinition {
  return {
    id: "fire_wall",
    renderer: "sprite",
    anchor: "cell",
    layers: buildFireWallCellLayers(CELL_TIER_SPECS[tier]),
  };
}

// ---------------------------------------------------------------- impacto

interface FireWallImpactTierSpec {
  sparkCount: number;
}

const IMPACT_TIER_SPECS: Record<FireWallGpuTier, FireWallImpactTierSpec> = {
  low: { sparkCount: 0 },
  medium: { sparkCount: 4 },
  high: { sparkCount: 8 },
};

const IMPACT_BURST_MS = 180;

/** flash pequeno relacionado ao fogo, SÓ quando o gameplay confirma o hit
 * (`useWorldEvents.ts: onSkillCast`, ver docblock do topo) — nunca um
 * segundo efeito grande, e nunca um por tick sem coalescer. */
function buildFireWallImpactLayers(spec: FireWallImpactTierSpec): VfxLayer[] {
  const layers: VfxLayer[] = [
    {
      renderer: "sprite",
      scale: { base: 0.55 },
      params: {
        color: IMPACT_FLASH_COLOR,
        opacity: 1,
        burstMs: IMPACT_BURST_MS,
        burstScaleFrom: 0.4,
        burstScaleTo: 1.6,
      },
    },
  ];
  if (spec.sparkCount > 0) {
    layers.push({
      renderer: "particle",
      scale: { base: 0.12 },
      params: {
        particleCount: spec.sparkCount,
        radius: 0.35,
        color: IMPACT_SPARK_COLOR,
        burstDelayBaseMs: 0,
        burstDelayMaxMs: 40,
        burstDurBaseMs: 220,
        burstDurJitterMs: 80,
      },
    });
  }
  return layers;
}

export function fireWallImpactGpuDef(tier: FireWallGpuTier): VfxDefinition {
  return {
    id: "fire_wall_impact",
    renderer: "sprite",
    anchor: "entity",
    freezeAnchorAfterMs: 0,
    lifetimeMs: IMPACT_BURST_MS + 120,
    coalesce: { by: "target", windowMs: 400 },
    layers: buildFireWallImpactLayers(IMPACT_TIER_SPECS[tier]),
  };
}
