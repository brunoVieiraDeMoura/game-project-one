"use client";

import { use, useEffect, useState } from "react";
import type { StatusEffectDef } from "@ragnarok/game-data";
import { getStatus } from "@/lib/api";
import { StatusForm } from "@/components/StatusForm";

export default function EditStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [status, setStatus] = useState<StatusEffectDef | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStatus(id)
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">
        Editar status {status ? `"${status.id}" — ${status.name}` : `"${id}"`}
      </h1>
      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {!status && !error && <p className="text-zinc-500">Carregando...</p>}
      {status && <StatusForm mode="edit" initial={status} />}
    </main>
  );
}
