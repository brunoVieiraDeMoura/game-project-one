import type { CSSProperties, ReactNode } from "react";
import { useNineSlice } from "./nineSlice";
import { CARD_FRAME, CARD_STROKE_RATIO } from "./loginFrameArt";

/**
 * Caixa pequena com a moldura de madeira de `ui_definitiva/login-new`
 * (`bordas-botoes-cards` + `extensor-bordas-botoes-cards(-top)`) —
 * leia1.txt: "bordas-botoes-cards (borda dos botões e cards)".
 *
 * MESMA API de `CurvedBox` (`ui/CurvedBox.tsx`) de propósito — as duas são a
 * mesma ideia (moldura de arte + véu + conteúdo), só que peças diferentes, e
 * migrar um consumidor de uma pra outra vira troca de nome. Onze lugares usam
 * esta: as 4 placas de região, a classificação indicativa, os 4 atalhos do
 * rodapé e os 2 botões de entrar/criar conta — em tamanhos bem diferentes, daí
 * `border-image` (que reflui sozinho) em vez de divs absolutos por canto como
 * `LoginFrame2.Canto`/`Faixa` fazem para o quadro maior.
 *
 * O canto É um chanfro (corte reto na diagonal), não uma curva como o de
 * `CurvedBox` — o `borderRadius` do véu é só uma aproximação visual dele, não
 * o corte exato.
 */
export function CardFrame({
  children,
  border = 10,
  background,
  style,
  inner,
  repeat = "stretch",
  onPointerDown,
  onMouseEnter,
  onMouseLeave,
  title,
}: {
  children?: ReactNode;
  /** espessura da moldura em px de TELA */
  border?: number;
  /** CSS background de dentro (translúcido: o mundo por trás tem que aparecer de leve) */
  background?: string;
  /** estilo do elemento de FORA — posição, tamanho. Filhos vão em `inner`, nunca aqui
   * (mesmo aviso do `CurvedBox`: um `display` aqui não alcança o conteúdo). */
  style?: CSSProperties;
  inner?: CSSProperties;
  /** "round" ajuda quando o grão esticado incomoda num lado muito comprido */
  repeat?: "stretch" | "round";
  onPointerDown?: (e: React.PointerEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  title?: string;
}) {
  const frame = useNineSlice(CARD_FRAME);
  const stroke = border * CARD_STROKE_RATIO;
  const radius = border * 0.4;

  return (
    <div
      title={title}
      onPointerDown={onPointerDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ position: "relative", ...style }}
    >
      <div
        style={{
          position: "absolute",
          inset: stroke,
          borderRadius: radius,
          background,
          pointerEvents: "none",
        }}
      />
      {frame && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderStyle: "solid",
            borderWidth: border,
            borderImageSource: `url(${frame})`,
            borderImageSlice: (CARD_FRAME.slice ?? 29) as number,
            borderImageWidth: `${border}px`,
            borderImageRepeat: repeat,
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", ...inner }}>{children}</div>
    </div>
  );
}
