import { describe, expect, it, beforeEach } from "vitest";
import {
  bindSkillVfx,
  defineVfx,
  getVfxDefinition,
  listSkillBindings,
  listVfxDefinitions,
  resetVfxRegistry,
  resolveSkillVfx,
  VfxDefinitionError,
} from "./registry";

describe("vfx/core registry", () => {
  beforeEach(() => resetVfxRegistry());

  it("registra e devolve uma definição pelo id", () => {
    defineVfx({ id: "test_vfx", renderer: "ring", anchor: "cell" });
    expect(getVfxDefinition("test_vfx")?.renderer).toBe("ring");
  });

  it("recusa definição sem id", () => {
    expect(() => defineVfx({ id: "", renderer: "ring", anchor: "cell" })).toThrow(VfxDefinitionError);
  });

  it("recusa renderer desconhecido", () => {
    // @ts-expect-error - propositalmente inválido
    expect(() => defineVfx({ id: "x", renderer: "canvas", anchor: "cell" })).toThrow(VfxDefinitionError);
  });

  it("renderer:dom exige dom.art", () => {
    expect(() => defineVfx({ id: "x", renderer: "dom", anchor: "cell" })).toThrow(VfxDefinitionError);
    expect(() => defineVfx({ id: "x", renderer: "dom", anchor: "cell", dom: { art: "x-art" } })).not.toThrow();
  });

  it("dom só é válido com renderer:dom", () => {
    expect(() => defineVfx({ id: "x", renderer: "sprite", anchor: "cell", dom: { art: "x-art" } })).toThrow(
      VfxDefinitionError,
    );
  });

  it("animation.frames vazio é rejeitado", () => {
    expect(() =>
      defineVfx({ id: "x", renderer: "sprite", anchor: "cell", animation: { frames: [], fps: 24, mode: "loop" } }),
    ).toThrow(VfxDefinitionError);
  });

  it("listVfxDefinitions devolve todas as registradas", () => {
    defineVfx({ id: "a", renderer: "ring", anchor: "cell" });
    defineVfx({ id: "b", renderer: "beam", anchor: "cell" });
    expect(listVfxDefinitions().map((d) => d.id).sort()).toEqual(["a", "b"]);
  });

  it("liga e resolve aegisName+kind -> vfxId", () => {
    bindSkillVfx("MG_FIREBALL", "impact", "fireball_impact");
    expect(resolveSkillVfx("MG_FIREBALL", "impact")).toBe("fireball_impact");
    expect(resolveSkillVfx("MG_FIREBALL", "cast")).toBeUndefined();
    expect(resolveSkillVfx(undefined, "impact")).toBeUndefined();
  });

  it("resolveSkillVfx para skill não migrada devolve undefined (caminho legado continua valendo)", () => {
    expect(resolveSkillVfx("MG_COLDBOLT", "impact")).toBeUndefined();
  });

  it("listSkillBindings expõe o mapa cru pra guarda de arquitetura", () => {
    bindSkillVfx("MG_SIGHT", "buff", "oracle_buff");
    expect(listSkillBindings().get("MG_SIGHT:buff")).toBe("oracle_buff");
  });
});
