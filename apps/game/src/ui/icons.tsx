import type { ReactNode } from "react";

/**
 * Conjunto de ícones do editor — SVG stroke (estilo Lucide/Feather), 24×24,
 * herdam `currentColor`. Traço fino e consistente pra uma UI limpa tipo editor
 * gráfico. Um único wrapper <Svg> padroniza viewBox/stroke.
 */
export function Svg({ children, size = 20, fill = "none", sw = 1.8 }: { children: ReactNode; size?: number; fill?: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      {children}
    </svg>
  );
}

type P = { size?: number };

// cursor de seleção
export const IcSelect = ({ size }: P) => <Svg size={size}><path d="M4 3l7 17 2.5-6.5L20 11 4 3z" /></Svg>;
// terreno / relevo (montanhas)
export const IcTerrain = ({ size }: P) => <Svg size={size}><path d="M3 19l5-8 3.5 5L15 9l6 10H3z" /><circle cx="7.5" cy="6.5" r="1.5" /></Svg>;
// decoração / asset (árvore)
export const IcTree = ({ size }: P) => <Svg size={size}><path d="M12 3l5 7h-3l3 5H7l3-5H7l5-7z" /><path d="M12 15v6" /></Svg>;
// spawn (pino de mapa)
export const IcPin = ({ size }: P) => <Svg size={size}><path d="M12 21s6-5.3 6-10a6 6 0 10-12 0c0 4.7 6 10 6 10z" /><circle cx="12" cy="11" r="2.2" /></Svg>;
// área / gatilho (retângulo tracejado)
export const IcArea = ({ size }: P) => <Svg size={size}><path d="M4 4h3M17 4h3M4 20h3M17 20h3M4 4v3M4 17v3M20 4v3M20 17v3M10 4h4M10 20h4M4 10v4M20 10v4" /></Svg>;
// rota / path (waypoints ligados)
export const IcPath = ({ size }: P) => <Svg size={size}><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /><path d="M7 17.5c4-1 6-3 6-6 0-2 1-3 3-4.5" strokeDasharray="2 2" /></Svg>;
// medir (régua)
export const IcRuler = ({ size }: P) => <Svg size={size}><rect x="2.5" y="8" width="19" height="8" rx="1.5" transform="rotate(0 12 12)" /><path d="M7 8v3M11 8v4M15 8v3M19 8v4" /></Svg>;
// prefab / grupo (camadas empilhadas)
export const IcPrefab = ({ size }: P) => <Svg size={size}><path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" /><path d="M4 12l8 4.5 8-4.5" /><path d="M4 16.5L12 21l8-4.5" /></Svg>;
// pincel (paint de props)
export const IcBrush = ({ size }: P) => <Svg size={size}><path d="M15 4l5 5-7 7-5 1 1-5 6-8z" /><path d="M8 16c-2 0-3 2-4 4 2-1 4-1 4-4z" /></Svg>;

// ações
export const IcNew = ({ size }: P) => <Svg size={size}><path d="M13 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V9l-6-6z" /><path d="M13 3v6h6" /><path d="M11 12v6M8 15h6" /></Svg>;
export const IcUndo = ({ size }: P) => <Svg size={size}><path d="M9 7L4 12l5 5" /><path d="M4 12h11a5 5 0 010 10h-1" /></Svg>;
export const IcRedo = ({ size }: P) => <Svg size={size}><path d="M15 7l5 5-5 5" /><path d="M20 12H9a5 5 0 000 10h1" /></Svg>;
export const IcPlay = ({ size }: P) => <Svg size={size} fill="currentColor" sw={0}><path d="M7 4.5v15l13-7.5-13-7.5z" /></Svg>;
export const IcSave = ({ size }: P) => <Svg size={size}><path d="M5 3h11l3 3v13a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" /><path d="M8 3v5h7V3" /><path d="M8 21v-6h8v6" /></Svg>;
export const IcSnap = ({ size }: P) => <Svg size={size}><path d="M4 9h16M4 15h16M9 4v16M15 4v16" /></Svg>;
export const IcEye = ({ size }: P) => <Svg size={size}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="2.5" /></Svg>;
export const IcEyeOff = ({ size }: P) => <Svg size={size}><path d="M4 4l16 16" /><path d="M9.5 9.5a2.5 2.5 0 003.5 3.5" /><path d="M6.5 6.6C3.9 8 2 12 2 12s4 7 10 7c1.8 0 3.4-.5 4.8-1.2M9.8 5.2A9.9 9.9 0 0112 5c6 0 10 7 10 7a17 17 0 01-2.2 3" /></Svg>;
export const IcSparkles = ({ size }: P) => <Svg size={size}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" /></Svg>;
export const IcLayers = ({ size }: P) => <Svg size={size}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></Svg>;
export const IcList = ({ size }: P) => <Svg size={size}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Svg>;
export const IcInfo = ({ size }: P) => <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
export const IcRotL = ({ size }: P) => <Svg size={size}><path d="M4 8a8 8 0 108-3" /><path d="M4 4v4h4" /></Svg>;
export const IcRotR = ({ size }: P) => <Svg size={size}><path d="M20 8a8 8 0 10-8-3" /><path d="M20 4v4h-4" /></Svg>;
export const IcPlus = ({ size }: P) => <Svg size={size}><path d="M12 5v14M5 12h14" /></Svg>;
export const IcMinus = ({ size }: P) => <Svg size={size}><path d="M5 12h14" /></Svg>;
export const IcCopy = ({ size }: P) => <Svg size={size}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></Svg>;
export const IcPaste = ({ size }: P) => <Svg size={size}><path d="M9 4h6M9 4a1 1 0 00-1 1v1h8V5a1 1 0 00-1-1M6 6H5a2 2 0 00-2 2v11a2 2 0 002 2h9a2 2 0 002-2v-1" /><rect x="12" y="11" width="9" height="9" rx="2" /></Svg>;
export const IcDuplicate = ({ size }: P) => <Svg size={size}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 012-2h10" /><path d="M14 11v4M12 13h4" /></Svg>;
export const IcFocus = ({ size }: P) => <Svg size={size}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></Svg>;
export const IcTrash = ({ size }: P) => <Svg size={size}><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" /></Svg>;
export const IcChevron = ({ size }: P) => <Svg size={size}><path d="M6 9l6 6 6-6" /></Svg>;
export const IcCamera = ({ size }: P) => <Svg size={size}><path d="M4 7h3l2-2h6l2 2h3a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" /><circle cx="12" cy="13" r="3.5" /></Svg>;
