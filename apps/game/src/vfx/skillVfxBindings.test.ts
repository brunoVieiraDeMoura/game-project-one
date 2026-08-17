import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import "./skillVfxBindings";
import { getVfxDefinition, listSkillBindings, listVfxDefinitions } from "./core/registry";
import { getDomArt } from "./core/renderers/domArtRegistry";

/** todo `*VfxDef.tsx` sob `vfx/mage/**` — arquivos NOVOS da migração pro
 * Core, achados por convenção de nome (não por lista fixa: cada Fase 3/5
 * soma um arquivo novo, o teste acompanha sozinho). */
function findVfxDefFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findVfxDefFiles(full));
    else if (entry.name.endsWith("VfxDef.tsx")) out.push(full);
  }
  return out;
}

/**
 * Guardas de arquitetura (leia1.txt — padronização Skills/VFX, Fase 4).
 * Importar `skillVfxBindings` aqui dispara os MESMOS efeitos colaterais
 * que `vfx/vfxStore.ts` dispara em produção (`defineVfx`/`registerDomArt`/
 * `bindSkillVfx` de cada `<skill>VfxDef.tsx`) — testa o registro de
 * verdade, não uma cópia.
 */
describe("vfx/skillVfxBindings — guardas de arquitetura", () => {
  it("toda skill vinculada (aegisName+kind) resolve pra uma VfxDefinition registrada", () => {
    for (const [key, vfxId] of listSkillBindings()) {
      expect(getVfxDefinition(vfxId), `binding "${key}" -> "${vfxId}" sem VfxDefinition`).toBeDefined();
    }
  });

  it("toda VfxDefinition renderer:\"dom\" tem uma arte registrada em domArtRegistry", () => {
    for (const def of listVfxDefinitions()) {
      if (def.renderer !== "dom") continue;
      expect(def.dom?.art, `"${def.id}": renderer:"dom" sem dom.art`).toBeDefined();
      expect(getDomArt(def.dom!.art), `"${def.id}": dom.art "${def.dom!.art}" nunca registrada via registerDomArt`).toBeDefined();
    }
  });

  it("as 5 skills de prova (Fase 3) estão todas vinculadas", () => {
    const bound = new Set(listSkillBindings().keys());
    const esperado = [
      "MG_FIREBALL:cast",
      "MG_FIREBALL:impact",
      "MG_THUNDERSTORM:cast",
      "MG_THUNDERSTORM:impact",
      "MG_SAFETYWALL:area",
      "MG_FIREWALL:area",
      "MG_SIGHT:buff",
    ];
    for (const key of esperado) expect(bound.has(key), `"${key}" não está em skillVfxBindings`).toBe(true);
  });

  it("Thunder Storm impact declara coalescência por alvo (item 14: nunca 2 raios no mesmo mob)", () => {
    const def = getVfxDefinition("thunder_storm_impact");
    expect(def?.coalesce).toEqual({ by: "target", windowMs: expect.any(Number) });
  });

  it("nenhum *VfxDef.tsx (migrado pro Core) importa <Html> do drei — DomRenderer é o único caminho", () => {
    const files = findVfxDefFiles(join(__dirname, "mage"));
    expect(files.length).toBeGreaterThan(0); // a busca por convenção realmente achou os 5 arquivos
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      expect(src.includes("@react-three/drei"), `${file} importa de @react-three/drei — deveria usar o DomRenderer`).toBe(false);
    }
  });

  it("nenhuma VfxDefinition duplica um dom.art de outra (cada arte pertence a UMA skill)", () => {
    const artUsage = new Map<string, string>();
    for (const def of listVfxDefinitions()) {
      if (def.renderer !== "dom" || !def.dom) continue;
      const previous = artUsage.get(def.dom.art);
      expect(previous, `dom.art "${def.dom.art}" usada por "${previous}" E "${def.id}"`).toBeUndefined();
      artUsage.set(def.dom.art, def.id);
    }
  });
});
