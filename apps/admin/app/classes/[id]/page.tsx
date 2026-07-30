"use client";

import { use, useEffect, useState } from "react";
import type { JobClass } from "@ragnarok/game-data";
import { getJobClass } from "@/lib/api";
import { JobClassForm } from "@/components/JobClassForm";

export default function EditClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [jobClass, setJobClass] = useState<JobClass | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJobClass(Number(id))
      .then(setJobClass)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">
        Editar classe {jobClass ? `#${jobClass.id} — ${jobClass.name}` : `#${id}`}
      </h1>
      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {!jobClass && !error && <p className="text-zinc-500">Carregando...</p>}
      {jobClass && <JobClassForm mode="edit" initial={jobClass} />}
    </main>
  );
}
