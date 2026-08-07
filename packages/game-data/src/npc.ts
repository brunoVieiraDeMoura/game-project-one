import { z } from "zod";

/**
 * NPC schema (soul.txt §5.5). Dialogue is a structured tree, never free
 * script. Legacy rAthena npc scripts convert into these nodes; unrecognized
 * constructs are flagged (needsReview + legacySource), never guessed.
 */

export const NpcActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("openShop"), shopId: z.string() }),
  z.object({ kind: z.literal("startQuest"), questId: z.string() }),
  z.object({ kind: z.literal("completeQuest"), questId: z.string() }),
  z.object({
    kind: z.literal("giveReward"),
    items: z.array(z.object({ itemId: z.number().int(), amount: z.number().int().positive() })).default([]),
    baseExp: z.number().int().nonnegative().default(0),
    jobExp: z.number().int().nonnegative().default(0),
    zeny: z.number().int().default(0),
  }),
  z.object({
    kind: z.literal("warp"),
    mapId: z.string(),
    position: z.tuple([z.number(), z.number(), z.number()]),
  }),
  z.object({
    kind: z.literal("legacyScript"),
    needsReview: z.literal(true),
    legacySource: z.string(),
  }),
]);
export type NpcAction = z.infer<typeof NpcActionSchema>;

export const DialogueConditionSchema = z.object({
  kind: z.enum(["questState", "hasItem", "minBaseLevel", "jobIs", "custom"]),
  questId: z.string().optional(),
  questState: z.enum(["not_started", "in_progress", "completed"]).optional(),
  itemId: z.number().int().optional(),
  amount: z.number().int().optional(),
  level: z.number().int().optional(),
  jobId: z.number().int().optional(),
  /** custom → needs manual implementation, flagged */
  legacySource: z.string().optional(),
});

export const DialogueNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["say", "choice", "action", "conditional", "end"]),
  /** say */
  text: z.string().optional(),
  next: z.string().optional(),
  /** choice */
  choices: z.array(z.object({ label: z.string(), next: z.string() })).optional(),
  /** action */
  action: NpcActionSchema.optional(),
  /** conditional: first matching branch wins, fallback = else */
  branches: z
    .array(z.object({ condition: DialogueConditionSchema, next: z.string() }))
    .optional(),
  elseNext: z.string().optional(),
});
export type DialogueNode = z.infer<typeof DialogueNodeSchema>;

export const NpcShopSchema = z.object({
  id: z.string(),
  currency: z.enum(["zeny", "cash", "item"]).default("zeny"),
  currencyItemId: z.number().int().optional(),
  /** flag de desconto do rAthena (yes/no no cabeçalho do shop) */
  discount: z.boolean().optional(),
  items: z.array(
    z.object({
      itemId: z.number().int().positive(),
      /** -1 = use item's buyPrice */
      price: z.number().int(),
      /** marketshop: estoque disponível (ausente = ilimitado) */
      stock: z.number().int().optional(),
    }),
  ),
});
export type NpcShop = z.infer<typeof NpcShopSchema>;

export const QuestDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  objectives: z
    .array(
      z.object({
        kind: z.enum(["kill", "collect", "talk", "reach"]),
        targetId: z.string(),
        amount: z.number().int().positive().default(1),
      }),
    )
    .default([]),
  rewards: z.object({
    baseExp: z.number().int().nonnegative().default(0),
    jobExp: z.number().int().nonnegative().default(0),
    zeny: z.number().int().default(0),
    items: z.array(z.object({ itemId: z.number().int(), amount: z.number().int().positive() })).default([]),
  }),
});
export type QuestDef = z.infer<typeof QuestDefSchema>;

export const NpcSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  sprite: z.string(),
  mapId: z.string(),
  position: z.tuple([z.number(), z.number(), z.number()]),
  /** 0-7 canônico; scripts legados usam valores maiores (tolerados pelo rAthena) */
  direction: z.number().int().nonnegative().default(0),

  /** entry node id into dialogue tree; null = non-interactive */
  dialogueEntry: z.string().nullable().default(null),
  dialogue: z.array(DialogueNodeSchema).default([]),

  questTriggers: z.array(z.string()).default([]),
  shop: NpcShopSchema.optional(),
  /** warp NPC: steps on it → teleport. Área de gatilho = retângulo (rAthena spanx/spany) */
  warp: z
    .object({
      mapId: z.string(),
      position: z.tuple([z.number(), z.number(), z.number()]),
      triggerSpan: z.object({ xs: z.number().int().nonnegative(), ys: z.number().int().nonnegative() }).default({ xs: 1, ys: 1 }),
    })
    .optional(),
  /** Eden-style repeatable reward board */
  questBoard: z.array(z.string()).default([]),

  /** script NPC com área de toque (dispara ao pisar, rAthena triggerX/triggerY) */
  touchArea: z.object({ xs: z.number().int().nonnegative(), ys: z.number().int().nonnegative() }).optional(),
  /** id (deste catálogo) do NPC original quando este é um duplicate() do rAthena */
  duplicateOf: z.string().optional(),
  /** rastreabilidade: arquivo:linha no rathena/npc de onde este NPC veio */
  legacyRef: z.string().optional(),
});
export type Npc = z.infer<typeof NpcSchema>;

/** classificação FUNCIONAL derivada, pro filtro da dashboard admin — não é campo do schema */
export const NpcKindSchema = z.enum(["warp", "shop", "dialogue", "duplicate", "other"]);
export type NpcKind = z.infer<typeof NpcKindSchema>;

export function npcKind(npc: Npc): NpcKind {
  if (npc.warp) return "warp";
  if (npc.shop) return "shop";
  if (npc.duplicateOf) return "duplicate";
  if (npc.dialogue.length > 0) return "dialogue";
  return "other";
}

/**
 * Origem do NPC pela PASTA de onde ele veio no rAthena (`legacyRef`,
 * "npc/re/<pasta>/arquivo.txt:linha") — dado real da árvore de origem, não
 * heurística de texto. Cobre Quest/Guilda/Instância/Evento/Arena/Loja/
 * Teleporte da lista pedida; "Healer" e "Buff" ficam de fora porque não há
 * pasta nem campo estruturado que os distinga sem adivinhar conteúdo de
 * script (ver auditoria).
 */
export const NpcOriginSchema = z.enum([
  "quest",
  "guild",
  "instance",
  "battleground",
  "event",
  "merchant",
  "kafra",
  "job",
  "city",
  "airport",
  "warp",
  "other",
]);
export type NpcOrigin = z.infer<typeof NpcOriginSchema>;

/** pasta rAthena → origem do filtro. Pasta desconhecida ou sem `legacyRef` = "other" — nunca adivinhado. */
const ORIGIN_BY_FOLDER: Record<string, NpcOrigin> = {
  quests: "quest",
  guild: "guild",
  guild2: "guild",
  guild3: "guild",
  instances: "instance",
  battleground: "battleground",
  events: "event",
  merchants: "merchant",
  kafras: "kafra",
  jobs: "job",
  cities: "city",
  airports: "airport",
  warps: "warp",
};

export function npcOrigin(npc: Npc): NpcOrigin {
  const ref = npc.legacyRef;
  if (!ref) return "other";
  // "npc/re/<pasta>/arquivo.txt:linha" ou "npc/<pasta>/arquivo.txt:linha"
  const parts = ref.split("/");
  const folder = parts[1] === "re" ? parts[2] : parts[1];
  return (folder && ORIGIN_BY_FOLDER[folder]) || "other";
}
