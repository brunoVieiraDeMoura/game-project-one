"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Barra de "voltar" comum a todas as telas do admin.
 *
 * O destino sai da HIERARQUIA da URL, não do histórico do navegador: abrir
 * `/items/501` direto por link (ou dar F5 nela) tem que voltar pra `/items` do
 * mesmo jeito. `router.back()` levaria pra fora do admin nesses casos.
 *
 * Não aparece na home nem no login — são raiz de fluxo, não têm "acima".
 */

/** rótulo do módulo por primeiro segmento (mesma nomenclatura da home) */
const MODULE_LABELS: Record<string, string> = {
  items: "Itens",
  classes: "Classes",
  skills: "Skills",
  statuses: "Statuses",
  monsters: "Monstros",
  npcs: "NPCs",
  config: "Gerenciador Global",
  users: "Usuários",
  maps: "Mapas",
  "game-editor": "Editor do game",
  "asset-scaling": "Dimensionamento de Assets",
};

/** rota-pai + nome de quem estamos deixando pra trás */
export function parentOf(pathname: string): { href: string; label: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null; // home
  const href = "/" + parts.slice(0, -1).join("/");
  const parentSegment = parts.length >= 2 ? parts[parts.length - 2]! : "";
  const label = parts.length === 1 ? "Início" : (MODULE_LABELS[parentSegment] ?? parentSegment);
  return { href: href === "/" ? "/" : href, label };
}

export function BackBar() {
  const pathname = usePathname() ?? "/";
  if (pathname === "/" || pathname === "/login") return null;
  const parent = parentOf(pathname);
  if (!parent) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-2 backdrop-blur">
      <Link
        href={parent.href}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
      >
        <span aria-hidden>←</span> Voltar
        <span className="text-zinc-500">· {parent.label}</span>
      </Link>
      {/* atalho pra home só quando o "voltar" NÃO é a própria home */}
      {parent.href !== "/" && (
        <Link href="/" className="ml-auto text-xs text-zinc-500 transition-colors hover:text-zinc-300">
          Início
        </Link>
      )}
    </div>
  );
}
