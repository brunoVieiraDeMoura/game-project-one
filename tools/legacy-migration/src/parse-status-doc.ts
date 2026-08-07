/**
 * Parser de `rathena/doc/status_change.txt` — a única fonte com descrição
 * humana de status change no rAthena (`status.yml` não tem campo nenhum
 * disso, ver skill-map-format/soul.txt: a migração de status é lossless em
 * relação ao yml, este arquivo é enriquecimento ADITIVO, não substituição).
 *
 * Formato (comentário do próprio arquivo, linhas 16-22):
 * ```
 * <SC_Name>	(<Default_EFST>)
 * 	desc: <descrição>
 * 	val1: <uso>
 * 	val2: <uso>
 * 	val3: <uso>
 * 	val4: <uso>
 * ```
 *
 * O cabeçalho tem que ser ancorado com TAB (`SC_NOME\t`), não só `^SC_`: sem
 * o tab, referências cruzadas dentro de outros `desc:` (ex. "ignore Steal &
 * Lex Aeterna") inflam a contagem de headers de 651 pra 673 — medido com
 * `grep -c '^SC_'` vs `grep -cP '^SC_[A-Za-z0-9_]+\t'`.
 */

export interface StatusDocEntry {
  desc: string;
  /** "1: Skill Level", "2: Caster's object ID (for mob_log_damage)" — o índice fica no texto, então um val ausente não desloca os outros */
  params: string[];
}

const HEADER_RE = /^SC_([A-Za-z0-9_]+)\t/;

export function parseStatusChangeDoc(raw: string): Map<string, StatusDocEntry> {
  const result = new Map<string, StatusDocEntry>();
  // split ANTES de cada header real (início de linha + "SC_...\t") — é essa
  // exigência de tab logo após o nome que descarta as referências cruzadas
  const blocks = raw.split(/\n(?=SC_[A-Za-z0-9_]+\t)/);

  for (const block of blocks) {
    const header = block.match(HEADER_RE);
    if (!header) continue;
    const id = header[1]!.toLowerCase();

    const descMatch = block.match(/\n[ \t]*desc:[ \t]*(.*)/);
    const desc = descMatch ? descMatch[1]!.trim() : "";

    const params: string[] = [];
    for (const m of block.matchAll(/\n[ \t]*val(\d):[ \t]*(.*)/g)) {
      const text = m[2]!.trim();
      if (text) params.push(`${m[1]}: ${text}`);
    }

    if (desc || params.length > 0) result.set(id, { desc, params });
  }

  return result;
}
