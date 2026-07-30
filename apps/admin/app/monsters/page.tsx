"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Monster } from "@ragnarok/game-data";
import { deleteMonster, listMonsters } from "@/lib/api";
import { Button, Input, Select } from "@/components/ui";

const PAGE_SIZES = [10, 20, 50, 100];

export default function MonstersPage() {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [dropsItem, setDropsItem] = useState("");
  const [debounced, setDebounced] = useState({ search: "", dropsItem: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced({ search, dropsItem });
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search, dropsItem]);

  const load = useCallback(() => {
    setLoading(true);
    const itemId = debounced.dropsItem.trim() !== "" ? Number(debounced.dropsItem) : undefined;
    listMonsters(page, pageSize, debounced.search, Number.isNaN(itemId!) ? undefined : itemId)
      .then((res) => {
        setMonsters(res.monsters);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, pageSize, debounced]);

  useEffect(load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function onDelete(m: Monster) {
    if (!confirm(`Excluir monstro #${m.id} — ${m.name}?`)) return;
    try {
      await deleteMonster(m.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Monstros</h1>
        <Link href="/monsters/new">
          <Button>Novo monstro</Button>
        </Link>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <Input
          placeholder="Buscar por nome, nome Aegis ou ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Input
          placeholder="Quem dropa o item (ID)?"
          value={dropsItem}
          onChange={(e) => setDropsItem(e.target.value)}
          className="max-w-48"
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
        <span className="text-sm text-zinc-500">{total.toLocaleString("pt-BR")} monstros</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Nv</th>
              <th className="px-3 py-2">HP</th>
              <th className="px-3 py-2">Raça</th>
              <th className="px-3 py-2">Elemento</th>
              <th className="px-3 py-2">IA</th>
              <th className="px-3 py-2">Drops</th>
              <th className="px-3 py-2">Spawns</th>
              <th className="px-3 py-2">MVP</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-zinc-500">
                  Carregando...
                </td>
              </tr>
            ) : monsters.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-zinc-500">
                  Nenhum monstro encontrado
                </td>
              </tr>
            ) : (
              monsters.map((m) => (
                <tr key={m.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                  <td className="px-3 py-2 text-zinc-400">{m.id}</td>
                  <td className="px-3 py-2">
                    {m.name}
                    <span className="ml-2 font-mono text-xs text-zinc-500">{m.aegisName}</span>
                  </td>
                  <td className="px-3 py-2">{m.level}</td>
                  <td className="px-3 py-2">{m.hp.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2 text-zinc-400">{m.race}</td>
                  <td className="px-3 py-2 text-zinc-400">
                    {m.element.type} {m.element.level}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{m.aiMode}</td>
                  <td className="px-3 py-2">{m.drops.length + m.mvpDrops.length}</td>
                  <td className="px-3 py-2">{m.spawns.length}</td>
                  <td className="px-3 py-2">
                    {m.mvp && <span className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-400">MVP</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link href={`/monsters/${m.id}`} className="mr-2 text-indigo-400 hover:underline">
                      Editar
                    </Link>
                    <button onClick={() => onDelete(m)} className="text-red-400 hover:underline">
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
