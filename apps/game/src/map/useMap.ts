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
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info(`[MAP_CACHE] ${emCache ? "HIT" : "MISS"} ${id}`);
    }
    if (emCache) {
      /**
       * Direto — sem `queueMicrotask` de folga. A versão anterior deste
       * arquivo adiava este `setMap` por um microtask torcendo para o
       * `setMap(null)` de cima comitar sozinho antes, e ASSIM forçar
       * `<Scene>`/`SquareTerrain` a desmontar de verdade antes do mapa
       * novo chegar — mas o React pode empacotar os dois de qualquer jeito
       * (o `queueMicrotask` não garante um commit em separado), e foi
       * exatamente isso que aconteceu ao vivo: `<Scene>` não desmontava, o
       * cache de chunk por coordenada (`cx,cz`) do mapa ANTERIOR ficava de
       * pé recebendo os dados do mapa NOVO, a invalidação incremental
       * (`chunksSujos`, pensada só para EDIÇÃO dentro do mesmo mapa)
       * comparava dois mapas diferentes célula a célula, e o mesmo `key`
       * de chunk entrava duas vezes em `visible` — "Encountered two
       * children with the same key", um `useMemo` reconstruindo o mapa
       * inteiro por engano, e a cortina nunca resolvendo.
       *
       * A garantia de remonte agora é `key={mapId}` no `<Scene>`/
       * `<SinalizaCenaPronta>` (`views/PlayView.tsx`) — identidade do
       * React, não timing de commit. Com ela, este hook não precisa mais
       * fingir um "null primeiro": pode entregar o mapa em cache direto,
       * mais rápido, e o remonte continua garantido de qualquer jeito.
       */
      setMap(emCache);
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
          // eslint-disable-next-line no-console
          console.info(`[MAP_CACHE] MISS ${id} — fetch+zod.parse: ${Math.round(ms)}ms`);
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
