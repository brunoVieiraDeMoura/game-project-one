import { describe, expect, it } from "vitest";
import type { MapProp } from "@ragnarok/map-format";
import { buildTreeImpostorInstances, collectTreeSpecies } from "./TreeImpostors";

function prop(overrides: Partial<MapProp>): MapProp {
  return {
    id: "p1",
    assetId: "commontree_1",
    position: [10, 0, 20],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  } as MapProp;
}

describe("buildTreeImpostorInstances", () => {
  it("árvore/árvore seca/arbusto viram instância — resto do catálogo (pedra, construção…) fica de fora", () => {
    const props = [
      prop({ id: "a", assetId: "commontree_1" }), // tree
      prop({ id: "b", assetId: "deadtree_1" }), // tree_bare
      prop({ id: "c", assetId: "bush_common" }), // bush — Fase 2 (mesma copa/silhueta, mesmo billboard)
      prop({ id: "d", assetId: "rock_medium_1" }), // rock
      prop({ id: "e", assetId: "hex_building_grain" }), // building
      prop({ id: "f", assetId: "assetid-desconhecido" }), // não resolve categoria nem url
    ];
    const instances = buildTreeImpostorInstances(props);
    expect(instances.length).toBe(3);
  });

  it("posição da instância é a MESMA do prop, sem recalcular altura", () => {
    const instances = buildTreeImpostorInstances([prop({ position: [4, 1.5, 8] })]);
    expect(instances[0]!.position.x).toBe(4);
    expect(instances[0]!.position.y).toBe(1.5);
    expect(instances[0]!.position.z).toBe(8);
  });

  it("guarda o assetId — quem decide tamanho/imagem é o atlas, não esta função", () => {
    const [viva] = buildTreeImpostorInstances([prop({ assetId: "commontree_1" })]);
    const [seca] = buildTreeImpostorInstances([prop({ assetId: "deadtree_1" })]);
    expect(viva!.assetId).toBe("commontree_1");
    expect(seca!.assetId).toBe("deadtree_1");
  });

  it("escala vem do scale[0] do prop (mesma leitura que PropInstance usa)", () => {
    const [inst] = buildTreeImpostorInstances([prop({ scale: [2.5, 2.5, 2.5] })]);
    expect(inst!.scale).toBe(2.5);
  });

  it("flip é determinístico pelo id — mesma árvore sempre espelha do mesmo jeito", () => {
    const a1 = buildTreeImpostorInstances([prop({ id: "g6w7e75_tree_142" })])[0]!.flip;
    const a2 = buildTreeImpostorInstances([prop({ id: "g6w7e75_tree_142" })])[0]!.flip;
    expect(a1).toBe(a2);
    expect([1, -1]).toContain(a1);
  });

  it("mapa sem árvore nenhuma devolve lista vazia (não quebra em mapa 'smooth' legado)", () => {
    expect(buildTreeImpostorInstances([])).toEqual([]);
    expect(buildTreeImpostorInstances([prop({ assetId: "grass_common_short" })])).toEqual([]);
  });

  it("assetId desconhecido (sem url no registry) não vira instância — nada pra bakear", () => {
    expect(buildTreeImpostorInstances([prop({ assetId: "isso-nao-existe" })])).toEqual([]);
  });
});

describe("collectTreeSpecies", () => {
  it("deduplica por assetId — 500 árvores da mesma espécie viram 1 entrada", () => {
    const props = Array.from({ length: 500 }, (_, i) => prop({ id: `t${i}`, assetId: "commontree_1" }));
    expect(collectTreeSpecies(props)).toEqual([{ assetId: "commontree_1", url: expect.stringContaining("CommonTree_1") }]);
  });

  it("uma entrada por espécie distinta, ordenada por assetId", () => {
    const props = [
      prop({ id: "a", assetId: "pine_2" }),
      prop({ id: "b", assetId: "commontree_1" }),
      prop({ id: "c", assetId: "deadtree_1" }),
    ];
    const species = collectTreeSpecies(props);
    expect(species.map((s) => s.assetId)).toEqual(["commontree_1", "deadtree_1", "pine_2"]);
  });

  it("bush entra no atlas (Fase 2); pedra/construção continuam fora", () => {
    const props = [prop({ assetId: "bush_common" }), prop({ assetId: "rock_medium_1" })];
    expect(collectTreeSpecies(props)).toEqual([{ assetId: "bush_common", url: expect.stringContaining("Bush_Common") }]);
  });

  it("mapa sem árvore devolve lista vazia", () => {
    expect(collectTreeSpecies([])).toEqual([]);
  });
});
