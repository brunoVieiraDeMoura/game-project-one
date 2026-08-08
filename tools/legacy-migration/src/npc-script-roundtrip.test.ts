import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { printNpcScript, type Statement, type Expr, type NpcScriptAst } from "@ragnarok/game-data";
import { parseNpcScript, parseExpression } from "./npc-script/parser";
import { extractScriptBodies } from "./npc-script/extract-corpus";

/**
 * Gate do Lexer/Parser/AST de NPCs (leia1.txt, aprovação da arquitetura,
 * 2026-08-07): round-trip ESTRUTURAL (não textual) sobre os scripts reais
 * de `rathena/npc/re/scripts_main.conf`, mais o relatório de cobertura
 * exigido antes de começar Mapper/Validator/Writer.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const NPC_ROOT = join(REPO_ROOT, "rathena");

/** remove `line` de toda a árvore pra comparar SÓ estrutura (leia1.txt: "equivalência estrutural do AST, não igualdade textual"). */
function stripLines(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripLines);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "line" || k === "start" || k === "end" || k === "bodyStart" || k === "bodyEnd") continue;
      out[k] = stripLines(v);
    }
    return out;
  }
  return node;
}

interface Coverage {
  entryPoints: number;
  labeledEntryPoints: number;
  statements: number;
  byKind: Record<string, number>;
  rawStatements: number;
  ifCount: number;
  switchCount: number;
  whileCount: number;
  forCount: number;
  callCount: number;
}

function walkStatements(stmts: Statement[], cov: Coverage) {
  for (const st of stmts) {
    cov.statements++;
    cov.byKind[st.kind] = (cov.byKind[st.kind] ?? 0) + 1;
    switch (st.kind) {
      case "RawStatement":
        cov.rawStatements++;
        break;
      case "IfStatement":
        cov.ifCount++;
        walkStatements(st.consequent, cov);
        if (st.alternate) walkStatements(st.alternate, cov);
        break;
      case "SwitchStatement":
        cov.switchCount++;
        for (const c of st.cases) walkStatements(c.body, cov);
        break;
      case "WhileStatement":
        cov.whileCount++;
        walkStatements(st.body, cov);
        break;
      case "DoWhileStatement":
        cov.whileCount++;
        walkStatements(st.body, cov);
        break;
      case "ForStatement":
        cov.forCount++;
        walkStatements(st.body, cov);
        break;
      case "BlockStatement":
        walkStatements(st.body, cov);
        break;
      case "CallStatement":
        cov.callCount++;
        break;
    }
  }
}

/** categoria pra relatório: rótulo aninhado (`Nome:`, texto sem espaço,
 * produzido pelo ramo dedicado de `parseStatementInner`) vs. falha de parse
 * de verdade (texto = tokens originais dumped com espaço por `recover()`,
 * categorizado pelo primeiro token — geralmente o nome do comando/palavra
 * que disparou o erro). */
function categorizeRawStatement(text: string): string {
  if (/^\S+:$/.test(text)) return "(rótulo aninhado)";
  const first = text.trim().split(/\s+/)[0] ?? "(vazio)";
  return first;
}

function collectRawStatements(asts: NpcScriptAst[], refs: string[]): { text: string; ref: string }[] {
  const out: { text: string; ref: string }[] = [];
  const walk = (stmts: Statement[], ref: string) => {
    for (const st of stmts) {
      if (st.kind === "RawStatement") out.push({ text: st.text, ref });
      else if (st.kind === "IfStatement") {
        walk(st.consequent, ref);
        if (st.alternate) walk(st.alternate, ref);
      } else if (st.kind === "SwitchStatement") for (const c of st.cases) walk(c.body, ref);
      else if (st.kind === "WhileStatement") walk(st.body, ref);
      else if (st.kind === "DoWhileStatement") walk(st.body, ref);
      else if (st.kind === "ForStatement") walk(st.body, ref);
      else if (st.kind === "BlockStatement") walk(st.body, ref);
    }
  };
  asts.forEach((ast, i) => {
    for (const ep of ast.entryPoints) walk(ep.body, refs[i]!);
  });
  return out;
}

function collectCoverage(asts: NpcScriptAst[]): Coverage {
  const cov: Coverage = {
    entryPoints: 0,
    labeledEntryPoints: 0,
    statements: 0,
    byKind: {},
    rawStatements: 0,
    ifCount: 0,
    switchCount: 0,
    whileCount: 0,
    forCount: 0,
    callCount: 0,
  };
  for (const ast of asts) {
    for (const ep of ast.entryPoints) {
      cov.entryPoints++;
      if (ep.label) cov.labeledEntryPoints++;
      walkStatements(ep.body, cov);
    }
  }
  return cov;
}

describe("NPC script — Lexer/Parser/AST (gate antes do Mapper)", () => {
  const bodies = extractScriptBodies(NPC_ROOT);

  it(`extrai corpos de script reais (achado: ${bodies.length} NPCs de script em scripts_main.conf)`, () => {
    expect(bodies.length).toBeGreaterThan(5000);
  });

  it("round-trip ESTRUTURAL: parse → print → reparse → AST idêntica (ignorando `line`), sobre TODO o corpus real", () => {
    const mismatches: { ref: string; error: string }[] = [];
    for (const { ref, code } of bodies) {
      try {
        const ast1 = parseNpcScript(code);
        const printed = printNpcScript(ast1);
        const ast2 = parseNpcScript(printed);
        const a = JSON.stringify(stripLines(ast1));
        const b = JSON.stringify(stripLines(ast2));
        if (a !== b) mismatches.push({ ref, error: "AST diverge após reimpressão" });
      } catch (err) {
        mismatches.push({ ref, error: (err as Error).message });
      }
    }
    if (mismatches.length > 0) {
      console.error(`${mismatches.length} divergências de round-trip (amostra):`, mismatches.slice(0, 10));
    }
    expect(mismatches).toEqual([]);
  }, 30_000); // ~9.200 scripts × parse+print+reparse+diff passa de 5s (default do vitest)

  it("relatório de cobertura (leia1.txt: exigido antes de Mapper/Validator/Writer)", () => {
    const asts = bodies.map(({ code }) => parseNpcScript(code));
    const cov = collectCoverage(asts);
    const fallbackRate = ((cov.rawStatements / cov.statements) * 100).toFixed(1);
    console.log("\n=== Cobertura do Parser de NPC ===");
    console.log(`scripts analisados: ${bodies.length}`);
    console.log(`entry points: ${cov.entryPoints} (${cov.labeledEntryPoints} rotulados / ${cov.entryPoints - cov.labeledEntryPoints} corpo principal)`);
    console.log(`statements totais: ${cov.statements}`);
    console.log(`  por tipo:`, cov.byKind);
    console.log(`RawStatement (fallback): ${cov.rawStatements} (${fallbackRate}% do total)`);
    console.log(`if: ${cov.ifCount}  switch: ${cov.switchCount}  while: ${cov.whileCount}  for: ${cov.forCount}`);
    console.log(`CallStatement (comandos): ${cov.callCount}`);
    console.log("===================================\n");
    expect(cov.statements).toBeGreaterThan(0);
  });

  it("classificação dos RawStatement (fallback) por construção — leia1.txt: nenhuma categoria relevante escondida sob número agregado", () => {
    const refs = bodies.map((b) => b.ref);
    const asts = bodies.map(({ code }) => parseNpcScript(code));
    const raws = collectRawStatements(asts, refs);

    const byCategory = new Map<string, { count: number; example: { text: string; ref: string } }>();
    for (const raw of raws) {
      const cat = categorizeRawStatement(raw.text).toLowerCase();
      const entry = byCategory.get(cat);
      if (entry) entry.count++;
      else byCategory.set(cat, { count: 1, example: raw });
    }
    const sorted = [...byCategory.entries()].sort((a, b) => b[1].count - a[1].count);

    console.log("\n=== RawStatement (fallback) por construção — leia1.txt ===");
    console.log(`total: ${raws.length}`);
    for (const [cat, { count, example }] of sorted) {
      const pct = ((count / raws.length) * 100).toFixed(1);
      const sample = example.text.length > 90 ? example.text.slice(0, 90) + "..." : example.text;
      console.log(`  ${count.toString().padStart(4)} (${pct.padStart(4)}%)  ${cat.padEnd(20)}  ex.: ${example.ref}  ::  ${sample}`);
    }
    console.log(`categorias distintas: ${sorted.length}`);
    console.log("=============================================================\n");

    expect(raws.length).toBe(249);
  });

  it("casos isolados: if/switch(select)/while com set — batem estrutura esperada", () => {
    const code = `
      mes "oi";
      next;
      switch (select("A:B:C")) {
        case 1:
          mes "escolheu A";
          break;
        case 2:
          mes "escolheu B";
          break;
        default:
          close;
      }
      if (.@x == 1) {
        mes "um";
      } else {
        mes "outro";
      }
      set .@i, 0;
      while (.@i < 3) {
        set .@i, .@i + 1;
      }
      close;
    `;
    const ast = parseNpcScript(code);
    expect(ast.entryPoints).toHaveLength(1);
    const [main] = ast.entryPoints;
    const kinds = main!.body.map((s) => s.kind);
    expect(kinds).toContain("SwitchStatement");
    expect(kinds).toContain("IfStatement");
    expect(kinds).toContain("WhileStatement");
    expect(kinds.filter((k) => k === "RawStatement")).toEqual([]);
  });

  it("rótulos de evento viram EntryPoint separado (achado da auditoria: OnTouch/OnInit etc.)", () => {
    const code = `
      mes "clique";
      close;
    OnTouch:
      warp "prontera",150,150;
      end;
    OnInit:
      set .@x, 1;
    `;
    const ast = parseNpcScript(code);
    expect(ast.entryPoints.map((e) => e.label)).toEqual([null, "OnTouch", "OnInit"]);
  });

  it("expressão isolada: precedência aritmética/lógica bate com C (Pratt parser)", () => {
    const e1 = parseExpression("1+2*3") as Extract<Expr, { kind: "Binary" }>;
    expect(e1.op).toBe("+");
    expect((e1.right as Extract<Expr, { kind: "Binary" }>).op).toBe("*");

    const e2 = parseExpression('hg_ma1==3&&.@x>0') as Extract<Expr, { kind: "Binary" }>;
    expect(e2.op).toBe("&&");
  });
});
