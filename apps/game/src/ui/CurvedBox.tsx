import type { CSSProperties, ReactNode } from "react";
import { BAR_FRAME_SLICE } from "./charFrame";
import { useBarFrame } from "./CurvedBar";

/**
 * Caixa com a moldura curva da arte — a MESMA das barras de HP/SP.
 *
 * `border-curve.png` e `reta-buttons.png` do pack do chat são byte a byte os
 * arquivos das barras, então o 9-slice montado em `ui/charFrame.ts` serve
 * aqui sem copiar PNG nenhum. Enquanto `CurvedBar` é uma barra de valor, esta
 * é um container: abas, canvas de mensagens e campo de digitar.
 *
 * `border` é a espessura da moldura em px; o canto da arte tem 24 px de lado e
 * 8 de traço, então o traço na tela sai com `border/3` e a curva INTERNA com
 * `border × 0,66` — a mesma conta da barra, e é ela que faz o fundo casar com
 * o desenho em vez de vazar no canto.
 */
export function CurvedBox({
  children,
  border = 9,
  background,
  style,
  inner,
  onPointerDown,
  title,
}: {
  children?: ReactNode;
  border?: number;
  /** CSS background de dentro (translúcido: a folhagem tem que aparecer) */
  background?: string;
  /**
   * Estilo do elemento de FORA — posição, tamanho, margem.
   *
   * ATENÇÃO: os filhos NÃO moram aqui. Layout de conteúdo (`display`, `padding`,
   * `gap`, `grid`…) tem de ir em `inner`, senão ele se aplica a um elemento cujos
   * únicos filhos são as duas camadas absolutas da moldura e o container do
   * conteúdo — ou seja, a nada. Foi assim que o aviso de item ficou com o ícone
   * numa linha e o texto na outra (`hud/LootToast`).
   */
  style?: CSSProperties;
  /** estilo da área interna, onde os filhos realmente ficam (padding, layout, overflow…) */
  inner?: CSSProperties;
  onPointerDown?: (e: React.PointerEvent) => void;
  title?: string;
}) {
  const frame = useBarFrame();
  const stroke = border / 3;
  const radius = border * 0.66;

  return (
    <div title={title} onPointerDown={onPointerDown} style={{ position: "relative", ...style }}>
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
            borderImageSlice: BAR_FRAME_SLICE,
            borderImageWidth: `${border}px`,
            borderImageRepeat: "stretch",
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", ...inner }}>
        {children}
      </div>
    </div>
  );
}
