import { useEffect, useState, type CSSProperties } from "react";
import {
  BAR_FRAME_SLICE,
  FRAME_COLORS,
  FRAME_FONT,
  FRAME_NUM_FONT,
  FRAME_NUM_VARIANT,
  barFrameCached,
  barFrameUrl,
} from "./charFrame";

/**
 * Barra HP/SP da placa do personagem: trilho escuro + preenchimento em
 * gradiente + a moldura curva da arte por cima (ui/charFrame.ts monta o
 * 9-slice a partir do canto e do trecho reto).
 *
 * A espessura do traço e o raio do canto saem da ALTURA da barra, não de
 * números fixos: a moldura é uma peça só de 24 px de canto, então renderizá-la
 * com `border-width` = 38% da altura reproduz a proporção da referência
 * (traço ≈ 1/8 da altura) em qualquer tamanho de HUD.
 */
export function CurvedBar({
  value,
  max,
  fill,
  height,
  left,
  right,
  title,
  style,
}: {
  value: number;
  max: number;
  /** CSS background do preenchimento (gradientes medidos em charFrame.ts) */
  fill: string;
  /** altura em px de tela */
  height: number;
  /** rótulo à esquerda dentro da barra (ex.: "HP") */
  left?: string;
  /** rótulo à direita dentro da barra (ex.: "1234 / 1234") */
  right?: string;
  title?: string;
  style?: CSSProperties;
}) {
  const frame = useBarFrame();
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0));

  const border = Math.max(5, Math.round(height * 0.38));
  const stroke = border / 3; // o traço ocupa 8 dos 24 px do canto
  const radius = border * 0.66; // curva INTERNA da moldura
  const font = Math.max(10, Math.round(height * 0.54));

  return (
    <div title={title} style={{ position: "relative", height, ...style }}>
      {/* trilho + preenchimento, recortados pela curva interna da moldura */}
      <div
        style={{
          position: "absolute",
          inset: stroke,
          borderRadius: radius,
          overflow: "hidden",
          background: `linear-gradient(180deg,${FRAME_COLORS.troughDeep},${FRAME_COLORS.trough})`,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${frac * 100}%`,
            background: fill,
            transition: "width 0.18s ease-out",
          }}
        />
      </div>

      {/* moldura por cima: o 9-slice deixa o miolo vazado, então a barra aparece */}
      {frame && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderStyle: "solid",
            borderWidth: border,
            borderImageSource: `url(${frame})`,
            borderImageSlice: BAR_FRAME_SLICE,
            borderImageWidth: `${border}px`,
            borderImageRepeat: "stretch",
            pointerEvents: "none",
          }}
        />
      )}

      {(left || right) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `0 ${Math.round(border * 0.7)}px`,
            font: `700 ${font}px ${FRAME_FONT}`,
            color: FRAME_COLORS.cream,
            textShadow: `0 1px 2px ${FRAME_COLORS.shadow}`,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <span>{left}</span>
          <span
            style={{
              fontFamily: FRAME_NUM_FONT,
              fontVariantNumeric: FRAME_NUM_VARIANT,
              fontWeight: 400,
            }}
          >
            {right}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * O 9-slice é montado num canvas, o que exige os PNGs carregados. Até lá a
 * barra aparece sem moldura (nunca some) — e como o data-url é cacheado no
 * módulo, do segundo mount em diante ele já vem pronto no primeiro render.
 */
export function useBarFrame(): string | null {
  const [url, setUrl] = useState<string | null>(() => barFrameCached());
  useEffect(() => {
    if (url) return;
    let vivo = true;
    barFrameUrl().then(
      (u) => vivo && setUrl(u),
      () => {
        /* sem moldura é melhor que HUD quebrado */
      },
    );
    return () => {
      vivo = false;
    };
  }, [url]);
  return url;
}
