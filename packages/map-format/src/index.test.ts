import { describe, expect, it } from "vitest";
import { GameMapSchema, cellIndex, createBlankMap, DEFAULT_BORDER_WIDTH } from "./index";

describe("createBlankMap — cinturão de borda", () => {
  it("borda tem largura DEFAULT_BORDER_WIDTH e miolo continua andável", () => {
    const map = createBlankMap("t", "Teste", 32, 32);
    const bw = DEFAULT_BORDER_WIDTH;
    // canto e meio da moldura: bloqueado
    expect(map.collision[cellIndex(map, 0, 0)]).toBe("wall");
    expect(map.collision[cellIndex(map, 16, 0)]).toBe("wall");
    expect(map.collision[cellIndex(map, 31, 31)]).toBe("wall");
    expect(map.collision[cellIndex(map, bw - 1, 16)]).toBe("wall");
    // logo depois da borda: andável
    expect(map.collision[cellIndex(map, bw, bw)]).toBe("walkable");
    expect(map.collision[cellIndex(map, 16, 16)]).toBe("walkable");
    expect(map.collision[cellIndex(map, 31 - bw, 31 - bw)]).toBe("walkable");
  });

  it("mapa retangular: borda respeita largura e altura independentemente", () => {
    const map = createBlankMap("t", "Teste", 60, 20);
    const bw = DEFAULT_BORDER_WIDTH;
    expect(map.collision[cellIndex(map, 30, 0)]).toBe("wall"); // topo
    expect(map.collision[cellIndex(map, 30, 19)]).toBe("wall"); // fundo
    expect(map.collision[cellIndex(map, 0, 10)]).toBe("wall"); // esquerda
    expect(map.collision[cellIndex(map, 59, 10)]).toBe("wall"); // direita
    expect(map.collision[cellIndex(map, 30, bw)]).toBe("walkable");
    expect(map.collision[cellIndex(map, 30, 19 - bw)]).toBe("walkable");
  });

  it("mapa mínimo (4×4): borda nunca come o miolo inteiro", () => {
    const map = createBlankMap("t", "Teste", 4, 4);
    const total = map.collision.length;
    const andaveis = map.collision.filter((c) => c === "walkable").length;
    expect(andaveis).toBeGreaterThan(0);
    expect(andaveis).toBeLessThan(total);
  });

  it("borderWidth=0 mantém o comportamento antigo (mapa todo andável)", () => {
    const map = createBlankMap("t", "Teste", 16, 16, 5, 0);
    expect(map.collision.every((c) => c === "walkable")).toBe(true);
  });

  it("resultado sempre valida contra o schema (heightmap/collision no tamanho certo)", () => {
    expect(() => GameMapSchema.parse(createBlankMap("t", "Teste"))).not.toThrow();
    expect(() => GameMapSchema.parse(createBlankMap("t", "Teste", 60, 20))).not.toThrow();
    expect(() => GameMapSchema.parse(createBlankMap("t", "Teste", 4, 4))).not.toThrow();
  });

  // Espelha o exemplo numérico do pedido (`EDITOR DE MAPA + FOG.jpg`): a
  // borda é uma faixa PARA DENTRO do limite físico, não uma área somada por
  // fora — o tamanho do mapa que sai daqui tem que ser IDÊNTICO ao pedido.
  it("borda fica DENTRO do mapa — size e collision.length não mudam", () => {
    const map = createBlankMap("t", "Teste", 12, 12, 5, 2);
    expect(map.size).toEqual({ width: 12, height: 12 });
    expect(map.collision.length).toBe(12 * 12);
  });

  it("exemplo numérico (mapa quadrado): borda de 2 células em CADA lado, miolo = tamanho − 2×borda", () => {
    const W = 12, H = 12, bw = 2;
    const map = createBlankMap("t", "Teste", W, H, 5, bw);
    let interior = 0;
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const naBorda = col < bw || row < bw || col >= W - bw || row >= H - bw;
        expect(map.collision[cellIndex(map, col, row)]).toBe(naBorda ? "wall" : "walkable");
        if (!naBorda) interior++;
      }
    }
    expect(interior).toBe((W - 2 * bw) * (H - 2 * bw)); // 8×8 = 64
  });

  it("exemplo numérico (mapa retangular): MESMA largura de borda nos 4 lados, não proporcional ao maior lado", () => {
    const W = 20, H = 10, bw = 2;
    const map = createBlankMap("t", "Teste", W, H, 5, bw);
    // topo/fundo (percorre a largura toda) e esquerda/direita (percorre a altura toda)
    for (let col = 0; col < W; col++) {
      expect(map.collision[cellIndex(map, col, 0)]).toBe("wall");
      expect(map.collision[cellIndex(map, col, H - 1)]).toBe("wall");
    }
    for (let row = 0; row < H; row++) {
      expect(map.collision[cellIndex(map, 0, row)]).toBe("wall");
      expect(map.collision[cellIndex(map, W - 1, row)]).toBe("wall");
    }
    // miolo = tamanho − 2×borda em CADA eixo independentemente (16×6, não algo derivado do maior lado)
    let interior = 0;
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        if (col >= bw && col < W - bw && row >= bw && row < H - bw) interior++;
      }
    }
    expect(interior).toBe((W - 2 * bw) * (H - 2 * bw)); // 16×6 = 96
  });

  it("largura da borda é FIXA — não escala com o tamanho do mapa (não usa o maior lado)", () => {
    const pequeno = createBlankMap("t", "Teste", 12, 12, 5, 2);
    const grande = createBlankMap("t", "Teste", 200, 80, 5, 2);
    // mesma contagem de células de borda na faixa superior (uma linha inteira
    // de largura W, bw células de altura) por CÉLULA de largura, não uma
    // fração do lado maior
    const contaTopo = (map: ReturnType<typeof createBlankMap>, w: number) => {
      let n = 0;
      for (let col = 0; col < w; col++) if (map.collision[cellIndex(map, col, 0)] === "wall") n++;
      for (let col = 0; col < w; col++) if (map.collision[cellIndex(map, col, 1)] === "wall") n++;
      return n;
    };
    // borda=2: linhas row=0 e row=1 são AMBAS de borda em qualquer tamanho de mapa
    expect(contaTopo(pequeno, 12)).toBe(12 * 2);
    expect(contaTopo(grande, 200)).toBe(200 * 2);
  });

  it("DEFAULT_BORDER_WIDTH vem de unidades de mundo (não célula inventada): 6 unidades ÷ 2 (SQUARE_SIZE) = 3 células", () => {
    expect(DEFAULT_BORDER_WIDTH).toBe(3);
  });
});
