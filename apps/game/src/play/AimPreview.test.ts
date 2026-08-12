import { describe, expect, it } from "vitest";
import { areaDeSkillVisivel } from "./AimPreview";

/**
 * `areaDeSkillVisivel` cobre o anel de alcance E a mancha de área da mira de
 * skill — os dois nascem/somem juntos com `showSkillArea` (ver o comentário
 * do arquivo). Puro, sem `<Canvas>`.
 */
describe("areaDeSkillVisivel", () => {
  it("Caso 1 — padrão (showSkillArea=true): mirando uma skill, a mira aparece", () => {
    expect(areaDeSkillVisivel(true, true)).toBe(true);
  });

  it("Caso 3/4 — showSkillArea=false: a mira nunca aparece, mesmo mirando", () => {
    expect(areaDeSkillVisivel(true, false)).toBe(false);
  });

  it("sem mirar nenhuma skill: nunca aparece, mesmo com showSkillArea=true", () => {
    expect(areaDeSkillVisivel(false, true)).toBe(false);
    expect(areaDeSkillVisivel(false, false)).toBe(false);
  });

  it("Caso 5 — não depende de classe: a função nem recebe jobId/classId", () => {
    // prova estrutural — mesma assinatura, mesmo resultado pra qualquer chamador
    for (const mirando of [true, false]) {
      for (const showSkillArea of [true, false]) {
        expect(areaDeSkillVisivel(mirando, showSkillArea)).toBe(mirando && showSkillArea);
      }
    }
  });
});
