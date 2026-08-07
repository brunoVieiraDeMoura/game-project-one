import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { areaToBox } from "./EditorScene";

/**
 * Módulo 5 (Renderização) — `areaToBox` era o único lugar de `EditorScene.tsx`
 * que ignorava a grade do mapa e usava `hexToWorld`/`HEX_W`/`HEX_V` fixos do
 * mundo hexagonal. Num mapa `terrainMode: "square"` (importado do rAthena),
 * a caixa de um gatilho saía na posição/escala erradas, porque a célula
 * quadrada não passa por `hexScale` (CLAUDE.md).
 *
 * Este teste não recria a grade de verdade (isso é `grid/squareGrid.ts` e
 * `hex/hexGrid.ts`, já testados à parte) — só prova que `areaToBox` USA os
 * parâmetros de grade recebidos em vez de uma conversão fixa embutida.
 */
function mapaPlano(w = 20, h = 20): GameMap {
  const n = w * h;
  return {
    id: "t",
    name: "t",
    size: { width: w, height: h },
    cellSize: 2,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
    ramps: [],
    props: [],
    spawns: [],
    triggers: [],
  } as unknown as GameMap;
}

describe("areaToBox usa a grade recebida, não uma conversão fixa", () => {
  const area = { col: 5, row: 5, w: 3, h: 3 };

  it("grade 'quadrada' (célula de 2 unidades): a caixa sai proporcional a 2", () => {
    const cellToWorld = (col: number, row: number) => ({ x: col * 2, z: row * 2 });
    const b = areaToBox(mapaPlano(), area, cellToWorld, 2, 2, (lvl) => lvl);
    // 3 células de 2 unidades = 6 de lado
    expect(b.sx).toBeCloseTo(6, 6);
    expect(b.sz).toBeCloseTo(6, 6);
    // centro em col 5..7, row 5..7 → (5+7)/2=6 → 6*2=12, mais meia-célula de cada
    // lado já embutida no min/max (a caixa cobre exatamente as 3 células)
    expect(b.cx).toBeCloseTo(12, 6);
    expect(b.cz).toBeCloseTo(12, 6);
  });

  it("grade 'hexagonal' (célula de 11,5 unidades): a MESMA área sai bem maior", () => {
    const cellToWorld = (col: number, row: number) => ({ x: col * 11.5, z: row * 11.5 });
    const b = areaToBox(mapaPlano(), area, cellToWorld, 11.5, 11.5, (lvl) => lvl);
    expect(b.sx).toBeCloseTo(3 * 11.5, 6);
    expect(b.sz).toBeCloseTo(3 * 11.5, 6);
    // é ISTO que provava o bug: antes da correção, trocar cellToWorld/cellW/
    // cellD não mudava nada no resultado (a função usava hexToWorld/HEX_W()
    // fixos por dentro) — agora o tamanho da caixa acompanha a grade passada
  });

  it("levelY recebido é o que decide a altura da caixa, não `levelToY` do mundo hex", () => {
    const map = mapaPlano();
    map.heightmap[6 * 20 + 6] = 3; // célula central da área (arredondada)
    const cellToWorld = (col: number, row: number) => ({ x: col, z: row });
    const b = areaToBox(map, area, cellToWorld, 1, 1, (lvl) => lvl * 100);
    expect(b.y).toBe(300);
  });
});
