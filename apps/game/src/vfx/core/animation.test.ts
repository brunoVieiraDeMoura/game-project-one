import { describe, expect, it } from "vitest";
import { animationCycleMs, computeFrame } from "./animation";
import type { VfxAnimation } from "./types";

describe("vfx/core animation", () => {
  const frames = ["f1", "f2", "f3", "f4"];

  it("once: fica no último frame e marca finished depois do ciclo", () => {
    const anim: VfxAnimation = { frames, fps: 10, mode: "once" }; // 100ms/frame, 400ms total
    expect(computeFrame(anim, 0)).toMatchObject({ frameName: "f1", frameIndex: 0, finished: false });
    expect(computeFrame(anim, 250)).toMatchObject({ frameName: "f3", frameIndex: 2, finished: false });
    expect(computeFrame(anim, 500)).toMatchObject({ frameName: "f4", frameIndex: 3, finished: true });
  });

  it("loop: volta ao início depois do último frame", () => {
    const anim: VfxAnimation = { frames, fps: 10, mode: "loop" };
    expect(computeFrame(anim, 0).frameName).toBe("f1");
    expect(computeFrame(anim, 350).frameName).toBe("f4");
    expect(computeFrame(anim, 400).frameName).toBe("f1"); // deu a volta
    expect(computeFrame(anim, 500).frameName).toBe("f2");
  });

  it("pingpong: vai até o fim e volta sem repetir o extremo", () => {
    const anim: VfxAnimation = { frames, fps: 10, mode: "pingpong" }; // ciclo = (4-1)*2=6 passos
    const seq = [0, 100, 200, 300, 400, 500, 600, 700].map((ms) => computeFrame(anim, ms).frameIndex);
    // 0,1,2,3,2,1,0,1 — sobe até o fim, desce até o começo, sobe de novo
    expect(seq).toEqual([0, 1, 2, 3, 2, 1, 0, 1]);
  });

  it("frames vazio não quebra — devolve frameIndex -1, finished true", () => {
    const anim: VfxAnimation = { frames: [], fps: 10, mode: "loop" };
    expect(computeFrame(anim, 0)).toEqual({ frameName: "", frameIndex: -1, finished: true });
  });

  it("animationCycleMs: Infinity para loop/pingpong, duração real para once", () => {
    expect(animationCycleMs({ frames, fps: 10, mode: "loop" })).toBe(Number.POSITIVE_INFINITY);
    expect(animationCycleMs({ frames, fps: 10, mode: "pingpong" })).toBe(Number.POSITIVE_INFINITY);
    expect(animationCycleMs({ frames, fps: 10, mode: "once" })).toBe(400);
  });
});
