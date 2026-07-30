"use client";

import { useState } from "react";
import { reloadServer, reloadStatus } from "@/lib/api";
import { Button } from "./ui";

/**
 * Aplicar as edições no servidor que está rodando.
 *
 * O map-server lê item_db/mob_db/skill_db uma vez, na inicialização: salvar no
 * painel muda o banco (ou o YAML), mas quem está jogando continua vendo o
 * conteúdo antigo até um reload. Salvar já enfileira o reload da base
 * correspondente — este botão existe para forçar na mão (e para recarregar
 * script de NPC, que nenhum formulário toca).
 */
const KINDS = [
  { kind: "itemdb", label: "Itens" },
  { kind: "mobdb", label: "Monstros" },
  { kind: "skilldb", label: "Habilidades" },
  { kind: "script", label: "Scripts de NPC" },
  { kind: "battleconf", label: "Config de batalha" },
] as const;

export function ServerReload() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function apply(kind: (typeof KINDS)[number]["kind"], label: string) {
    setBusy(kind);
    setMessage(null);
    try {
      await reloadServer(kind);
      // O NPC do servidor consulta a fila a cada 2s; esperar um pouco e
      // conferir é a diferença entre "pedi" e "aplicou".
      await new Promise((r) => setTimeout(r, 2500));
      const status = await reloadStatus();
      const applied = status.recent.find((r) => r.kind === kind);
      setMessage(
        applied?.done_at
          ? `${label}: recarregado no servidor.`
          : `${label}: pedido na fila — o servidor aplica em instantes (ou está fora do ar).`,
      );
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <h2 className="text-sm font-semibold text-zinc-200">Aplicar no servidor</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Recarrega a base no map-server em execução, sem reiniciar nada. Salvar um item ou monstro
        já faz isso sozinho.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <Button key={k.kind} variant="outline" disabled={busy !== null} onClick={() => apply(k.kind, k.label)}>
            {busy === k.kind ? "aplicando…" : k.label}
          </Button>
        ))}
      </div>
      {message && <p className="mt-3 text-xs text-zinc-400">{message}</p>}
    </section>
  );
}
