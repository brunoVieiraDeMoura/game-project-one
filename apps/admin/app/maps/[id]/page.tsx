"use client";

import { use, useEffect, useRef, useState } from "react";
import type { GameMap } from "@ragnarok/map-format";
import { updateMap, createMap } from "@/lib/api";

/**
 * Editor de mapas 3D (substitui o editor 2D). Embute o editor do game
 * (localhost:3001/editor) num iframe; a edição 3D (colocar/mover/girar/escalar
 * props com os assets da floresta) acontece lá. O salvar é delegado a esta
 * página autenticada: o iframe manda o GameMap via postMessage e aqui fazemos
 * o PUT com o token de admin, respondendo o resultado.
 */
const GAME_URL = process.env.NEXT_PUBLIC_GAME_URL ?? "http://localhost:3001";

export default function EditMapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const decoded = decodeURIComponent(id);
  const isNewRoute = decoded === "new";
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [saveState, setSaveState] = useState<string>("");

  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      if (e.data?.type !== "ragnarok:save-map") return;
      const map = e.data.map as GameMap;
      setSaveState("Salvando…");
      const reply = (ok: boolean, error?: string) =>
        iframeRef.current?.contentWindow?.postMessage({ type: "ragnarok:save-result", ok, error }, "*");
      try {
        // robusto: tenta atualizar; se o mapa ainda não existe (404), cria.
        // Assim funciona pro 1º save (cria) e pros seguintes (substitui).
        try {
          await updateMap(map.id, map);
        } catch {
          await createMap(map);
        }
        setSaveState(`Salvo ✓ (${map.props.length} props) — ${new Date().toLocaleTimeString("pt-BR")}`);
        reply(true);
      } catch (err) {
        const msg = (err as Error).message;
        setSaveState(`Erro: ${msg}`);
        reply(false, msg);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [decoded]);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <h1 className="text-sm font-semibold">Editor de mapa · {isNewRoute ? "novo" : decoded}</h1>
        <span className="text-xs text-zinc-500">{saveState}</span>
      </div>
      <iframe
        ref={iframeRef}
        src={isNewRoute ? `${GAME_URL}/editor?new=1` : `${GAME_URL}/editor?map=${encodeURIComponent(decoded)}`}
        className="flex-1 border-0"
        title="Editor de mapas 3D"
      />
    </main>
  );
}
