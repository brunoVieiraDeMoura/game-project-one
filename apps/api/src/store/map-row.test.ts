import { describe, it, expect } from "vitest";
import { createBlankMap } from "@ragnarok/map-format";
import { mapToRow, rowToMap, type MapRow } from "./map-row";

describe("map-row round-trip (terreno em blocos)", () => {
  it("preserva terrainMode + surface via metadata jsonb", () => {
    const map = createBlankMap("t", "Teste", 4, 4); // terrainMode "blocks", surface cheio
    map.surface[0] = "water";
    map.heightmap[5] = 3;
    map.triggers = [
      { id: "tr1", kind: "warp", area: { col: 1, row: 1, w: 2, h: 2 }, target: { mapId: "prontera", col: 5, row: 6 } },
      { id: "tr2", kind: "damage", area: { col: 0, row: 0, w: 1, h: 1 }, value: 25 },
    ];

    const row = mapToRow(map) as unknown as MapRow;
    const back = rowToMap(row);

    expect(back.terrainMode).toBe("blocks");
    expect(back.surface).toHaveLength(16);
    expect(back.surface[0]).toBe("water");
    expect(back.heightmap[5]).toBe(3);
    // triggers preservados via stash
    expect(back.triggers).toHaveLength(2);
    expect(back.triggers[0]).toMatchObject({ kind: "warp", target: { mapId: "prontera", col: 5, row: 6 } });
    expect(back.triggers[1]).toMatchObject({ kind: "damage", value: 25 });
    // metadata limpo (sem a chave interna _blocks)
    expect((back.metadata as Record<string, unknown>)._blocks).toBeUndefined();
    expect(back.metadata.version).toBe(map.metadata.version);
  });

  it("mapa legado (smooth) continua smooth", () => {
    const map = createBlankMap("s", "Smooth", 3, 3);
    map.terrainMode = "smooth";
    const back = rowToMap(mapToRow(map) as unknown as MapRow);
    expect(back.terrainMode).toBe("smooth");
  });
});
