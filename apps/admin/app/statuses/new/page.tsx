"use client";

import { StatusForm } from "@/components/StatusForm";

export default function NewStatusPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Novo status</h1>
      <StatusForm mode="create" />
    </main>
  );
}
