import { useState, type CSSProperties, type ReactNode } from "react";
import { ink } from "../ui/rpg";
import { IcChevron } from "../ui/icons";

const ACCENT = "#4f46e5";

/**
 * Botão da barra de ferramentas esquerda (estilo editor gráfico): ícone grande
 * centralizado + tecla de atalho embaixo com opacidade. Ativo = destaque azul
 * com barra lateral. Tooltip nativo pelo `label`.
 */
export function RailButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
  accent = ACCENT,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  accent?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: "relative",
        width: 46,
        height: 46,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        border: "none",
        borderRadius: 9,
        background: active ? accent : hover && !disabled ? "rgba(255,255,255,0.09)" : "transparent",
        color: active ? "#fff" : ink.text,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transition: "background 0.12s",
      }}
    >
      {active && <span style={{ position: "absolute", left: -6, top: 10, bottom: 10, width: 3, borderRadius: 2, background: accent }} />}
      {icon}
      {shortcut && (
        <span style={{ font: "700 8px system-ui", letterSpacing: 0.5, opacity: active ? 0.75 : 0.4, lineHeight: 1 }}>{shortcut}</span>
      )}
    </button>
  );
}

/** botão de ícone pequeno (top bar / options bar). Atalho no canto inferior. */
export function IconBtn({
  icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
  accent = ACCENT,
  danger,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  accent?: string;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const bg = active ? accent : hover && !disabled ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: "relative",
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${active ? accent : ink.border}`,
        borderRadius: 7,
        background: bg,
        color: disabled ? ink.faint : danger ? "#f87171" : active ? "#fff" : ink.text,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      {icon}
      {shortcut && (
        <span style={{ position: "absolute", right: 2, bottom: 0, font: "700 7px system-ui", opacity: 0.4, lineHeight: 1 }}>{shortcut}</span>
      )}
    </button>
  );
}

/** botão de texto pequeno (labels curtos: Topo/Frente/Lado, tipos de pincel). */
export function TextBtn({ children, active, onClick, accent = ACCENT, style }: { children: ReactNode; active?: boolean; onClick?: () => void; accent?: string; style?: CSSProperties }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        border: `1px solid ${active ? accent : ink.border}`,
        borderRadius: 6,
        background: active ? accent : hover ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
        color: active ? "#fff" : ink.text,
        font: "600 11px system-ui",
        cursor: "pointer",
        padding: "4px 9px",
        whiteSpace: "nowrap",
        transition: "background 0.12s",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** separador vertical fino */
export function VSep() {
  return <span style={{ width: 1, alignSelf: "stretch", margin: "3px 2px", background: ink.border }} />;
}

/** seção recolhível do dock direito: cabeçalho (ícone + título + contagem) + corpo. */
export function DockSection({
  icon,
  title,
  count,
  defaultOpen = true,
  right,
  children,
}: {
  icon?: ReactNode;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${ink.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 11px", userSelect: "none" }}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0, background: "none", border: "none", color: ink.text, cursor: "pointer", padding: 0 }}
        >
          <span style={{ display: "flex", color: ink.dim, transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}><IcChevron size={14} /></span>
          {icon && <span style={{ display: "flex", color: ink.dim }}>{icon}</span>}
          <span style={{ font: "700 12px system-ui", color: ink.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
          {count != null && <span style={{ font: "600 10px system-ui", color: ink.faint }}>{count}</span>}
        </button>
        {right}
      </div>
      {open && <div style={{ padding: "0 11px 12px" }}>{children}</div>}
    </div>
  );
}
