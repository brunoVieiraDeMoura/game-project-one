import { describe, expect, it } from "vitest";
import { MONSTER_MODES } from "@ragnarok/game-data";
import { MODE_COLUMNS } from "./mysql-monster-row";

describe("MONSTER_MODES (game-data, opções do admin) vs MODE_COLUMNS (colunas reais do mob_db_re)", () => {
  it("é superset — toda coluna real tem opção correspondente na UI", () => {
    for (const column of MODE_COLUMNS) {
      expect(MONSTER_MODES).toContain(column);
    }
  });

  it("não tem token a mais que a UI ofereceria sem coluna pra gravar", () => {
    for (const mode of MONSTER_MODES) {
      expect(MODE_COLUMNS as readonly string[]).toContain(mode);
    }
  });

  it("é exatamente o mesmo conjunto (26), não só superset", () => {
    expect(new Set(MONSTER_MODES)).toEqual(new Set(MODE_COLUMNS));
  });
});
