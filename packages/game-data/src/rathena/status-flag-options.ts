import { CALC_FLAG_READABLE, STATE_READABLE } from "./status-db-mapper";

/**
 * Opções de `MultiSelectField` pra `Status.states[]`/`calcFlags[]` — SÓ
 * esses dois campos (Fase 2c, aprovação leia1.txt). `flags`/`opt2`/`opt3`/
 * `options` ficam de fora desta rodada.
 *
 * Value/description vêm direto de `STATE_READABLE`/`CALC_FLAG_READABLE`
 * (`status-db-mapper.ts`, já a fonte que o Writer usa) — nenhum enum
 * redigitado. As duas tabelas foram completadas nesta mesma tarefa (11
 * chaves que faltavam, confirmadas uma a uma em `status.hpp`, ver
 * `docs/audit/risk-report.md` A1) — agora cobrem o `SCS_*`(24)/
 * `SCB_*`(44+`All`) real por inteiro, então a UI e o Writer nunca mais
 * divergem: toda opção que aparece aqui é gravável.
 */

export type StatusFlagOption = { value: string; label: string; description?: string };

function optionsFrom(table: Record<string, string>, prefix: string): StatusFlagOption[] {
  return Object.entries(table).map(([canonical, readable]) => ({
    value: readable,
    label: readable.replace(/_/g, " "),
    description: canonical === "All" ? "SCB_ALL (especial, zera/aplica tudo)" : `${prefix}_${canonical}`,
  }));
}

export const STATUS_STATE_OPTIONS: StatusFlagOption[] = optionsFrom(STATE_READABLE, "SCS");
export const STATUS_CALC_FLAG_OPTIONS: StatusFlagOption[] = optionsFrom(CALC_FLAG_READABLE, "SCB");
