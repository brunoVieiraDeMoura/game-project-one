"use client";

import { use, useEffect, useState } from "react";
import type { Monster } from "@ragnarok/game-data";
import { getMonster } from "@/lib/api";
import { MonsterForm } from "@/components/MonsterForm";

export default function EditMonsterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [monster, setMonster] = useState<Monster | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMonster(Number(id))
      .then(setMonster)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">
        Editar monstro {monster ? `#${monster.id} — ${monster.name}` : `#${id}`}
      </h1>
      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {!monster && !error && <p className="text-zinc-500">Carregando...</p>}
      {monster && <MonsterForm mode="edit" initial={monster} />}
    </main>
  );
}
