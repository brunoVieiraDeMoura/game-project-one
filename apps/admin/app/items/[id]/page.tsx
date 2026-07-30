"use client";

import { use, useEffect, useState } from "react";
import type { Item } from "@ragnarok/game-data";
import { getItem } from "@/lib/api";
import { ItemForm } from "@/components/ItemForm";

export default function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getItem(Number(id))
      .then(setItem)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">
        Editar item {item ? `#${item.id} — ${item.name}` : `#${id}`}
      </h1>
      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {!item && !error && <p className="text-zinc-500">Carregando...</p>}
      {item && <ItemForm mode="edit" initial={item} />}
    </main>
  );
}
