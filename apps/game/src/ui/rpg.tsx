import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BOOK, TB, UI_SCALE, bookFrame, bookPiece, bookTile, pixelated } from "./travelbook";

/**
 * Primitivos de UI vestidos com o pack TravelBookLite (pixel-art de livro,
 * Crusenho — ver ui/travelbook.ts). Painel = página de pergaminho com moldura
 * 9-slice, slot e botão = peças de madeira do pack, barra = trilho + fill.
 *
 * Tudo herda daqui — trocar aqui reveste o HUD inteiro. As cores de texto saem
 * das próprias peças (medidas pixel a pixel), então nada "quase combina".
 *
 * O posicionamento e os atalhos das janelas imitam o Ragnarok (ver
 * hud/hotkeys.ts); a APARÊNCIA é esta, que é a cara nova do jogo.
 */

export const ink = {
  text: BOOK.ink,
  dim: BOOK.inkSoft,
  faint: BOOK.inkFaint,
  accent: BOOK.wood,
  panel: BOOK.paper,
  border: BOOK.paperEdge,
  slot: BOOK.wood,
};

/** painel = página do livro com moldura do pack */
export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: BOOK.paper,
        ...bookFrame(TB.popup, 6),
        boxShadow: "0 6px 18px rgba(30,15,10,0.45)",
        padding: 10,
        color: ink.text,
        font: "13px system-ui, sans-serif",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

type BtnColor = "blue" | "grey" | "brown";
/** o pack é monocromático; a "cor" vira só o realce do estado ativo */
const ACCENT: Record<BtnColor, string> = {
  blue: BOOK.gold,
  grey: BOOK.paperShade,
  brown: BOOK.paperEdge,
};

/** botão de madeira do pack, com os frames de hover/press da animação */
export function RpgButton({
  children,
  onClick,
  color = "grey",
  active = false,
  disabled = false,
  title,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  color?: BtnColor;
  active?: boolean;
  /** opcional — sem isso, um botão "sem seleção"/"sem alvo" ficava com a
   * mesma cara de sempre e o clique só falhava calado (ver PrefabPanel
   * "Salvar" com `selCount === 0`: o campo ao lado já desabilitava, o botão
   * não, e a diferença lia como inconsistência, não como estado) */
  disabled?: boolean;
  /** tooltip — também vira `aria-label` quando o filho é só um emoji/ícone
   * ("🗑", "✕"), que sozinho não diz nada a leitor de tela */
  title?: string;
  style?: CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const art = pressed ? TB.buttonPress : hover || active ? TB.buttonHover : TB.button;

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      style={{
        border: "none",
        ...bookPiece(art),
        color: active ? ACCENT[color] : BOOK.parchmentLight,
        font: "700 12px system-ui",
        textShadow: `1px 1px 0 ${BOOK.wood}`,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        padding: "6px 12px",
        lineHeight: 1.1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/**
 * Placeholder de ícone: quadrado colorido (o usuário troca por ícones reais).
 * `seed` diferente = cor diferente; `standard` = madeira do pack.
 */
/**
 * Anel girando — carregamento genérico.
 *
 * Gira mexendo `transform` por ref a cada quadro (`requestAnimationFrame`),
 * não `@keyframes` CSS: o projeto inteiro é estilo inline, sem folha de
 * estilo própria pra declarar a animação (mesma receita do cronômetro de
 * recarga em `hud/SkillBar.tsx: Cooldown`).
 */
export function LoadingRing({ size = 34 }: { size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const passo = (t: number) => {
      if (ref.current) ref.current.style.transform = `rotate(${(t / 3.5) % 360}deg)`;
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, []);
  const anel = Math.max(10, Math.round(size * 0.6));
  const espessura = Math.max(2, Math.round(anel * 0.16));
  return (
    <div
      ref={ref}
      style={{
        width: anel,
        height: anel,
        borderRadius: "50%",
        border: `${espessura}px solid rgba(255,255,255,0.22)`,
        borderTopColor: "rgba(255,255,255,0.9)",
        flex: "none",
      }}
    />
  );
}

export function IconSquare({
  seed,
  standard,
  size = 34,
  label,
  loading,
  imageSrc,
  fill,
  radius = 0,
}: {
  seed?: string;
  standard?: boolean;
  size?: number;
  label?: string;
  /** nome ainda não chegou do catálogo — mostra o anel em vez do rótulo/cor final */
  loading?: boolean;
  /** ícone de verdade (`public/assets/...`) — presente e carregando com sucesso
   * substitui o quadrado colorido por seed; erro de carga volta pro
   * placeholder sozinho (`onError` troca o estado local), nunca quebra a UI */
  imageSrc?: string;
  /**
   * `size` vira só a dica pro raio do `LoadingRing` — a caixa em si ocupa
   * 100% do PAI (que precisa ter tamanho de verdade, ex.: `inset:"12%"`
   * dentro de uma célula de CSS grid). Existe porque alguns chamadores
   * (grade de skills, `SkillsWindow.tsx`) não sabem o pixel exato em tempo
   * de autoria — só a cor/texto do placeholder é invariante a isso (enche
   * qualquer caixa igual); uma `<img>` real não é, e SEM este prop ela
   * renderizava no tamanho de `size` (999px, valor-sentinela histórico) e o
   * `overflow:hidden` do pai cortava tudo menos um canto em branco — achado
   * ao vivo dando ícone real pela primeira vez pras skills do Arqueiro.
   */
  fill?: boolean;
  /** canto arredondado do ícone (px) — 0 mantém quadrado vivo (itens, etc);
   * skills usam a mesma referência visual do slot que as envolve
   * (`ui-skills.jpg`: ícone redondo POR DENTRO da moldura de madeira, não
   * um quadrado colado nela) */
  radius?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const color = standard ? BOOK.woodLight : colorFromSeed(seed ?? "x");
  const useImage = !loading && imageSrc && !imgFailed;
  return (
    <div
      title={loading ? undefined : label}
      style={{
        width: fill ? "100%" : size,
        height: fill ? "100%" : size,
        background: loading ? BOOK.wood : useImage ? "transparent" : color,
        boxShadow: `inset 0 0 0 ${UI_SCALE}px ${BOOK.wood}`,
        borderRadius: radius,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: BOOK.parchmentLight,
        font: "700 10px system-ui",
        textShadow: `1px 1px 0 ${BOOK.wood}`,
        overflow: "hidden",
      }}
    >
      {loading ? (
        <LoadingRing size={size} />
      ) : useImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt={label ?? ""}
          width={size}
          height={size}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImgFailed(true)}
        />
      ) : label ? (
        label.slice(0, 3)
      ) : (
        ""
      )}
    </div>
  );
}

function colorFromSeed(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  // saturação/luz fixas e baixas: cor de destaque que ainda convive com o
  // pergaminho (o pack inteiro é terroso)
  return `hsl(${h % 360}, 38%, 42%)`;
}

/** slot do pack (inventário/skill/equip); realce no hover */
export function Slot({
  size = 44,
  children,
  title,
  selected,
}: {
  size?: number;
  children?: ReactNode;
  title?: string;
  selected?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const art = selected ? TB.select : hover ? TB.slotHover : TB.slot;
  return (
    <div
      title={title}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        width: size,
        height: size,
        ...bookPiece(art),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: "8px system-ui",
        color: BOOK.paperShade,
      }}
    >
      {children}
    </div>
  );
}

/** cor lógica → peça de preenchimento do pack */
const FILL_ART: Record<string, string> = {
  green: TB.fillWarm,
  red: TB.fillWarm,
  yellow: TB.fillWarm,
};
/** tinta por cima do fill (o pack só tem duas peças; a matiz vem daqui) */
const FILL_TINT: Record<string, string> = {
  green: "#7fae4f",
  red: "#c05a4a",
  yellow: "#e5b67f",
};

/** barra HP/SP: trilho Bar01a + preenchimento Fill01a tingido */
export function RpgBar({
  value,
  max,
  color = "green",
  fill,
  width = 220,
  height = 16,
  label,
}: {
  value: number;
  max: number;
  color?: "green" | "red" | "yellow";
  fill?: string;
  width?: number | string;
  height?: number;
  label?: string;
}) {
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        ...bookTile(TB.bar, 62, 4),
        backgroundSize: "100% 100%",
        boxShadow: `inset 0 0 0 ${UI_SCALE}px ${BOOK.wood}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${frac * 100}%`,
          ...bookPiece(FILL_ART[color] ?? TB.fillWarm),
          backgroundColor: fill ?? FILL_TINT[color],
          backgroundBlendMode: "multiply",
          transition: "width 0.15s",
        }}
      />
      {label && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "700 11px system-ui",
            color: BOOK.parchmentLight,
            textShadow: `1px 1px 0 ${BOOK.wood}`,
            pointerEvents: "none",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

/** moldura fina do pack para campos de texto e faixas */
export function BookField({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ ...bookFrame(TB.frame, 4), background: BOOK.paper, ...pixelated, ...style }}>{children}</div>
  );
}

/** Crédito obrigatório pela licença do pack (aparece nas Configurações). */
export const UI_PACK_CREDIT = "UI: Complete UI Book Styles Pack — Crusenho (crusenho.itch.io)";
