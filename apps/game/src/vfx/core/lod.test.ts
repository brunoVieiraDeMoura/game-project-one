import { describe, expect, it } from "vitest";
import { DEFAULT_LOD_THRESHOLDS, lodTierFor } from "./lod";

describe("vfx/core lod — lodTierFor", () => {
  it("thresholds padrão (Infinity/Infinity): sempre \"full\", qualquer distância", () => {
    expect(lodTierFor(0, DEFAULT_LOD_THRESHOLDS)).toBe("full");
    expect(lodTierFor(1e9, DEFAULT_LOD_THRESHOLDS)).toBe("full");
  });

  it("abaixo do limiar reduced: full", () => {
    const t = { reducedAtDistance: 20, coreAtDistance: 40 };
    expect(lodTierFor(19.9, t)).toBe("full");
  });

  it("entre reduced e core: reduced", () => {
    const t = { reducedAtDistance: 20, coreAtDistance: 40 };
    expect(lodTierFor(20, t)).toBe("reduced");
    expect(lodTierFor(39.9, t)).toBe("reduced");
  });

  it("no limiar core ou além: core", () => {
    const t = { reducedAtDistance: 20, coreAtDistance: 40 };
    expect(lodTierFor(40, t)).toBe("core");
    expect(lodTierFor(1000, t)).toBe("core");
  });
});
