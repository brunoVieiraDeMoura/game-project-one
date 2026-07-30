import { describe, expect, it } from "vitest";
import { RetroQuantizeShader, colorLevelsFor } from "./retroShader";

/**
 * O filtro retrô é pós-processamento: o shader é a única parte com regra de
 * negócio (quantos degraus de cor, quando ditherizar). O resto (composer,
 * passes) é montagem de three e só dá pra conferir no browser.
 */

describe("colorLevelsFor", () => {
  it("16 bits = RGB565 (mais degraus no verde, como no console)", () => {
    expect(colorLevelsFor("16bit")).toEqual([32, 64, 32]);
  });

  it("8 bits = RGB332 (256 cores, bem mais chapado)", () => {
    const [r, g, b] = colorLevelsFor("8bit");
    expect([r, g, b]).toEqual([8, 8, 4]);
    expect(r * g * b).toBe(256);
  });

  it("off/pixel não quantizam (pixeliza mas mantém as cores)", () => {
    expect(colorLevelsFor("pixel")).toEqual([0, 0, 0]);
    expect(colorLevelsFor("off")).toEqual([0, 0, 0]);
  });
});

describe("RetroQuantizeShader", () => {
  it("tem os uniforms que o RetroFilter atualiza", () => {
    expect(RetroQuantizeShader.uniforms).toHaveProperty("tDiffuse");
    expect(RetroQuantizeShader.uniforms.levels.value.x).toBeGreaterThan(1);
    expect(RetroQuantizeShader.uniforms.dither.value).toBe(1);
  });

  it("passa a imagem intacta quando levels <= 1 (modo sem quantização)", () => {
    // o early-return é o que faz o modo "pixel" não mexer nas cores
    expect(RetroQuantizeShader.fragmentShader).toContain("min(levels.r, min(levels.g, levels.b)) <= 1.0");
  });

  it("o dither é indexado por PIXEL DE TELA, não por UV", () => {
    // por UV o padrão esticaria junto com a resolução do render e viraria
    // manchão; por gl_FragCoord ele tem sempre 1 pixel
    expect(RetroQuantizeShader.fragmentShader).toContain("bayer(gl_FragCoord.xy)");
    expect(RetroQuantizeShader.fragmentShader).not.toContain("bayer(vUv");
  });

  it("o offset do dither é meio degrau (±0.5 × step)", () => {
    expect(RetroQuantizeShader.fragmentShader).toContain("(m / 16.0) - 0.5");
    expect(RetroQuantizeShader.fragmentShader).toContain("bayer(gl_FragCoord.xy) * step");
  });

  it("a matriz de Bayer 4×4 tem os 16 valores, sem repetir", () => {
    // pega só o corpo da função bayer (o resto do shader tem outros números)
    const corpo = RetroQuantizeShader.fragmentShader.split("float bayer(")[1]!.split("return")[0]!;
    const nums = [...corpo.matchAll(/(\d+)\.0/g)].map((m) => Number(m[1]));
    const unicos = new Set(nums.filter((n) => n <= 15));
    expect(unicos.size).toBe(16);
    expect(Math.min(...unicos)).toBe(0);
    expect(Math.max(...unicos)).toBe(15);
  });

  it("quantiza com arredondamento (floor(x*n + 0.5)/n), não truncando", () => {
    // truncar escurece a imagem inteira meio degrau
    expect(RetroQuantizeShader.fragmentShader).toContain("floor(clamp(c, 0.0, 1.0) * levels + 0.5) / levels");
  });
});
