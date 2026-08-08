/**
 * Extração de `enum` do C++ do rAthena — infra COMPARTILHADA (leia1.txt,
 * aprovação Status 2026-08-07): Skills (`Unit.Id`/174 `UNT_*`) e Classes
 * (`enum e_job` em migrate-jobs.ts) já fizeram isso ad-hoc, cada um com o
 * próprio regex. Daqui em diante é uma função só — quem precisar (Status
 * agora, NPCs depois) reusa em vez de reescrever o parsing.
 *
 * Só extrai NOMES (não resolve valor numérico — quem precisa de id
 * sequencial, como `enum e_job`, continua com extração própria, já que o
 * cálculo de `= valor` explícito é mais específico do que vale a pena
 * generalizar aqui). Serve pra construir lista de validação
 * case-insensitive (`case-insensitive-lookup.ts`), não pra runtime do jogo.
 */

/** Acha o bloco `enum <nome> [: tipo] { ... };` e devolve o texto entre chaves. */
function extractEnumBody(source: string, enumName: string): string {
  const marker = new RegExp(`enum\\s+${enumName}\\b[^{]*\\{`);
  const match = marker.exec(source);
  if (!match) throw new Error(`enum ${enumName} não encontrado no arquivo`);
  const braceStart = match.index + match[0].length - 1;
  const end = source.indexOf("};", braceStart);
  if (end < 0) throw new Error(`enum ${enumName}: "};" de fechamento não encontrado`);
  return source.slice(braceStart + 1, end);
}

/**
 * Nomes declarados dentro do enum, na ORDEM em que aparecem (primeiro
 * token de cada entrada, antes de `=`/`,`/comentário). Inclui alias como
 * `SC_COMMON_MIN = SC_STONE` (nome próprio, mesmo sendo um apelido de
 * valor) — sobra inofensiva numa lista de validação permissiva, não vale a
 * complexidade de filtrar.
 */
export function parseCppEnumConstants(source: string, enumName: string): string[] {
  const body = extractEnumBody(source, enumName);
  const names: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (m) names.push(m[1]!);
  }
  return names;
}

/** `parseCppEnumConstants` + descarta o prefixo comum (ex. "SCS_") — é o
 * que a maioria dos chamadores realmente quer, já que o YAML usa a chave
 * SEM o prefixo (`States: NoMove:` não `States: SCS_NoMove:`). */
export function parseCppEnumSuffixes(source: string, enumName: string, prefix: string): string[] {
  return parseCppEnumConstants(source, enumName)
    .filter((n) => n.startsWith(prefix))
    .map((n) => n.slice(prefix.length))
    .filter((n) => n.length > 0);
}
