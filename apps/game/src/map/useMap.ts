import { useEffect, useState } from "react";
import { GameMapSchema, type GameMap } from "@ragnarok/map-format";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * Cache de SESSÃO (módulo, sobrevive a remonte de `<PlayView>`/troca de rota)
 * dos mapas já buscados+validados. `GET /maps/:id` é público e o admin não
 * empurra invalidação nenhuma pro cliente do jogo — dentro de uma sessão de
 * jogo, o mapa não muda debaixo do jogador, então reusar é seguro, não só
 * rápido.
 *
 * Existe porque, sem ele, TODO warp — inclusive voltar para um mapa que o
 * jogador acabou de sair — refazia o fetch E os 160.000 `GameMapSchema.parse`
 * de zod do zero, mesmo já tendo os dois resultados disponíveis. Não é o
 * gargalo dos 40-60 s relatados (esse é a cena não montada — ver
 * `SinalizaCenaPronta` em `views/PlayView.tsx`), mas é trabalho jogado fora
 * toda vez que "trocar de mapa → voltar" acontece, e o pedido explícito do
 * usuário foi não destruir cache que pode ser reaproveitado.
 */
const cache = new Map<string, GameMap>();

/** Carrega um GameMap da API (GET público). Estados: loading → map | error. */
export function useMap(id: string): { map: GameMap | null; error: string | null } {
  const [map, setMap] = useState<GameMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMap(null);
    setError(null);
    if (!id) return;

    const emCache = cache.get(id);
    if (emCache) {
      /**
       * Um microtask de folga, de propósito — não `setMap(emCache)` direto
       * aqui em cima.
       *
       * O `setMap(null)` acima e este `setMap` são o sinal que `<Scene>`/
       * `SquareTerrain` usam para saber que HOUVE troca de mapa (o longo
       * comentário em `PlayView.tsx` sobre `ultimoMapa` documenta por que:
       * `{map && <Scene/>}` desmonta e remonta quando `map` passa por
       * `null`). Se os dois `setState` corressem no MESMO commit React os
       * empacotaria num só, o `null` nunca chegaria a comitar, `<Scene>`
       * NUNCA desmontaria para o mapa novo, e o cache de chunk do mapa
       * ANTERIOR (`SquareTerrain`, por posição de chunk) ficaria vivo sob os
       * dados do mapa seguinte — que não tem a invalidação incremental
       * (`chunksSujos`) preparada pra isso, só para EDIÇÃO dentro do MESMO
       * mapa. O microtask garante que o `null` pinta primeiro; o ganho
       * continua sendo pular rede + os 160.000 `zod.parse`, não pular o
       * remonte.
       */
      queueMicrotask(() => {
        if (!cancelled) setMap(emCache);
      });
      return () => {
        cancelled = true;
      };
    }

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
        if (cancelled) return;
        cache.set(id, m);
        setMap(m);
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
