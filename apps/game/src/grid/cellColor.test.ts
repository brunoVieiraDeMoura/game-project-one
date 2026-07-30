import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { buildChunkGeometry, surfaceFromCollision } from "./squareChunks";

/**
 * A primeira pincelada num mapa importado NÃO pode repintar o mapa inteiro.
 *
 * `paintCell` materializa `surface` (que vem vazia do `map_cache.dat`) com
 * "grass" em todas as células. Enquanto a superfície mandava na cor de tudo,
 * encostar o pincel numa célula deixava mata, penhasco e água verdes de uma vez
 * — o "está bugando todo o mapa". A cor de célula BLOQUEADA passa a sair sempre
 * do tipo de colisão.
 */
const W = 8;
const H = 8;

function mapa(surface: string[]): GameMap {
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  collision[0] = "wall";
  collision[1] = "cliff";
  collision[2] = "water";
  return {
    size: { width: W, height: H },
    collision,
    surface,
    heightmap: new Array(n).fill(0),
  } as unknown as GameMap;
}

/** cor RGB do primeiro vértice de cada célula, na ordem em que a malha é montada */
function coresDoChunk(m: GameMap): string[] {
  const geo = buildChunkGeometry(m, 0, 0);
  const cor = geo.getAttribute("color");
  const pos = geo.getAttribute("position");
  const out: string[] = [];
  for (let v = 0; v < cor.count; v++) {
    // agrupa por posição de célula: basta uma amostra por vértice, o teste
    // compara CONJUNTOS de cores presentes
    out.push(`${cor.getX(v).toFixed(3)},${cor.getY(v).toFixed(3)},${cor.getZ(v).toFixed(3)}`);
  }
  expect(pos.count).toBe(cor.count);
  geo.dispose();
  return out;
}

describe("cor do chão quadrado", () => {
  it("mapa sem superfície tem cores distintas para mata, ravina, água e grama", () => {
    const distintas = new Set(coresDoChunk(mapa([])));
    // grama + parede + penhasco + água = 4 cores no mínimo (as saias somam mais)
    expect(distintas.size).toBeGreaterThanOrEqual(4);
  });

  it("materializar a superfície não muda NADA na aparência", () => {
    // é o que o editor faz na primeira pincelada de um mapa importado
    const base = mapa([]);
    const semSurface = new Set(coresDoChunk(base));
    const comSurface = new Set(coresDoChunk(mapa(surfaceFromCollision(base) as string[])));
    expect(comSurface).toEqual(semSurface);
  });

  it("grama forçada em tudo ainda preserva mata e ravina", () => {
    // superfície não manda em célula bloqueada: mesmo pintando grama por cima,
    // parede e penhasco continuam com a cor do tipo. A água ANDÁVEL, sim, vira
    // grama — ali a superfície é a autoridade, e foi uma escolha de quem pintou.
    const cores = new Set(coresDoChunk(mapa(new Array(W * H).fill("grass"))));
    const doTipo = new Set(coresDoChunk(mapa([])));
    const perdidas = [...doTipo].filter((c) => !cores.has(c));
    // some só o azul da água (e a saia dela, que usa a mesma cor)
    expect(perdidas.length).toBeLessThanOrEqual(2);
    expect(cores.size).toBeGreaterThanOrEqual(4);
  });

  it("superfície autorada continua mandando no chão ANDÁVEL", () => {
    const surface = new Array(W * H).fill("grass");
    surface[20] = "sand"; // célula andável
    const cores = new Set(coresDoChunk(mapa(surface)));
    const semAreia = new Set(coresDoChunk(mapa(new Array(W * H).fill("grass"))));
    expect(cores.size).toBeGreaterThan(semAreia.size);
  });
});
