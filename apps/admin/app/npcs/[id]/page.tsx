"use client";

import { use, useEffect, useState } from "react";
import type { Npc } from "@ragnarok/game-data";
import { getNpc } from "@/lib/api";
import { NpcForm } from "@/components/NpcForm";

export default function EditNpcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const decoded = decodeURIComponent(id);
  const [npc, setNpc] = useState<Npc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getNpc(decoded)
      .then(setNpc)
      .catch((e: Error) => setError(e.message));
  }, [decoded]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">
        Editar NPC {npc ? `"${npc.id}" — ${npc.name}` : `"${decoded}"`}
      </h1>
      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {!npc && !error && <p className="text-zinc-500">Carregando...</p>}
      {npc && <NpcForm mode="edit" initial={npc} />}
    </main>
  );
}
