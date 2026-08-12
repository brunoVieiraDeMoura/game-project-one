import { describe, expect, it } from "vitest";
import type { MapProp } from "@ragnarok/map-format";
import { agruparPorEspecie, especiesDoMapa, ehCategoriaInstanciavel, CATEGORIAS_INSTANCIAVEIS } from "./VegetationInstancer";

function prop(overrides: Partial<MapProp>): MapProp {
  return {
    id: "p1",
    assetId: "grass_common_short",
    position: [10, 0, 20],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  } as MapProp;
}

describe("ehCategoriaInstanciavel", () => {
  it("cobre grama, flor, planta, arbusto, árvore e árvore seca", () => {
    expect(CATEGORIAS_INSTANCIAVEIS).toEqual(new Set(["grass", "flower", "plant", "bush", "tree", "tree_bare"]));
  });

  it("rocha/construção/estrada não entram", () => {
    expect(ehCategoriaInstanciavel("rock_medium_1")).toBe(false);
    expect(ehCategoriaInstanciavel("hex_building_grain")).toBe(false);
  });

  it("assetId desconhecido não quebra e devolve false", () => {
    expect(ehCategoriaInstanciavel("nao-existe")).toBe(false);
  });
});

describe("agruparPorEspecie", () => {
  it("agrupa por assetId — 3 árvores da mesma espécie viram 1 grupo de 3", () => {
    const props = [
      prop({ id: "a", assetId: "commontree_1" }),
      prop({ id: "b", assetId: "commontree_1" }),
      prop({ id: "c", assetId: "commontree_1" }),
    ];
    const grupos = agruparPorEspecie(props);
    expect(grupos.size).toBe(1);
    expect(grupos.get("commontree_1")).toHaveLength(3);
  });

  it("espécies diferentes viram grupos diferentes", () => {
    const props = [prop({ id: "a", assetId: "commontree_1" }), prop({ id: "b", assetId: "pine_1" })];
    const grupos = agruparPorEspecie(props);
    expect(grupos.size).toBe(2);
  });

  it("categoria não instanciável (rocha) fica de fora", () => {
    const props = [prop({ id: "a", assetId: "commontree_1" }), prop({ id: "b", assetId: "rock_medium_1" })];
    const grupos = agruparPorEspecie(props);
    expect(grupos.size).toBe(1);
    expect(grupos.has("rock_medium_1")).toBe(false);
  });

  it("cada instância carrega posição/rotação/escala corretas do prop", () => {
    const grupos = agruparPorEspecie([prop({ position: [5, 1, 8], rotation: [0, 1.2, 0], scale: [2, 2, 2] })]);
    const [inst] = grupos.get("grass_common_short")!;
    expect(inst!.position.x).toBe(5);
    expect(inst!.position.y).toBe(1);
    expect(inst!.position.z).toBe(8);
    expect(inst!.scale.x).toBe(2);
    // quaternion Y=1.2rad — confere que não ficou identidade
    expect(Math.abs(inst!.quaternion.y)).toBeGreaterThan(0);
  });

  it("assetId desconhecido (sem url no registry) não vira instância", () => {
    const grupos = agruparPorEspecie([prop({ assetId: "isso-nao-existe" })]);
    expect(grupos.size).toBe(0);
  });

  it("mapa sem props devolve mapa vazio", () => {
    expect(agruparPorEspecie([]).size).toBe(0);
  });
});

describe("especiesDoMapa", () => {
  it("deduplica por assetId — 200 arbustos da mesma espécie viram 1 entrada", () => {
    const props = Array.from({ length: 200 }, (_, i) => prop({ id: `b${i}`, assetId: "bush_common" }));
    expect(especiesDoMapa(props)).toEqual([{ assetId: "bush_common", url: expect.stringContaining("Bush_Common") }]);
  });

  it("ordena por assetId, cobrindo várias categorias instanciáveis", () => {
    const props = [
      prop({ id: "a", assetId: "pine_2" }),
      prop({ id: "b", assetId: "bush_common" }),
      prop({ id: "c", assetId: "grass_common_short" }),
      prop({ id: "d", assetId: "deadtree_1" }),
    ];
    const nomes = especiesDoMapa(props).map((e) => e.assetId);
    expect(nomes).toEqual([...nomes].sort());
    expect(nomes).toContain("pine_2");
    expect(nomes).toContain("bush_common");
    expect(nomes).toContain("grass_common_short");
    expect(nomes).toContain("deadtree_1");
  });

  it("categoria fora da lista (pedra, construção) não entra", () => {
    expect(especiesDoMapa([prop({ assetId: "rock_medium_1" }), prop({ assetId: "hex_building_grain" })])).toEqual([]);
  });
});
