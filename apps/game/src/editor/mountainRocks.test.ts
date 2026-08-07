import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore, MOUNTAIN_ROCK_LAYER } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";
import { propCategory, propRadius, PROP_BY_CATEGORY } from "../props/registry";

/**
 * Rochas na montanha: a camada procedural que povoa BLOQUEIO em vez de chão.
 *
 * O scatter comum exige célula andável nos escopos "dentro"/"tudo", então
 * montanha (parede) nunca receberia nada por ele — é essa a diferença que os
 * testes abaixo protegem, junto com a de a rocha só nascer onde o pincel de
 * montanha passou.
 */
const W = 32;
const H = 32;
const idx = (col: number, row: number) => row * W + col;

function mapaComMontanha(): GameMap {
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  const surface: string[] = new Array(n).fill("grass");
  const heightmap: number[] = new Array(n).fill(0);
  // montanha de 9×9 no miolo, mais alta no centro
  for (let r = 10; r < 19; r++) {
    for (let c = 10; c < 19; c++) {
      collision[idx(c, r)] = "wall";
      surface[idx(c, r)] = "stone";
      heightmap[idx(c, r)] = 12 - Math.max(Math.abs(c - 14), Math.abs(r - 14));
    }
  }
  // e uma mata IMPORTADA (parede sem superfície de pedra) do outro lado
  for (let r = 25; r < 30; r++) for (let c = 25; c < 30; c++) collision[idx(c, r)] = "wall";
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 1,
    terrainMode: "square",
    heightmap,
    collision,
    surface,
    ramps: [],
    props: [],
    spawns: [],
    triggers: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const rochas = () => st().map!.props.filter((p) => p.tags?.[1] === MOUNTAIN_ROCK_LAYER);

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({
    past: [],
    future: [],
    procAmounts: {},
    // seed FIXO: sem ele o store sorteia um por execução (`?? Math.random()`) e a
    // distribuição de tamanhos passava a ser um teste de sorte
    procSeeds: { "all:mountain_rock": 12345 },
    procDisabled: {},
  });
  st().init(mapaComMontanha());
  st().setEditScope("all");
});

describe("rochas na montanha", () => {
  it("gera rocha e só rocha", () => {
    st().setMountainRocks(100);
    expect(rochas().length).toBeGreaterThan(0);
    expect(rochas().every((p) => propCategory(p.assetId) === "rock")).toBe(true);
  });

  it("toda rocha cai numa célula de montanha — nunca no campo nem na mata importada", () => {
    st().setMountainRocks(100);
    const map = st().map!;
    for (const p of rochas()) {
      const col = Math.round((p.position[0] ?? 0) / 2 - 0.5);
      const row = Math.round((p.position[2] ?? 0) / 2 - 0.5);
      const i = idx(col, row);
      expect(map.collision[i], `prop em ${col},${row}`).toBe("wall");
      expect(map.surface[i], `prop em ${col},${row}`).toBe("stone");
    }
  });

  it("sem montanha no mapa, não gera nada", () => {
    const plano = mapaComMontanha();
    const collision = [...(plano.collision as string[])].fill("walkable");
    const surface = [...(plano.surface as string[])].fill("grass");
    st().init({ ...plano, collision, surface } as unknown as GameMap);
    st().setMountainRocks(100);
    expect(rochas()).toHaveLength(0);
  });

  it("baixar o slider remove; zerar limpa a camada", () => {
    st().setMountainRocks(100);
    const cheio = rochas().length;
    st().setMountainRocks(30);
    expect(rochas().length).toBeLessThan(cheio);
    st().setMountainRocks(0);
    expect(rochas()).toHaveLength(0);
  });

  it("regenerar não mexe nos props manuais", () => {
    st().setMountainRocks(60);
    const manuais = st().map!.props.filter((p) => p.tags?.[0] !== "_gen").length;
    st().reseedMountainRocks();
    expect(st().map!.props.filter((p) => p.tags?.[0] !== "_gen")).toHaveLength(manuais);
  });

  it("os matacões ficam no alto e as pedras miúdas na saia", () => {
    // é a distribuição da ref3. O tamanho está no RAIO do modelo, não na escala
    // (as rochas do KayKit têm defaultScale 1 e só o jitter mexe nela).
    st().setMountainRocks(100);
    const rs = rochas();
    expect(rs.length).toBeGreaterThan(8);
    const alturas = rs.map((p) => p.position[1] ?? 0);
    const raios = rs.map((p) => propRadius(p.assetId, p.scale[0] ?? 1));
    const media = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const mA = media(alturas);
    const mR = media(raios);
    let num = 0;
    let dA = 0;
    let dR = 0;
    for (let i = 0; i < rs.length; i++) {
      num += (alturas[i]! - mA) * (raios[i]! - mR);
      dA += (alturas[i]! - mA) ** 2;
      dR += (raios[i]! - mR) ** 2;
    }
    // correlação de Pearson: positiva = quanto mais alto, maior a pedra
    expect(num / Math.sqrt(dA * dR || 1)).toBeGreaterThan(0.25);
  });
});

describe("seletor de espécies de rocha da montanha", () => {
  const especies = PROP_BY_CATEGORY.find((g) => g.cat === "rock")?.items ?? [];

  it("sem nenhum toggle, usa o catálogo inteiro (não regride o comportamento antigo)", () => {
    st().setMountainRocks(100);
    const usadas = new Set(rochas().map((p) => p.assetId));
    // pelo menos mais de uma espécie apareceu (com o catálogo inteiro
    // disponível, a chance de sair só uma é desprezível num mapa com dezenas
    // de rochas geradas)
    expect(usadas.size).toBeGreaterThan(1);
  });

  it("desligar uma espécie tira ela da regeneração", () => {
    st().setMountainRocks(100);
    const antes = new Set(rochas().map((p) => p.assetId));
    expect(antes.size).toBeGreaterThan(0);
    const alvo = [...antes][0]!; // uma espécie que REALMENTE apareceu neste seed

    st().toggleMountainRockSpecies(alvo);
    expect(rochas().every((p) => p.assetId !== alvo)).toBe(true);
  });

  it("desligar é POR ESCOPO — desligar em 'all' não mexe no toggle de 'inside'", () => {
    const alvo = especies[0]!.id;
    st().setEditScope("all");
    st().toggleMountainRockSpecies(alvo);
    st().setEditScope("inside");
    expect(st().procDisabled["inside:mountain_rock"] ?? []).not.toContain(alvo);
  });

  it("religar a espécie volta a incluí-la", () => {
    const alvo = especies[0]!.id;
    st().toggleMountainRockSpecies(alvo); // desliga
    st().toggleMountainRockSpecies(alvo); // religa
    st().setMountainRocks(100);
    // com o catálogo inteiro de volta, a espécie pode voltar a aparecer —
    // não garantimos que ELA especificamente saia no seed fixo, só que o
    // desligamento não ficou "preso"
    expect(st().procDisabled["all:mountain_rock"] ?? []).not.toContain(alvo);
  });

  it("desligar TODAS as espécies zera a geração (sem travar em catálogo vazio)", () => {
    for (const e of especies) st().toggleMountainRockSpecies(e.id);
    st().setMountainRocks(100);
    expect(rochas()).toHaveLength(0);
  });
});

describe("montanha fora do escopo ativo não gera rocha (base de dado do fix de UI)", () => {
  /**
   * `TerrainPanel.tsx: MountainRocksRow` passou a checar `cellInScope` célula
   * a célula pra decidir se HABILITA o slider — antes varria o mapa inteiro,
   * então uma montanha na borda mantinha o slider ativo mesmo com "Dentro"
   * escolhido, onde `generateMountainRocks` já filtrava (corretamente) e não
   * gerava nada. A parte de UI não é testável aqui sem renderizar componente
   * (fora do padrão deste projeto) — este teste confirma o dado que a UI lê:
   * o gerador continua vazio nesse cenário, então "slider desabilitado" é a
   * leitura certa quando ele checar o mesmo predicado.
   */
  it("montanha só na BORDA não gera nada com escopo 'Dentro' escolhido", () => {
    const m = mapaComMontanha();
    const collision = [...(m.collision as string[])];
    const surface = [...(m.surface as string[])];
    for (let r = 10; r < 19; r++) for (let c = 10; c < 19; c++) { collision[idx(c, r)] = "walkable"; surface[idx(c, r)] = "grass"; }
    for (let c = 0; c < W; c++) { collision[idx(c, 0)] = "wall"; surface[idx(c, 0)] = "stone"; }
    st().init({ ...m, collision, surface } as unknown as GameMap);
    st().setEditScope("inside");
    st().setMountainRocks(100);
    expect(rochas()).toHaveLength(0);
  });
});
