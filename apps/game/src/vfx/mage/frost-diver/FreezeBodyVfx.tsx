import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Html } from "@react-three/drei";
import { useWorldStore } from "../../../net/worldStore";
import { OPT1_FREEZE } from "../../../net/entityOption";

/**
 * VFX PERSISTENTE de Congelar (MG_FROSTDIVER) — o ícone de cristal de gelo
 * que fica no alvo enquanto `opt1 === OPT1_FREEZE` for verdade.
 *
 * Fonte da verdade é SEMPRE o `opt1` real do servidor
 * (`net/worldStore.entities[gid].opt1`, via `entity:option`/ZC_STATE_CHANGE)
 * — nunca um timer local. Mesmo princípio de fonte da verdade que Petrificar
 * usa (`net/NetEntity.tsx: usePetrifyMaterial`, `entities/
 * petrifyMaterial.ts` — lá é tint de material, aqui é VFX; a skill pediu
 * abordagens diferentes, o `opt1` real é a mesma fonte para as duas).
 * Montado UMA vez por entidade em `net/NetEntity.tsx`, nunca depende de
 * quantas vezes a skill foi lançada. O trilho de gelo/impacto
 * (`FrostDiverImpact`, vida curta, um por cast) fica separado — este
 * componente só cuida do "congelou e continua congelado".
 *
 * REDESENHO 2026-08-14 (pedido explícito, referência `exemplo de como fazer.jpg`):
 * ícone plano — um leque de 5 LOSANGOS (não o "kite" de 6 pontas de antes),
 * todos saindo do MESMO pivô na base (por isso se sobrepõem perto do centro,
 * igual à foto), só girados em ângulos diferentes.
 *
 * Ângulo pedido (sistema padrão: 0°=direita, 90°=cima, 180°=esquerda,
 * medido anti-horário) → `rotate()` do CSS (0°=já aponta pra cima, sentido
 * HORÁRIO): `cssRotate = 90 - ânguloPedido`.
 *   - meio:    90°  → rotate(0deg)   (reto pra cima)
 *   - laterais: 140°/40° → rotate(-50deg)/rotate(50deg)
 *   - baixo:   180°/0°  → rotate(-90deg)/rotate(90deg) (deitados, um pra
 *     cada lado)
 */

/** centro vertical do leque — perto da base do corpo, pra cobrir do chão até
 * acima da cabeça (igual à referência: o cristal é do tamanho do alvo). */
const ICE_Y = 0.5;

/** um losango só (4 pontas), levemente esticado — não o hexágono de 6
 * pontas usado antes. A largura/altura de cada fragmento (abaixo) já cuida
 * do "esticado". */
const DIAMOND_CLIP = "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";

export function FreezeBodyVfx({ gid, targetScale = 1 }: { gid: number; targetScale?: number }) {
  useFreezeBodyStyles();
  const opt1 = useWorldStore((s) => s.entities[gid]?.opt1);
  const frozen = opt1 === OPT1_FREEZE;

  const [visible, setVisible] = useState(frozen);
  useEffect(() => {
    if (frozen) setVisible(true);
  }, [frozen]);

  if (!visible) return null;

  const tscaleStyle = { "--tscale": targetScale, "--dclip": DIAMOND_CLIP } as CSSProperties;

  return (
    <group position={[0, ICE_Y * targetScale, 0]}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div
          className={frozen ? "fbv-icon fbv-icon--go" : "fbv-icon fbv-icon--gone"}
          style={tscaleStyle}
          onAnimationEnd={(e) => {
            // o fragmento central é o maior — sempre o último a acabar de
            // sumir, então é ele quem decide "acabou de vez"
            if (!frozen && e.animationName === "fbvShardGone") setVisible(false);
          }}
        >
          {/* todos saem do MESMO ponto (base do grupo) — a sobreposição
              perto do centro vem de propósito, não é erro de posicionamento */}
          <div className="fbv-shard fbv-shard--lowerL" />
          <div className="fbv-shard fbv-shard--lowerR" />
          <div className="fbv-shard fbv-shard--upperL" />
          <div className="fbv-shard fbv-shard--upperR" />
          <div className="fbv-shard fbv-shard--top" />
        </div>
      </Html>
    </group>
  );
}

const FREEZE_BODY_STYLE_ID = "freeze-body-vfx-style";
const FREEZE_BODY_CSS = `
.fbv-icon { position: relative; width: 0; height: 0; pointer-events: none; }
.fbv-shard {
  position: absolute; left: 50%; bottom: 0;
  clip-path: var(--dclip);
  background: linear-gradient(180deg, #eaf9ff 0%, #b9e6fb 35%, #6fb9e8 70%, #3f85c2 100%);
  opacity: 0;
  transform-origin: 50% 100%;
}
/* fragmento central — o maior, reto pra cima (90°) */
.fbv-shard--top {
  width: calc(78px * var(--tscale, 1)); height: calc(220px * var(--tscale, 1));
  margin-left: calc(-39px * var(--tscale, 1));
}
/* laterais — 140°/40° */
.fbv-shard--upperL, .fbv-shard--upperR {
  width: calc(60px * var(--tscale, 1)); height: calc(170px * var(--tscale, 1));
  margin-left: calc(-30px * var(--tscale, 1));
}
.fbv-shard--upperL { transform: rotate(-50deg); }
.fbv-shard--upperR { transform: rotate(50deg); }
/* de baixo — 180°/0°, deitados */
.fbv-shard--lowerL, .fbv-shard--lowerR {
  width: calc(56px * var(--tscale, 1)); height: calc(150px * var(--tscale, 1));
  margin-left: calc(-28px * var(--tscale, 1));
}
.fbv-shard--lowerL { transform: rotate(-90deg); }
.fbv-shard--lowerR { transform: rotate(90deg); }

/* translúcido — é ÍCONE, não superfície sólida (a referência deixa o alvo
   por trás aparecer). Cada fragmento tem SUA PRÓPRIA regra completa (nome +
   duração + delay), nada de cascata implícita entre eles. */
.fbv-icon--go .fbv-shard--top { animation: fbvShardGoTop 340ms ease-out 110ms forwards; }
.fbv-icon--go .fbv-shard--upperL { animation: fbvShardGoUpperL 340ms ease-out 60ms forwards; }
.fbv-icon--go .fbv-shard--upperR { animation: fbvShardGoUpperR 340ms ease-out 60ms forwards; }
.fbv-icon--go .fbv-shard--lowerL { animation: fbvShardGoLowerL 340ms ease-out forwards; }
.fbv-icon--go .fbv-shard--lowerR { animation: fbvShardGoLowerR 340ms ease-out forwards; }
@keyframes fbvShardGoTop {
  0% { opacity: 0; transform: scale(0.4, 0.15); }
  60% { opacity: 0.68; }
  100% { opacity: 0.6; transform: scale(1, 1); }
}
@keyframes fbvShardGoUpperL {
  0% { opacity: 0; transform: rotate(-50deg) scale(0.4, 0.15); }
  60% { opacity: 0.68; }
  100% { opacity: 0.58; transform: rotate(-50deg) scale(1, 1); }
}
@keyframes fbvShardGoUpperR {
  0% { opacity: 0; transform: rotate(50deg) scale(0.4, 0.15); }
  60% { opacity: 0.68; }
  100% { opacity: 0.58; transform: rotate(50deg) scale(1, 1); }
}
@keyframes fbvShardGoLowerL {
  0% { opacity: 0; transform: rotate(-90deg) scale(0.4, 0.15); }
  60% { opacity: 0.6; }
  100% { opacity: 0.52; transform: rotate(-90deg) scale(1, 1); }
}
@keyframes fbvShardGoLowerR {
  0% { opacity: 0; transform: rotate(90deg) scale(0.4, 0.15); }
  60% { opacity: 0.6; }
  100% { opacity: 0.52; transform: rotate(90deg) scale(1, 1); }
}

.fbv-icon--gone .fbv-shard--top { animation: fbvShardGone 420ms ease-in forwards; }
.fbv-icon--gone .fbv-shard--upperL { animation: fbvShardGoneUpperL 380ms ease-in forwards; }
.fbv-icon--gone .fbv-shard--upperR { animation: fbvShardGoneUpperR 380ms ease-in forwards; }
.fbv-icon--gone .fbv-shard--lowerL { animation: fbvShardGoneLowerL 340ms ease-in forwards; }
.fbv-icon--gone .fbv-shard--lowerR { animation: fbvShardGoneLowerR 340ms ease-in forwards; }
@keyframes fbvShardGone {
  0% { opacity: 0.6; transform: scale(1, 1); }
  100% { opacity: 0; transform: scale(0.7, 0.85) translateY(6px); }
}
@keyframes fbvShardGoneUpperL {
  0% { opacity: 0.58; transform: rotate(-50deg) scale(1, 1); }
  100% { opacity: 0; transform: rotate(-50deg) scale(0.7, 0.85); }
}
@keyframes fbvShardGoneUpperR {
  0% { opacity: 0.58; transform: rotate(50deg) scale(1, 1); }
  100% { opacity: 0; transform: rotate(50deg) scale(0.7, 0.85); }
}
@keyframes fbvShardGoneLowerL {
  0% { opacity: 0.52; transform: rotate(-90deg) scale(1, 1); }
  100% { opacity: 0; transform: rotate(-90deg) scale(0.7, 0.85); }
}
@keyframes fbvShardGoneLowerR {
  0% { opacity: 0.52; transform: rotate(90deg) scale(1, 1); }
  100% { opacity: 0; transform: rotate(90deg) scale(0.7, 0.85); }
}
`;

function useFreezeBodyStyles(): void {
  useEffect(() => {
    if (document.getElementById(FREEZE_BODY_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = FREEZE_BODY_STYLE_ID;
    tag.textContent = FREEZE_BODY_CSS;
    document.head.appendChild(tag);
  }, []);
}
