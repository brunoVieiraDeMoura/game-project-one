"use client";

import { NpcForm } from "@/components/NpcForm";

export default function NewNpcPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Novo NPC</h1>
      <NpcForm mode="create" />
    </main>
  );
}
