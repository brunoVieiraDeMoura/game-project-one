import { useEffect, useRef } from "react";
import { useCastStore } from "../net/castStore";
import { useSkillCatalog } from "../net/skillCatalog";
import { usePlayerStore } from "../net/playerStore";
import { BAR_FRAME_SLICE, FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { useBarFrame } from "../ui/CurvedBar";
import { CAST_BAR, CAST_FILL, SB_COLORS } from "../ui/skillBar";

/**
 * Barra de conjuração (ui-change.txt): aparece entre o personagem e a barra de
 * habilidades enquanto a skill está sendo conjurada, com o nome à esquerda e o
 * tempo que falta à direita — "Storm Gust    1.5".
 *
 * Quem diz que há conjuração e quanto ela dura é o SERVIDOR
 * (ZC_USESKILL_ACK → `skill:casting`, já no contrato do gateway). A barra some
 * sozinha quando o tempo acaba e também quando a skill efetivamente sai
 * (`skill:cast`), que é o caso de conjuração interrompida ou mais curta do que
 * o anunciado.
 *
 * A moldura é a MESMA das barras de HP/SP: `curva-das-bordas-barra-hp-sp` e
 * `reta-barra-hp-sp` do pacote da conjuração são esses arquivos, então usa-se o
 * 9-slice que `ui/charFrame.ts` já monta.
 */
export function CastBar() {
  const atual = useCastStore((s) => s.atual);
  const nomeCatalogo = useSkillCatalog((s) => (atual ? s.byId[atual.skillId]?.name : undefined));
  const nomeCru = usePlayerStore((s) => (atual ? s.skills.find((k) => k.id === atual.skillId)?.name : undefined));
  const frame = useBarFrame();
  const enchimento = useRef<HTMLDivElement>(null);
  const relogio = useRef<HTMLSpanElement>(null);

  // O preenchimento e o relógio andam a cada quadro, mutando o DOM por ref —
  // `setState` 60×/s repintaria o HUD inteiro por causa de uma barra.
  useEffect(() => {
    if (!atual) return;
    let raf = 0;
    const passo = () => {
      const falta = atual.fim - performance.now();
      if (falta <= 0) {
        useCastStore.getState().parar();
        return;
      }
      const feito = 1 - falta / atual.duracaoMs;
      if (enchimento.current) enchimento.current.style.width = `${feito * 100}%`;
      if (relogio.current) relogio.current.textContent = (falta / 1000).toFixed(1);
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [atual]);

  if (!atual) return null;

  const borda = Math.max(5, Math.round(CAST_BAR.h * 0.38));
  const fonte = Math.max(10, Math.round(CAST_BAR.h * 0.5));

  return (
    <div style={{ position: "relative", width: CAST_BAR.w, height: CAST_BAR.h }}>
      <div
        style={{
          position: "absolute",
          inset: borda / 3,
          borderRadius: borda * 0.66,
          overflow: "hidden",
          background: `linear-gradient(180deg,${SB_COLORS.trough},#1a1410)`,
        }}
      >
        {/* começa em zero e enche até o fim da conjuração */}
        <div ref={enchimento} style={{ height: "100%", width: 0, background: CAST_FILL }} />
      </div>

      {frame && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderStyle: "solid",
            borderWidth: borda,
            borderImageSource: `url(${frame})`,
            borderImageSlice: BAR_FRAME_SLICE,
            borderImageWidth: `${borda}px`,
            borderImageRepeat: "stretch",
            pointerEvents: "none",
          }}
        />
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `0 ${Math.round(borda * 0.8)}px`,
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: fonte,
          lineHeight: 1,
          color: "#ffffff",
          textShadow: `0 1px 2px ${SB_COLORS.shadow}`,
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {nomeCatalogo ?? nomeCru ?? `#${atual.skillId}`}
        </span>
        <span
          ref={relogio}
          style={{
            fontFamily: FRAME_NUM_FONT,
            fontVariantNumeric: FRAME_NUM_VARIANT,
            fontWeight: 400,
            paddingLeft: fonte,
          }}
        >
          {(atual.duracaoMs / 1000).toFixed(1)}
        </span>
      </div>
    </div>
  );
}
