/**
 * Diff genérico usado pelo Audit Log (auditoria 2026-08-13, PARTE 10/11): só
 * registra um campo como alterado quando o valor REALMENTE mudou — comparação
 * por valor (`JSON.stringify`), nunca por referência, e arrays comparados por
 * CONJUNTO de elementos (não por índice/ordem), senão reordenar um array sem
 * mudar seu conteúdo contaria como alteração falsa.
 *
 * Não é específico de nenhuma entidade — Item, Skill, JobClass, Monster, Npc
 * e Status usam a mesma função sobre o objeto de domínio inteiro.
 */

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Diferença de CONJUNTO entre dois arrays (por valor, via JSON.stringify de
 * cada elemento) — retorna só o que foi removido/adicionado, ignorando
 * reordenação pura. `null` quando os dois arrays têm o mesmo conjunto de
 * elementos (nenhuma mudança real). */
function arraySetDiff(before: unknown[], after: unknown[]): { removed: unknown[]; added: unknown[] } | null {
  const beforeKeys = before.map((v) => JSON.stringify(v));
  const afterKeys = after.map((v) => JSON.stringify(v));
  const removed = before.filter((_, i) => !afterKeys.includes(beforeKeys[i]!));
  const added = after.filter((_, i) => !beforeKeys.includes(afterKeys[i]!));
  if (removed.length === 0 && added.length === 0) return null;
  return { removed, added };
}

/**
 * Compara `before`/`after` campo a campo (nível superior do objeto de
 * domínio) e devolve só os campos que mudaram de verdade. `before`
 * `undefined` (criação) faz todo campo presente em `after` contar como
 * alterado — quem chama para criação normalmente prefere `logCreate` (que
 * não faz diff, só registra o snapshot inteiro), este caminho existe pra
 * quando um diff explícito também fizer sentido numa criação.
 */
export function diffFields(before: Record<string, unknown> | undefined, after: Record<string, unknown>): FieldChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  const changes: FieldChange[] = [];

  for (const key of keys) {
    const a = before?.[key];
    const b = after[key];

    if (Array.isArray(a) && Array.isArray(b)) {
      const setDiff = arraySetDiff(a, b);
      if (!setDiff) continue;
      changes.push({ field: key, oldValue: setDiff.removed, newValue: setDiff.added });
      continue;
    }

    // objetos aninhados: comparação por valor via JSON.stringify já é
    // suficiente (chave a mais/menos ou valor diferente muda a string) —
    // não precisa de diff recursivo por campo aqui, só não pode ser
    // comparação de referência (`a === b`), que é exatamente o que
    // JSON.stringify evita pros dois casos (objeto e array).
    if (isPlainRecord(a) || isPlainRecord(b)) {
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      changes.push({ field: key, oldValue: a ?? null, newValue: b ?? null });
      continue;
    }

    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    changes.push({ field: key, oldValue: a ?? null, newValue: b ?? null });
  }

  return changes;
}
