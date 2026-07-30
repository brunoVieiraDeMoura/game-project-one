"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { StatusEffectDef } from "@ragnarok/game-data";
import { deleteStatus, listStatuses } from "@/lib/api";
import { Button, Input, Select } from "@/components/ui";

const PAGE_SIZES = [10, 20, 50, 100];

const CATEGORY_STYLE: Record<string, string> = {
  buff: "bg-emerald-950 text-emerald-400",
  debuff: "bg-red-950 text-red-400",
  neutral: "bg-zinc-800 text-zinc-400",
};

export default function StatusesPage() {
  const [statuses, setStatuses] = useState<StatusEffectDef[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    listStatuses(page, pageSize, debouncedSearch)
      .then((res) => {
        setStatuses(res.statuses);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, pageSize, debouncedSearch]);

  useEffect(load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function onDelete(s: StatusEffectDef) {
    if (!confirm(`Excluir status "${s.id}" — ${s.name}?`)) return;
    try {
      await deleteStatus(s.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Statuses (buffs/debuffs)</h1>
        <Link href="/statuses/new">
          <Button>Novo status</Button>
        </Link>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <Input
          placeholder="Buscar por ID ou nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
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
        <span className="text-sm text-zinc-500">{total.toLocaleString("pt-BR")} statuses</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2">Estados</th>
              <th className="px-3 py-2">Flags</th>
              <th className="px-3 py-2">Script</th>
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
            ) : statuses.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  Nenhum status encontrado
                </td>
              </tr>
            ) : (
              statuses.map((s) => (
                <tr key={s.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{s.id}</td>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${CATEGORY_STYLE[s.category]}`}>{s.category}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-400">{s.states.join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{s.flags.length}</td>
                  <td className="px-3 py-2">
                    {s.effects && s.effects.unmappedEffects.length > 0 ? (
                      <span className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-400">revisar</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link href={`/statuses/${s.id}`} className="mr-2 text-indigo-400 hover:underline">
                      Editar
                    </Link>
                    <button onClick={() => onDelete(s)} className="text-red-400 hover:underline">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-zinc-500">
          Página {page} de {totalPages}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(1)}>
            «
          </Button>
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>
            »
          </Button>
        </div>
      </div>
    </main>
  );
}
