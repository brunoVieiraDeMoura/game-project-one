"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Npc, NpcKind, NpcOrigin } from "@ragnarok/game-data";
import { NPC_KIND_LABELS, NPC_ORIGIN_LABELS, labelOf, npcKind, selectOptions } from "@ragnarok/game-data";
import { deleteNpc, listNpcs } from "@/lib/api";
import { Badge, Button, FilterSelect, Input, Pager, Select } from "@/components/ui";

const PAGE_SIZES = [10, 20, 50, 100];
const KIND_OPTIONS = selectOptions(NPC_KIND_LABELS, "Todos os tipos");
const ORIGIN_OPTIONS = selectOptions(NPC_ORIGIN_LABELS, "Todas as origens");

const KIND_TONE: Record<NpcKind, "sky" | "emerald" | "indigo" | "zinc"> = {
  warp: "sky",
  shop: "emerald",
  dialogue: "indigo",
  duplicate: "zinc",
  other: "zinc",
};

export default function NpcsPage() {
  const [npcs, setNpcs] = useState<Npc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"" | NpcKind>("");
  const [origin, setOrigin] = useState<"" | NpcOrigin>("");
  const [mapId, setMapId] = useState("");
  const [debounced, setDebounced] = useState({ search: "", mapId: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced({ search, mapId });
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search, mapId]);

  const load = useCallback(() => {
    setLoading(true);
    listNpcs({
      page,
      pageSize,
      search: debounced.search,
      kind: kind || undefined,
      mapId: debounced.mapId || undefined,
      origin: origin || undefined,
    })
      .then((res) => {
        setNpcs(res.npcs);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, pageSize, debounced, kind, origin]);

  useEffect(load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function onDelete(n: Npc) {
    if (!confirm(`Excluir NPC "${n.id}" — ${n.name}?`)) return;
    try {
      await deleteNpc(n.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">NPCs</h1>
        <Link href="/npcs/new">
          <Button>Novo NPC</Button>
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por nome ou ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <FilterSelect
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPage(1);
          }}
          options={KIND_OPTIONS}
        />
        <FilterSelect
          value={origin}
          onChange={(v) => {
            setOrigin(v);
            setPage(1);
          }}
          options={ORIGIN_OPTIONS}
        />
        <Input placeholder="Mapa..." value={mapId} onChange={(e) => setMapId(e.target.value)} className="max-w-36" />
        <Select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          className="w-auto"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} / página
            </option>
          ))}
        </Select>
        <span className="text-sm text-zinc-500">{total.toLocaleString("pt-BR")} NPCs</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Mapa</th>
              <th className="px-3 py-2">Posição</th>
              <th className="px-3 py-2">Detalhe</th>
              <th className="px-3 py-2">Revisar</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  Carregando...
                </td>
              </tr>
            ) : npcs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  Nenhum NPC encontrado
                </td>
              </tr>
            ) : (
              npcs.map((n) => {
                const k = npcKind(n);
                const flagged = n.dialogue.some((d) => d.kind === "action" && d.action?.kind === "legacyScript");
                return (
                  <tr key={n.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                    <td className="px-3 py-2">
                      {n.name}
                      <span className="ml-2 font-mono text-xs text-zinc-500">{n.id}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={KIND_TONE[k]}>{labelOf(NPC_KIND_LABELS, k)}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-400">{n.mapId}</td>
                    <td className="px-3 py-2 text-xs text-zinc-400">
                      {n.position[0]},{n.position[1]}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-400">
                      {n.warp
                        ? `→ ${n.warp.mapId} ${n.warp.position[0]},${n.warp.position[1]}`
                        : n.shop
                          ? `${n.shop.items.length} itens (${n.shop.currency})`
                          : n.dialogue.length > 0
                            ? `${n.dialogue.length} nós`
                            : n.duplicateOf
                              ? `de ${n.duplicateOf}`
                              : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {flagged && <Badge tone="amber">script</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Link href={`/npcs/${encodeURIComponent(n.id)}`} className="mr-2 text-indigo-400 hover:underline">
                        Editar
                      </Link>
                      <button onClick={() => onDelete(n)} className="text-red-400 hover:underline">
                        Excluir
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={setPage} />
    </main>
  );
}
