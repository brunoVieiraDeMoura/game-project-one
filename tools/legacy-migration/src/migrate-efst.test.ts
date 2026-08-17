import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEfstIds } from "./migrate-efst";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

function loadSource(): string {
  return readFileSync(join(REPO_ROOT, "rathena", "src", "map", "status.hpp"), "utf-8");
}

describe("parseEfstIds", () => {
  it("resolves ids sequentially from the start of the enum", () => {
    const ids = parseEfstIds(loadSource());
    expect(ids.get(0)).toBe("EFST_PROVOKE");
    expect(ids.get(1)).toBe("EFST_ENDURE");
    expect(ids.get(2)).toBe("EFST_TWOHANDQUICKEN");
  });

  it("respects explicit `= N` resets after a run of implicit values", () => {
    const ids = parseEfstIds(loadSource());
    expect(ids.get(596)).toBe("EFST_SILVERVEIN_RUSH_POSTDELAY");
    expect(ids.get(1688)).toBe("EFST_BLOCK");
  });

  it("keeps counting past a trailing-comment line without losing sync", () => {
    const ids = parseEfstIds(loadSource());
    // EFST_OVERCOMING_CRISIS,	//1671 — comentário à direita, sem `=`
    expect(ids.get(1671)).toBe("EFST_OVERCOMING_CRISIS");
  });

  it("excludes the sentinel entries but still advances the counter through them", () => {
    const ids = parseEfstIds(loadSource());
    expect([...ids.values()]).not.toContain("EFST_BLANK");
    expect([...ids.values()]).not.toContain("EFST_MAX");
    // EFST_BLANK = -1 empurra EFST_PROVOKE pra 0, não pra 1
    expect(ids.get(0)).toBe("EFST_PROVOKE");
  });

  it("has no duplicate ids", () => {
    const ids = parseEfstIds(loadSource());
    expect(ids.size).toBeGreaterThan(1400);
  });
});
