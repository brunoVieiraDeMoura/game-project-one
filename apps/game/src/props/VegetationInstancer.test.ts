import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { MapProp } from "@ragnarok/map-format";
import {
  agruparPorEspecie,
  especiesDoMapa,
  ehCategoriaInstanciavel,
  CATEGORIAS_INSTANCIAVEIS,
  densidadeMantida,
  instanciasVisiveisNaCamada,
  ANEIS_DENSIDADE_RASTEIRA,
  type InstanciaVegetacao,
} from "./VegetationInstancer";

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
  it("cobre grama, flor, planta, arbusto, árvore, árvore seca, rocha e pedra", () => {
    expect(CATEGORIAS_INSTANCIAVEIS).toEqual(new Set(["grass", "flower", "plant", "bush", "tree", "tree_bare", "rock", "stone"]));
  });

  it("rocha/pedra ENTRAM (Fase de instancing de pedra) — props repetidos, sem identidade individual", () => {
    expect(ehCategoriaInstanciavel("rock_medium_1")).toBe(true);
    expect(ehCategoriaInstanciavel("pebble_round_1")).toBe(true);
  });

  it("construção/estrada continuam de fora — landmark, não decoração repetida", () => {
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

  it("rocha ENTRA (agora instanciável); construção continua fora", () => {
    const props = [
      prop({ id: "a", assetId: "commontree_1" }),
      prop({ id: "b", assetId: "rock_medium_1" }),
      prop({ id: "c", assetId: "hex_building_grain" }),
    ];
    const grupos = agruparPorEspecie(props);
    expect(grupos.size).toBe(2);
    expect(grupos.has("rock_medium_1")).toBe(true);
    expect(grupos.has("hex_building_grain")).toBe(false);
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

  it("rocha/pedra entram; construção continua fora da lista", () => {
    const especies = especiesDoMapa([
      prop({ id: "a", assetId: "rock_medium_1" }),
      prop({ id: "b", assetId: "pebble_round_1" }),
      prop({ id: "c", assetId: "hex_building_grain" }),
    ]);
    const nomes = especies.map((e) => e.assetId);
    expect(nomes).toContain("rock_medium_1");
    expect(nomes).toContain("pebble_round_1");
    expect(nomes).not.toContain("hex_building_grain");
  });
});

describe("densidadeMantida — densidade adaptativa de vegetação rasteira", () => {
  it("mantém 100% perto (dentro do primeiro anel)", () => {
    expect(densidadeMantida(0)).toBe(1);
    expect(densidadeMantida(0.4)).toBe(1);
  });

  it("reduz no anel médio", () => {
    expect(densidadeMantida(0.41)).toBeLessThan(1);
    expect(densidadeMantida(0.7)).toBe(0.6);
  });

  it("reduz mais no anel externo, antes do corte total", () => {
    expect(densidadeMantida(0.71)).toBeLessThan(0.6);
    expect(densidadeMantida(1)).toBe(0.3);
  });

  it("nunca cresce ao se afastar — monotônica decrescente", () => {
    const fracoes = [0, 0.2, 0.4, 0.5, 0.7, 0.85, 1];
    const valores = fracoes.map((f) => densidadeMantida(f));
    for (let i = 1; i < valores.length; i++) expect(valores[i]!).toBeLessThanOrEqual(valores[i - 1]!);
  });

  it("aceita anéis customizados (não depende do array default por closure)", () => {
    const aneisCustom = [{ ateFracaoDoRaio: 1, mantem: 0.5 }];
    expect(densidadeMantida(0.9, aneisCustom)).toBe(0.5);
  });

  it("além do último anel (fração > 1, não deveria acontecer — corte por raio já bloqueou) usa o último valor, nunca 0 nem NaN", () => {
    expect(densidadeMantida(1.5)).toBe(ANEIS_DENSIDADE_RASTEIRA[ANEIS_DENSIDADE_RASTEIRA.length - 1]!.mantem);
  });
});

describe("instanciasVisiveisNaCamada", () => {
  function inst(id: string, x: number, z: number): InstanciaVegetacao {
    return {
      prop: { id, assetId: "grass_common_short", position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] } as MapProp,
      position: new THREE.Vector3(x, 0, z),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
    };
  }

  it("categoria NÃO rasteira (árvore/arbusto/pedra): corte só por raio, densidade sempre 100%", () => {
    const instancias = Array.from({ length: 200 }, (_, i) => inst(`t${i}`, i * 0.1, 0));
    const visiveis = instanciasVisiveisNaCamada(instancias, { x: 0, z: 0 }, 10, false);
    // todas as instâncias dentro do raio (x <= 10) devem passar — nenhuma decimada
    const dentroDoRaio = instancias.filter((i) => i.position.x <= 10);
    expect(visiveis).toHaveLength(dentroDoRaio.length);
  });

  it("categoria RASTEIRA: perto do centro (dentro do 1º anel) mantém tudo", () => {
    // raio 100, 1º anel vai até 40% = 40 unidades — todas aqui ficam dentro
    const instancias = Array.from({ length: 300 }, (_, i) => inst(`g${i}`, (i % 20) - 10, (Math.floor(i / 20) % 20) - 10));
    const visiveis = instanciasVisiveisNaCamada(instancias, { x: 0, z: 0 }, 100, true);
    expect(visiveis).toHaveLength(instancias.length);
  });

  /** posiciona N pontos num ANEL a `distancia` do centro (não numa linha — uma linha reta rapidamente sai do raio quando `z` cresce, testando o corte por raio em vez da densidade) */
  function pontosNoAnel(n: number, distancia: number, prefixo: string): InstanciaVegetacao[] {
    return Array.from({ length: n }, (_, i) => {
      const ang = (i / n) * Math.PI * 2;
      return inst(`${prefixo}${i}`, Math.cos(ang) * distancia, Math.sin(ang) * distancia);
    });
  }

  it("categoria RASTEIRA: no anel externo, decima — sobra MENOS que o total ali, mas não zero", () => {
    const raio = 100;
    const instancias = pontosNoAnel(500, raio - 0.01, "g");
    const visiveis = instanciasVisiveisNaCamada(instancias, { x: 0, z: 0 }, raio, true);
    // ~30% esperado (mantém=0.3 no anel externo) — folga generosa (hash não é perfeitamente uniforme em amostra pequena)
    expect(visiveis.length).toBeGreaterThan(0);
    expect(visiveis.length).toBeLessThan(instancias.length);
    expect(visiveis.length / instancias.length).toBeCloseTo(0.3, 1);
  });

  it("decimação é DETERMINÍSTICA — mesma instância, mesmo resultado em chamadas repetidas (nunca Math.random)", () => {
    const raio = 100;
    const instancias = pontosNoAnel(50, raio - 0.01, "g");
    const a = instanciasVisiveisNaCamada(instancias, { x: 0, z: 0 }, raio, true).map((i) => i.prop.id);
    const b = instanciasVisiveisNaCamada(instancias, { x: 0, z: 0 }, raio, true).map((i) => i.prop.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("nunca decima além do raio de corte — instância fora do raio já não entra, decidido antes da densidade", () => {
    const instancias = [inst("longe", 999, 0)];
    const visiveis = instanciasVisiveisNaCamada(instancias, { x: 0, z: 0 }, 10, true);
    expect(visiveis).toHaveLength(0);
  });

  it("raioEfetivo = 0 não divide por zero nem trava — sem instância dentro do raio, resultado vazio", () => {
    const instancias = [inst("a", 0, 0)];
    expect(() => instanciasVisiveisNaCamada(instancias, { x: 0, z: 0 }, 0, true)).not.toThrow();
  });
});
