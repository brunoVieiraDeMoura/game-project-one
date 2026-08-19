import { describe, expect, it } from "vitest";
import {
  computeTargetFade,
  createRevealState,
  tickRevealFade,
  retickTargets,
  advanceAndUpload,
  canopyWeightForHeight,
  REVEAL_CONFIG,
  type RevealConfig,
  type RevealCandidate,
} from "./vegetationReveal";

const CFG: RevealConfig = REVEAL_CONFIG;

describe("REVEAL_CONFIG — alcance e máscara vertical", () => {
  it("revealRadius/revealRadiusOuter/candidateRadius ampliados (4º tuning)", () => {
    expect(CFG.revealRadius).toBe(8.0);
    expect(CFG.revealRadiusOuter).toBe(13.0);
    expect(CFG.candidateRadius).toBe(24.0);
  });

  it("maxFade total (elimina resíduo pontilhado no platô máximo), trunkFadeFraction quase nulo", () => {
    expect(CFG.maxFade).toBe(1.0);
    expect(CFG.trunkFadeFraction).toBe(0.03);
  });

  it("máscara vertical comprimida perto da base (3º tuning: só um toco do tronco fica visível)", () => {
    expect(CFG.canopyFadeStart).toBe(0.12);
    expect(CFG.canopyFadeFull).toBe(0.28);
  });
});

describe("computeTargetFade", () => {
  it("zero fora do raio de candidatas, mesmo em cima do personagem em outra métrica", () => {
    const t = computeTargetFade({ x: 100, z: 100 }, { x: 0, z: 0 }, { x: 0, z: -10 }, CFG);
    expect(t).toBe(0);
  });

  it("máximo dentro do revealRadius, mesmo sem estar no corredor da câmera", () => {
    const t = computeTargetFade({ x: 5, z: 0 }, { x: 0, z: 0 }, { x: -50, z: 50 }, CFG);
    expect(t).toBeCloseTo(CFG.maxFade, 3);
  });

  it("dentro do candidateRadius mas fora do revealRadiusOuter e fora do corredor: zero", () => {
    // dist ≈ 21.2 — entre revealRadiusOuter(13) e candidateRadius(24)
    const t = computeTargetFade({ x: 15, z: 15 }, { x: 0, z: 0 }, { x: 0, z: -50 }, CFG);
    expect(t).toBe(0);
  });

  it("interpola suavemente entre revealRadius e revealRadiusOuter (não é degrau)", () => {
    const meio = (CFG.revealRadius + CFG.revealRadiusOuter) / 2;
    const t = computeTargetFade({ x: meio, z: 0 }, { x: 0, z: 0 }, { x: -50, z: 50 }, CFG);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(CFG.maxFade);
  });

  it("árvore bem no meio do corredor câmera→personagem funde forte", () => {
    const t = computeTargetFade({ x: 0, z: -10 }, { x: 0, z: 0 }, { x: 0, z: -20 }, CFG);
    expect(t).toBeGreaterThan(0);
  });

  it("árvore fora da largura do corredor (lateral) não funde por causa da câmera", () => {
    const t = computeTargetFade({ x: 10, z: -10 }, { x: 0, z: 0 }, { x: 0, z: -20 }, CFG);
    expect(t).toBe(0);
  });

  it("árvore ATRÁS do personagem (t > ~1) não conta como corredor, mesmo alinhada", () => {
    // fora do revealRadiusOuter(13) também, senão a reveal zone sozinha já explicaria
    const t = computeTargetFade({ x: 0, z: 15 }, { x: 0, z: 0 }, { x: 0, z: -20 }, CFG);
    expect(t).toBe(0);
  });

  it("nunca ultrapassa maxFade", () => {
    const t = computeTargetFade({ x: 0, z: -1 }, { x: 0, z: 0 }, { x: 0, z: -20 }, CFG);
    expect(t).toBeLessThanOrEqual(CFG.maxFade + 1e-9);
  });

  it("árvore perto do personagem mas fora do corredor da câmera ainda funde pela reveal zone", () => {
    const t = computeTargetFade({ x: 2, z: 0 }, { x: 0, z: 0 }, { x: -80, z: 80 }, CFG);
    expect(t).toBeGreaterThan(0);
  });
});

describe("canopyWeightForHeight — máscara vertical", () => {
  it("platô no mínimo (trunkFadeFraction) em toda a base, até canopyFadeStart", () => {
    expect(canopyWeightForHeight(0, CFG)).toBeCloseTo(CFG.trunkFadeFraction, 6);
    expect(canopyWeightForHeight(CFG.canopyFadeStart * 0.5, CFG)).toBeCloseTo(CFG.trunkFadeFraction, 6);
    expect(canopyWeightForHeight(CFG.canopyFadeStart, CFG)).toBeCloseTo(CFG.trunkFadeFraction, 6);
  });

  it("platô no MÁXIMO (1.0) a partir de canopyFadeFull", () => {
    expect(canopyWeightForHeight(CFG.canopyFadeFull, CFG)).toBeCloseTo(1, 6);
    expect(canopyWeightForHeight(1, CFG)).toBeCloseTo(1, 6);
  });

  it("transição estritamente crescente e suave entre os dois limiares (sem degrau)", () => {
    const a = canopyWeightForHeight(CFG.canopyFadeStart + 0.01, CFG);
    const b = canopyWeightForHeight((CFG.canopyFadeStart + CFG.canopyFadeFull) / 2, CFG);
    const c = canopyWeightForHeight(CFG.canopyFadeFull - 0.01, CFG);
    expect(a).toBeGreaterThan(CFG.trunkFadeFraction);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThan(1);
  });

  it("só um toco pequeno da base fica no platô mínimo — a maior parte da árvore já é fade forte", () => {
    // metade da altura (0.5) já passou de canopyFadeFull(0.28): tem que estar no platô máximo
    expect(canopyWeightForHeight(0.5, CFG)).toBeCloseTo(1, 6);
  });

  it("combinado com maxFade≈0.98, o topo/tronco alto chega a fade praticamente total", () => {
    const pesoAlto = canopyWeightForHeight(1, CFG);
    const finalFadeAlto = CFG.maxFade * pesoAlto;
    expect(finalFadeAlto).toBeGreaterThan(0.95);
  });

  it("o toco da base nunca desaparece de vez, mesmo com instanceFade no máximo", () => {
    const pesoBase = canopyWeightForHeight(0, CFG);
    const finalFadeNaBase = CFG.maxFade * pesoBase;
    expect(finalFadeNaBase).toBeGreaterThan(0);
    expect(finalFadeNaBase).toBeLessThan(0.1);
  });
});

describe("tickRevealFade — throttling + suavização + limpeza", () => {
  function umCandidato(): RevealCandidate[] {
    return [{ slot: 0, x: 1, z: 0 }]; // dentro do revealRadius de (0,0)
  }

  it("não faz nada (out permanece 0) antes do intervalo de updateHz passar", () => {
    const state = createRevealState(4);
    const out = new Float32Array(4);
    const getCandidatos = () => umCandidato();
    const r = tickRevealFade(state, 0.001, getCandidatos, { x: 0, z: 0 }, { x: -50, z: 50 }, out, CFG);
    expect(out[0]).toBe(0);
    expect(state.trackedSlots.size).toBe(0);
    expect(r.changed).toBe(false);
  });

  it("depois de acumular 1/updateHz, o slot candidato entra em trackedSlots e começa a subir", () => {
    const state = createRevealState(4);
    const out = new Float32Array(4);
    const dtDoRetick = 1 / CFG.updateHz + 0.001;
    const r = tickRevealFade(state, dtDoRetick, () => umCandidato(), { x: 0, z: 0 }, { x: -50, z: 50 }, out, CFG);
    expect(state.trackedSlots.has(0)).toBe(true);
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0]).toBeLessThan(CFG.maxFade);
    expect(r.changed).toBe(true);
    expect(r.minSlot).toBe(0);
    expect(r.maxSlot).toBe(0);
  });

  it("converge para perto do maxFade depois de vários quadros com o mesmo candidato", () => {
    const state = createRevealState(4);
    const out = new Float32Array(4);
    const passoUpdate = 1 / CFG.updateHz + 0.0001;
    for (let i = 0; i < 60; i++) {
      tickRevealFade(state, passoUpdate, () => umCandidato(), { x: 0, z: 0 }, { x: -50, z: 50 }, out, CFG);
    }
    expect(out[0]).toBeGreaterThan(CFG.maxFade * 0.95);
  });

  it("quando o candidato some da lista, o slot decai de volta a zero e sai de trackedSlots", () => {
    const state = createRevealState(4);
    const out = new Float32Array(4);
    const passoUpdate = 1 / CFG.updateHz + 0.0001;
    for (let i = 0; i < 30; i++) tickRevealFade(state, passoUpdate, () => umCandidato(), { x: 0, z: 0 }, { x: -50, z: 50 }, out, CFG);
    expect(out[0]).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) tickRevealFade(state, passoUpdate, () => [], { x: 0, z: 0 }, { x: -50, z: 50 }, out, CFG);
    expect(out[0]).toBe(0);
    expect(state.trackedSlots.has(0)).toBe(false);
  });

  it("candidato fora do raio nunca entra em trackedSlots (custo zero mantido)", () => {
    const state = createRevealState(4);
    const out = new Float32Array(4);
    const longe: RevealCandidate[] = [{ slot: 1, x: 500, z: 500 }];
    const passoUpdate = 1 / CFG.updateHz + 0.0001;
    const r = tickRevealFade(state, passoUpdate, () => longe, { x: 0, z: 0 }, { x: -50, z: 50 }, out, CFG);
    expect(state.trackedSlots.size).toBe(0);
    expect(out[1]).toBe(0);
    expect(r.changed).toBe(false);
  });

  it("com dois candidatos em slots distantes, o intervalo devolvido cobre os dois (upload parcial)", () => {
    const state = createRevealState(10);
    const out = new Float32Array(10);
    const dois: RevealCandidate[] = [
      { slot: 1, x: 1, z: 0 },
      { slot: 7, x: 1, z: 0 },
    ];
    const passoUpdate = 1 / CFG.updateHz + 0.0001;
    const r = tickRevealFade(state, passoUpdate, () => dois, { x: 0, z: 0 }, { x: -50, z: 50 }, out, CFG);
    expect(r.changed).toBe(true);
    expect(r.minSlot).toBe(1);
    expect(r.maxSlot).toBe(7);
  });
});

describe("advanceAndUpload", () => {
  it("changed=false (nada pra reenviar à GPU) quando não há slot rastreado", () => {
    const state = createRevealState(4);
    const out = new Float32Array(4);
    expect(advanceAndUpload(state, 0.016, out, CFG).changed).toBe(false);
  });

  it("changed=true enquanto o valor ainda está se movendo em direção ao alvo", () => {
    const state = createRevealState(4);
    const out = new Float32Array(4);
    retickTargets(state, [{ slot: 0, x: 0, z: 0 }], { x: 0, z: 0 }, { x: -50, z: 50 }, CFG);
    expect(advanceAndUpload(state, 0.016, out, CFG).changed).toBe(true);
  });
});
