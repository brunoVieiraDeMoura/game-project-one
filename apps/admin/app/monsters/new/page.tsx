"use client";

import { MonsterForm } from "@/components/MonsterForm";

export default function NewMonsterPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Novo monstro</h1>
      <MonsterForm mode="create" />
    </main>
  );
}
