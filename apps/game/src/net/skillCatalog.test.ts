import { describe, expect, it } from "vitest";
import { getSkillDisplayName, SKILL_NAME_FALLBACK, type SkillInfo } from "./skillCatalog";

/**
 * Trava de regressão: Skill Bar, Alt+S (`SkillsWindow`) e a barra de
 * conjuração (`CastBar`) resolvem TODAS o nome de exibição por esta única
 * função — nunca lendo `aegisName`/`skill.name` (a constante crua do pacote
 * do servidor, tipo "MG_SRECOVERY") nem o `id` como substituto.
 *
 * Dois estados de "sem nome ainda", com resultado DIFERENTE de propósito:
 *  • catálogo ainda não respondeu (`info === undefined`) → `undefined`, e
 *    quem desenha mostra um ícone de carregamento (`ui/rpg.LoadingRing`),
 *    nunca texto — nem "Unknown", nem a constante Aegis.
 *  • catálogo respondeu mas o skill_db não tem nome pra essa skill
 *    (`info.name === ""`) → `SKILL_NAME_FALLBACK` ("Unknown"), porque não é
 *    carregamento, é o valor final.
 *
 * `getSkillDisplayName` é o único ponto de resolução: testar ele uma vez
 * cobre os três lugares que o chamam.
 */
describe("getSkillDisplayName — nome visual de skill, nunca Aegis nem id", () => {
  it("skill carregada: usa skill.name do catálogo (ex.: id 9, MG_SRECOVERY → Increase SP Recovery)", () => {
    const info: SkillInfo = {
      id: 9,
      aegisName: "MG_SRECOVERY",
      name: "Increase SP Recovery",
      hitType: "normal",
      target: "self",
      areaRadius: 0,
      maxLevel: 10,
      type: "self_buff",
      element: "neutral",
      spCost: 0,
      range: 0,
      cooldownMs: 0,
      durationMs: 0,
      duration2Ms: 0,
    };
    expect(getSkillDisplayName(info)).toBe("Increase SP Recovery");
  });

  it("nome ainda não carregado (info undefined): undefined — quem desenha mostra o anel de carregamento, nunca texto", () => {
    expect(getSkillDisplayName(undefined)).toBeUndefined();
  });

  it("catálogo respondeu mas sem nome (name: \"\"): Unknown — não é carregamento, é o valor final", () => {
    const info: Pick<SkillInfo, "name"> = { name: "" };
    expect(getSkillDisplayName(info)).toBe(SKILL_NAME_FALLBACK);
  });

  it("mesmo com aegisName e id presentes no objeto, o retorno NUNCA é a constante Aegis nem o id — só name, ou Unknown", () => {
    const infoSemNome = { id: 9, aegisName: "MG_SRECOVERY", name: "" } as SkillInfo;
    const resultado = getSkillDisplayName(infoSemNome);
    expect(resultado).toBe(SKILL_NAME_FALLBACK);
    expect(resultado).not.toBe("MG_SRECOVERY");
    expect(resultado).not.toBe("9");
    expect(resultado).not.toMatch(/^MG_/);
  });

  it("sequência de carregamento nunca passa por MG_*: undefined (anel) → nome correto, sem etapa intermediária", () => {
    const antes = getSkillDisplayName(undefined); // catálogo ainda não respondeu
    const depois = getSkillDisplayName({ name: "Increase SP Recovery" }); // catálogo respondeu
    expect(antes).toBeUndefined();
    expect(depois).toBe("Increase SP Recovery");
    // não existe terceiro estado possível entre os dois — a função é pura e
    // só enxerga `info`, então não há como um valor intermediário (Aegis)
    // ser produzido por ela em NENHUM re-render/hydration.
    expect(depois).not.toMatch(/^MG_/);
  });
});
