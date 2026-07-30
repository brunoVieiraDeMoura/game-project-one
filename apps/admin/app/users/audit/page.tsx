"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminAuditEntry } from "@ragnarok/game-data";
import { listAudit } from "@/lib/api";
import { Button, Input } from "@/components/ui";

const PAGE_SIZE = 50;

const ACTION_STYLE: Record<string, string> = {
  ban: "bg-red-950 text-red-300",
  unban: "bg-emerald-950 text-emerald-300",
  create: "bg-sky-950 text-sky-300",
  update: "bg-indigo-950 text-indigo-300",
  delete: "bg-amber-950 text-amber-300",
};

export default function AuditPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [targetType, setTargetType] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(targetType);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [targetType]);

  const load = useCallback(() => {
    setLoading(true);
    listAudit(page, PAGE_SIZE, debounced || undefined)
      .then((res) => {
        setEntries(res.entries);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, debounced]);

  useEffect(load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto max-w-5xl p-6">
      <button onClick={() => router.push("/users")} className="mb-3 text-sm text-indigo-400 hover:underline">
        ← Usuários
      </button>
      <h1 className="mb-4 text-xl font-semibold">Auditoria administrativa</h1>

      <div className="mb-3 flex items-center gap-3">
        <Input
          placeholder="Filtrar por tipo de alvo (item, account, monster...)"
          value={targetType}
          onChange={(e) => setTargetType(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-sm text-zinc-500">{total.toLocaleString("pt-BR")} registros</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">Quando</th>
              <th className="px-3 py-2">Ação</th>
              <th className="px-3 py-2">Alvo</th>
              <th className="px-3 py-2">Ator</th>
              <th className="px-3 py-2">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Carregando...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Nenhum registro</td></tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                  <td className="px-3 py-2 text-xs text-zinc-400">{new Date(e.at).toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${ACTION_STYLE[e.action] ?? "bg-zinc-800 text-zinc-300"}`}>
                      {e.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{e.targetType}:{e.targetId}</td>
                  <td className="px-3 py-2 text-zinc-400">#{e.actorAccountId}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400">{e.reason ?? "—"}</td>
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
