/**
 * CSS de TODA arte DOM transitória (`renderer:"dom"`, ver invariante
 * leia1.txt) num módulo só — item 7 do pedido de leia1.txt: "o CSS legado
 * deve ser centralizado... não deve continuar espalhado em componentes
 * React individuais". Antes de migrar, cada skill injetava o PRÓPRIO
 * `<style>` (`useXStyles()`, um hook por componente); agora existe UM
 * `<style>` para o jogo inteiro, injetado uma vez por `DomRenderer`
 * (`vfx/core/renderers/DomRenderer.tsx`), nunca por skill.
 *
 * Cada bloco abaixo é o CSS de UMA skill migrada, movido byte a byte do
 * componente antigo (nomes de classe preservados — são a única coisa que
 * liga este arquivo ao JSX de `vfx/mage/<skill>/<skill>VfxDef.tsx`, que
 * nunca importa CSS diretamente, só usa `className` combinando com o que
 * está aqui). Adicionar uma skill nova ao Core: colar o CSS dela como mais
 * um bloco na constante `LEGACY_VFX_ART_CSS` abaixo — nunca um `<style>`
 * novo em lugar nenhum.
 */

/**
 * Correção real (Fase 5, investigação Fases J-N) — `display:none` no
 * ancestral de uma instância culled NÃO pausa `@keyframes ... infinite`
 * de descendentes; o navegador continua agendando/avaliando a animação
 * mesmo assim (medido: ~49ms/quadro extras em 30 instâncias culled, causa
 * isolada a UMA animação CSS `infinite`, ver `docs/claude-context/
 * 09-vfx-gpu-migration.md`). `DomRenderer.setActive()` liga esta classe no
 * wrapper de QUALQUER instância culled — `animation-play-state: paused`
 * preserva o progresso da animação (retoma de onde parou, não reinicia).
 * GENÉRICA de propósito: não é `.or-glimmer`, é `*` — qualquer arte DOM
 * futura com `@keyframes` ganha a mesma proteção sem precisar declarar
 * nada.
 */
const CORE_CSS = `
.vfx-dom-culled, .vfx-dom-culled * {
  animation-play-state: paused !important;
}
`;

/**
 * `TrailPrimitive` (Fase 5, Etapa Trail/Echo) — CSS ÚNICA compartilhada por
 * QUALQUER skill que use a primitive de rastro/eco (`vfx/core/primitives/
 * trailDom.tsx`). Antes existiam `.or-echo` (Oráculo) e `.fbi-echo` (Fire
 * Ball) — duas classes quase idênticas (mesma fórmula de opacidade/escala
 * por índice, mesmo `drop-shadow`, só cor/tamanho/traço diferentes)
 * duplicadas byte a byte. Os parâmetros que realmente variam por skill
 * (cor, tamanho, glow, espessura do traço) viram custom properties CSS
 * setadas por instância — a REGRA (como um rastro se comporta) fica UMA
 * vez só, o que muda é dado, não código.
 */
const TRAIL_PRIMITIVE_CSS = `
.vfx-trail-echo {
  position: absolute; left: 50%; top: 50%;
  width: calc(var(--tw, 40px) * var(--tscale, 1));
  height: calc(var(--th, 16px) * var(--tscale, 1));
  margin: calc(var(--th, 16px) * -0.5 * var(--tscale, 1)) 0 0 calc(var(--tw, 40px) * -0.5 * var(--tscale, 1));
  overflow: visible;
  opacity: calc(var(--op0, 0.9) - var(--echoi, 0) * var(--opstep, 0.055));
  transform: rotate(var(--srot, 0deg)) scale(calc(1 - var(--echoi, 0) * var(--scalestep, 0.045)));
  filter: drop-shadow(0 0 var(--glowpx, 3px) var(--glowcolor, rgba(255, 200, 80, 0.8)));
}
.vfx-trail-echo path {
  stroke: var(--strokecolor, #ffb23c);
  stroke-width: var(--strokew, 2.4);
  stroke-linecap: round;
}
`;

/** Cúpula Fantasma (MG_SAFETYWALL) — movido de
 * `vfx/mage/ghost-dome/GhostDomeCell.tsx` (arquivo removido na migração). */
const GHOST_DOME_CSS = `
.gd-wrap { position: relative; width: 0; height: 0; pointer-events: none; }
.gd-border {
  position: absolute; left: 50%; top: 50%;
  width: var(--cellpx); height: var(--cellpx);
  margin: calc(var(--cellpx) / -2) 0 0 calc(var(--cellpx) / -2);
  border-radius: 42%;
  border: 4px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 26px rgba(255, 255, 255, 0.75), inset 0 0 30px rgba(255, 255, 255, 0.45);
  animation: gdBorderPulse 1.6s ease-in-out infinite;
}
.gd-mist {
  position: absolute; left: 50%; top: 50%;
  width: calc(var(--cellpx) * 0.92); height: calc(var(--cellpx) * 0.92);
  margin: calc(var(--cellpx) * -0.46) 0 0 calc(var(--cellpx) * -0.46);
  border-radius: 42%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.1) 55%, rgba(255, 255, 255, 0) 78%);
  animation: gdMistPulse 2.4s ease-in-out infinite;
}
.gd-wisp {
  position: absolute; left: 50%; top: 50%;
  width: calc(var(--cellpx) * 0.85); height: 9px;
  margin: -4.5px 0 0 calc(var(--cellpx) * -0.425);
  opacity: 0;
  animation: gdWisp var(--wdur) ease-in-out var(--wdelay) infinite;
}
.gd-wisp::before {
  content: "";
  position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0) 8%, rgba(255, 255, 255, 0.95) 50%, rgba(255, 255, 255, 0) 92%, transparent 100%);
  filter: blur(2.5px);
  border-radius: 50%;
}
.gd-rise {
  position: absolute; left: 50%; top: 50%;
  width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff, rgba(255, 255, 255, 0) 75%);
  transform: rotate(var(--rangle)) translateX(calc(var(--cellpx) * 0.32));
  opacity: 0;
  animation: gdRise 2.6s ease-out var(--rdelay) infinite;
}
@keyframes gdBorderPulse { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }
@keyframes gdMistPulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
@keyframes gdWisp {
  0% { opacity: 0; transform: rotate(var(--wangle)) translateX(-55%); }
  18% { opacity: 0.95; }
  50% { opacity: 0.85; }
  82% { opacity: 0.95; }
  100% { opacity: 0; transform: rotate(var(--wangle)) translateX(55%); }
}
@keyframes gdRise {
  0% { opacity: 0; transform: rotate(var(--rangle)) translateX(calc(var(--cellpx) * 0.32)) translateY(0) scale(0.6); }
  20% { opacity: 0.85; }
  100% { opacity: 0; transform: rotate(var(--rangle)) translateX(calc(var(--cellpx) * 0.32)) translateY(-64px) scale(1); }
}
.gd-ghost {
  position: absolute; left: 50%; top: 50%; width: 34px; height: 30px; margin: -17px 0 0 -17px;
  filter: drop-shadow(0 0 9px rgba(255, 255, 255, 0.9));
}
.gd-ghost__body {
  position: absolute; inset: 0;
  clip-path: polygon(50% 2%, 82% 12%, 96% 38%, 90% 62%, 78% 76%, 66% 60%, 50% 82%, 34% 60%, 22% 76%, 10% 62%, 4% 38%, 18% 12%);
  background: radial-gradient(ellipse at 50% 35%, #ffffff 0%, #f2f2f8 40%, rgba(255, 255, 255, 0.5) 78%, rgba(255, 255, 255, 0) 100%);
  opacity: 0.92;
}
.gd-ghost__glow {
  position: absolute; left: 50%; top: 42%; width: 150%; height: 120%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0) 70%);
  filter: blur(2px);
}
`;

/** Parede de Fogo (MG_FIREWALL) — movido de
 * `vfx/mage/fire-wall/FireWallCell.tsx` (arquivo removido na migração). */
const FIRE_WALL_CSS = `
.fw-wrap { position: relative; width: 0; height: 0; pointer-events: none; }
.fw-glow {
  position: absolute; left: 50%; bottom: 0;
  width: 150px; height: 60px; margin-left: -75px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(255, 140, 40, 0.5), rgba(255, 90, 20, 0) 72%);
  filter: blur(3px);
  animation: fwGlowPulse 900ms ease-in-out infinite;
}
.fw-column {
  position: absolute; left: 50%; bottom: 0; width: 96px; height: 210px; margin-left: -48px;
  transform-origin: 50% 100%;
  animation: fwColumnSway 1.1s ease-in-out infinite;
}
.fw-column__core {
  position: absolute; inset: 0;
  clip-path: polygon(50% 0%, 66% 18%, 58% 38%, 78% 52%, 64% 68%, 80% 82%, 50% 100%, 20% 82%, 36% 68%, 22% 52%, 42% 38%, 34% 18%);
  background: linear-gradient(0deg, #ff3b0f 0%, #ff8a2e 42%, #ffce5c 72%, #fff3c4 100%);
  filter: drop-shadow(0 0 16px rgba(255, 110, 30, 0.85));
  animation: fwCoreFlicker 340ms ease-in-out infinite;
}
.fw-lick {
  position: absolute; bottom: 6px; width: 30px; height: 96px;
  clip-path: polygon(50% 0%, 78% 30%, 62% 50%, 84% 66%, 50% 100%, 16% 66%, 38% 50%, 22% 30%);
  background: linear-gradient(0deg, #ff5a1f 0%, #ff9d3a 55%, #ffe27a 100%);
  filter: drop-shadow(0 0 10px rgba(255, 110, 30, 0.75));
  transform-origin: 50% 100%;
  opacity: 0.9;
}
.fw-lick--a { left: 2px; animation: fwLickSway 780ms ease-in-out infinite; }
.fw-lick--b { left: 26px; height: 130px; animation: fwLickSway 620ms ease-in-out infinite 90ms; }
.fw-lick--c { right: 26px; left: auto; height: 118px; animation: fwLickSway 700ms ease-in-out infinite 160ms; }
.fw-lick--d { right: 2px; left: auto; animation: fwLickSway 860ms ease-in-out infinite 40ms; }
.fw-smoke {
  position: absolute; left: 50%; top: -10px; width: 44px; height: 60px; margin-left: -22px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(180, 180, 180, 0.28), rgba(180, 180, 180, 0) 75%);
  filter: blur(4px);
  animation: fwSmokeRise 2.2s ease-out infinite;
}
.fw-ember {
  position: absolute; left: 50%; bottom: 10px;
  width: calc(6px * var(--esize, 1)); height: calc(6px * var(--esize, 1));
  margin-left: calc(-3px * var(--esize, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #fff3c4, #ff8a3d 60%, transparent 78%);
  opacity: 0;
  animation: fwEmberRise var(--pdur) ease-out var(--pdelay) infinite;
}
@keyframes fwGlowPulse { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.12); opacity: 1; } }
@keyframes fwColumnSway {
  0%, 100% { transform: skewX(0deg) scaleY(1); }
  50% { transform: skewX(-2.5deg) scaleY(1.03); }
}
@keyframes fwCoreFlicker { 0%, 100% { transform: scale(1, 1); opacity: 0.96; } 50% { transform: scale(1.05, 0.97); opacity: 1; } }
@keyframes fwLickSway {
  0%, 100% { transform: rotate(-6deg) scale(1, 1); opacity: 0.85; }
  50% { transform: rotate(7deg) scale(1.08, 1.12); opacity: 1; }
}
@keyframes fwSmokeRise {
  0% { opacity: 0; transform: translateY(0) scale(0.7); }
  30% { opacity: 0.5; }
  100% { opacity: 0; transform: translateY(-70px) scale(1.4); }
}
@keyframes fwEmberRise {
  0% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius, 14px)) translateY(0) scale(0.7); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--angle)) translateX(calc(var(--radius, 14px) * 1.4)) translateY(-190px) scale(0.3); }
}
`;

/** Oráculo (MG_SIGHT) — movido de `vfx/mage/oracle/OracleBuff.tsx`
 * (arquivo removido na migração). */
const ORACLE_CSS = `
.or-skull {
  position: relative; width: 58px; height: 56px; margin: -28px 0 0 -29px; left: 50%; top: 50%;
  filter: drop-shadow(0 0 11px rgba(255, 90, 90, 0.9)) drop-shadow(0 0 26px rgba(220, 40, 50, 0.55));
}
.or-skull__glow {
  position: absolute; left: 50%; top: 42%; width: 170%; height: 140%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(255, 70, 70, 0.5), rgba(255, 70, 70, 0) 70%);
  filter: blur(3px);
}
.or-skull__cranium {
  position: absolute; left: 0; top: 0; width: 100%; height: 72%;
  border-radius: 50% 50% 45% 45%;
  background: radial-gradient(ellipse at 50% 32%, #fff0f0 0%, #ffabab 42%, #d43333 80%, rgba(150, 15, 25, 0.6) 100%);
  opacity: 0.95;
}
.or-skull__jaw {
  position: absolute; left: 22%; bottom: 0; width: 56%; height: 34%;
  clip-path: polygon(6% 0%, 94% 0%, 84% 55%, 68% 100%, 50% 82%, 32% 100%, 16% 55%);
  background: linear-gradient(180deg, #e56c6c 0%, #b52424 70%, rgba(120, 10, 20, 0.6) 100%);
  opacity: 0.92;
}
.or-skull__eye {
  position: absolute; top: 32%; width: 12px; height: 15px; border-radius: 50%;
  background: radial-gradient(circle, #300 0%, #700 70%, rgba(119, 0, 0, 0) 100%);
}
.or-skull__eye--l { left: 26%; }
.or-skull__eye--r { left: 60%; }
.or-skull__nose {
  position: absolute; left: 50%; top: 52%; width: 8px; height: 10px; margin-left: -4px;
  clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
  background: rgba(70, 0, 0, 0.8);
}
.or-glimmer {
  position: relative; left: 50%; top: 50%;
  width: 6px; height: 6px; margin: -3px 0 0 -3px;
  border-radius: 50%;
  background: radial-gradient(circle, #ffd4d4, #ff5050 55%, rgba(255, 60, 60, 0) 76%);
  opacity: 0;
  animation: orGlimmer var(--pdur) ease-in-out var(--pdelay) infinite;
}
@keyframes orGlimmer {
  0% { opacity: 0; transform: translateY(6px) scale(0.5); }
  25% { opacity: 0.85; transform: translateY(-4px) scale(1.1); }
  60% { opacity: 0.5; transform: translateY(-14px) scale(0.9); }
  100% { opacity: 0; transform: translateY(-26px) scale(0.6); }
}
`;

/** Fire Ball (MG_FIREBALL) — cast, movido de
 * `vfx/mage/fire-ball/FireBallCastFire.tsx` (arquivo removido). */
const FIRE_BALL_CAST_CSS = `
.fb-cast-fire { position: relative; width: 4px; height: 4px; pointer-events: none; }
.fb-cast-fire__glow {
  position: absolute; left: 50%; top: 50%; width: 138px; height: 138px;
  margin: -69px 0 0 -69px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 190, 70, calc(0.34 * var(--intensity, 0.55))), rgba(255, 90, 20, 0) 72%);
  animation: fbCastGlow 620ms ease-in-out infinite;
}
.fb-cast-fire__core {
  position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; margin: -13px 0 0 -13px;
  border-radius: 50%;
  background: radial-gradient(circle, #fffdf0 0%, #ffe27a 30%, #ff8a3d 60%, rgba(255, 90, 20, 0) 78%);
  animation: fbCastCore 480ms ease-in-out infinite;
  opacity: 0.9;
}
.fb-cast-fire__ember {
  position: absolute; left: 50%; top: 50%; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px;
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  background: linear-gradient(160deg, #fff3c4 0%, #ffb347 45%, #d1440b 100%);
  filter: drop-shadow(0 0 6px rgba(255, 140, 40, 0.9));
  opacity: 0;
  animation: fbCastOrbit var(--pdur) ease-in-out var(--pdelay) infinite;
}
.fb-cast-fire__spark {
  position: absolute; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: #fff3c4;
  box-shadow: 0 0 7px 2px rgba(255, 210, 120, 0.9);
  opacity: 0;
  animation: fbCastSpark var(--pdur) ease-in-out var(--pdelay) infinite;
}
.fb-cast-fire__flame {
  position: absolute; left: 50%; top: 50%; width: 19px; height: 24px; margin: -19px 0 0 -9.5px;
  clip-path: polygon(50% 0%, 80% 42%, 68% 62%, 92% 78%, 50% 100%, 8% 78%, 32% 62%, 20% 42%);
  background: linear-gradient(0deg, #ff5a1f 0%, #ff9d3a 55%, #ffe27a 100%);
  filter: drop-shadow(0 0 8px rgba(255, 110, 30, 0.85));
  opacity: 0;
  transform-origin: 50% 100%;
  animation: fbCastFlameOrbit var(--pdur) ease-in-out var(--pdelay) infinite;
}
.fb-cast-fire--release .fb-cast-fire__ember,
.fb-cast-fire--release .fb-cast-fire__spark,
.fb-cast-fire--release .fb-cast-fire__flame,
.fb-cast-fire--release .fb-cast-fire__core {
  animation: fbCastScatter 320ms ease-out forwards;
}
.fb-cast-fire__burst {
  position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; margin: -13px 0 0 -13px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff7d6 0%, #ffb347 40%, rgba(255, 90, 20, 0) 72%);
  opacity: 0;
}
.fb-cast-fire--release .fb-cast-fire__burst { animation: fbCastBurst 300ms ease-out forwards; }
.fb-cast-fire__forward {
  position: absolute; left: 50%; top: 50%; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff3c4, #ff8a3d 60%, transparent 75%);
  opacity: 0;
  transform: rotate(var(--fwangle, 0deg));
}
.fb-cast-fire--release .fb-cast-fire__forward { animation: fbCastForward 360ms ease-out forwards; }
@keyframes fbCastGlow {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(calc(1 + 0.2 * var(--intensity, 0.55))); }
}
@keyframes fbCastCore {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}
@keyframes fbCastOrbit {
  0% {
    opacity: 0;
    transform: rotate(var(--angle)) translateX(var(--radius)) rotate(calc(var(--angle) * -1)) translateY(0) scale(0.5);
  }
  18% { opacity: 1; }
  100% {
    opacity: 0.15;
    transform: rotate(calc(var(--angle) + 130deg)) translateX(var(--radius)) rotate(calc((var(--angle) + 130deg) * -1))
      translateY(calc(-1 * var(--rise))) scale(0.95);
  }
}
@keyframes fbCastSpark {
  0%, 100% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) scale(0.6); }
  8% { opacity: 1; transform: rotate(var(--angle)) translateX(var(--radius)) scale(1.3); }
  20% { opacity: 0; }
}
@keyframes fbCastFlameOrbit {
  0% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) rotate(calc(var(--angle) * -1)) scale(0.6, 0.6); }
  20% { opacity: 0.95; }
  50% { transform: rotate(calc(var(--angle) + 55deg)) translateX(var(--radius)) rotate(calc((var(--angle) + 55deg) * -1)) scale(1, 1.1); }
  100% { opacity: 0.2; transform: rotate(calc(var(--angle) + 110deg)) translateX(var(--radius)) rotate(calc((var(--angle) + 110deg) * -1)) scale(0.85, 0.9); }
}
@keyframes fbCastScatter {
  0% { opacity: 1; transform: rotate(var(--angle, 0deg)) translateX(var(--radius, 0px)) rotate(calc(var(--angle, 0deg) * -1)) scale(1); }
  100% {
    opacity: 0;
    transform: rotate(var(--angle, 0deg)) translateX(calc(var(--radius, 0px) * 3.4)) rotate(calc(var(--angle, 0deg) * -1)) scale(0.3);
  }
}
@keyframes fbCastBurst {
  0% { opacity: 0; transform: scale(0.3); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: scale(7.5); }
}
@keyframes fbCastForward {
  0% { opacity: 1; transform: rotate(var(--fwangle, 0deg)) translateY(0) scale(1); }
  100% { opacity: 0; transform: rotate(var(--fwangle, 0deg)) translateY(-76px) scale(0.4); }
}
`;

/** Fire Ball (MG_FIREBALL) — impacto, movido de
 * `vfx/mage/fire-ball/FireBallImpact.tsx` (arquivo removido). */
const FIRE_BALL_IMPACT_CSS = `
.fbi-ball { position: relative; width: 0; height: 0; pointer-events: none; }
.fbi-ball__glow {
  position: absolute; left: 50%; top: 50%;
  width: calc(300px * var(--tscale, 1)); height: calc(300px * var(--tscale, 1));
  margin: calc(-150px * var(--tscale, 1)) 0 0 calc(-150px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 200, 90, 0.55), rgba(255, 90, 20, 0) 72%);
  filter: blur(2px);
  animation: fbiGlowPulse 260ms ease-in-out infinite;
}
.fbi-ball__core {
  position: absolute; left: 50%; top: 50%;
  width: calc(92px * var(--tscale, 1)); height: calc(92px * var(--tscale, 1));
  margin: calc(-46px * var(--tscale, 1)) 0 0 calc(-46px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #fff6c8 30%, rgba(255, 246, 200, 0) 75%);
}
.fbi-ball__mid {
  position: absolute; left: 50%; top: 50%;
  width: calc(136px * var(--tscale, 1)); height: calc(136px * var(--tscale, 1));
  margin: calc(-68px * var(--tscale, 1)) 0 0 calc(-68px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 214, 120, 0.9) 0%, #ff9d3a 55%, rgba(255, 90, 20, 0.15) 82%);
  animation: fbiBallFlicker 180ms ease-in-out infinite;
}
.fbi-ball__rim {
  position: absolute; left: 50%; top: 50%;
  width: calc(168px * var(--tscale, 1)); height: calc(168px * var(--tscale, 1));
  margin: calc(-84px * var(--tscale, 1)) 0 0 calc(-84px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 90, 20, 0) 55%, rgba(214, 40, 10, 0.55) 78%, rgba(140, 20, 5, 0) 92%);
  filter: blur(1px);
}
.fbi-ball__tendril {
  position: absolute; left: 50%; top: 50%; width: 44px; height: 60px; margin: -52px 0 0 -22px;
  clip-path: polygon(50% 0%, 82% 44%, 66% 64%, 94% 82%, 50% 100%, 6% 82%, 34% 64%, 18% 44%);
  background: linear-gradient(0deg, #ff4d15 0%, #ff9d3a 55%, #ffe27a 100%);
  filter: drop-shadow(0 0 8px rgba(255, 110, 30, 0.85));
  transform-origin: 50% 100%;
  transform: rotate(var(--tangle)) translateY(calc(-60px * var(--tscale, 1))) rotate(calc(var(--tangle) * -1));
  animation: fbiTendril 420ms ease-in-out infinite;
  opacity: 0.9;
}
.fbi-ball__eject {
  position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff3c4, #ff8a3d 60%, transparent 78%);
  transform: rotate(var(--eangle));
  animation: fbiEject 480ms linear infinite;
}
.fbi-ball__swirl {
  position: absolute; left: 50%; top: 50%;
  width: calc(8px * var(--tscale, 1)); height: calc(8px * var(--tscale, 1));
  margin: calc(-4px * var(--tscale, 1)) 0 0 calc(-4px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffe9a8, #ff8a3d 65%, transparent 80%);
  animation: fbiSwirl 340ms linear var(--sdelay, 0ms) infinite;
}
@keyframes fbiSwirl {
  0% { transform: rotate(var(--sangle)) translateX(calc(52px * var(--tscale, 1))) scale(0.8); opacity: 0.9; }
  50% { transform: rotate(calc(var(--sangle) + 180deg)) translateX(calc(58px * var(--tscale, 1))) scale(1); opacity: 1; }
  100% { transform: rotate(calc(var(--sangle) + 360deg)) translateX(calc(52px * var(--tscale, 1))) scale(0.8); opacity: 0.9; }
}
@keyframes fbiGlowPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
@keyframes fbiBallFlicker { 0%, 100% { transform: scale(1); opacity: 0.95; } 50% { transform: scale(1.08); opacity: 1; } }
@keyframes fbiTendril {
  0%, 100% { transform: rotate(var(--tangle)) translateY(calc(-60px * var(--tscale, 1))) rotate(calc(var(--tangle) * -1)) scale(1); }
  50% { transform: rotate(calc(var(--tangle) + 20deg)) translateY(calc(-68px * var(--tscale, 1))) rotate(calc((var(--tangle) + 20deg) * -1)) scale(1.1); }
}
@keyframes fbiEject {
  0% { opacity: 0; transform: rotate(var(--eangle)) translateX(calc(60px * var(--tscale, 1))) scale(0.6); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--eangle)) translateX(calc(140px * var(--tscale, 1))) scale(0.2); }
}
.fbi-blast { position: relative; width: 0; height: 0; pointer-events: none; }
.fbi-blast__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(90px * var(--tscale, 1)); height: calc(90px * var(--tscale, 1));
  margin: calc(-45px * var(--tscale, 1)) 0 0 calc(-45px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #fff3c4 30%, #ff9d3a 58%, rgba(255, 90, 20, 0) 76%);
  opacity: 0;
}
.fbi-blast__ring {
  position: absolute; left: 50%; top: 50%;
  border-radius: 50%;
  opacity: 0;
}
.fbi-blast__ring--1 {
  width: calc(120px * var(--tscale, 1)); height: calc(120px * var(--tscale, 1));
  margin: calc(-60px * var(--tscale, 1)) 0 0 calc(-60px * var(--tscale, 1));
  border: calc(8px * var(--tscale, 1)) solid rgba(255, 160, 60, 0.85);
  box-shadow: 0 0 40px rgba(255, 130, 40, 0.7), inset 0 0 24px rgba(255, 200, 100, 0.5);
}
.fbi-blast__ring--2 {
  width: calc(260px * var(--tscale, 1)); height: calc(260px * var(--tscale, 1));
  margin: calc(-130px * var(--tscale, 1)) 0 0 calc(-130px * var(--tscale, 1));
  border: calc(4px * var(--tscale, 1)) solid rgba(255, 120, 40, 0.5);
}
.fbi-blast__frag {
  position: absolute; left: 50%; top: 50%;
  width: calc(16px * var(--tscale, 1)); height: calc(16px * var(--tscale, 1));
  margin: calc(-8px * var(--tscale, 1)) 0 0 calc(-8px * var(--tscale, 1));
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  background: linear-gradient(160deg, #fff3c4, #ff9d3a 55%, #d1440b);
  filter: drop-shadow(0 0 8px rgba(255, 140, 40, 0.9));
  opacity: 0;
  transform: rotate(var(--fangle));
}
.fbi-blast__up {
  position: absolute; left: 50%; top: 50%;
  width: calc(10px * var(--tscale, 1)); height: calc(14px * var(--tscale, 1));
  margin: calc(-7px * var(--tscale, 1)) 0 0 calc(-5px * var(--tscale, 1));
  border-radius: 50% 50% 40% 40%;
  background: radial-gradient(ellipse, #ffe27a, rgba(255, 140, 40, 0) 75%);
  opacity: 0;
  transform: rotate(var(--uangle));
}
.fbi-blast--go .fbi-blast__flash { animation: fbiBlastFlash 260ms ease-out forwards; }
.fbi-blast--go .fbi-blast__ring--1 { animation: fbiBlastRing1 460ms ease-out forwards; }
.fbi-blast--go .fbi-blast__ring--2 { animation: fbiBlastRing2 620ms ease-out forwards; }
.fbi-blast--go .fbi-blast__frag { animation: fbiBlastFrag 520ms ease-out forwards; }
.fbi-blast--go .fbi-blast__up { animation: fbiBlastUp 640ms ease-out forwards; }
@keyframes fbiBlastFlash {
  0% { opacity: 0; transform: scale(0.3); }
  22% { opacity: 1; transform: scale(1.3); }
  100% { opacity: 0; transform: scale(2.4); }
}
@keyframes fbiBlastRing1 {
  0% { opacity: 0.95; transform: scale(0.25); }
  100% { opacity: 0; transform: scale(1.9); }
}
@keyframes fbiBlastRing2 {
  0% { opacity: 0.8; transform: scale(0.2); }
  100% { opacity: 0; transform: scale(1.35); }
}
@keyframes fbiBlastFrag {
  0% { opacity: 1; transform: rotate(var(--fangle)) translateX(0) scale(1); }
  100% { opacity: 0; transform: rotate(var(--fangle)) translateX(calc(96px * var(--tscale, 1))) scale(0.35); }
}
@keyframes fbiBlastUp {
  0% { opacity: 0; transform: rotate(var(--uangle)) translateY(0) scale(0.6); }
  20% { opacity: 0.9; }
  100% { opacity: 0; transform: rotate(var(--uangle)) translateY(calc(-70px * var(--tscale, 1))) scale(1); }
}
.fbi-decoy { position: relative; width: 0; height: 0; pointer-events: none; }
.fbi-decoy__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(40px * var(--tscale, 1)); height: calc(40px * var(--tscale, 1));
  margin: calc(-20px * var(--tscale, 1)) 0 0 calc(-20px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #fff3c4 0%, #ff9d3a 50%, rgba(255, 90, 20, 0) 74%);
  opacity: 0;
}
.fbi-decoy__ring {
  position: absolute; left: 50%; top: 50%;
  width: calc(70px * var(--tscale, 1)); height: calc(70px * var(--tscale, 1));
  margin: calc(-35px * var(--tscale, 1)) 0 0 calc(-35px * var(--tscale, 1));
  border-radius: 50%;
  border: calc(3px * var(--tscale, 1)) solid rgba(255, 150, 60, 0.7);
  opacity: 0;
}
.fbi-decoy--go .fbi-decoy__flash { animation: fbiDecoyFlash 320ms ease-out forwards; }
.fbi-decoy--go .fbi-decoy__ring { animation: fbiDecoyRing 420ms ease-out forwards; }
@keyframes fbiDecoyFlash {
  0% { opacity: 0; transform: scale(0.3); }
  30% { opacity: 0.95; transform: scale(1.15); }
  100% { opacity: 0; transform: scale(1.7); }
}
@keyframes fbiDecoyRing {
  0% { opacity: 0.85; transform: scale(0.3); }
  100% { opacity: 0; transform: scale(1.8); }
}
`;

/** Thunder Storm (MG_THUNDERSTORM) — cast, movido de
 * `vfx/mage/thunder-storm/ThunderStormCastElectric.tsx` (arquivo mantido —
 * Light Bolt ainda o usa via `vfx/SkillVfx.tsx: CAST_VFX` — mas o CSS
 * canônico agora mora aqui; o componente legado injeta o PRÓPRIO `<style>`
 * ainda, então esta cópia serve exclusivamente a `thunderStormVfxDef.tsx`
 * e os dois convivem até Light Bolt migrar na Fase 5). */
const THUNDER_STORM_CAST_CSS = `
.ts-cast-elec { position: relative; width: 4px; height: 4px; pointer-events: none; }
.ts-cast-elec__glow {
  position: absolute; left: 50%; top: 50%; width: 100px; height: 100px;
  margin: -50px 0 0 -50px; border-radius: 50%;
  background: radial-gradient(circle, rgba(180, 220, 255, calc(0.32 * var(--intensity, 0.45))), rgba(120, 190, 255, 0) 72%);
  animation: tsCastGlow 560ms ease-in-out infinite;
}
.ts-cast-elec__spark {
  position: absolute; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: #f2fbff;
  box-shadow: 0 0 7px 2px rgba(150, 210, 255, 0.95);
  opacity: 0;
  animation: tsCastSpark var(--pdur) ease-in-out var(--pdelay) infinite;
}
.ts-cast-elec__rise {
  position: absolute; left: 50%; top: 50%; width: 4px; height: 10px; margin: -5px 0 0 -2px;
  border-radius: 2px;
  background: linear-gradient(180deg, #ffffff, #8ecbff);
  filter: drop-shadow(0 0 5px rgba(140, 200, 255, 0.9));
  opacity: 0;
  animation: tsCastRise var(--pdur) ease-in var(--pdelay) infinite;
}
.ts-cast-elec__arc {
  position: absolute; left: 50%; top: 50%; width: 2px; height: var(--len);
  margin-left: -1px;
  transform: rotate(var(--rot));
  transform-origin: 50% 0%;
  background: linear-gradient(180deg, #ffffff, rgba(150, 210, 255, 0));
  filter: drop-shadow(0 0 4px rgba(180, 225, 255, 0.95));
  opacity: 0;
  animation: tsCastArc var(--pdur) linear var(--pdelay) infinite;
}
.ts-cast-elec--release .ts-cast-elec__spark,
.ts-cast-elec--release .ts-cast-elec__rise,
.ts-cast-elec--release .ts-cast-elec__arc {
  animation: tsCastDischarge 260ms ease-out forwards;
}
.ts-cast-elec__burst {
  position: absolute; left: 50%; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px;
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #cfe9ff 40%, rgba(120, 190, 255, 0) 72%);
  opacity: 0;
}
.ts-cast-elec--release .ts-cast-elec__burst { animation: tsCastBurst 260ms ease-out forwards; }
@keyframes tsCastGlow {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(calc(1 + 0.2 * var(--intensity, 0.45))); }
}
@keyframes tsCastSpark {
  0%, 100% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) scale(0.6); }
  10% { opacity: 1; transform: rotate(var(--angle)) translateX(var(--radius)) scale(1.4); }
  24% { opacity: 0; }
}
@keyframes tsCastRise {
  0% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) translateY(0) scale(0.6); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) translateY(calc(-1 * var(--rise))) scale(0.9); }
}
@keyframes tsCastArc {
  0%, 100% { opacity: 0; }
  6% { opacity: 1; }
  12% { opacity: 0; }
  50% { opacity: 0; }
  56% { opacity: 0.9; }
  60% { opacity: 0; }
}
@keyframes tsCastDischarge {
  0% { opacity: 1; }
  100% { opacity: 0; transform: scale(0.4); }
}
@keyframes tsCastBurst {
  0% { opacity: 0; transform: scale(0.3); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: scale(6); }
}
`;

/** Thunder Storm (MG_THUNDERSTORM) — impacto, movido de
 * `vfx/mage/thunder-storm/ThunderStormImpact.tsx` (arquivo removido). */
const THUNDER_STORM_IMPACT_CSS = `
.ts-bolt-wrap {
  position: relative; width: 0; height: 0; pointer-events: none;
  animation: tsBoltAppear 100ms ease-out;
}
.ts-bolt-wrap--gone { animation: tsBoltGone 260ms ease-in forwards; }
.ts-bolt__core {
  position: absolute; left: 50%; top: 0;
  width: calc(70px * var(--tscale, 1)); height: calc(640px * var(--tscale, 1));
  margin-left: calc(-35px * var(--tscale, 1));
  clip-path: polygon(45.5% 0%, 57.5% 14%, 35.5% 30%, 53.5% 46%, 33.5% 62%, 47.5% 80%, 43.5% 100%,
    52.5% 100%, 56.5% 80%, 42.5% 62%, 62.5% 46%, 44.5% 30%, 66.5% 14%, 54.5% 0%);
  background: linear-gradient(180deg, #ffffff 0%, #eaf6ff 30%, #a9d8ff 60%, #6ab4ff 100%);
  filter: drop-shadow(0 0 10px rgba(150, 210, 255, 0.95)) drop-shadow(0 0 26px rgba(90, 170, 255, 0.7));
  animation: tsBoltFlicker 180ms ease-in-out infinite;
}
.ts-bolt__glow {
  position: absolute; left: 50%; top: 0;
  width: calc(176px * var(--tscale, 1)); height: calc(672px * var(--tscale, 1));
  margin-left: calc(-88px * var(--tscale, 1));
  background: radial-gradient(ellipse 50% 46% at 50% 50%, rgba(150, 205, 255, 0.55) 0%, rgba(130, 195, 255, 0.32) 45%, rgba(120, 190, 255, 0) 78%);
  opacity: 0.85;
}
.ts-bolt__branch {
  position: absolute; left: 50%; top: var(--by, 40%); width: calc(40px * var(--tscale, 1)); height: 2px;
  margin-left: calc(-20px * var(--tscale, 1));
  transform: rotate(var(--brot, 0deg));
  transform-origin: 0% 50%;
  background: linear-gradient(90deg, #ffffff, rgba(150, 210, 255, 0));
  filter: drop-shadow(0 0 5px rgba(180, 225, 255, 0.9));
  opacity: 0;
  animation: tsBoltBranch 420ms ease-in-out infinite;
}
.ts-bolt__mote {
  position: absolute; left: 50%; top: 40%; width: calc(4px * var(--tscale, 1)); height: calc(4px * var(--tscale, 1));
  margin: calc(-2px * var(--tscale, 1)) 0 0 calc(-2px * var(--tscale, 1));
  border-radius: 50%;
  background: #eaf6ff;
  box-shadow: 0 0 6px 2px rgba(160, 215, 255, 0.9);
  opacity: 0;
  animation: tsBoltMote 900ms ease-in-out var(--mdelay, 0ms) infinite;
}
@keyframes tsBoltAppear { from { opacity: 0; } to { opacity: 1; } }
@keyframes tsBoltGone { from { opacity: 1; } to { opacity: 0; } }
@keyframes tsBoltFlicker { 0%, 100% { opacity: 1; } 45% { opacity: 0.55; } 60% { opacity: 1; } 80% { opacity: 0.7; } }
@keyframes tsBoltBranch {
  0%, 100% { opacity: 0; transform: rotate(var(--brot, 0deg)) scaleX(0.6); }
  50% { opacity: 0.9; transform: rotate(var(--brot, 0deg)) scaleX(1); }
}
@keyframes tsBoltMote {
  0%, 100% { opacity: 0; transform: rotate(var(--mangle)) translateX(calc(50px * var(--tscale, 1))) scale(0.6); }
  50% { opacity: 1; transform: rotate(var(--mangle)) translateX(calc(64px * var(--tscale, 1))) scale(1); }
}
.ts-ground { position: relative; width: 0; height: 0; pointer-events: none; }
.ts-ground__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(70px * var(--tscale, 1)); height: calc(70px * var(--tscale, 1));
  margin: calc(-35px * var(--tscale, 1)) 0 0 calc(-35px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #cfe9ff 35%, rgba(120, 190, 255, 0.6) 60%, rgba(120, 190, 255, 0) 75%);
  opacity: 0;
}
.ts-ground__ring {
  position: absolute; left: 50%; top: 50%;
  width: calc(190px * var(--tscale, 1)); height: calc(70px * var(--tscale, 1));
  margin: calc(-35px * var(--tscale, 1)) 0 0 calc(-95px * var(--tscale, 1));
  border-radius: 50%;
  border: calc(4px * var(--tscale, 1)) solid rgba(170, 220, 255, 0.85);
  box-shadow: 0 0 30px rgba(120, 190, 255, 0.7);
  opacity: 0;
}
.ts-ground__branch {
  position: absolute; left: 50%; top: 50%; height: 2px; width: var(--glen);
  margin-top: -1px;
  transform: rotate(var(--gangle)) scaleX(0.15);
  transform-origin: 0% 50%;
  background: linear-gradient(90deg, #ffffff, rgba(140, 205, 255, 0));
  filter: drop-shadow(0 0 4px rgba(160, 215, 255, 0.9));
  opacity: 0;
}
.ts-ground--impact .ts-ground__flash { animation: tsGroundFlash 260ms ease-out forwards; }
.ts-ground--impact .ts-ground__ring { animation: tsGroundRing 520ms ease-out forwards; }
.ts-ground--impact .ts-ground__branch { animation: tsGroundBranch 480ms ease-out forwards; }
@keyframes tsGroundFlash {
  0% { opacity: 0; transform: scale(0.3); }
  25% { opacity: 1; transform: scale(1.2); }
  100% { opacity: 0; transform: scale(1.8); }
}
@keyframes tsGroundRing {
  0% { opacity: 0.9; transform: scale(0.2, 0.2); }
  100% { opacity: 0; transform: scale(2, 2); }
}
@keyframes tsGroundBranch {
  0% { opacity: 1; transform: rotate(var(--gangle)) scaleX(0.15); }
  30% { opacity: 1; transform: rotate(var(--gangle)) scaleX(1); }
  100% { opacity: 0; transform: rotate(var(--gangle)) scaleX(1); }
}
.ts-shock { position: relative; width: 0; height: 0; pointer-events: none; }
.ts-shock__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(58px * var(--tscale, 1)); height: calc(58px * var(--tscale, 1));
  margin: calc(-29px * var(--tscale, 1)) 0 0 calc(-29px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #d8ecff 40%, rgba(140, 205, 255, 0) 72%);
  opacity: 0;
}
.ts-shock__arc {
  position: absolute; left: 50%; top: 50%; width: calc(26px * var(--tscale, 1)); height: calc(3px * var(--tscale, 1));
  margin-top: calc(-1.5px * var(--tscale, 1));
  transform: rotate(var(--sangle));
  transform-origin: 0% 50%;
  background: linear-gradient(90deg, #ffffff, rgba(150, 210, 255, 0));
  filter: drop-shadow(0 0 5px rgba(180, 225, 255, 0.95));
  opacity: 0;
}
.ts-shock__spark {
  position: absolute; left: 50%; top: 50%; width: calc(5px * var(--tscale, 1)); height: calc(5px * var(--tscale, 1));
  margin: calc(-2.5px * var(--tscale, 1)) 0 0 calc(-2.5px * var(--tscale, 1));
  border-radius: 50%;
  background: #eaf6ff;
  box-shadow: 0 0 8px 2px rgba(160, 215, 255, 0.95);
  opacity: 0;
}
.ts-shock--impact .ts-shock__flash { animation: tsShockFlash 220ms ease-out forwards; }
.ts-shock--impact .ts-shock__arc { animation: tsShockArc 360ms ease-out forwards; }
.ts-shock--impact .ts-shock__spark { animation: tsShockSpark 500ms ease-out forwards; }
@keyframes tsShockFlash {
  0% { opacity: 0; transform: scale(0.4); }
  30% { opacity: 1; transform: scale(1.3); }
  100% { opacity: 0; transform: scale(1.9); }
}
@keyframes tsShockArc {
  0% { opacity: 1; transform: rotate(var(--sangle)) scaleX(0.3); }
  35% { opacity: 1; transform: rotate(var(--sangle)) scaleX(1.2); }
  100% { opacity: 0; transform: rotate(var(--sangle)) scaleX(1); }
}
@keyframes tsShockSpark {
  0% { opacity: 1; transform: rotate(var(--pangle)) translateX(calc(6px * var(--tscale, 1))) scale(1); }
  100% { opacity: 0; transform: rotate(var(--pangle)) translateX(calc(48px * var(--tscale, 1))) scale(0.4); }
}
.ts-dmgnum {
  position: relative;
  left: var(--dmgx, 0px);
  transform: translate(-50%, 0) scale(0.4);
  font: 800 84px/1 "Segoe UI", system-ui, sans-serif;
  color: #eaf6ff;
  text-shadow: 0 0 32px rgba(130, 195, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9), 0 0 56px rgba(90, 160, 230, 0.6);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
}
.ts-dmgnum--crit {
  font-size: 108px;
  color: #f2f9ff;
  text-shadow: 0 0 40px rgba(180, 220, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9);
}
.ts-dmgnum--self { color: #ffb4b4; }
.ts-dmgnum--impact { animation: tsDmgNum 1000ms cubic-bezier(0.33, 0.4, 0.4, 1) forwards; }
@keyframes tsDmgNum {
  0% { opacity: 0; transform: translate(calc(-50% + 0px), 24px) scale(0.4); }
  10% { opacity: 1; transform: translate(calc(-50% + 0px), -40px) scale(1.2); }
  22% { opacity: 1; transform: translate(calc(-50% + 8px), -56px) scale(1); }
  55% { opacity: 0.75; transform: translate(calc(-50% + 280px), 240px) scale(0.95); }
  100% { opacity: 0; transform: translate(calc(-50% + 520px), 520px) scale(0.8); }
}
.ts-total {
  position: relative;
  transform: translate(-50%, 0) scale(0.3);
  font: 900 168px/1 "Segoe UI", system-ui, sans-serif;
  color: #ffe27a;
  text-shadow: 0 0 64px rgba(255, 220, 110, 0.95), 0 12px 0 rgba(60, 45, 0, 0.95), 0 -12px 0 rgba(60, 45, 0, 0.95),
    12px 0 0 rgba(60, 45, 0, 0.95), -12px 0 0 rgba(60, 45, 0, 0.95), 0 0 104px rgba(255, 210, 90, 0.65);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
  animation: tsTotalShow 1400ms cubic-bezier(0.16, 0.84, 0.28, 1);
}
.ts-total--crit { color: #fff3c4; }
@keyframes tsTotalShow {
  0% { opacity: 0; transform: translate(-50%, 32px) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -24px) scale(1.3); }
  32% { transform: translate(-50%, -40px) scale(1.08); }
  78% { opacity: 1; transform: translate(-50%, -40px) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -88px) scale(1); }
}
`;

/**
 * Cold Bolt (MG_COLDBOLT) — só os números de dano/total (`cb-ice-dmgnum`/
 * `cb-ice-total`), portados byte a byte de `vfx/mage/cold-bolt/
 * ColdBoltImpact.tsx` (que continua 100% intocado — é o baseline DOM,
 * dispatch legado em `vfx/SkillVfx.tsx`). A lança/burst de impacto
 * (`cb-ice-spike`/`cb-ice-hit*`) NÃO vem pra cá: a versão GPU
 * (`coldBoltVfxDefGpu.tsx`) desenha esses dois por partícula/ring/sprite —
 * só os números continuam DOM (`coldBoltDamageDomArt.tsx`), mesma técnica
 * já provada em Thunder Storm (`ts-dmgnum`/`ts-total`, migrado inteiro).
 */
const COLD_BOLT_DMG_CSS = `
.cb-ice-dmgnum {
  position: relative;
  left: var(--dmgx, 0px);
  transform: translate(-50%, 0) scale(0.4);
  font: 800 84px/1 "Segoe UI", system-ui, sans-serif;
  color: #eafcff;
  text-shadow: 0 0 32px rgba(80, 190, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9), 0 0 56px rgba(40, 150, 230, 0.6);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
}
.cb-ice-dmgnum--crit {
  font-size: 108px;
  color: #fff3bf;
  text-shadow: 0 0 40px rgba(255, 214, 110, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9);
}
.cb-ice-dmgnum--self { color: #ffb4b4; }
.cb-ice-dmgnum--impact {
  animation: cbDmgNum 1000ms cubic-bezier(0.33, 0.4, 0.4, 1) forwards;
}
@keyframes cbDmgNum {
  0% { opacity: 0; transform: translate(calc(-50% + 0px), 24px) scale(0.4); }
  10% { opacity: 1; transform: translate(calc(-50% + 0px), -40px) scale(1.2); }
  22% { opacity: 1; transform: translate(calc(-50% + 8px), -56px) scale(1); }
  55% { opacity: 0.75; transform: translate(calc(-50% + 280px), 240px) scale(0.95); }
  100% { opacity: 0; transform: translate(calc(-50% + 520px), 520px) scale(0.8); }
}
.cb-ice-total {
  position: relative;
  transform: translate(-50%, 0) scale(0.3);
  font: 900 168px/1 "Segoe UI", system-ui, sans-serif;
  color: #ffe27a;
  text-shadow: 0 0 64px rgba(255, 200, 60, 0.95), 0 12px 0 rgba(70, 40, 0, 0.95), 0 -12px 0 rgba(70, 40, 0, 0.95),
    12px 0 0 rgba(70, 40, 0, 0.95), -12px 0 0 rgba(70, 40, 0, 0.95), 0 0 104px rgba(255, 180, 40, 0.65);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
  animation: cbTotalShow 1400ms cubic-bezier(0.16, 0.84, 0.28, 1);
}
.cb-ice-total--crit { color: #fff2b8; }
@keyframes cbTotalShow {
  0% { opacity: 0; transform: translate(-50%, 32px) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -24px) scale(1.3); }
  32% { transform: translate(-50%, -40px) scale(1.08); }
  78% { opacity: 1; transform: translate(-50%, -40px) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -88px) scale(1); }
}
`;

/**
 * Soul Strike (MG_SOULSTRIKE) — só os números de dano/total (`ss-dmgnum`/
 * `ss-total`), portados byte a byte de `vfx/mage/soul-strike/
 * SoulStrikeImpact.tsx` (intocado, baseline DOM). MESMA exceção já
 * documentada em Cold Bolt/Thunder Storm.
 */
const SOUL_STRIKE_DMG_CSS = `
.ss-dmgnum {
  position: relative;
  left: var(--dmgx, 0px);
  transform: translate(-50%, 0) scale(0.4);
  font: 800 84px/1 "Segoe UI", system-ui, sans-serif;
  color: #eef8ff;
  text-shadow: 0 0 32px rgba(190, 220, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9), 0 0 56px rgba(150, 195, 240, 0.6);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
}
.ss-dmgnum--crit {
  font-size: 108px;
  color: #ffffff;
  text-shadow: 0 0 40px rgba(210, 235, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9);
}
.ss-dmgnum--self { color: #ffb4b4; }
.ss-dmgnum--impact { animation: ssDmgNum 1000ms cubic-bezier(0.33, 0.4, 0.4, 1) forwards; }
@keyframes ssDmgNum {
  0% { opacity: 0; transform: translate(calc(-50% + 0px), 24px) scale(0.4); }
  10% { opacity: 1; transform: translate(calc(-50% + 0px), -40px) scale(1.2); }
  22% { opacity: 1; transform: translate(calc(-50% + 8px), -56px) scale(1); }
  55% { opacity: 0.75; transform: translate(calc(-50% + 280px), 240px) scale(0.95); }
  100% { opacity: 0; transform: translate(calc(-50% + 520px), 520px) scale(0.8); }
}
.ss-total {
  position: relative;
  transform: translate(-50%, 0) scale(0.3);
  font: 900 168px/1 "Segoe UI", system-ui, sans-serif;
  color: #ffe27a;
  text-shadow: 0 0 64px rgba(255, 220, 110, 0.95), 0 12px 0 rgba(60, 45, 0, 0.95), 0 -12px 0 rgba(60, 45, 0, 0.95),
    12px 0 0 rgba(60, 45, 0, 0.95), -12px 0 0 rgba(60, 45, 0, 0.95), 0 0 104px rgba(255, 210, 90, 0.65);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
  animation: ssTotalShow 1400ms cubic-bezier(0.16, 0.84, 0.28, 1);
}
.ss-total--crit { color: #fff3c4; }
@keyframes ssTotalShow {
  0% { opacity: 0; transform: translate(-50%, 32px) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -24px) scale(1.3); }
  32% { transform: translate(-50%, -40px) scale(1.08); }
  78% { opacity: 1; transform: translate(-50%, -40px) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -88px) scale(1); }
}
`;

/**
 * Fire Lance (MG_FIREBOLT) — só os números de dano/total (`fl-fire-dmgnum`/
 * `fl-fire-total`), portados byte a byte de `vfx/mage/fire-lance/
 * FireLanceImpact.tsx` (intocado). Mesma exceção já documentada em Cold
 * Bolt/Thunder Storm/Soul Strike.
 */
const FIRE_LANCE_DMG_CSS = `
.fl-fire-dmgnum {
  position: relative;
  left: var(--dmgx, 0px);
  transform: translate(-50%, 0) scale(0.4);
  font: 800 84px/1 "Segoe UI", system-ui, sans-serif;
  color: #fff3d6;
  text-shadow: 0 0 32px rgba(255, 140, 40, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9), 0 0 56px rgba(230, 90, 20, 0.6);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
}
.fl-fire-dmgnum--crit {
  font-size: 108px;
  color: #ffe7a8;
  text-shadow: 0 0 40px rgba(255, 180, 60, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9);
}
.fl-fire-dmgnum--self { color: #ffb4b4; }
.fl-fire-dmgnum--impact { animation: flDmgNum 1000ms cubic-bezier(0.33, 0.4, 0.4, 1) forwards; }
@keyframes flDmgNum {
  0% { opacity: 0; transform: translate(calc(-50% + 0px), 24px) scale(0.4); }
  10% { opacity: 1; transform: translate(calc(-50% + 0px), -40px) scale(1.2); }
  22% { opacity: 1; transform: translate(calc(-50% + 8px), -56px) scale(1); }
  55% { opacity: 0.75; transform: translate(calc(-50% + 280px), 240px) scale(0.95); }
  100% { opacity: 0; transform: translate(calc(-50% + 520px), 520px) scale(0.8); }
}
.fl-fire-total {
  position: relative;
  transform: translate(-50%, 0) scale(0.3);
  font: 900 168px/1 "Segoe UI", system-ui, sans-serif;
  color: #ffb84d;
  text-shadow: 0 0 64px rgba(255, 120, 20, 0.95), 0 12px 0 rgba(70, 20, 0, 0.95), 0 -12px 0 rgba(70, 20, 0, 0.95),
    12px 0 0 rgba(70, 20, 0, 0.95), -12px 0 0 rgba(70, 20, 0, 0.95), 0 0 104px rgba(255, 90, 20, 0.65);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
  animation: flTotalShow 1400ms cubic-bezier(0.16, 0.84, 0.28, 1);
}
.fl-fire-total--crit { color: #ffe6a8; }
@keyframes flTotalShow {
  0% { opacity: 0; transform: translate(-50%, 32px) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -24px) scale(1.3); }
  32% { transform: translate(-50%, -40px) scale(1.08); }
  78% { opacity: 1; transform: translate(-50%, -40px) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -88px) scale(1); }
}
`;

/**
 * Light Bolt (MG_LIGHTNINGBOLT) — só os números de dano/total (`lb-dmgnum`/
 * `lb-total`), portados byte a byte de `vfx/mage/light-bolt/
 * LightBoltImpact.tsx` (intocado). Cores idênticas ao Thunder Storm (mesma
 * arte de raio, mesmo pedido de referência visual).
 */
const LIGHT_BOLT_DMG_CSS = `
.lb-dmgnum {
  position: relative;
  left: var(--dmgx, 0px);
  transform: translate(-50%, 0) scale(0.4);
  font: 800 84px/1 "Segoe UI", system-ui, sans-serif;
  color: #eaf6ff;
  text-shadow: 0 0 32px rgba(130, 195, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9), 0 0 56px rgba(90, 160, 230, 0.6);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
}
.lb-dmgnum--crit {
  font-size: 108px;
  color: #f2f9ff;
  text-shadow: 0 0 40px rgba(180, 220, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9);
}
.lb-dmgnum--self { color: #ffb4b4; }
.lb-dmgnum--impact { animation: lbDmgNum 1000ms cubic-bezier(0.33, 0.4, 0.4, 1) forwards; }
@keyframes lbDmgNum {
  0% { opacity: 0; transform: translate(calc(-50% + 0px), 24px) scale(0.4); }
  10% { opacity: 1; transform: translate(calc(-50% + 0px), -40px) scale(1.2); }
  22% { opacity: 1; transform: translate(calc(-50% + 8px), -56px) scale(1); }
  55% { opacity: 0.75; transform: translate(calc(-50% + 280px), 240px) scale(0.95); }
  100% { opacity: 0; transform: translate(calc(-50% + 520px), 520px) scale(0.8); }
}
.lb-total {
  position: relative;
  transform: translate(-50%, 0) scale(0.3);
  font: 900 168px/1 "Segoe UI", system-ui, sans-serif;
  color: #ffe27a;
  text-shadow: 0 0 64px rgba(255, 220, 110, 0.95), 0 12px 0 rgba(60, 45, 0, 0.95), 0 -12px 0 rgba(60, 45, 0, 0.95),
    12px 0 0 rgba(60, 45, 0, 0.95), -12px 0 0 rgba(60, 45, 0, 0.95), 0 0 104px rgba(255, 210, 90, 0.65);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
  animation: lbTotalShow 1400ms cubic-bezier(0.16, 0.84, 0.28, 1);
}
.lb-total--crit { color: #fff3c4; }
@keyframes lbTotalShow {
  0% { opacity: 0; transform: translate(-50%, 32px) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -24px) scale(1.3); }
  32% { transform: translate(-50%, -40px) scale(1.08); }
  78% { opacity: 1; transform: translate(-50%, -40px) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -88px) scale(1); }
}
`;

/** registro de blocos — a ORDEM não importa (seletores de classe não
 * colidem entre skills, cada uma tem prefixo próprio: `gd-`, `fw-`, `ts-`,
 * `fbi-`/`fb-`, `or-`, `cb-`, `ss-`, `fl-`, `lb-`). Fase 3 vai crescendo
 * skill por skill. */
const CSS_BLOCKS: string[] = [
  CORE_CSS,
  TRAIL_PRIMITIVE_CSS,
  GHOST_DOME_CSS,
  FIRE_WALL_CSS,
  ORACLE_CSS,
  FIRE_BALL_CAST_CSS,
  FIRE_BALL_IMPACT_CSS,
  THUNDER_STORM_CAST_CSS,
  THUNDER_STORM_IMPACT_CSS,
  COLD_BOLT_DMG_CSS,
  SOUL_STRIKE_DMG_CSS,
  FIRE_LANCE_DMG_CSS,
  LIGHT_BOLT_DMG_CSS,
];

const LEGACY_VFX_ART_STYLE_ID = "legacy-vfx-art-style";

/** injeta o `<style>` único — chamado UMA VEZ por `DomRenderer`
 * (construtor), nunca por skill/componente. Idempotente (checa o id antes
 * de criar de novo — mesmo padrão que cada `useXStyles()` antigo já usava,
 * só que agora com UM id em vez de 18). */
export function injectLegacyVfxArtStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(LEGACY_VFX_ART_STYLE_ID)) return;
  const tag = document.createElement("style");
  tag.id = LEGACY_VFX_ART_STYLE_ID;
  tag.textContent = CSS_BLOCKS.join("\n");
  document.head.appendChild(tag);
}
