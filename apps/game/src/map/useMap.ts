import { useEffect, useState } from "react";
import { GameMapSchema, type GameMap } from "@ragnarok/map-format";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** Carrega um GameMap da API (GET público). Estados: loading → map | error. */
export function useMap(id: string): { map: GameMap | null; error: string | null } {
  const [map, setMap] = useState<GameMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMap(null);
    setError(null);
    fetch(`${API_URL}/maps/${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}: mapa "${id}" não encontrado`);
        const raw = await r.json();
        // Um mapa do rAthena tem 160.000 células, e o zod valida CADA UMA
        // (enum de colisão, número de altura). É o custo real de carregar o
        // mapa inteiro — a rede some com compressão, isto não. Medido aqui para
        // a decisão de empacotar a colisão em binário ser tomada por número.
        const t0 = performance.now();
        const parsed = GameMapSchema.parse(raw);
        const ms = performance.now() - t0;
        if (import.meta.env.DEV) {
          (window as unknown as { __mapParseMs?: Record<string, number> }).__mapParseMs = {
            ...(window as unknown as { __mapParseMs?: Record<string, number> }).__mapParseMs,
            [id]: Math.round(ms),
          };
        }
        return parsed;
      })
      .then((m) => {
        if (!cancelled) setMap(m);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return { map, error };
}
