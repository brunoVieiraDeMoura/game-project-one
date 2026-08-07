import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Módulo 1 (Undo/Redo) — trava a convenção "uma ação, um push".
 *
 * Três ofensores achados por leitura (dois na auditoria, um na hora de
 * implementar): `resizeMap`, `reseedFeature`/`reseedTerrain` e
 * `placeTileAsset` faziam `histPush` PRÓPRIO além do `beginStroke()` que o
 * chamador de UI já dispara — cada um duplicando (ou, no caso da peça de
 * chão arrastada, multiplicando por célula) o número de passos de undo por
 * um único gesto do usuário. Sem este teste, qualquer um dos três pode
 * regredir em silêncio — os testes de conteúdo do mapa não olham `past`.
 */

function blankMap(w = 12, h = 12): GameMap {
  const n = w * h;
  return {
    id: "t",
    name: "t",
    size: { width: w, height: h },
    cellSize: 1,
    terrainMode: "blocks",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
    ramps: [],
    props: [],
    spawns: [],
    triggers: [],
  } as unknown as GameMap;
}

beforeEach(() => {
  setHexScale(1);
});

describe("convenção de undo — um gesto = um passo, nunca dois", () => {
  it("resizeMap: beginStroke() + 1 chamada = 1 passo (não 2)", () => {
    const s = useEditorStore.getState();
    s.init(blankMap());
    expect(useEditorStore.getState().past.length).toBe(0);
    useEditorStore.getState().beginStroke();
    useEditorStore.getState().resizeMap(20, 20);
    expect(useEditorStore.getState().past.length).toBe(1);
  });

  it("resizeMap: arrastar o slider (várias chamadas no MESMO beginStroke) continua sendo 1 passo", () => {
    const s = useEditorStore.getState();
    s.init(blankMap());
    useEditorStore.getState().beginStroke();
    // onChange dispara várias vezes durante um único arrasto de <input type=range>
    useEditorStore.getState().resizeMap(20, 12);
    useEditorStore.getState().resizeMap(25, 12);
    useEditorStore.getState().resizeMap(30, 12);
    expect(useEditorStore.getState().past.length).toBe(1);
  });

  it("reseedFeature: beginStroke() + 1 chamada = 1 passo (não 2)", () => {
    const s = useEditorStore.getState();
    s.init(blankMap());
    useEditorStore.getState().setEditScope("all");
    useEditorStore.getState().beginStroke();
    useEditorStore.getState().reseedFeature("hill");
    expect(useEditorStore.getState().past.length).toBe(1);
  });

  it("reseedTerrain: beginStroke() + 1 chamada = 1 passo (não 2)", () => {
    const s = useEditorStore.getState();
    s.init(blankMap());
    useEditorStore.getState().setEditScope("all");
    useEditorStore.getState().beginStroke();
    useEditorStore.getState().reseedTerrain();
    expect(useEditorStore.getState().past.length).toBe(1);
  });

  it("placeTileAsset: um traçado inteiro (beginStroke + N células arrastadas) = 1 passo, não N", () => {
    const s = useEditorStore.getState();
    s.init(blankMap());
    useEditorStore.getState().beginStroke(); // 1x no mousedown, como EditorScene faz
    // onMove chama placeTileAsset de novo a cada célula nova do arrasto, sem beginStroke extra
    useEditorStore.getState().placeTileAsset(2, 2, "hex_road_a");
    useEditorStore.getState().placeTileAsset(3, 2, "hex_road_a");
    useEditorStore.getState().placeTileAsset(4, 2, "hex_road_a");
    expect(useEditorStore.getState().past.length).toBe(1);
    // e o traçado de fato pintou as 3 células (a correção não pode ter
    // quebrado a pintura em si, só o número de snapshots)
    const m = useEditorStore.getState().map!;
    expect(m.surface[2 * m.size.width + 2]).toBe("dirt");
    expect(m.surface[2 * m.size.width + 3]).toBe("dirt");
    expect(m.surface[2 * m.size.width + 4]).toBe("dirt");
  });
});
