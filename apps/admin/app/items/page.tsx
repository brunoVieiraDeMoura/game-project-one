"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Item, ItemType } from "@ragnarok/game-data";
import { ITEM_TYPE_LABELS, labelOf, selectOptions } from "@ragnarok/game-data";
import { deleteItem, listItems } from "@/lib/api";
import { Badge, Button, FilterSelect, Input, Pager, Select } from "@/components/ui";

const PAGE_SIZES = [10, 20, 50, 100];
const TYPE_OPTIONS = selectOptions(ITEM_TYPE_LABELS, "Todos os tipos");

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"" | ItemType>("");
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
    listItems({ page, pageSize, search: debouncedSearch, type: type || undefined })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, pageSize, debouncedSearch, type]);

  useEffect(load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function onDelete(item: Item) {
    if (!confirm(`Excluir item #${item.id} — ${item.name}?`)) return;
    try {
      await deleteItem(item.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Itens</h1>
        <Link href="/items/new">
          <Button>Novo item</Button>
        </Link>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <Input
          placeholder="Buscar por nome, aegis name ou ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <FilterSelect
          value={type}
          onChange={(v) => {
            setType(v);
            setPage(1);
          }}
          options={TYPE_OPTIONS}
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
        <span className="text-sm text-zinc-500">{total.toLocaleString("pt-BR")} itens</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Aegis</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">ATK</th>
              <th className="px-3 py-2">DEF</th>
              <th className="px-3 py-2">Peso</th>
              <th className="px-3 py-2">Preço</th>
              <th className="px-3 py-2">Slots</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-zinc-500">
                  Carregando...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-zinc-500">
                  Nenhum item encontrado
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                  <td className="px-3 py-2 text-zinc-400">{item.id}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2 text-zinc-400">{item.aegisName}</td>
                  <td className="px-3 py-2">
                    <Badge>{labelOf(ITEM_TYPE_LABELS, item.type)}</Badge>
                  </td>
                  <td className="px-3 py-2">{item.attack}</td>
                  <td className="px-3 py-2">{item.defense}</td>
                  <td className="px-3 py-2">{item.weight}</td>
                  <td className="px-3 py-2">{item.buyPrice}z</td>
                  <td className="px-3 py-2">{item.slots}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link href={`/items/${item.id}`} className="mr-2 text-indigo-400 hover:underline">
                      Editar
                    </Link>
                    <button onClick={() => onDelete(item)} className="text-red-400 hover:underline">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={setPage} />
    </main>
  );
}
