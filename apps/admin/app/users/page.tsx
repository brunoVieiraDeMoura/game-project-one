"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Account } from "@ragnarok/game-data";
import { listAccounts } from "@/lib/api";
import { Button, Checkbox, Input, Select } from "@/components/ui";

const PAGE_SIZES = [10, 20, 50, 100];

function banLabel(ban: Account["ban"]): string {
  if (!ban) return "—";
  return ban.expiresAt ? `até ${new Date(ban.expiresAt).toLocaleDateString("pt-BR")}` : "permanente";
}

export default function UsersPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [bannedOnly, setBannedOnly] = useState(false);
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
    listAccounts(page, pageSize, debouncedSearch, bannedOnly)
      .then((res) => {
        setAccounts(res.accounts);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, pageSize, debouncedSearch, bannedOnly]);

  useEffect(load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Usuários</h1>
        <Link href="/users/audit">
          <Button variant="outline">Ver auditoria</Button>
        </Link>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <Input
          placeholder="Buscar por usuário, e-mail ou ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Checkbox label="Só banidos" checked={bannedOnly} onChange={(v) => { setBannedOnly(v); setPage(1); }} />
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
        <span className="text-sm text-zinc-500">{total.toLocaleString("pt-BR")} contas</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Usuário</th>
              <th className="px-3 py-2">E-mail</th>
              <th className="px-3 py-2">Grupo</th>
              <th className="px-3 py-2">Personagens</th>
              <th className="px-3 py-2">Último login</th>
              <th className="px-3 py-2">Ban</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">Carregando...</td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">Nenhuma conta encontrada</td>
              </tr>
            ) : (
              accounts.map((a) => (
                <tr key={a.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                  <td className="px-3 py-2 text-zinc-400">{a.id}</td>
                  <td className="px-3 py-2">{a.username}</td>
                  <td className="px-3 py-2 text-zinc-400">{a.email ?? "—"}</td>
                  <td className="px-3 py-2">
                    {a.groupLevel >= 10 ? (
                      <span className="rounded bg-indigo-950 px-1.5 py-0.5 text-xs text-indigo-300">{a.groupLevel}</span>
                    ) : (
                      a.groupLevel
                    )}
                  </td>
                  <td className="px-3 py-2">{a.characterIds.length}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400">
                    {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString("pt-BR") : "nunca"}
                  </td>
                  <td className="px-3 py-2">
                    {a.ban ? (
                      <span className="rounded bg-red-950 px-1.5 py-0.5 text-xs text-red-300">{banLabel(a.ban)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/users/${a.id}`} className="text-indigo-400 hover:underline">
                      Detalhes
                    </Link>
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
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(1)}>«</Button>
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Próxima</Button>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</Button>
        </div>
      </div>
    </main>
  );
}
