"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listMaps, deleteMap, type MapSummary } from "@/lib/api";
import { Button, Input } from "@/components/ui";

export default function MapsPage() {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    listMaps(page, pageSize, debounced)
      .then((res) => {
        setMaps(res.maps);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, debounced]);

  useEffect(load, [load]);

  const [deleting, setDeleting] = useState<string | null>(null);
  async function onDelete(id: string) {
    if (!confirm(`Deletar o mapa "${id}"? Não dá pra desfazer.`)) return;
    setDeleting(id);
    try {
      await deleteMap(id);
      load();
    } catch (e) {
      setError(`Falha ao deletar ${id}: ${(e as Error).message}`);
    } finally {
      setDeleting(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Mapas</h1>
        <div className="flex gap-2">
          <Link href="/maps/hexdemo" className="rounded border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800">
            Importar demo
          </Link>
          <Link href="/maps/new" className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            + Novo mapa 3D
          </Link>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <Input placeholder="Buscar por id ou nome..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <span className="text-sm text-zinc-500">{total.toLocaleString("pt-BR")} mapas</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Dimensões</th>
              <th className="px-3 py-2">Água</th>
              <th className="px-3 py-2">Spawns</th>
              <th className="px-3 py-2">Props</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">Carregando...</td></tr>
            ) : maps.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">Nenhum mapa</td></tr>
            ) : (
              maps.map((m) => (
                <tr key={m.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{m.id}</td>
                  <td className="px-3 py-2">{m.name}</td>
                  <td className="px-3 py-2 text-zinc-400">{m.width}×{m.height}</td>
                  <td className="px-3 py-2 text-zinc-400">{m.waterLevel === null ? "—" : m.waterLevel}</td>
                  <td className="px-3 py-2">{m.spawnCount}</td>
                  <td className="px-3 py-2">{m.propCount}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/maps/${encodeURIComponent(m.id)}`} className="text-indigo-400 hover:underline">Editar</Link>
                    <button
                      onClick={() => onDelete(m.id)}
                      disabled={deleting === m.id}
                      className="ml-3 text-red-400 hover:underline disabled:opacity-50"
                    >
                      {deleting === m.id ? "Deletando…" : "Deletar"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-zinc-500">Página {page} de {totalPages}</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Próxima</Button>
        </div>
      </div>
    </main>
  );
}
