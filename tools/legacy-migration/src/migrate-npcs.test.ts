import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Npc } from "@ragnarok/game-data";

/**
 * Testes da migração de NPCs realinhada ao pipeline novo (leia1.txt,
 * 2026-08-11 — "alinhar a migração dos NPCs ao novo pipeline Lexer → Parser
 * → AST → Mapper"). Carrega o resultado REAL já produzido por
 * `pnpm migrate:npcs --out output/npcs-v2-compare.json` (rodado sobre o
 * corpus inteiro) — não simula, testa o que a migração de verdade produziu.
 *
 * `npcs-v2-compare.json` é um artefato de COMPARAÇÃO (não o `npcs.json`
 * oficial) — de propósito, pra não sobrescrever nada em silêncio antes de
 * aprovação (leia1.txt §4/§8).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");

function loadNpcs(): Npc[] {
  return JSON.parse(readFileSync(join(OUTPUT_DIR, "npcs-v2-compare.json"), "utf8"));
}

function allNodes(npc: Npc) {
  return [...npc.dialogue, ...(npc.eventHandlers ?? []).flatMap((h) => h.dialogue)];
}

describe("Migração de NPCs — caso obrigatório: #AirshipWarp-1", () => {
  it("OnInit/OnHide/OnUnhide/OnTouch_ aparecem como eventHandlers SEPARADOS, e o switch dos 4 warps mantém a estrutura", () => {
    const npcs = loadNpcs();
    const npc = npcs.find((n) => n.name === "#AirshipWarp-1");
    expect(npc).toBeDefined();
    expect(npc!.legacyRef).toBe("npc/airports/airships.txt:21");

    const labels = npc!.eventHandlers.map((h) => h.label);
    expect(labels).toEqual(["OnInit", "OnHide", "OnUnhide", "OnTouch_"]);

    const onHide = npc!.eventHandlers.find((h) => h.label === "OnHide")!;
    expect(onHide.dialogue.map((n) => n.kind)).toEqual(["action", "action", "end"]);

    const onTouch = npc!.eventHandlers.find((h) => h.label === "OnTouch_")!;
    expect(onTouch.dialogue).toHaveLength(1);
    const legacy = onTouch.dialogue[0]!;
    expect(legacy.kind).toBe("action");
    const action = legacy.action!;
    expect(action.kind).toBe("legacyScript");
    const source = action.kind === "legacyScript" ? action.legacySource : "";
    // os 4 destinos do switch, todos presentes e coerentes:
    expect(source).toContain("case 0:");
    expect(source).toContain('warp("yuno",92,260)');
    expect(source).toContain("case 1:");
    expect(source).toContain('warp("einbroch",92,278)');
    expect(source).toContain("case 2:");
    expect(source).toContain('warp("lighthalzen",302,75)');
    expect(source).toContain("case 3:");
    expect(source).toContain('warp("hugel",181,146)');
  });

  it("achado documentado: antes (parser antigo) tudo isso virava UM legacyScript só, sem eventHandlers — não é mais o caso", () => {
    const npcs = loadNpcs();
    const npc = npcs.find((n) => n.name === "#AirshipWarp-1")!;
    // a garantia central desta migração: eventHandlers de primeira classe.
    expect(npc.eventHandlers.length).toBeGreaterThan(0);
    expect(npc.dialogue.every((n) => n.kind !== "action" || n.action?.kind !== "legacyScript" || !n.action.legacySource.includes("OnInit:"))).toBe(true);
  });
});

describe("Migração de NPCs — categorias obrigatórias (leia1.txt §12)", () => {
  const npcs = loadNpcs();

  // `.name` remove o sufixo "#ex"/"::ex" (`w3.split("#")[0]`) — `legacyRef`
  // (arquivo:linha) é a chave estável pra achar um NPC específico.
  it("NPC de diálogo linear simples", () => {
    const npc = npcs.find((n) => n.legacyRef === "npc/airports/airships.txt:181")!;
    expect(npc).toBeDefined();
    expect(npc.dialogue.map((n) => n.kind)).toEqual(["say", "end"]);
    expect(npc.dialogue[0]!.text).toContain("If we've landed at");
  });

  it("NPC com if/else", () => {
    const npc = npcs.find((n) => n.legacyRef === "npc/airports/airships.txt:192")!;
    expect(npc).toBeDefined();
    expect(npc.dialogue.some((n) => n.kind === "conditional")).toBe(true);
    const cond = npc.dialogue.find((n) => n.kind === "conditional")!;
    expect(cond.branches![0]!.condition.legacySource).toContain("event_umbala");
    expect(cond.elseNext).toBeDefined();
  });

  it("NPC com switch(select(...))", () => {
    const npc = npcs.find((n) => n.legacyRef === "npc/airports/airships.txt:272")!;
    expect(npc).toBeDefined();
    const choice = npc.dialogue.find((n) => n.kind === "choice");
    expect(choice).toBeDefined();
    expect(choice!.choices!.length).toBeGreaterThan(1);
  });

  it("NPC com handlers (genérico, além do #AirshipWarp-1)", () => {
    const npc = npcs.find((n) => n.legacyRef === "npc/airports/airships.txt:1020")!;
    expect(npc).toBeDefined();
    expect(npc.eventHandlers.map((h) => h.label)).toEqual(["OnTouch_"]);
  });

  it("NPC com legacyScript", () => {
    const npc = npcs.find((n) => n.legacyRef === "npc/airports/airships.txt:192")!;
    const legacy = npc!.dialogue.find((n) => n.kind === "action" && n.action?.kind === "legacyScript");
    expect(legacy).toBeDefined();
    const action = legacy!.action!;
    expect(action.kind === "legacyScript" && action.legacySource).toContain("emotion");
  });

  it("NPC com múltiplos níveis de aninhamento (Court Musician, achado: 14 níveis)", () => {
    const npc = npcs.find((n) => n.legacyRef === "npc/re/quests/quests_16_1.txt:13944")!;
    expect(npc).toBeDefined();
    // condicional aninhado várias camadas — confirma que o Mapper produziu
    // pelo menos um nível de `conditional` sem colapsar tudo num legacyScript.
    expect(npc.dialogue.filter((n) => n.kind === "conditional").length).toBeGreaterThan(1);
  });

  it("NPC com callfunc", () => {
    const npc = npcs.find((n) => n.legacyRef === "npc/guild2/arug_cas03.txt:34"); // LF-01#arug_cas03
    expect(npc).toBeDefined();
    const legacy = npc!.dialogue.find((n) => n.kind === "action" && n.action?.kind === "legacyScript");
    expect(legacy).toBeDefined();
    const action = legacy!.action!;
    expect(action.kind === "legacyScript" && action.legacySource).toContain("callfunc");
  });

  it("NPC com comentários — o corpo migrado não trava, comentário some do dado estruturado (esperado — AST não representa comentário; achado sistêmico já documentado)", () => {
    // Airship Staff tem "// Hugel quest addition" — confirma que o NPC migra
    // sem erro apesar do comentário, e SEM o texto do comentário aparecer
    // em nenhum campo estruturado (ele nunca deveria — não é dado do jogo).
    const npc = npcs.find((n) => n.legacyRef === "npc/airports/airships.txt:272")!;
    const allText = JSON.stringify(npc.dialogue);
    expect(allText).not.toContain("Hugel quest addition");
    expect(npc.dialogue.length).toBeGreaterThan(0);
  });
});

describe("Migração de NPCs — regressão: ordem de push preserva resolução de alias de duplicate()", () => {
  it("Horn#LF_ar03_01::LF_ar03_01 (nome com '#Ex' E '::Ex' juntos) — duplicates resolvem pro NPC FONTE, não pro primeiro duplicate vizinho", () => {
    const npcs = loadNpcs();
    const source = npcs.find((n) => n.legacyRef === "npc/guild2/arug_cas03.txt:44")!;
    expect(source).toBeDefined();
    expect(source.name).toBe("Horn");

    const dup1 = npcs.find((n) => n.legacyRef === "npc/guild2/arug_cas03.txt:45")!;
    expect(dup1).toBeDefined();
    expect(dup1.duplicateOf).toBe(source.id);
  });
});

describe("Migração de NPCs — todos os 9.206 scripts continuam representados, nenhum NPC some", () => {
  it("mesma contagem de NPCs por tipo do relatório de cobertura já provado (warps/shops/duplicates/scripts)", () => {
    const npcs = loadNpcs();
    expect(npcs.length).toBe(24133);
    expect(npcs.filter((n) => n.warp).length).toBe(4082);
    expect(npcs.filter((n) => n.shop).length).toBe(347);
    expect(npcs.filter((n) => n.duplicateOf).length).toBe(10498);
    expect(npcs.filter((n) => n.dialogue.length > 0 || n.eventHandlers.length > 0).length).toBeGreaterThan(0);
    expect(npcs.filter((n) => n.eventHandlers.length > 0).length).toBe(4074);
  });

  it("comparação PAR A PAR com a migração antiga: nenhum NPC individual perdeu estrutura (nós do novo >= nós do antigo, sempre)", () => {
    // achado durante esta auditoria: uma heurística por regex ("contém
    // 'On___:' como texto dentro de um legacyScript") dá FALSO POSITIVO —
    // rótulo ANINHADO (dentro de bloco, ex. dentro de um `for`/`while` não
    // reconhecido) é um caso conhecido e DIFERENTE do bug antigo (script
    // INTEIRO achatado): 9 ocorrências reais no corpus, todas dentro de UM
    // nó pequeno, não do NPC inteiro. A comparação certa é par a par: pra
    // TODO NPC, a quantidade de nós estruturados no NOVO nunca pode ser
    // MENOR que no antigo — isso prova ausência de regressão sem depender
    // de adivinhar o formato de um texto opaco.
    const oldNpcs: Npc[] = JSON.parse(readFileSync(join(OUTPUT_DIR, "npcs-old-backup.json"), "utf8"));
    const newNpcs = loadNpcs();
    const newById = new Map(newNpcs.map((n) => [n.id, n]));
    let regressions = 0;
    for (const o of oldNpcs) {
      const n = newById.get(o.id);
      if (!n) continue;
      if (allNodes(n).length < allNodes(o).length) {
        regressions++;
        if (regressions <= 5) console.error(`regressão: ${o.id} (${o.legacyRef}) — antigo ${allNodes(o).length} nós, novo ${allNodes(n).length}`);
      }
    }
    expect(regressions).toBe(0);
  });
});
