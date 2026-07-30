"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui";
import { ServerReload } from "../components/ServerReload";

const MODULES = [
  { href: "/items", title: "Itens", status: "Completo", ready: true },
  { href: "/classes", title: "Classes", status: "Completo", ready: true },
  { href: "/skills", title: "Skills", status: "Completo", ready: true },
  { href: "/statuses", title: "Statuses", status: "Catálogo — Fase 3", ready: true },
  { href: "/monsters", title: "Monstros", status: "Completo", ready: true },
  { href: "/npcs", title: "NPCs", status: "Completo", ready: true },
  { href: "/config", title: "Gerenciador Global", status: "Completo", ready: true },
  { href: "/users", title: "Usuários", status: "Completo", ready: true },
  { href: "/maps", title: "Editor de mapas", status: "Completo", ready: true },
  { href: "/game-editor", title: "Editor do game", status: "Ajustes 3D", ready: true },
  { href: "/asset-scaling", title: "Dimensionamento de Assets", status: "Escala default", ready: true },
];

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
      } else {
        setEmail(data.session.user.email ?? null);
      }
    });
  }, [router]);

  async function logout() {
    await supabase?.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">Gerenciamento de conteúdo do servidor</p>
        </div>
        {email && (
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <span>{email}</span>
            <Button variant="outline" onClick={logout}>
              Sair
            </Button>
          </div>
        )}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {MODULES.map((m) => (
          <Link
            key={m.title}
            href={m.href}
            className={`rounded-lg border p-4 transition-colors ${
              m.ready
                ? "border-indigo-800 bg-indigo-950/40 hover:bg-indigo-950/70"
                : "pointer-events-none border-zinc-800 bg-zinc-900/40 opacity-60"
            }`}
          >
            <h2 className="font-medium">{m.title}</h2>
            <p className="mt-1 text-xs text-zinc-500">{m.status}</p>
          </Link>
        ))}
      </div>
      <ServerReload />
    </main>
  );
}
