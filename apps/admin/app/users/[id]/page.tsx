"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountDetail } from "@/lib/api";
import { banAccount, getAccount, unbanAccount } from "@/lib/api";
import { Button, Field, Input, Section, Select } from "@/components/ui";

const DURATIONS: { label: string; days: number | null }[] = [
  { label: "Permanente", days: null },
  { label: "1 dia", days: 1 },
  { label: "3 dias", days: 3 },
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
];

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const accountId = Number(id);
  const router = useRouter();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [durationIdx, setDurationIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getAccount(accountId)
      .then(setAccount)
      .catch((e: Error) => setError(e.message));
  }, [accountId]);

  useEffect(load, [load]);

  async function onBan() {
    if (!reason.trim()) {
      setError("Motivo obrigatório para banir.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const days = DURATIONS[durationIdx]!.days;
      const expiresAt = days === null ? null : new Date(Date.now() + days * 86400_000).toISOString();
      await banAccount(accountId, reason.trim(), expiresAt);
      setReason("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onUnban() {
    setBusy(true);
    setError(null);
    try {
      await unbanAccount(accountId);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !account)
    return <main className="mx-auto max-w-4xl p-6"><p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p></main>;
  if (!account) return <main className="mx-auto max-w-4xl p-6"><p className="text-zinc-500">Carregando...</p></main>;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <button onClick={() => router.push("/users")} className="mb-3 text-sm text-indigo-400 hover:underline">
        ← Usuários
      </button>
      <h1 className="mb-1 text-xl font-semibold">
        {account.username} <span className="text-sm text-zinc-500">#{account.id}</span>
      </h1>
      {error && <p className="my-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <Section title="Dados da conta">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div><dt className="text-xs text-zinc-500">E-mail</dt><dd>{account.email ?? "—"}</dd></div>
          <div><dt className="text-xs text-zinc-500">Grupo</dt><dd>{account.groupLevel}</dd></div>
          <div><dt className="text-xs text-zinc-500">Personagens</dt><dd>{account.characterIds.length}</dd></div>
          <div><dt className="text-xs text-zinc-500">Criada</dt><dd>{new Date(account.createdAt).toLocaleDateString("pt-BR")}</dd></div>
          <div><dt className="text-xs text-zinc-500">Último login</dt><dd>{account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString("pt-BR") : "nunca"}</dd></div>
        </dl>
      </Section>

      <div className="mt-4">
        <Section title="Ban">
          {account.ban ? (
            <div className="space-y-3">
              <div className="rounded bg-red-950/60 px-3 py-2 text-sm text-red-200">
                <p><span className="text-red-400">Ativo:</span> {account.ban.reason}</p>
                <p className="text-xs text-red-300/70">
                  desde {new Date(account.ban.bannedAt).toLocaleString("pt-BR")} ·{" "}
                  {account.ban.expiresAt ? `expira ${new Date(account.ban.expiresAt).toLocaleString("pt-BR")}` : "permanente"} ·
                  por conta #{account.ban.bannedByAccountId}
                </p>
              </div>
              <Button variant="danger" onClick={onUnban} disabled={busy}>Remover ban</Button>
            </div>
          ) : (
            <div className="flex items-end gap-3">
              <Field label="Motivo" className="flex-1">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex: uso de bot" />
              </Field>
              <Field label="Duração" className="w-40">
                <Select value={durationIdx} onChange={(e) => setDurationIdx(Number(e.target.value))}>
                  {DURATIONS.map((d, i) => (
                    <option key={i} value={i}>{d.label}</option>
                  ))}
                </Select>
              </Field>
              <Button variant="danger" onClick={onBan} disabled={busy}>Banir</Button>
            </div>
          )}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Section title={`Histórico de login (${account.loginHistory.length})`}>
          {account.loginHistory.length === 0 ? (
            <p className="text-xs text-zinc-500">Sem registros.</p>
          ) : (
            <ul className="space-y-1 text-xs text-zinc-400">
              {account.loginHistory.map((l, i) => (
                <li key={i} className="flex justify-between">
                  <span>{new Date(l.at).toLocaleString("pt-BR")}</span>
                  <span className="font-mono">{l.ip}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`Bans anteriores (${account.banHistory.length})`}>
          {account.banHistory.length === 0 ? (
            <p className="text-xs text-zinc-500">Nenhum.</p>
          ) : (
            <ul className="space-y-1 text-xs text-zinc-400">
              {account.banHistory.map((b, i) => (
                <li key={i}>
                  {b?.reason} — {b?.expiresAt ? new Date(b.expiresAt).toLocaleDateString("pt-BR") : "permanente"}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}
