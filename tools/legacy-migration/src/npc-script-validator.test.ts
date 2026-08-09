import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapNpcScript, validateNpcScript, type NpcCatalogs } from "@ragnarok/game-data";
import { parseNpcScript } from "@ragnarok/game-data";
import { extractScriptBodies } from "./npc-script/extract-corpus";
import { loadMapCatalog, loadIdCatalog, buildNpcEventIndex, makeCatalogs } from "./npc-script/catalogs";

/**
 * Testes do Validator de NPC (leia1.txt, 2026-08-08: "Validator antes do
 * Writer"). Mesmas duas partes dos módulos anteriores: casos sintéticos por
 * regra, e uma passada sobre o CORPUS REAL produzindo o relatório exigido
 * em §10.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const NPC_ROOT = join(REPO_ROOT, "rathena");
const OUTPUT_DIR = join(__dirname, "..", "output");

function fakeCatalogs(overrides?: Partial<NpcCatalogs>): NpcCatalogs {
  return {
    mapExists: (id) => id === "prontera",
    itemExists: (id) => id === 501,
    skillExists: (id) => id === 1,
    monsterExists: (id) => id === 1002,
    ...overrides,
  };
}

function run(code: string, catalogs = fakeCatalogs()) {
  const ast = parseNpcScript(code);
  const mapped = mapNpcScript(ast);
  return { ast, mapped, report: validateNpcScript(ast, mapped, catalogs) };
}

describe("Validator de NPC — labels", () => {
  it("label válida, sem duplicidade", () => {
    const { report } = run(`
      mes "oi"; close;
    OnTouch:
      end;
    `);
    expect(report.labels.duplicates).toEqual([]);
    expect(report.labels.total).toBe(1);
    expect(report.issues.filter((i) => i.code === "duplicate-label")).toEqual([]);
  });

  it("label duplicada é ERRO e invalida o NPC", () => {
    const { report } = run(`
      mes "oi"; close;
    OnTouch:
      end;
    OnTouch:
      end;
    `);
    expect(report.labels.duplicates).toEqual(["OnTouch"]);
    expect(report.classification).toBe("invalid");
    expect(report.safeToWrite).toBe(false);
    expect(report.blockers.some((b) => b.includes("duplicado"))).toBe(true);
  });

  it("goto pra rótulo EXISTENTE resolve", () => {
    const { report } = run(`
      goto L_Fim;
    L_Fim:
      close;
    `);
    expect(report.gotos).toEqual({ total: 1, resolved: 1, missing: 0, dynamic: 0 });
    expect(report.issues.filter((i) => i.code === "goto-missing")).toEqual([]);
  });

  it("goto pra rótulo INEXISTENTE é órfão — erro, bloqueia safeToWrite", () => {
    const { report } = run(`goto Nunca_Existiu; close;`);
    expect(report.gotos).toEqual({ total: 1, resolved: 0, missing: 1, dynamic: 0 });
    expect(report.classification).toBe("invalid");
    expect(report.safeToWrite).toBe(false);
  });

  it("goto DINÂMICO (alvo não é identificador literal) — nunca invalida, fica dynamic", () => {
    // sintaticamente factível pela gramática (goto é CallStatement genérico
    // com 1 arg); não ocorre de verdade no corpus real (rAthena resolve
    // goto em tempo de parse — só aceita rótulo), mas o Validator não pode
    // ASSUMIR isso por fora da AST.
    const ast = parseNpcScript(`close;`);
    ast.entryPoints[0]!.body.unshift({ kind: "CallStatement", callee: "goto", args: [{ kind: "IntLit", value: 1 }], line: 1 });
    const mapped = mapNpcScript(ast);
    const report = validateNpcScript(ast, mapped, fakeCatalogs());
    expect(report.gotos).toEqual({ total: 1, resolved: 0, missing: 0, dynamic: 1 });
    expect(report.issues.filter((i) => i.code === "goto-missing")).toEqual([]);
  });

  it("goto resolve rótulo ANINhado (dentro de bloco, achado da auditoria original) — mesmo script_code compilado", () => {
    const { report } = run(`
      if (1) {
        goto L_Interno;
      L_Interno:
        mes "chegou";
      }
      close;
    `);
    expect(report.gotos.missing).toBe(0);
    expect(report.gotos.resolved).toBe(1);
  });
});

describe("Validator de NPC — event handlers", () => {
  it("múltiplos handlers com rótulos distintos — sem conflito", () => {
    const { report } = run(`
      mes "clique"; close;
    OnTouch:
      end;
    OnInit:
      set .@x, 1;
    OnTimer5000:
      end;
    `);
    expect(report.eventHandlers.total).toBe(3);
    expect(report.eventHandlers.labels).toEqual(["OnTouch", "OnInit", "OnTimer5000"]);
    expect(report.labels.duplicates).toEqual([]);
  });

  it("handler VAZIO (rótulo sem statement) não é erro", () => {
    const { report } = run(`
      mes "clique"; close;
    OnInit:
    OnTouch:
      end;
    `);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(report.eventHandlers.total).toBe(2);
  });

  it("conflito de nomes entre handlers é a MESMA regra de rótulo duplicado", () => {
    const { report } = run(`
      close;
    OnEnable:
      end;
    OnEnable:
      end;
    `);
    expect(report.issues.some((i) => i.code === "duplicate-label" && i.message.includes("OnEnable"))).toBe(true);
  });

  it("ids de nó nunca colidem entre principal e handlers (invariante do Mapper, provada aqui)", () => {
    const { report } = run(`
      mes "a"; mes "b"; close;
    OnTouch:
      mes "c"; end;
    `);
    expect(report.issues.filter((i) => i.code === "node-id-collision")).toEqual([]);
  });
});

describe("Validator de NPC — referências estáticas", () => {
  it("mapa existente → valid", () => {
    const { report } = run(`warp "prontera",150,150; end;`);
    expect(report.references.maps).toEqual({ valid: 1, invalid: 0, unknown: 0 });
  });

  it("mapa inexistente → invalid, bloqueia safeToWrite", () => {
    const { report } = run(`warp "mapa_que_nao_existe",150,150; end;`);
    expect(report.references.maps).toEqual({ valid: 0, invalid: 1, unknown: 0 });
    expect(report.classification).toBe("invalid");
    expect(report.safeToWrite).toBe(false);
  });

  it('strings mágicas do rAthena ("this"/"Random"/"SavePoint") NÃO são mapa inválido (script.cpp: warp trata como especial)', () => {
    expect(run(`warp "Random",0,0; end;`).report.references.maps).toEqual({ valid: 1, invalid: 0, unknown: 0 });
    expect(run(`warp "SavePoint",0,0; end;`).report.references.maps).toEqual({ valid: 1, invalid: 0, unknown: 0 });
    expect(run(`warp "this",0,0; end;`).report.references.maps).toEqual({ valid: 1, invalid: 0, unknown: 0 });
    // "this" vale pra QUALQUER comando que recebe mapa; "Random"/"SavePoint" só na família warp*.
    expect(run(`killmonster "this","AllEvent"; end;`).report.references.maps).toEqual({ valid: 1, invalid: 0, unknown: 0 });
    expect(run(`killmonster "Random","AllEvent"; end;`).report.references.maps).toEqual({ valid: 0, invalid: 1, unknown: 0 });
  });

  it("referência DINÂMICA (variável no lugar do literal) → unknown, NUNCA invalid", () => {
    const { report } = run(`warp .@map$,.@x,.@y; end;`);
    expect(report.references.maps).toEqual({ valid: 0, invalid: 0, unknown: 1 });
    expect(report.issues.filter((i) => i.code === "map-invalid")).toEqual([]);
  });

  it("item existente/inexistente", () => {
    const ok = run(`getitem 501,1; close;`);
    expect(ok.report.references.items).toEqual({ valid: 1, invalid: 0, unknown: 0 });
    const bad = run(`getitem 999999,1; close;`);
    expect(bad.report.references.items).toEqual({ valid: 0, invalid: 1, unknown: 0 });
  });

  it("skill existente/inexistente", () => {
    const ok = run(`skill 1,5; close;`);
    expect(ok.report.references.skills).toEqual({ valid: 1, invalid: 0, unknown: 0 });
    const bad = run(`skill 999999,5; close;`);
    expect(bad.report.references.skills).toEqual({ valid: 0, invalid: 1, unknown: 0 });
  });

  it("monster existente/inexistente", () => {
    const ok = run(`monster "prontera",150,150,"Poring",1002,1; close;`);
    expect(ok.report.references.monsters).toEqual({ valid: 1, invalid: 0, unknown: 0 });
    const bad = run(`monster "prontera",150,150,"Ghost",999999,1; close;`);
    expect(bad.report.references.monsters).toEqual({ valid: 0, invalid: 1, unknown: 0 });
  });
});

describe("Validator de NPC — fallback / legacyScript", () => {
  it("legacyScript ISOLADO não gera issue de erro — não invalida o NPC (§6: sintaxe válida, semântica não mapeada)", () => {
    const { report } = run(`
      mes "antes";
      someWeirdCommand(1,2);
      mes "depois";
      close;
    `);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(report.legacyStatements.total).toBe(1);
    expect(report.classification).toBe("unknown"); // sintaticamente ok, semântica não mapeada — não é "invalid"
  });

  it("legacyScript AINDA bloqueia safeToWrite (§7.8, explícito e documentado — não é 'invalid')", () => {
    const { report } = run(`someWeirdCommand(1,2); close;`);
    expect(report.safeToWrite).toBe(false);
    expect(report.blockers.some((b) => b.includes("legacyScript"))).toBe(true);
  });

  it("fallback preserva o statement isolado — statements antes/depois continuam presentes no diálogo mapeado", () => {
    const ast = parseNpcScript(`
      mes "antes";
      someWeirdCommand(1,2);
      mes "depois";
      close;
    `);
    const mapped = mapNpcScript(ast);
    expect(mapped.dialogue.map((n) => n.kind)).toEqual(["say", "action", "say", "end"]);
  });

  it("NPC 100% mapeado (sem legacyScript) pode ser safeToWrite", () => {
    const { report } = run(`
      mes "oi";
      if (countitem(501) > 0) {
        warp "prontera",150,150;
      } else {
        close;
      }
    `);
    expect(report.legacyStatements.total).toBe(0);
    expect(report.classification).toBe("valid");
    expect(report.safeToWrite).toBe(true);
  });
});

describe("Validator de NPC — estrutura (varredura não perde nó aninhado)", () => {
  it("if aninhado dentro de switch dentro de while — referência no fundo da árvore é encontrada", () => {
    const { report } = run(`
      while (1) {
        switch (select("A:B")) {
          case 1:
            if (1) {
              getitem 501,1;
            }
            break;
          default:
            break;
        }
        break;
      }
      close;
    `);
    expect(report.references.items).toEqual({ valid: 1, invalid: 0, unknown: 0 });
  });

  it("for + bloco + ternário + assignment + chamada aninhada — referência dentro de ternário é encontrada", () => {
    const { report } = run(`
      for (.@i = 0; .@i < 3; .@i++) {
        .@x = (.@i == 0) ? getitem(501,1) : 0;
      }
      close;
    `);
    expect(report.references.items).toEqual({ valid: 1, invalid: 0, unknown: 0 });
  });

  it("referência dentro do TESTE de um if (não statement de topo) é encontrada", () => {
    const { report } = run(`
      if (countitem(501) > 0) {
        close;
      }
    `);
    expect(report.references.items.valid).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Corpus real — leia1.txt §10: relatório completo sobre os 9.206 scripts.
// ---------------------------------------------------------------------------

describe("Validator de NPC — corpus real (relatório §10)", () => {
  const bodies = extractScriptBodies(NPC_ROOT);

  it("NPC VALIDATION REPORT", () => {
    const maps = loadMapCatalog(NPC_ROOT);
    const items = loadIdCatalog(OUTPUT_DIR, "items.json");
    const skills = loadIdCatalog(OUTPUT_DIR, "skills.json");
    const monsters = loadIdCatalog(OUTPUT_DIR, "monsters.json");

    // passe 1 — parse + map de tudo, pra montar o índice cross-NPC de donpcevent.
    const parsed = bodies.map(({ ref, name, code }) => {
      const ast = parseNpcScript(code);
      const mapped = mapNpcScript(ast);
      return { ref, name, ast, mapped };
    });
    const npcEventIndex = buildNpcEventIndex(
      parsed.map((p) => ({ name: p.name, labels: p.ast.entryPoints.filter((ep) => ep.label !== null).map((ep) => ep.label) })),
    );
    const catalogs = makeCatalogs(maps, items, skills, monsters, npcEventIndex);

    // passe 2 — validação de verdade, com o índice já pronto.
    let valid = 0;
    let invalid = 0;
    let unknown = 0;
    let labelsTotal = 0;
    const labelDuplicates = new Set<string>();
    let gotoTotal = 0,
      gotoResolved = 0,
      gotoMissing = 0,
      gotoDynamic = 0;
    const refTotals = {
      maps: { valid: 0, invalid: 0, unknown: 0 },
      items: { valid: 0, invalid: 0, unknown: 0 },
      skills: { valid: 0, invalid: 0, unknown: 0 },
      monsters: { valid: 0, invalid: 0, unknown: 0 },
    };
    let legacyTotal = 0;
    const legacyByCallee: Record<string, number> = {};
    let eventHandlersTotal = 0;
    let npcsWithHandlers = 0;
    let maxHandlersPerNpc = 0;
    let safeToWriteCount = 0;
    const crashRefs: { ref: string; error: string }[] = [];

    for (const { ref, ast, mapped } of parsed) {
      try {
        const report = validateNpcScript(ast, mapped, catalogs);
        if (report.classification === "valid") valid++;
        else if (report.classification === "invalid") invalid++;
        else unknown++;

        labelsTotal += report.labels.total;
        for (const d of report.labels.duplicates) labelDuplicates.add(`${ref}::${d}`);

        gotoTotal += report.gotos.total;
        gotoResolved += report.gotos.resolved;
        gotoMissing += report.gotos.missing;
        gotoDynamic += report.gotos.dynamic;

        for (const key of ["maps", "items", "skills", "monsters"] as const) {
          refTotals[key].valid += report.references[key].valid;
          refTotals[key].invalid += report.references[key].invalid;
          refTotals[key].unknown += report.references[key].unknown;
        }

        legacyTotal += report.legacyStatements.total;
        for (const [callee, n] of Object.entries(report.legacyStatements.byCallee)) {
          legacyByCallee[callee] = (legacyByCallee[callee] ?? 0) + n;
        }

        eventHandlersTotal += report.eventHandlers.total;
        if (report.eventHandlers.total > 0) npcsWithHandlers++;
        maxHandlersPerNpc = Math.max(maxHandlersPerNpc, report.eventHandlers.total);

        if (report.safeToWrite) safeToWriteCount++;
      } catch (err) {
        crashRefs.push({ ref, error: (err as Error).message });
      }
    }

    const topCallees = Object.entries(legacyByCallee)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    console.log("\n=== NPC VALIDATION REPORT ===\n");
    console.log(`scripts: ${bodies.length}`);
    console.log(`valid: ${valid}`);
    console.log(`invalid: ${invalid}`);
    console.log(`unknown/dynamic: ${unknown}`);
    console.log(`crashes: ${crashRefs.length}`);
    console.log(`safeToWrite: ${safeToWriteCount} (${((safeToWriteCount / bodies.length) * 100).toFixed(1)}%)`);
    console.log(`\nlabels:`);
    console.log(`  total: ${labelsTotal}`);
    console.log(`  duplicate: ${labelDuplicates.size}`);
    console.log(`\ngotos:`);
    console.log(`  total: ${gotoTotal}`);
    console.log(`  resolved: ${gotoResolved}`);
    console.log(`  missing: ${gotoMissing}`);
    console.log(`  dynamic: ${gotoDynamic}`);
    console.log(`\nreferences:`);
    for (const key of ["maps", "items", "skills", "monsters"] as const) {
      console.log(`  ${key}: valid ${refTotals[key].valid}  invalid ${refTotals[key].invalid}  unknown ${refTotals[key].unknown}`);
    }
    console.log(`\nlegacyScript:`);
    console.log(`  statements: ${legacyTotal}`);
    console.log(`  percentage: ${((legacyTotal / (legacyTotal + valid + unknown + invalid || 1)) * 100).toFixed(1)}% dos NPCs contêm ≥1`);
    console.log(`  top callees:`, topCallees);
    console.log(`\neventHandlers:`);
    console.log(`  total: ${eventHandlersTotal}`);
    console.log(`  NPCs affected: ${npcsWithHandlers}`);
    console.log(`  max per NPC: ${maxHandlersPerNpc}`);
    console.log(`\ninformation loss (achados sistêmicos, ver doc de npc-script-validator.ts):`);
    console.log(`  - comentários (//, /* */) descartados pelo Lexer, sem representação no NpcSchema`);
    console.log(`  - formatação original não preservada (Printer normaliza)`);
    console.log(`  - blocos "function script Nome {...}" (bibliotecas) fora do NpcSchema inteiramente`);
    console.log(`  - rótulos aninhados (profundidade > 0) não são EntryPoint de 1ª classe — resolvidos por casamento de padrão no Validator`);
    console.log(`  - legacyScript.legacySource é reformatado (Printer), não fatia literal do arquivo`);
    console.log("\n==============================\n");

    if (crashRefs.length > 0) console.error("crashes (amostra):", crashRefs.slice(0, 10));
    expect(crashRefs).toEqual([]);
    expect(valid + invalid + unknown).toBe(bodies.length);
  }, 90_000);
});
