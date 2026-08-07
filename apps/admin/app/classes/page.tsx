"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { JobClass } from "@ragnarok/game-data";
import { deleteJobClass, listJobClasses } from "@/lib/api";
import { Button, Input, Pager, Select } from "@/components/ui";

const PAGE_SIZES = [10, 20, 50, 100];

export default function ClassesPage() {
  const [jobClasses, setJobClasses] = useState<JobClass[]>([]);
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
    listJobClasses(page, pageSize, debouncedSearch)
      .then((res) => {
        setJobClasses(res.jobClasses);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, pageSize, debouncedSearch]);

  useEffect(load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function onDelete(jc: JobClass) {
    if (!confirm(`Excluir classe #${jc.id} — ${jc.name}?`)) return;
    try {
      await deleteJobClass(jc.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Classes</h1>
        <Link href="/classes/new">
          <Button>Nova classe</Button>
        </Link>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <Input
          placeholder="Buscar por nome ou ID..."
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
        <span className="text-sm text-zinc-500">{total.toLocaleString("pt-BR")} classes</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Pai</th>
              <th className="px-3 py-2">Base máx</th>
              <th className="px-3 py-2">Job máx</th>
              <th className="px-3 py-2">Peso máx</th>
              <th className="px-3 py-2">Skills</th>
              <th className="px-3 py-2">Tabela HP</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-zinc-500">
                  Carregando...
                </td>
              </tr>
            ) : jobClasses.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-zinc-500">
                  Nenhuma classe encontrada
                </td>
              </tr>
            ) : (
              jobClasses.map((jc) => (
                <tr key={jc.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                  <td className="px-3 py-2 text-zinc-400">{jc.id}</td>
                  <td className="px-3 py-2">{jc.name}</td>
                  <td className="px-3 py-2 text-zinc-400">{jc.parentClassId ?? "—"}</td>
                  <td className="px-3 py-2">{jc.maxBaseLevel}</td>
                  <td className="px-3 py-2">{jc.maxJobLevel}</td>
                  <td className="px-3 py-2">{jc.maxWeight}</td>
                  <td className="px-3 py-2">{jc.skills.length}</td>
                  <td className="px-3 py-2">
                    {jc.baseHpByLevel.length > 0 ? (
                      `${jc.baseHpByLevel.length} níveis`
                    ) : (
                      <span className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-400">fórmula</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link href={`/classes/${jc.id}`} className="mr-2 text-indigo-400 hover:underline">
                      Editar
                    </Link>
                    <button onClick={() => onDelete(jc)} className="text-red-400 hover:underline">
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
