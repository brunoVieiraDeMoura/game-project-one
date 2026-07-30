"use client";

import { JobClassForm } from "@/components/JobClassForm";

export default function NewClassPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Nova classe</h1>
      <JobClassForm mode="create" />
    </main>
  );
}
