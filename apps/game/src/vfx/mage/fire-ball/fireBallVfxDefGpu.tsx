import type { VfxDefinition } from "../../core/types";

/**
 * Fire Ball em GPU (Fase 5, rodada "reestruturar VFX pra escala", leia1.txt
 * itens 4-5) — PROTÓTIPO, não substitui `fireBallVfxDef.tsx` (a versão DOM
 * continua sendo a definição real registrada por padrão; troca de renderer
 * é via `fireBallRenderMode.ts`, nunca automática). Composição de
 * primitivas GENÉRICAS já existentes (`particle`/`sprite`/`ring`/`trail`) —
 * zero `if FIRE_BALL` em qualquer renderer, zero mudança de dano/alvo/
 * timing lógico/rede (só a receita de DESENHO).
 *
 * Não tenta reproduzir os ~118 elementos DOM da versão original 1:1 (item
 * 5: "preserve a linguagem visual, não a implementação"). Reproduz:
 *   - projétil + glow: 1 `sprite` (bola brilhante voando caster→alvo via
 *     `payload.flightMs`, mesmo helper genérico de `flightOffset.ts` que
 *     Sprite/Particle/Trail já leem);
 *   - rastro: 1 `trail` (mesma curva de voo, sem nenhum `<Html>`/segmento
 *     DOM — era 14 ecos com `<svg>` cada, agora 10 slots de UM
 *     `InstancedMesh`);
 *   - embers/sparks: 1 `particle` (voando junto com a bola, mesmo
 *     `payload.flightMs`);
 *   - impacto/shockwave: 1 `ring` (disco no alvo, `mode:"disc"`).
 *
 * Cast (órbita de partículas antes do disparo): embers+sparks+chamas viram
 * 1 `particle` (a MESMA distribuição radial que o Oráculo/Fire Wall já
 * usam pra decoração ao redor do caster) + 1 `sprite` central pro glow.
 */

const FIREBALL_FLIGHT_MS = 480;
const IMPACT_FRACTION = 0.93;
const IMPACT_AT_MS = FIREBALL_FLIGHT_MS * IMPACT_FRACTION;
const IMPACT_TAIL_MS = 650;
const ARRIVE_Y = 1.0;

export const FIREBALL_CAST_GPU_DEF: VfxDefinition = {
  id: "fireball_cast",
  renderer: "particle", // camada top-level = layer 0, mesma regra de `layersFor()`
  anchor: "caster-tip",
  scale: { base: 0.16 },
  layers: [
    { renderer: "particle", scale: { base: 0.3 }, params: { particleCount: 16, radius: 0.9, color: "#ff9a3d" } },
    { renderer: "sprite", scale: { base: 0.5 }, params: { color: "#ffcf80", opacity: 0.85 } },
  ],
};

export const FIREBALL_IMPACT_GPU_DEF: VfxDefinition = {
  id: "fireball_impact",
  renderer: "sprite",
  anchor: "caster-to-target",
  scale: { base: 0.55 },
  lifetimeMs: IMPACT_AT_MS + IMPACT_TAIL_MS,
  // mesmo mecanismo genérico de Soul Strike/Frost Diver/Stone Curse —
  // congela na chegada, nunca segue o alvo pelo resto do IMPACT_TAIL_MS
  // (auditoria 2026-08-18).
  freezeAnchorAfterMs: FIREBALL_FLIGHT_MS,
  layers: [
    // projétil + glow (2 sprites levemente sobrepostos, um maior/mais
    // translúcido atrás do núcleo — mesmo truque visual de "glow atrás do
    // core" que a arte DOM já fazia com elementos separados).
    { renderer: "sprite", scale: { base: 0.85 }, params: { color: "#ff9a3d", opacity: 0.45, flightMs: FIREBALL_FLIGHT_MS, arriveY: ARRIVE_Y } },
    { renderer: "sprite", scale: { base: 0.4 }, params: { color: "#fff2c2", opacity: 1, flightMs: FIREBALL_FLIGHT_MS, arriveY: ARRIVE_Y } },
    { renderer: "trail", scale: { base: 0.3 }, params: { color: "#ff9a3d", trailLength: 10, flightMs: FIREBALL_FLIGHT_MS, arriveY: ARRIVE_Y } },
    { renderer: "particle", scale: { base: 0.12 }, params: { particleCount: 14, radius: 0.5, color: "#ffb35c", flightMs: FIREBALL_FLIGHT_MS, arriveY: ARRIVE_Y } },
    // shockwave — fica no ALVO (posição fixa no nascimento, `ring` nunca
    // segue voo); presente durante o voo inteiro por simplicidade (ver
    // docblock — pulsar continuamente pelos ~1.1s de vida é uma aproximação
    // aceita, não uma tentativa de cronometrar o instante exato do impacto).
    // `radius` de RingRenderer é MULTIPLICADO por `world.cellSize` (feito
    // pra decal de área tipo Fire Wall) — 0.18 aqui é só um flourish visual
    // pequeno no alvo, não uma AoE de verdade.
    { renderer: "ring", params: { radius: 0.18, mode: "disc", color: "#ff9a3d" } },
  ],
};
