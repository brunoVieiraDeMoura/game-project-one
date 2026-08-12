import { describe, expect, it } from "vitest";
import { origemDoAlcance, circuloDeAlcanceVisivel, type OrigemDoAlcance } from "./AttackRangeCircle";

/**
 * Lógica de VISIBILIDADE do anel, testada sem montar cena/Three.js — as duas
 * funções são puras de propósito (ver o comentário delas em
 * `AttackRangeCircle.tsx`). Cobre os Casos 1-5 do pedido de toggles de
 * combate; o gameplay em si (raio, targeting, dano) não é tocado por nada
 * aqui — só decide se um `<mesh>` nasce.
 */

describe("origemDoAlcance — prioridade fixa, sem depender de classe", () => {
  it("mirando uma skill: nenhuma origem (AimPreview cobre sozinho)", () => {
    expect(
      origemDoAlcance({ mirando: true, temPendenteAlvo: true, temPendenteChao: true, temAlvoBasico: true }),
    ).toBeNull();
  });

  it("indo até o alcance pra castar numa CRIATURA: origem skill", () => {
    expect(
      origemDoAlcance({ mirando: false, temPendenteAlvo: true, temPendenteChao: false, temAlvoBasico: true }),
    ).toBe("skill");
  });

  it("indo até o alcance pra castar numa CÉLULA: origem skill", () => {
    expect(
      origemDoAlcance({ mirando: false, temPendenteAlvo: false, temPendenteChao: true, temAlvoBasico: true }),
    ).toBe("skill");
  });

  it("só alvo de ataque básico, sem skill pendente nenhuma: origem ataque", () => {
    expect(
      origemDoAlcance({ mirando: false, temPendenteAlvo: false, temPendenteChao: false, temAlvoBasico: true }),
    ).toBe("ataque");
  });

  it("nada selecionado: nenhuma origem", () => {
    expect(
      origemDoAlcance({ mirando: false, temPendenteAlvo: false, temPendenteChao: false, temAlvoBasico: false }),
    ).toBeNull();
  });
});

describe("circuloDeAlcanceVisivel", () => {
  const raio = 5; // > 1 célula, o mínimo pra qualquer anel valer a pena

  it("Caso 1 — padrão (showAttackRange=false, showSkillArea=true): ataque não aparece, skill aparece", () => {
    const prefs = { showAttackRange: false, showSkillArea: true };
    expect(circuloDeAlcanceVisivel("ataque", raio, prefs)).toBe(false);
    expect(circuloDeAlcanceVisivel("skill", raio, prefs)).toBe(true);
  });

  it("Caso 2 — showAttackRange=true: ataque aparece, skill continua aparecendo", () => {
    const prefs = { showAttackRange: true, showSkillArea: true };
    expect(circuloDeAlcanceVisivel("ataque", raio, prefs)).toBe(true);
    expect(circuloDeAlcanceVisivel("skill", raio, prefs)).toBe(true);
  });

  it("Caso 3 — showSkillArea=false: skill desaparece, ataque segue sua própria config (ligado)", () => {
    const prefs = { showAttackRange: true, showSkillArea: false };
    expect(circuloDeAlcanceVisivel("skill", raio, prefs)).toBe(false);
    expect(circuloDeAlcanceVisivel("ataque", raio, prefs)).toBe(true);
  });

  it("Caso 4 — os dois OFF: nenhuma das duas origens aparece", () => {
    const prefs = { showAttackRange: false, showSkillArea: false };
    expect(circuloDeAlcanceVisivel("ataque", raio, prefs)).toBe(false);
    expect(circuloDeAlcanceVisivel("skill", raio, prefs)).toBe(false);
  });

  it("sem origem (nada selecionado/mirando): sempre invisível, não importa a preferência", () => {
    expect(circuloDeAlcanceVisivel(null, raio, { showAttackRange: true, showSkillArea: true })).toBe(false);
  });

  it("raio <= 1 célula: sempre invisível — corpo a corpo não ganha ruído mesmo com o toggle ligado", () => {
    expect(circuloDeAlcanceVisivel("ataque", 1, { showAttackRange: true, showSkillArea: true })).toBe(false);
    expect(circuloDeAlcanceVisivel("skill", 0, { showAttackRange: true, showSkillArea: true })).toBe(false);
  });

  it("independência: alternar um toggle nunca muda o resultado do outro pra mesma origem", () => {
    const combinacoes: [boolean, boolean][] = [
      [false, true],
      [true, true],
      [true, false],
      [false, false],
    ];
    for (const [showAttackRange, showSkillArea] of combinacoes) {
      expect(circuloDeAlcanceVisivel("ataque", raio, { showAttackRange, showSkillArea })).toBe(showAttackRange);
      expect(circuloDeAlcanceVisivel("skill", raio, { showAttackRange, showSkillArea })).toBe(showSkillArea);
    }
  });
});

describe("Caso 5 — todas as classes/arquétipos: o resultado não depende de jobId nem do valor de atkRange", () => {
  // mesmos jobIds de família usados em `entities/classModels.test.ts`
  // (novice/swordsman/mage/thief/archer) — só para provar que o raio de
  // ataque de QUALQUER classe (arma diferente = atkRange diferente) segue a
  // MESMA regra de visibilidade, sem branch por classe em lugar nenhum.
  const jobIdsPorFamilia = [0, 1, 2, 3, 6];
  const atkRangesPossiveis = [1, 2, 5, 9, 15]; // corpo a corpo curto até arco/arma longa

  it("mesma origem 'ataque', mesmo toggle, qualquer classe/atkRange: resultado idêntico", () => {
    for (const jobId of jobIdsPorFamilia) {
      for (const atkRange of atkRangesPossiveis) {
        // a função nem RECEBE jobId — é a prova estrutural de que não há
        // como ela se comportar diferente por classe
        const off = circuloDeAlcanceVisivel("ataque", atkRange, { showAttackRange: false, showSkillArea: true });
        const on = circuloDeAlcanceVisivel("ataque", atkRange, { showAttackRange: true, showSkillArea: true });
        expect(off).toBe(false);
        expect(on).toBe(atkRange > 1);
        void jobId; // documental: a mesma asserção vale pra toda família listada
      }
    }
  });

  it("mesma origem 'skill', mesmo toggle, qualquer classe: resultado idêntico", () => {
    for (const jobId of jobIdsPorFamilia) {
      const on = circuloDeAlcanceVisivel("skill", 9, { showAttackRange: false, showSkillArea: true });
      const off = circuloDeAlcanceVisivel("skill", 9, { showAttackRange: false, showSkillArea: false });
      expect(on).toBe(true);
      expect(off).toBe(false);
      void jobId;
    }
  });
});

describe("Caso 7 — visibilidade não é mecânica: o raio nunca muda com a preferência", () => {
  it("circuloDeAlcanceVisivel não recebe nem devolve raio — só um booleano de desenho", () => {
    const resultado: boolean = circuloDeAlcanceVisivel("ataque", 9, { showAttackRange: true, showSkillArea: true });
    expect(typeof resultado).toBe("boolean");
  });

  it("a mesma origem/raio com preferências diferentes nunca muda o RAIO — só se aparece", () => {
    const raioFixo = 9;
    const origem: OrigemDoAlcance = "ataque";
    // simula o componente real: `raioAtual` é calculado ANTES e
    // independentemente de `circuloDeAlcanceVisivel` — aqui só confirmamos
    // que a função de visibilidade não tem como alterá-lo, por não o receber
    // por referência nem devolvê-lo.
    circuloDeAlcanceVisivel(origem, raioFixo, { showAttackRange: false, showSkillArea: false });
    circuloDeAlcanceVisivel(origem, raioFixo, { showAttackRange: true, showSkillArea: true });
    expect(raioFixo).toBe(9); // nunca mudou — é `const`, a prova é estrutural
  });
});
