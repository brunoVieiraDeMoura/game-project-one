import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { cornerLevel } from "./heightField";
import { buildChunkGeometry } from "./squareChunks";

/**
 * Relevo AUTORADO que atravessa a fronteira de passagem não pode rasgar.
 *
 * A altura de canto separa por grupo (chão com chão, bloqueio com bloqueio) por
 * causa do PALPITE por tipo do `visualLevel`: parede sobe 1, buraco afunda 1, e
 * misturar isso com o campo daria ladeira onde o servidor não deixa subir.
 *
 * Só que um morro PINTADO por cima de mata e campo tem `wall` e `walkable`
 * intercalados, e ali não há palpite nenhum — a forma foi decidida por quem
 * autorou. Separando mesmo assim, cada grupo calculava um canto diferente e o
 * vão entre eles virava uma prateleira de face vertical no meio da encosta
 * (relato do usuário em `Desktop/ref/craquelado-square.jpg`; medido no mapa
 * dele: 618 fronteiras assim, degrau de até 3,73 níveis).
 */

const W = 16;
const H = 16;
const idx = (col: number, row: number) => row * W + col;

/** morro suave cobrindo o mapa, com uma mancha de PAREDE no meio dele */
function morroSobreMata(): GameMap {
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  const heightmap: number[] = new Array(n).fill(0);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      // cone centrado em (8,8): altura autorada, fracionária
      const d = Math.hypot(col - 8, row - 8);
      heightmap[idx(col, row)] = Math.max(0.01, 6 - d * 0.6);
      // mancha de mata intercalada, como no mapa importado
      if ((col + row) % 3 === 0 && d < 5) collision[idx(col, row)] = "wall";
    }
  }
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap,
    collision,
    surface: [],
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
  } as unknown as GameMap;
}

describe("relevo autorado atravessando bloqueio", () => {
  it("os dois grupos concordam na altura do canto", () => {
    const map = morroSobreMata();
    let piorDiferenca = 0;
    for (let row = 2; row < H - 2; row++) {
      for (let col = 2; col < W - 2; col++) {
        const chao = cornerLevel(map, col, row, false);
        const bloqueio = cornerLevel(map, col, row, true);
        piorDiferenca = Math.max(piorDiferenca, Math.abs(chao - bloqueio));
      }
    }
    // sem a regra, esta diferença chegava a vários níveis — e é ela que abre o
    // vão que a saia preenche com uma face vertical
    expect(piorDiferenca).toBeLessThan(1e-9);
  });

  it("a malha não ganha face vertical no meio da encosta", () => {
    const geo = buildChunkGeometry(morroSobreMata(), 0, 0);
    const pos = geo.getAttribute("position");
    const normal = geo.getAttribute("normal");
    let verticais = 0;
    for (let v = 0; v < pos.count; v += 4) {
      // saia = quad cuja normal não tem componente para cima
      if (Math.abs(normal.getY(v)) < 1e-6) verticais++;
    }
    geo.dispose();
    expect(verticais).toBe(0);
  });

  it("mas a mata SEM altura autorada continua com sua saia", () => {
    // aqui o degrau é o palpite por tipo (`visualLevel` sobe a parede 1 nível),
    // e é exatamente o que a separação por grupo existe para preservar
    const n = W * H;
    const collision: string[] = new Array(n).fill("walkable");
    for (let row = 4; row < 9; row++) for (let col = 4; col < 9; col++) collision[idx(col, row)] = "wall";
    const map = {
      ...morroSobreMata(),
      collision,
      heightmap: new Array(n).fill(0),
    } as unknown as GameMap;
    const geo = buildChunkGeometry(map, 0, 0);
    const normal = geo.getAttribute("normal");
    let verticais = 0;
    for (let v = 0; v < normal.count; v += 4) if (Math.abs(normal.getY(v)) < 1e-6) verticais++;
    geo.dispose();
    expect(verticais).toBeGreaterThan(0);
  });
});
