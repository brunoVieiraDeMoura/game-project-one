"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { StatusCategory, StatusEffectDef, StatusGroup } from "@ragnarok/game-data";
import { STATUS_CATEGORY_LABELS, STATUS_GROUP_LABELS, labelOf, selectOptions } from "@ragnarok/game-data";
import { deleteStatus, listStatuses } from "@/lib/api";
import { Badge, Button, FilterSelect, Input, Pager, Select } from "@/components/ui";

const PAGE_SIZES = [10, 20, 50, 100];
const CATEGORY_OPTIONS = selectOptions(STATUS_CATEGORY_LABELS, "Todas as categorias");
const GROUP_OPTIONS = selectOptions(STATUS_GROUP_LABELS, "Todos os grupos");

const CATEGORY_TONE: Record<StatusCategory, "emerald" | "red" | "zinc"> = {
  buff: "emerald",
  debuff: "red",
  neutral: "zinc",
};

export default function StatusesPage() {
  const [statuses, setStatuses] = useState<StatusEffectDef[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"" | StatusCategory>("");
  const [group, setGroup] = useState<"" | StatusGroup>("");
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
    listStatuses({ page, pageSize, search: debouncedSearch, category: category || undefined, group: group || undefined })
      .then((res) => {
        setStatuses(res.statuses);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, pageSize, debouncedSearch, category, group]);

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

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por ID ou nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <FilterSelect
          value={category}
          onChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
          options={CATEGORY_OPTIONS}
        />
        <FilterSelect
          value={group}
          onChange={(v) => {
            setGroup(v);
            setPage(1);
          }}
          options={GROUP_OPTIONS}
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
              <th className="px-3 py-2">Grupo</th>
              <th className="px-3 py-2">O que faz</th>
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
                    <Badge tone={CATEGORY_TONE[s.category]}>{labelOf(STATUS_CATEGORY_LABELS, s.category)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone="indigo">{labelOf(STATUS_GROUP_LABELS, s.group)}</Badge>
                  </td>
                  <td className="px-3 py-2 max-w-xs truncate text-xs text-zinc-400" title={s.description}>
                    {s.description ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {s.effects && s.effects.unmappedEffects.length > 0 ? (
                      <Badge tone="amber">revisar</Badge>
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

      <Pager page={page} totalPages={totalPages} onPage={setPage} />
    </main>
  );
}
