"use client";

import { SkillForm } from "@/components/SkillForm";

export default function NewSkillPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Nova skill</h1>
      <SkillForm mode="create" />
    </main>
  );
}
