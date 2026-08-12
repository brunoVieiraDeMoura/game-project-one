import { describe, expect, it } from "vitest";
import {
  CHAVES_ISOLAMENTO,
  chavesIsoladas,
  forcarIsolamento,
  isolado,
  isolar,
  limparIsolamento,
  reativar,
} from "./isolamento";

/**
 * `forcarIsolamento` bypassa `localStorage`/`window.location` (não existem
 * no ambiente de teste, node puro) — mesmo truque do `forcarFlag` do
 * `flightRecorder.test.ts`. O que se testa aqui é a REGRA: quem está
 * isolado responde `true`, o resto responde `false`, e nenhuma chave
 * inventada passa pelo filtro.
 */
describe("isolamento (Fase C)", () => {
  it("nasce sem nada isolado", () => {
    forcarIsolamento([]);
    for (const c of CHAVES_ISOLAMENTO) expect(isolado(c)).toBe(false);
    expect(chavesIsoladas()).toEqual([]);
  });

  it("isolar liga só a chave pedida", () => {
    forcarIsolamento([]);
    isolar("semTerreno");
    expect(isolado("semTerreno")).toBe(true);
    expect(isolado("semAoe")).toBe(false);
  });

  it("reativar desliga de volta", () => {
    forcarIsolamento(["semAoe", "semCursor"]);
    reativar("semAoe");
    expect(isolado("semAoe")).toBe(false);
    expect(isolado("semCursor")).toBe(true);
  });

  it("limparIsolamento zera tudo", () => {
    forcarIsolamento(["semProps", "semHorizonte"]);
    limparIsolamento();
    expect(chavesIsoladas()).toEqual([]);
  });

  it("cada chave é independente das outras", () => {
    forcarIsolamento([]);
    for (const c of CHAVES_ISOLAMENTO) isolar(c);
    for (const c of CHAVES_ISOLAMENTO) expect(isolado(c)).toBe(true);
    reativar("semNevoa");
    expect(isolado("semNevoa")).toBe(false);
    for (const c of CHAVES_ISOLAMENTO) {
      if (c !== "semNevoa") expect(isolado(c)).toBe(true);
    }
  });

  it("as chaves de isolamento conhecidas existem, e só elas", () => {
    expect([...CHAVES_ISOLAMENTO].sort()).toEqual(
      [
        "semRetratoAlvo",
        "semAoe",
        "semCursor",
        "semProps",
        "semTerreno",
        "semNevoa",
        "semHorizonte",
        "semVento",
        "semSol",
        "semAmbiente",
        "semAgua",
        "semSombra",
        "semParticulas",
        "semCeuFoto",
        "semImpostorArvore",
      ].sort(),
    );
  });
});
