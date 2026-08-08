import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapNpcScript, DialogueNodeSchema, NpcEventHandlerSchema } from "@ragnarok/game-data";
import { parseNpcScript } from "./npc-script/parser";
import { extractScriptBodies } from "./npc-script/extract-corpus";

/**
 * Testes do Mapper AST → DialogueNode/NpcEventHandler (leia1.txt, 2026-08-07:
 * "testes do Mapper", exigido antes de Validator/Writer). Duas partes:
 * casos sintéticos por padrão reconhecido, e uma passada sobre o CORPUS REAL
 * (mesma extração do gate do Parser) validando toda saída contra o schema da
 * dashboard + relatório de cobertura do Mapper.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const NPC_ROOT = join(REPO_ROOT, "rathena");

function byId<T extends { id: string }>(nodes: T[], id: string | null | undefined) {
  return nodes.find((n) => n.id === id);
}

describe("Mapper de NPC — casos sintéticos por padrão", () => {
  it("diálogo linear mes/next/close vira say encadeado → end", () => {
    const ast = parseNpcScript(`
      mes "primeira linha";
      mes "segunda linha";
      next;
      mes "terceira";
      close;
    `);
    const { dialogueEntry, dialogue } = mapNpcScript(ast);
    expect(dialogueEntry).not.toBeNull();
    const kinds = dialogue.map((n) => n.kind);
    expect(kinds).toEqual(["say", "say", "end"]);

    const say1 = byId(dialogue, dialogueEntry)!;
    expect(say1.text).toBe("primeira linha\nsegunda linha");
    const say2 = byId(dialogue, say1.next)!;
    expect(say2.text).toBe("terceira");
    const end = byId(dialogue, say2.next)!;
    expect(end.kind).toBe("end");
  });

  it("if/else vira conditional, e o que vem DEPOIS recebe as duas pontas (next e elseNext patchados)", () => {
    const ast = parseNpcScript(`
      if (.@x == 1) {
        mes "um";
      } else {
        mes "outro";
      }
      mes "depois";
      close;
    `);
    const { dialogueEntry, dialogue } = mapNpcScript(ast);
    const cond = byId(dialogue, dialogueEntry)!;
    expect(cond.kind).toBe("conditional");
    expect(cond.branches).toHaveLength(1);
    expect(cond.branches![0]!.condition.kind).toBe("custom");
    expect(cond.branches![0]!.condition.legacySource).toBe(".@x==1");

    const thenSay = byId(dialogue, cond.branches![0]!.next)!;
    expect(thenSay.text).toBe("um");
    const elseSay = byId(dialogue, cond.elseNext)!;
    expect(elseSay.text).toBe("outro");

    // as duas pontas do if convergem no MESMO nó "depois" — fallthrough real, não dois ramos soltos.
    expect(thenSay.next).toBe(elseSay.next);
    const after = byId(dialogue, thenSay.next)!;
    expect(after.text).toBe("depois");
  });

  it("if SEM else: falso cai direto no que vem depois (elseNext do próprio nó é a ponta aberta)", () => {
    const ast = parseNpcScript(`
      if (.@x == 1) {
        mes "um";
      }
      mes "depois";
      close;
    `);
    const { dialogueEntry, dialogue } = mapNpcScript(ast);
    const cond = byId(dialogue, dialogueEntry)!;
    const after = byId(dialogue, cond.elseNext)!;
    expect(after.text).toBe("depois");
  });

  it("switch(select(\"A:B:C\")) vira choice com rótulos vindos do PRÓPRIO argumento de select", () => {
    const ast = parseNpcScript(`
      mes "escolha";
      switch (select("Ir:Ficar:Cancelar")) {
        case 1:
          mes "foi";
          break;
        case 2:
          mes "ficou";
          break;
        default:
          mes "cancelou";
      }
      close;
    `);
    const { dialogueEntry, dialogue } = mapNpcScript(ast);
    const say = byId(dialogue, dialogueEntry)!;
    const choice = byId(dialogue, say.next)!;
    expect(choice.kind).toBe("choice");
    expect(choice.choices).toHaveLength(3);
    expect(choice.choices!.map((c) => c.label)).toEqual(["Ir", "Ficar", "Cancelar"]);

    const branch1 = byId(dialogue, choice.choices![0]!.next)!;
    expect(branch1.text).toBe("foi");
  });

  it("warp(mapa,x,y) vira action:warp", () => {
    const ast = parseNpcScript(`warp "prontera",150,150; end;`);
    const { dialogueEntry, dialogue } = mapNpcScript(ast);
    const node = byId(dialogue, dialogueEntry)!;
    expect(node.kind).toBe("action");
    expect(node.action).toEqual({ kind: "warp", mapId: "prontera", position: [150, 150, 0] });
  });

  it("comando não reconhecido SEMANTICAMENTE vira legacyScript do PRÓPRIO statement — não do script inteiro", () => {
    const ast = parseNpcScript(`
      mes "antes";
      someWeirdCommand(1,2);
      mes "depois";
      close;
    `);
    const { dialogueEntry, dialogue } = mapNpcScript(ast);
    const kinds = dialogue.map((n) => n.kind);
    expect(kinds).toEqual(["say", "action", "say", "end"]);

    const before = byId(dialogue, dialogueEntry)!;
    expect(before.text).toBe("antes");
    const legacy = byId(dialogue, before.next)!;
    expect(legacy.action?.kind).toBe("legacyScript");
    const legacyAction = legacy.action!;
    if (legacyAction.kind !== "legacyScript") throw new Error("esperava legacyScript");
    expect(legacyAction.legacySource).toBe('someWeirdCommand(1,2);');
    // preservação NO MENOR nó: o texto do fallback não carrega "antes"/"depois" do resto do script.
    expect(legacyAction.legacySource).not.toContain("antes");

    const after = byId(dialogue, legacy.next)!;
    expect(after.text).toBe("depois");
  });

  it("rótulos de evento viram eventHandlers, cada um com árvore própria (não achatados no diálogo principal)", () => {
    const ast = parseNpcScript(`
      mes "clique";
      close;
    OnTouch:
      warp "prontera",150,150;
      end;
    OnInit:
      set .@x, 1;
    `);
    const { dialogue, eventHandlers } = mapNpcScript(ast);
    expect(dialogue.map((n) => n.kind)).toEqual(["say", "end"]);
    expect(eventHandlers).toHaveLength(2);
    expect(eventHandlers.map((h) => h.label)).toEqual(["OnTouch", "OnInit"]);

    const onTouch = eventHandlers[0]!;
    const warpNode = byId(onTouch.dialogue, onTouch.entry)!;
    expect(warpNode.action?.kind).toBe("warp");
    const endNode = byId(onTouch.dialogue, warpNode.next)!;
    expect(endNode.kind).toBe("end");

    const onInit = eventHandlers[1]!;
    const setNode = byId(onInit.dialogue, onInit.entry)!;
    expect(setNode.action?.kind).toBe("legacyScript"); // `set` ainda não é semanticamente reconhecido
  });
});

describe("Mapper de NPC — corpus real (leia1.txt: provado antes de Validator/Writer)", () => {
  const bodies = extractScriptBodies(NPC_ROOT);

  it("toda saída do Mapper sobre o corpus real valida contra DialogueNodeSchema/NpcEventHandlerSchema, e reporta cobertura", () => {
    const failures: { ref: string; error: string }[] = [];
    let totalDialogueNodes = 0;
    let totalEventHandlers = 0;
    let npcsWithHandlers = 0;
    let maxHandlersPerNpc = 0;
    const byKind: Record<string, number> = {};
    let actionLegacy = 0;
    let actionTyped = 0;

    const tally = (nodes: { kind: string; action?: { kind: string } }[]) => {
      for (const n of nodes) {
        byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
        if (n.kind === "action") {
          if (n.action?.kind === "legacyScript") actionLegacy++;
          else actionTyped++;
        }
      }
    };

    for (const { ref, code } of bodies) {
      try {
        const ast = parseNpcScript(code);
        const result = mapNpcScript(ast);

        for (const node of result.dialogue) {
          const parsed = DialogueNodeSchema.safeParse(node);
          if (!parsed.success) failures.push({ ref, error: `dialogue node ${node.id}: ${parsed.error.message}` });
        }
        for (const handler of result.eventHandlers) {
          const parsed = NpcEventHandlerSchema.safeParse(handler);
          if (!parsed.success) failures.push({ ref, error: `eventHandler ${handler.label}: ${parsed.error.message}` });
        }

        totalDialogueNodes += result.dialogue.length;
        tally(result.dialogue);
        for (const h of result.eventHandlers) tally(h.dialogue);
        totalEventHandlers += result.eventHandlers.length;
        if (result.eventHandlers.length > 0) npcsWithHandlers++;
        maxHandlersPerNpc = Math.max(maxHandlersPerNpc, result.eventHandlers.length);
      } catch (err) {
        failures.push({ ref, error: (err as Error).message });
      }
    }

    const totalNodes = actionLegacy + actionTyped + (byKind.say ?? 0) + (byKind.choice ?? 0) + (byKind.conditional ?? 0) + (byKind.end ?? 0);
    const recognizedRate = (((totalNodes - actionLegacy) / totalNodes) * 100).toFixed(1);

    console.log("\n=== Cobertura do Mapper de NPC ===");
    console.log(`scripts mapeados: ${bodies.length}`);
    console.log(`nós de diálogo totais (principal + handlers): ${totalNodes}`);
    console.log(`  por kind:`, byKind);
    console.log(`  action: ${actionTyped} tipado (warp/...) vs ${actionLegacy} legacyScript`);
    console.log(`reconhecido (não-legacyScript / total de nós): ${recognizedRate}%`);
    console.log(`eventHandlers totais: ${totalEventHandlers} em ${npcsWithHandlers} NPCs (máx. por NPC: ${maxHandlersPerNpc})`);
    console.log(`falhas de validação contra o schema: ${failures.length}`);
    if (failures.length > 0) console.error("amostra de falhas:", failures.slice(0, 10));
    console.log("===================================\n");

    expect(failures).toEqual([]);
    expect(totalDialogueNodes).toBeGreaterThan(0);
  }, 60_000);
});
