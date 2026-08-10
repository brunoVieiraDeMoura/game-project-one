/**
 * Resolução de nome de constante rAthena — CASE-INSENSITIVE, porque
 * `script_get_constant` (script.cpp:690-699) resolve por `strcasecmp`, não
 * por igualdade exata. Achado em TRÊS módulos até aqui, cada um com a
 * própria armadilha: `Unit.Id` de Skills (`Firepillar_Active` vs
 * `FUUMASHOUAKU`), `BaseASPD` de Classes (`1hSword`), e agora `Status`/
 * `Icon`/chaves de `States`/`CalcFlags`/etc. de status.yml
 * (`Twohandquicken` vs 9 nomes ALL-CAPS em 1.019 entradas). Infra
 * compartilhada (leia1.txt, aprovação Status 2026-08-07) pra não reinventar
 * a mesma checagem pela quarta vez em NPCs.
 *
 * Nunca deriva grafia mecanicamente (TitleCase, snake_case, etc.) — a
 * grafia "canônica" de cada constante é o que APARECE nos dados reais
 * (`db/re/*.yml`) ou no nome do enum em C++, extraída e verificada, nunca
 * suposta.
 */

export interface CaseInsensitiveLookup {
  /** existe alguma entrada cuja versão minúscula bate com `name`? */
  isValid(name: string): boolean;
  /** grafia CANÔNICA (a que entrou primeiro na lista `names`) pra um nome
   * reconhecido case-insensitively, ou `undefined` se não reconhecido. */
  canonicalOf(name: string): string | undefined;
}

/** Primeira grafia vista por chave minúscula vence — mesma regra usada em
 * `job-class-mapper.ts`/`job-database-writer.ts` (que hoje fazem isso
 * inline; podem migrar pra este helper depois, sem necessidade de tocar
 * neles agora). */
export function buildCaseInsensitiveLookup(names: Iterable<string>): CaseInsensitiveLookup {
  const byLower = new Map<string, string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, name);
  }
  return {
    isValid: (name: string) => byLower.has(name.toLowerCase()),
    canonicalOf: (name: string) => byLower.get(name.toLowerCase()),
  };
}
