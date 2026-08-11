import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHARACTER_URLS, WEAPON_URLS } from "../assets";
import { classModelFor, weaponFamilyFor } from "./classModels";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** `CHARACTER_URLS`/`WEAPON_URLS` são caminhos `/assets/...` servidos a
 * partir de `apps/game/public` (Vite serve public na raiz) — resolve pra
 * disco relativo a este arquivo (`src/entities/`). */
const PUBLIC_DIR = join(__dirname, "../../public");

describe("weaponFamilyFor / classModelFor — ids reais de tools/legacy-migration/output/job-classes.json", () => {
  it("Swordman (1) e Knight (7) resolvem swordsman/knight", () => {
    expect(weaponFamilyFor(1)).toBe("swordsman");
    expect(classModelFor(1).character).toBe("knight");
    expect(classModelFor(7).character).toBe("knight");
  });

  it("Mage (2) e Wizard (9) resolvem mage/mage", () => {
    expect(weaponFamilyFor(2)).toBe("mage");
    expect(classModelFor(2).character).toBe("mage");
    expect(classModelFor(9).character).toBe("mage");
  });

  it("Thief (6) e Assassin (12) resolvem thief/rogue_hooded", () => {
    expect(weaponFamilyFor(6)).toBe("thief");
    expect(classModelFor(6).character).toBe("rogue_hooded");
    expect(classModelFor(12).character).toBe("rogue_hooded");
  });

  it("Archer (3) e Hunter (11) resolvem archer/ranger (personagem dedicado, não Rogue+arco)", () => {
    expect(weaponFamilyFor(3)).toBe("archer");
    expect(classModelFor(3).character).toBe("ranger");
    expect(classModelFor(11).character).toBe("ranger");
  });

  it("Novice (0) cai no fallback other/barbarian — sem arma de assinatura", () => {
    expect(weaponFamilyFor(0)).toBe("other");
    expect(classModelFor(0).character).toBe("barbarian");
    expect(classModelFor(0).weapons).toEqual([]);
  });

  it("Acolyte (4) e Priest (8) resolvem mage/mage (cajado, não fallback)", () => {
    expect(weaponFamilyFor(4)).toBe("mage");
    expect(weaponFamilyFor(8)).toBe("mage");
    expect(classModelFor(4).character).toBe("mage");
  });

  it("Monk (15), mesma raiz Acolyte, fica no fallback (luta desarmado de verdade)", () => {
    expect(weaponFamilyFor(15)).toBe("other");
  });

  it("Merchant (5) e Blacksmith (10) caem no fallback — nenhuma arma dessa linhagem no acervo", () => {
    expect(weaponFamilyFor(5)).toBe("other");
    expect(weaponFamilyFor(10)).toBe("other");
  });

  it("Ninja (25) resolve thief/rogue_hooded — linhagem visual mais próxima disponível", () => {
    expect(weaponFamilyFor(25)).toBe("thief");
    expect(classModelFor(25).character).toBe("rogue_hooded");
  });

  it("Gunslinger (24) cai no fallback — nenhuma arma de fogo no acervo", () => {
    expect(weaponFamilyFor(24)).toBe("other");
  });

  it("Taekwon (4046) cai no fallback — marcial desarmado", () => {
    expect(weaponFamilyFor(4046)).toBe("other");
  });

  it("Dragon_Knight (4252), 4º job de Knight, herda swordsman (fecho transitivo)", () => {
    expect(weaponFamilyFor(4252)).toBe("swordsman");
    expect(classModelFor(4252).character).toBe("knight");
  });

  it("Cardinal (4256), 4º job de Priest, herda mage (achado só no fecho transitivo)", () => {
    expect(weaponFamilyFor(4256)).toBe("mage");
  });

  it("Abyss_Chaser (4260), 4º job de Rogue, herda thief (achado só no fecho transitivo)", () => {
    expect(weaponFamilyFor(4260)).toBe("thief");
  });

  it("jobId desconhecido (fora de qualquer linhagem) cai no fallback sem quebrar", () => {
    expect(weaponFamilyFor(999999)).toBe("other");
  });

  it("jobId undefined/null cai no fallback sem quebrar", () => {
    expect(weaponFamilyFor(undefined)).toBe("other");
    expect(weaponFamilyFor(null)).toBe("other");
  });
});

describe("classModelFor — armas por família", () => {
  it("swordsman (Knight) empunha espada 2 mãos na mão direita", () => {
    const m = classModelFor(1);
    expect(m.weapons).toEqual([{ weapon: "sword_2handed", slot: "handslotr" }]);
  });

  it("archer (Ranger) empunha arco na mão esquerda, com rotação de pose", () => {
    const m = classModelFor(3);
    expect(m.weapons).toHaveLength(1);
    expect(m.weapons[0]).toMatchObject({ weapon: "bow", slot: "handslotl" });
    expect(m.weapons[0]!.rotation).toBeDefined();
  });

  it("mage (Mage) empunha cajado na mão direita", () => {
    const m = classModelFor(2);
    expect(m.weapons).toEqual([{ weapon: "staff", slot: "handslotr" }]);
  });

  it("thief (Rogue_Hooded) empunha adaga dupla, uma por mão — dual wield real", () => {
    const m = classModelFor(6);
    expect(m.weapons).toEqual([
      { weapon: "dagger", slot: "handslotl" },
      { weapon: "dagger", slot: "handslotr" },
    ]);
  });

  it("classe sem arma no mapeamento (fallback, ex. Novice) não empunha nada — não quebra desarmado", () => {
    const m = classModelFor(0);
    expect(m.weapons).toEqual([]);
    expect(m.character).toBe("barbarian");
  });
});

describe("todo asset referenciado pela tabela existe em disco (sem typo silencioso)", () => {
  it("todo CHARACTER_URLS aponta pra um .glb real em public/assets", () => {
    for (const [key, url] of Object.entries(CHARACTER_URLS)) {
      const onDisk = join(PUBLIC_DIR, url);
      expect(existsSync(onDisk), `${key} -> ${url} (${onDisk})`).toBe(true);
    }
  });

  it("todo WEAPON_URLS aponta pra um .gltf real em public/assets", () => {
    for (const [key, url] of Object.entries(WEAPON_URLS)) {
      const onDisk = join(PUBLIC_DIR, url);
      expect(existsSync(onDisk), `${key} -> ${url} (${onDisk})`).toBe(true);
    }
  });

  it("todo character referenciado por CLASS_MODEL (via classModelFor) existe em CHARACTER_URLS", () => {
    const jobIdsPorFamilia = [1, 2, 6, 3, 0]; // swordsman/mage/thief/archer/other
    for (const jobId of jobIdsPorFamilia) {
      const m = classModelFor(jobId);
      expect(CHARACTER_URLS).toHaveProperty(m.character);
    }
  });

  it("toda arma referenciada por CLASS_MODEL existe em WEAPON_URLS", () => {
    const jobIdsPorFamilia = [1, 2, 6, 3, 0];
    for (const jobId of jobIdsPorFamilia) {
      const m = classModelFor(jobId);
      for (const w of m.weapons) {
        expect(WEAPON_URLS).toHaveProperty(w.weapon);
      }
    }
  });
});
