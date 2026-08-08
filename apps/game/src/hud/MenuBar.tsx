import { useState } from "react";
import { useHudStore } from "./hudStore";
import { FRAME_FONT } from "../ui/charFrame";
import {
  TOOL_ICONS,
  TOOL_LABEL_COLOR,
  TOOL_LABEL_SHADOW,
  TOOL_LAYOUT,
} from "../ui/toolIcons";

/**
 * Barra de menu (baixo-direita): abre/fecha as janelas.
 *
 * Cada botão é a arte pintada inteira (ui/toolIcons.ts) com o nome por cima, na
 * ordem da referência. Sem `Panel` atrás: os botões já trazem a própria moldura,
 * e a página pixel-art do TravelBook por baixo brigava com eles.
 *
 * A largura total (~370 px) é o teto: a barra de skills, centrada, chega a
 * ~900 px numa tela de 1280 e as duas se encostariam se o botão passasse de 48.
 */
export function MenuBar() {
  // várias podem estar abertas ao mesmo tempo agora — o botão acende para
  // TODAS que estiverem na pilha, não só a mais recente
  const open = useHudStore((s) => s.openWindows);
  const toggle = useHudStore((s) => s.toggleWindow);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: TOOL_LAYOUT.gap }}>
      {TOOL_ICONS.map((it) => (
        <ToolButton
          key={it.key}
          label={it.label}
          art={it.art}
          hotkey={it.hotkey}
          active={open.includes(it.key)}
          onClick={() => toggle(it.key)}
        />
      ))}
    </div>
  );
}

/**
 * Animação (ui-change.txt: "leve ao passar o mouse por cima, e ao clicar"):
 * o botão SOBE e clareia no hover, e AFUNDA ao apertar. Tudo em `transform` e
 * `filter`, que o compositor resolve sem relayout — mexer em largura/altura
 * empurraria os vizinhos a cada passada de mouse.
 *
 * O brilho do estado aberto usa `drop-shadow`, não `box-shadow`: a arte tem
 * canto arredondado com alpha, e box-shadow desenharia um retângulo em volta.
 */
function ToolButton({
  label,
  art,
  hotkey,
  active,
  onClick,
}: {
  label: string;
  art: string;
  hotkey: string;
  active: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const h = TOOL_LAYOUT.height;

  const transform = pressed
    ? "translateY(1px) scale(0.94)"
    : hover
      ? "translateY(-4px) scale(1.05)"
      : active
        ? "translateY(-2px)"
        : "none";

  const filter = pressed
    ? "brightness(0.88)"
    : active
      ? "brightness(1.14) drop-shadow(0 0 5px rgba(255,214,140,0.95))"
      : hover
        ? "brightness(1.12) drop-shadow(0 4px 5px rgba(20,12,4,0.5))"
        : "drop-shadow(0 2px 3px rgba(20,12,4,0.45))";

  return (
    <button
      onClick={onClick}
      title={`${label} (${hotkey})`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      style={{
        position: "relative",
        display: "block",
        padding: 0,
        border: "none",
        background: "none",
        cursor: "pointer",
        lineHeight: 0,
        transform,
        filter,
        transition: "transform 120ms ease-out, filter 120ms ease-out",
      }}
    >
      {/* `width: auto` mantém a proporção NATIVA de cada peça — elas não têm o
          mesmo tamanho (169..177 de largura), e a referência também as usa como
          vieram */}
      <img src={art} alt="" draggable={false} height={h} style={{ height: h, width: "auto", display: "block" }} />
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: h * TOOL_LAYOUT.labelBottom,
          textAlign: "center",
          font: `700 ${Math.round(h * TOOL_LAYOUT.labelSize)}px ${FRAME_FONT}`,
          letterSpacing: -0.2,
          lineHeight: 1,
          color: TOOL_LABEL_COLOR,
          textShadow: TOOL_LABEL_SHADOW,
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </button>
  );
}
