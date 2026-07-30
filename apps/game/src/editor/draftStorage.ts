import type { GameMap } from "@ragnarok/map-format";

const PREFIX = "ragnarok.editor.draft.";
/** quantos rascunhos ficam guardados; o mais velho sai quando entra um novo */
const MAX_DRAFTS = 3;

interface DraftEntry {
  key: string;
  ts: number;
  bytes: number;
}

function listDrafts(): DraftEntry[] {
  const out: DraftEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const raw = localStorage.getItem(key) ?? "";
    let ts = 0;
    try {
      ts = JSON.parse(raw).ts ?? 0;
    } catch {
      ts = 0; // rascunho corrompido: vira o primeiro candidato a sair
    }
    out.push({ key, ts, bytes: raw.length });
  }
  return out.sort((a, b) => a.ts - b.ts); // mais velho primeiro
}

/**
 * Grava o rascunho do mapa, podando os antigos.
 *
 * Um mapa hex serializado passa de 1 MB (colisão + props célula a célula) e o
 * localStorage do domínio tem ~5 MB no total. Guardar um rascunho por mapa
 * editado — sem nunca apagar — enchia a cota, e aí TODO `setItem` do site
 * passava a falhar, inclusive os do jogo (barra de habilidades). O rascunho é
 * uma rede de segurança de curto prazo: manter os três últimos basta.
 *
 * Devolve `true` se conseguiu gravar.
 */
export function saveDraft(map: GameMap): boolean {
  const key = `${PREFIX}${map.id}`;
  const payload = JSON.stringify({ map, ts: Date.now() });

  // poda ANTES de gravar: contando o que este mapa já ocupa como espaço livre
  const drafts = listDrafts().filter((d) => d.key !== key);
  while (drafts.length >= MAX_DRAFTS) {
    const oldest = drafts.shift();
    if (oldest) localStorage.removeItem(oldest.key);
  }

  try {
    localStorage.setItem(key, payload);
    return true;
  } catch {
    // ainda estourou: joga fora os outros rascunhos e tenta uma última vez.
    // Perder rascunho velho é melhor que perder o do mapa aberto agora.
    for (const d of listDrafts()) if (d.key !== key) localStorage.removeItem(d.key);
    try {
      localStorage.setItem(key, payload);
      return true;
    } catch {
      return false;
    }
  }
}
