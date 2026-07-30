"use client";

import { use, useEffect, useState } from "react";
import type { Skill } from "@ragnarok/game-data";
import { getSkill } from "@/lib/api";
import { SkillForm } from "@/components/SkillForm";

export default function EditSkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSkill(Number(id))
      .then(setSkill)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">
        Editar skill {skill ? `#${skill.id} — ${skill.name}` : `#${id}`}
      </h1>
      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {!skill && !error && <p className="text-zinc-500">Carregando...</p>}
      {skill && <SkillForm mode="edit" initial={skill} />}
    </main>
  );
}
