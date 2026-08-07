import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap, SurfaceType } from "@ragnarok/map-format";
import { useEditorStore, type Brush } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Task 12 (leia1.txt): "checar todas as ferramentas se o desfazer do ctrl+Z
 * está funcionando". `undoConvencao.test.ts` já trava a CONTAGEM de passos
 * (1 push por gesto); este arquivo trava o CONTEÚDO — que 1 undo devolve o
 * mapa byte a byte ao estado de antes do gesto, para CADA pincel/ferramenta,
 * não só para os quatro casos que motivaram o Módulo 1.
 */

function mapaPlano(w = 24, h = 24): GameMap {
  const n = w * h;
  return {
    id: "t",
    name: "t",
    size: { width: w, height: h },
    cellSize: 1,
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

const st = () => useEditorStore.getState();
const snap = () => {
  const m = st().map!;
  return { heightmap: [...m.heightmap], collision: [...m.collision], surface: [...(m.surface as string[])] };
};
const igual = (a: ReturnType<typeof snap>) => {
  const m = st().map!;
  expect([...m.heightmap]).toEqual(a.heightmap);
  expect([...m.collision]).toEqual(a.collision);
  expect([...(m.surface as string[])]).toEqual(a.surface);
};

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [] });
  st().init(mapaPlano());
  st().setEditScope("all");
  st().setBrushSize(3);
  st().setBrushStrength(1);
});

/** simula EditorScene.onDown+onMove: beginStroke 1x, paintCell em várias células */
function tracoDePincel(brush: Brush, cols: [number, number][]) {
  st().setBrush(brush);
  st().beginStroke();
  for (const [c, r] of cols) st().paintCell(c, r);
}

/**
 * Mapa PLANO + superfície uniforme não dá trabalho pra smooth/flatten/scrape
 * (já estão no alvo) nem pra "pintar a mesma superfície que já está lá" — o
 * teste passaria mesmo com um bug de undo, sem provar nada. Semeia altura
 * irregular e superfície diferente do pincel ANTES do traçado medido (fora do
 * `beginStroke`, então não entra no histórico que o undo vai desfazer).
 */
function semearVariacao(brush: Brush) {
  const m = st().map!;
  const W = m.size.width;
  const heightmap = m.heightmap.slice();
  const surface = (m.surface as SurfaceType[]).slice();
  for (let rr = 8; rr <= 13; rr++) for (let cc = 8; cc <= 14; cc++) heightmap[rr * W + cc] = ((cc + rr) % 4) - 1;
  const partida: SurfaceType = brush === "grass" ? "dirt" : "grass";
  for (let rr = 9; rr <= 12; rr++) for (let cc = 9; cc <= 13; cc++) surface[rr * W + cc] = partida;
  useEditorStore.setState({ map: { ...m, heightmap, surface } });
}

describe("undo — pincéis de relevo/superfície simples (1 traçado = revert total)", () => {
  const simples: Brush[] = ["raise", "lower", "smooth", "flatten", "noise", "inflate", "scrape", "grass", "dirt", "stone", "sand", "snow", "water"];
  for (const brush of simples) {
    it(`"${brush}": beginStroke + traçado + undo devolve o mapa original`, () => {
      semearVariacao(brush);
      const antes = snap();
      tracoDePincel(brush, [
        [10, 10],
        [11, 10],
        [12, 11],
      ]);
      // precisa ter mudado alguma coisa, senão o teste não prova nada
      const mudou = JSON.stringify(snap()) !== JSON.stringify(antes);
      expect(mudou).toBe(true);
      expect(st().past.length).toBe(1);
      st().undo();
      igual(antes);
      expect(st().past.length).toBe(0);
    });
  }
});

describe("undo — cliffUp/cliffDown (exige célula bloqueada no disco)", () => {
  beforeEach(() => {
    // planta uma parede sob o pincel (raio 3 em 10,10)
    const m = st().map!;
    const i = 10 * m.size.width + 10;
    const collision = m.collision.slice();
    collision[i] = "wall";
    useEditorStore.setState({ map: { ...m, collision } });
  });

  for (const brush of ["cliffUp", "cliffDown"] as Brush[]) {
    it(`"${brush}": traçado + undo devolve o mapa original`, () => {
      const antes = snap();
      tracoDePincel(brush, [[10, 10]]);
      const mudou = JSON.stringify(snap()) !== JSON.stringify(antes);
      expect(mudou).toBe(true);
      st().undo();
      igual(antes);
    });
  }
});

describe("undo — montanha e desfazer-montanha (histórias separadas)", () => {
  it('"mountain": traçado + undo devolve o mapa original', () => {
    const antes = snap();
    tracoDePincel("mountain", [
      [10, 10],
      [11, 10],
    ]);
    const mudou = JSON.stringify(snap()) !== JSON.stringify(antes);
    expect(mudou).toBe(true);
    st().undo();
    igual(antes);
  });

  it('"mountainClear": pinta montanha (stroke 1), limpa (stroke 2), 1 undo só desfaz o stroke 2', () => {
    tracoDePincel("mountain", [[10, 10]]);
    const comMontanha = snap();
    expect(comMontanha.surface[10 * st().map!.size.width + 10]).toBe("stone");

    tracoDePincel("mountainClear", [[10, 10]]);
    const semMontanha = snap();
    expect(semMontanha.surface[10 * st().map!.size.width + 10]).toBe("grass");

    st().undo(); // desfaz só o mountainClear
    igual(comMontanha);

    st().undo(); // desfaz a montanha original
    expect(st().map!.surface[10 * st().map!.size.width + 10]).toBe("grass");
    expect(st().map!.collision[10 * st().map!.size.width + 10]).toBe("walkable");
  });
});

describe("undo — rio (raso e fundo)", () => {
  for (const brush of ["riverShallow", "riverDeep"] as Brush[]) {
    it(`"${brush}": traçado + undo devolve o mapa original`, () => {
      const antes = snap();
      tracoDePincel(brush, [
        [10, 10],
        [11, 10],
        [12, 10],
      ]);
      const mudou = JSON.stringify(snap()) !== JSON.stringify(antes);
      expect(mudou).toBe(true);
      st().undo();
      igual(antes);
    });
  }
});

describe("undo — rampa, grab e promontório (usam beginRamp/rampBase)", () => {
  it('"ramp": beginStroke + beginRamp + traçado + undo devolve o mapa original', () => {
    // sem desnível entre âncora e ponta, a rampa interpola 0→0: nada muda, e
    // o teste não provaria nada. Ergue a âncora ANTES do traçado medido.
    const m0 = st().map!;
    const h0 = m0.heightmap.slice();
    h0[10 * m0.size.width + 5] = 4;
    useEditorStore.setState({ map: { ...m0, heightmap: h0 } });
    const antes = snap();
    st().setBrush("ramp");
    st().beginStroke();
    st().beginRamp(5, 10); // âncora nível 0
    st().paintCell(5, 10);
    st().paintCell(15, 10); // outra ponta, nível diferente via level do rampCells
    const mudou = JSON.stringify(snap()) !== JSON.stringify(antes);
    expect(mudou).toBe(true);
    st().undo();
    igual(antes);
  });

  it('"grab": beginStroke + beginRamp + arrasto + undo devolve o mapa original', () => {
    const antes = snap();
    st().setBrush("grab");
    st().setBrushStrength(1);
    st().beginStroke();
    st().beginRamp(10, 10);
    st().paintCell(10, 10);
    st().paintCell(13, 10); // se afasta da âncora → sobe
    const mudou = JSON.stringify(snap()) !== JSON.stringify(antes);
    expect(mudou).toBe(true);
    st().undo();
    igual(antes);
  });

  it('"ledge" (promontório): beginStroke + beginRamp + arrasto + undo devolve o mapa original', () => {
    const antes = snap();
    st().setBrush("ledge");
    st().setLedgeAngle(45);
    st().beginStroke();
    st().beginRamp(10, 10);
    st().paintCell(10, 10);
    st().paintCell(16, 10); // comprimento >= 1 exigido pelo pincel
    const mudou = JSON.stringify(snap()) !== JSON.stringify(antes);
    expect(mudou).toBe(true);
    st().undo();
    igual(antes);
  });
});

describe("undo — ferramentas fora do pincel de terreno", () => {
  it("addProp (place, clique único): undo remove o prop", () => {
    const antesLen = st().map!.props.length;
    st().addProp({
      id: "p1",
      assetId: "hex_tree_single_a",
      position: [10, 0, 10],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    } as any);
    expect(st().map!.props.length).toBe(antesLen + 1);
    st().undo();
    expect(st().map!.props.length).toBe(antesLen);
  });

  it("addSpawn: undo remove o spawn", () => {
    const antesLen = st().map!.spawns.length;
    st().addSpawn(5, 5);
    expect(st().map!.spawns.length).toBe(antesLen + 1);
    st().undo();
    expect(st().map!.spawns.length).toBe(antesLen);
  });

  it("placeTileAsset (place, traçado): undo devolve a superfície original", () => {
    const antes = snap();
    st().beginStroke();
    st().placeTileAsset(2, 2, "hex_road_a");
    st().placeTileAsset(3, 2, "hex_road_a");
    const mudou = JSON.stringify(snap()) !== JSON.stringify(antes);
    expect(mudou).toBe(true);
    st().undo();
    igual(antes);
  });

  it("área/gatilho (beginArea+dragArea+commitArea): undo remove o gatilho", () => {
    const antesLen = (st().map!.triggers ?? []).length;
    st().setTool("area");
    st().beginArea(3, 3);
    st().dragArea(6, 6);
    st().commitArea();
    expect((st().map!.triggers ?? []).length).toBe(antesLen + 1);
    st().undo();
    expect((st().map!.triggers ?? []).length).toBe(antesLen);
  });

  it("deleteSelected (prop): undo restaura o prop apagado", () => {
    st().addProp({
      id: "p2",
      assetId: "hex_tree_single_a",
      position: [8, 0, 8],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    } as any);
    const comProp = snap();
    const props = st().map!.props;
    st().select(props.length - 1);
    st().deleteSelected();
    expect(st().map!.props.length).toBe(0);
    st().undo();
    igual(comProp);
    expect(st().map!.props.length).toBe(1);
  });
});
