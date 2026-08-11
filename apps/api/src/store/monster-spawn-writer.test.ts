import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MonsterSpawn } from "@ragnarok/game-data";
import { applyMonsterSpawnSync, type MonsterSpawnWriterPaths } from "./monster-spawn-writer";

/**
 * Testes reais do write-path de spawn (Fase 4, auditoria A23). `spawnRoot`
 * é um `mkdtempSync` novo por teste — nunca `npc-idle/mobs` real. Identidade
 * por `spawnId` (nunca linha) é o ponto central: cada teste de preservação
 * confere BYTE A BYTE que um spawn vizinho não mudou, e o teste de
 * regressão (equivalente ao drift de `legacyRef` da Fase 3.5) prova que uma
 * operação que muda a contagem de linhas do arquivo não invalida a
 * localização de um spawn seguinte.
 */

const MOB = { id: 1002, name: "Poring" };
const MOB2 = { id: 1012, name: "Roda Frog" };

function spawn(overrides: Partial<MonsterSpawn> = {}): MonsterSpawn {
  return { mapId: "prt_fild00", amount: 10, respawnTimeMs: 5000, respawnVarianceMs: 0, boss: false, ...overrides };
}

describe("applyMonsterSpawnSync", () => {
  let dir: string;
  let paths: MonsterSpawnWriterPaths;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "monster-spawn-writer-test-"));
    const mapConfPath = join(dir, "map_conf.txt");
    writeFileSync(
      mapConfPath,
      ["npc: npc/game-project/mobs/prt_fild00.txt", "npc: npc/game-project/mobs/prt_fild01.txt", "npc: npc/game-project/mobs/gpqa01.txt"].join("\n") + "\n",
      "utf8",
    );
    paths = { spawnRoot: dir, mapConfPath };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("cria spawn novo — arquivo nasce com marcador + linha, spawnId atribuído", () => {
    const result = applyMonsterSpawnSync(paths, MOB, [], [spawn()]);
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") throw new Error("esperava applied");

    expect(result.spawns).toHaveLength(1);
    expect(result.spawns[0]!.spawnId).toBeTruthy();

    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toBe(`// spawnId:${result.spawns[0]!.spawnId}\nprt_fild00,0,0\tmonster\tPoring\t1002,10,5000\n`);
  });

  it("recusa quando o mapa não está registrado em map_conf.txt — nada é escrito", () => {
    const result = applyMonsterSpawnSync(paths, MOB, [], [spawn({ mapId: "prt_fild99" })]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") throw new Error("esperava refused");
    expect(result.error).toBe("map-not-registered");
    expect(result.mapId).toBe("prt_fild99");
    expect(existsSync(join(dir, "prt_fild99.txt"))).toBe(false);
  });

  it("edita spawn existente — linha de dados muda, marcador e spawnId ficam intocados", () => {
    const created = applyMonsterSpawnSync(paths, MOB, [], [spawn({ amount: 10 })]);
    if (created.kind !== "applied") throw new Error("setup falhou");
    const before = created.spawns;
    const id = before[0]!.spawnId!;

    const edited = applyMonsterSpawnSync(paths, MOB, before, [{ ...before[0]!, amount: 25, respawnTimeMs: 9000 }]);
    expect(edited.kind).toBe("applied");
    if (edited.kind !== "applied") throw new Error("esperava applied");
    expect(edited.spawns[0]!.spawnId).toBe(id); // spawnId não muda numa edição

    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toBe(`// spawnId:${id}\nprt_fild00,0,0\tmonster\tPoring\t1002,25,9000\n`);
  });

  it("remove spawn — marcador e linha de dados somem, arquivo fica vazio", () => {
    const created = applyMonsterSpawnSync(paths, MOB, [], [spawn()]);
    if (created.kind !== "applied") throw new Error("setup falhou");

    const removed = applyMonsterSpawnSync(paths, MOB, created.spawns, []);
    expect(removed.kind).toBe("applied");
    if (removed.kind !== "applied") throw new Error("esperava applied");
    expect(removed.spawns).toHaveLength(0);

    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toBe("");
  });

  it("no-op: reenviar exatamente os mesmos spawns não toca o arquivo", () => {
    const created = applyMonsterSpawnSync(paths, MOB, [], [spawn()]);
    if (created.kind !== "applied") throw new Error("setup falhou");
    const before = readFileSync(join(dir, "prt_fild00.txt"), "utf8");

    const noop = applyMonsterSpawnSync(paths, MOB, created.spawns, created.spawns);
    expect(noop.kind).toBe("skip");
    expect(readFileSync(join(dir, "prt_fild00.txt"), "utf8")).toBe(before);
  });

  it("múltiplos spawns no mesmo arquivo: editar B não altera A nem C (preservação byte a byte)", () => {
    const created = applyMonsterSpawnSync(paths, MOB, [], [
      spawn({ amount: 1 }),
      spawn({ amount: 2 }),
      spawn({ amount: 3 }),
    ]);
    if (created.kind !== "applied") throw new Error("setup falhou");
    const [a, b, c] = created.spawns;

    const edited = applyMonsterSpawnSync(paths, MOB, created.spawns, [a!, { ...b!, amount: 999 }, c!]);
    expect(edited.kind).toBe("applied");
    if (edited.kind !== "applied") throw new Error("esperava applied");

    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toContain(`// spawnId:${a!.spawnId}\nprt_fild00,0,0\tmonster\tPoring\t1002,1,5000`);
    expect(text).toContain(`// spawnId:${b!.spawnId}\nprt_fild00,0,0\tmonster\tPoring\t1002,999,5000`);
    expect(text).toContain(`// spawnId:${c!.spawnId}\nprt_fild00,0,0\tmonster\tPoring\t1002,3,5000`);
  });

  it("múltiplos spawns do MESMO monstro (áreas diferentes) — cada um vira uma linha própria", () => {
    const created = applyMonsterSpawnSync(paths, MOB, [], [
      spawn({ area: { x: 10, y: 10, xs: 5, ys: 5 } }),
      spawn({ area: { x: 200, y: 200, xs: 5, ys: 5 } }),
    ]);
    expect(created.kind).toBe("applied");
    if (created.kind !== "applied") throw new Error("esperava applied");
    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toContain("prt_fild00,10,10,5,5\tmonster\tPoring\t1002,10,5000");
    expect(text).toContain("prt_fild00,200,200,5,5\tmonster\tPoring\t1002,10,5000");
  });

  it("spawns em mapas diferentes vão pra arquivos diferentes, sem se misturar", () => {
    const created = applyMonsterSpawnSync(paths, MOB, [], [spawn({ mapId: "prt_fild00" }), spawn({ mapId: "prt_fild01" })]);
    expect(created.kind).toBe("applied");
    if (created.kind !== "applied") throw new Error("esperava applied");
    expect(created.touchedFiles.sort()).toEqual([join(dir, "prt_fild00.txt"), join(dir, "prt_fild01.txt")].sort());
    expect(readFileSync(join(dir, "prt_fild00.txt"), "utf8")).toContain("prt_fild00,0,0");
    expect(readFileSync(join(dir, "prt_fild01.txt"), "utf8")).toContain("prt_fild01,0,0");
  });

  it("mover um spawn de mapa (mesmo spawnId, mapId muda) remove do arquivo antigo e cria no novo", () => {
    const created = applyMonsterSpawnSync(paths, MOB, [], [spawn({ mapId: "prt_fild00" })]);
    if (created.kind !== "applied") throw new Error("setup falhou");
    const id = created.spawns[0]!.spawnId!;

    const moved = applyMonsterSpawnSync(paths, MOB, created.spawns, [{ ...created.spawns[0]!, mapId: "prt_fild01" }]);
    expect(moved.kind).toBe("applied");
    if (moved.kind !== "applied") throw new Error("esperava applied");

    expect(readFileSync(join(dir, "prt_fild00.txt"), "utf8")).toBe("");
    expect(readFileSync(join(dir, "prt_fild01.txt"), "utf8")).toContain(`spawnId:${id}`);
  });

  it("REGRESSÃO (equivalente ao drift de legacyRef, Fase 3.5): remover B não invalida a identidade de C — C continua editável mesmo com o arquivo tendo encolhido", () => {
    // A, B, C no mesmo arquivo.
    const created = applyMonsterSpawnSync(paths, MOB, [], [spawn({ amount: 1 }), spawn({ amount: 2 }), spawn({ amount: 3 })]);
    if (created.kind !== "applied") throw new Error("setup falhou");
    const [a, b, c] = created.spawns;

    // remove B — arquivo perde 2 linhas (marcador + dado), C físicamente sobe de posição.
    const afterRemoveB = applyMonsterSpawnSync(paths, MOB, created.spawns, [a!, c!]);
    expect(afterRemoveB.kind).toBe("applied");
    if (afterRemoveB.kind !== "applied") throw new Error("esperava applied");

    const textAfterRemove = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(textAfterRemove).not.toContain(`spawnId:${b!.spawnId}`);
    expect(textAfterRemove).toContain(`spawnId:${a!.spawnId}`);
    expect(textAfterRemove).toContain(`spawnId:${c!.spawnId}`);
    expect(textAfterRemove).not.toMatch(/\n\n\n/); // remover B não deixa separador residual (bug corrigido)

    // agora edita C, usando o MESMO spawnId de antes (nunca um número de
    // linha) — sem a correção de identidade estável, isso é exatamente onde
    // o drift do NPC (Fase 3.5) teria corrompido a localização.
    const cNow = afterRemoveB.spawns.find((s) => s.spawnId === c!.spawnId)!;
    const editedC = applyMonsterSpawnSync(paths, MOB, afterRemoveB.spawns, [a!, { ...cNow, amount: 777 }]);
    expect(editedC.kind).toBe("applied");
    if (editedC.kind !== "applied") throw new Error("esperava applied");

    const finalText = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(finalText).toContain(`// spawnId:${c!.spawnId}\nprt_fild00,0,0\tmonster\tPoring\t1002,777,5000`);
    // A nunca foi tocado por nenhuma das duas operações.
    expect(finalText).toContain(`// spawnId:${a!.spawnId}\nprt_fild00,0,0\tmonster\tPoring\t1002,1,5000`);
    expect(finalText).not.toContain("1002,2,5000"); // conteúdo de B não ressuscitou
  });

  it("round-trip: escrever e reler produz exatamente os campos originais", () => {
    const s = spawn({ area: { x: 64, y: 64, xs: 10, ys: 10 }, amount: 3, respawnTimeMs: 5000, respawnVarianceMs: 1000, boss: true });
    const created = applyMonsterSpawnSync(paths, MOB2, [], [s]);
    expect(created.kind).toBe("applied");
    if (created.kind !== "applied") throw new Error("esperava applied");
    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toContain("prt_fild00,64,64,10,10\tboss_monster\tRoda Frog\t1012,3,5000,1000");
  });

  it("operacional: marcador sem linha de dados válida logo depois é recusado (arquivo mudou por fora)", () => {
    writeFileSync(join(dir, "prt_fild00.txt"), "// spawnId:ghost\nnão é uma linha de spawn\n", "utf8");
    const result = applyMonsterSpawnSync(paths, MOB, [{ ...spawn(), spawnId: "ghost" }], []);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") throw new Error("esperava refused");
    expect(result.error).toBe("operational");
  });

  // fixture com conteúdo hand-authored real (cabeçalho + linha em branco
  // legítima + 2 spawns não marcados), igual a gpqa01.txt de verdade — usado
  // nos testes de "criar→remover" pra provar round-trip EXATO contra
  // conteúdo pré-existente, não só contra arquivo vazio.
  const PRISTINE = `//===== game-project Script ===================================
//= fixture de teste (Fase 4, bug do separador residual na remoção)
//==============================================================

prt_fild00,64,64,10,10\tmonster\tQA Slime Novo\t25001,3,5000
prt_fild00,50,50,10,10\tmonster\tPoring\t1002,3,5000
`;

  it("BUG FIX: criar → remover, com arquivo pré-existente não vazio — volta EXATAMENTE ao conteúdo original (nenhum resíduo)", () => {
    writeFileSync(join(dir, "prt_fild00.txt"), PRISTINE, "utf8");

    const created = applyMonsterSpawnSync(paths, MOB, [], [spawn({ area: { x: 90, y: 90, xs: 3, ys: 3 } })]);
    if (created.kind !== "applied") throw new Error("setup falhou");
    expect(readFileSync(join(dir, "prt_fild00.txt"), "utf8")).not.toBe(PRISTINE);

    const removed = applyMonsterSpawnSync(paths, MOB, created.spawns, []);
    expect(removed.kind).toBe("applied");
    expect(readFileSync(join(dir, "prt_fild00.txt"), "utf8")).toBe(PRISTINE); // byte a byte, sem linha em branco sobrando
  });

  it("BUG FIX: criar A + criar B (chamadas separadas) → remover A — B fica byte a byte intacto, sem linha em branco residual de A", () => {
    writeFileSync(join(dir, "prt_fild00.txt"), PRISTINE, "utf8");

    const a = applyMonsterSpawnSync(paths, MOB, [], [spawn({ area: { x: 10, y: 10, xs: 2, ys: 2 } })]);
    if (a.kind !== "applied") throw new Error("setup A falhou");
    const b = applyMonsterSpawnSync(paths, MOB, [], [spawn({ area: { x: 20, y: 20, xs: 2, ys: 2 } })]);
    if (b.kind !== "applied") throw new Error("setup B falhou");
    const bBlock = `// spawnId:${b.spawns[0]!.spawnId}\nprt_fild00,20,20,2,2\tmonster\tPoring\t1002,10,5000`;
    const textWithBoth = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(textWithBoth).toContain(bBlock);

    const removedA = applyMonsterSpawnSync(paths, MOB, [...a.spawns, ...b.spawns], b.spawns);
    expect(removedA.kind).toBe("applied");
    const finalText = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(finalText).not.toContain(`spawnId:${a.spawns[0]!.spawnId}`);
    expect(finalText).toContain(bBlock); // B intacto, byte a byte
    expect(finalText).not.toMatch(/\n\n\n/); // nenhuma linha em branco dupla sobrando
    expect(finalText.endsWith("\n\n")).toBe(false); // nem no fim do arquivo
  });

  it("BUG FIX: criar A + B + C → remover B — A e C ficam intactos, sem resíduo de B", () => {
    const created = applyMonsterSpawnSync(paths, MOB, [], [spawn({ amount: 1 }), spawn({ amount: 2 }), spawn({ amount: 3 })]);
    if (created.kind !== "applied") throw new Error("setup falhou");
    const [a, b, c] = created.spawns;
    const aBlock = `// spawnId:${a!.spawnId}\nprt_fild00,0,0\tmonster\tPoring\t1002,1,5000`;
    const cBlock = `// spawnId:${c!.spawnId}\nprt_fild00,0,0\tmonster\tPoring\t1002,3,5000`;

    const removedB = applyMonsterSpawnSync(paths, MOB, created.spawns, [a!, c!]);
    expect(removedB.kind).toBe("applied");
    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toContain(aBlock);
    expect(text).toContain(cBlock);
    expect(text).not.toContain(`spawnId:${b!.spawnId}`);
    expect(text).not.toContain("1002,2,5000"); // conteúdo de B não sobra em lugar nenhum
    expect(text).toBe(`${aBlock}\n\n${cBlock}\n`); // exatamente A + 1 separador + C, nada mais
  });

  it("BUG FIX: remover o ÚLTIMO spawn do arquivo (com conteúdo pré-existente antes) não deixa lixo/separador extra", () => {
    writeFileSync(join(dir, "prt_fild00.txt"), PRISTINE, "utf8");
    const created = applyMonsterSpawnSync(paths, MOB, [], [spawn({ area: { x: 90, y: 90, xs: 3, ys: 3 } })]);
    if (created.kind !== "applied") throw new Error("setup falhou");

    const removed = applyMonsterSpawnSync(paths, MOB, created.spawns, []);
    expect(removed.kind).toBe("applied");
    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toBe(PRISTINE);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("BUG FIX: múltiplos spawns do MESMO mob — remover um não afeta os outros nem deixa resíduo", () => {
    const created = applyMonsterSpawnSync(paths, MOB, [], [
      spawn({ area: { x: 1, y: 1, xs: 1, ys: 1 } }),
      spawn({ area: { x: 2, y: 2, xs: 1, ys: 1 } }),
      spawn({ area: { x: 3, y: 3, xs: 1, ys: 1 } }),
    ]);
    if (created.kind !== "applied") throw new Error("setup falhou");
    const [s1, s2, s3] = created.spawns;

    const removedS2 = applyMonsterSpawnSync(paths, MOB, created.spawns, [s1!, s3!]);
    expect(removedS2.kind).toBe("applied");
    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toContain(`spawnId:${s1!.spawnId}`);
    expect(text).toContain(`spawnId:${s3!.spawnId}`);
    expect(text).not.toContain(`spawnId:${s2!.spawnId}`);
    expect(text).not.toContain("prt_fild00,2,2,1,1");
    expect(text).not.toMatch(/\n\n\n/);
  });

  it("BUG FIX: linhas em branco legítimas do arquivo original NÃO são removidas por estarem vazias — só a do bloco removido", () => {
    // 2 linhas em branco legítimas de propósito (separando seções hand-authored).
    const withLegitBlanks = `// secao 1

prt_fild00,1,1,1,1\tmonster\tPoring\t1002,5,5000


// secao 2
prt_fild00,2,2,1,1\tmonster\tPoring\t1002,5,5000
`;
    writeFileSync(join(dir, "prt_fild00.txt"), withLegitBlanks, "utf8");

    const created = applyMonsterSpawnSync(paths, MOB, [], [spawn({ area: { x: 99, y: 99, xs: 1, ys: 1 } })]);
    if (created.kind !== "applied") throw new Error("setup falhou");

    const removed = applyMonsterSpawnSync(paths, MOB, created.spawns, []);
    expect(removed.kind).toBe("applied");
    expect(readFileSync(join(dir, "prt_fild00.txt"), "utf8")).toBe(withLegitBlanks); // as 2 linhas em branco originais sobrevivem intactas
  });

  it("spawn do catálogo sem spawnId (nunca passou pelo writer) é ignorado no diff — nunca editado/removido às cegas", () => {
    const legacySpawn: MonsterSpawn = spawn({ amount: 42 }); // sem spawnId
    const result = applyMonsterSpawnSync(paths, MOB, [legacySpawn], [legacySpawn]);
    // nenhum spawnId em before nem depois "casa" — o writer trata como
    // "nada em comum" e recria; para não perder o dado, o chamador deveria
    // enviar `after` com o registro já presente (mesma entrada), o que
    // resulta numa CRIAÇÃO nova (ganha spawnId), não um no-op silencioso.
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") throw new Error("esperava applied");
    expect(result.spawns[0]!.spawnId).toBeTruthy();
  });
});
