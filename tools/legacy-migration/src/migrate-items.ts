import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { ItemSchema, type Item } from "@ragnarok/game-data";
import {
  ITEM_TYPE_MAP,
  WEAPON_SUBTYPE_MAP,
  AMMO_SUBTYPE_MAP,
  CARD_SUBTYPE_MAP,
  LOCATION_MAP,
  CLASS_MAP,
} from "./mappings";
import { parseItemScript } from "./parse-item-script";

/**
 * item_db migration: rathena/db/<ruleset>/item_db*.yml → items.json matching
 * @ragnarok/game-data ItemSchema.
 *
 * Usage: pnpm migrate:items [--ruleset re|pre-re] [--out <path>]
 * Default ruleset: re (renewal) — PENDING USER CONFIRMATION which ruleset
 * this server uses (skill-legacy-import).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

interface RawItem {
  Id: number;
  AegisName: string;
  Name: string;
  Type?: string;
  SubType?: string;
  Buy?: number;
  Sell?: number;
  Weight?: number;
  Attack?: number;
  MagicAttack?: number;
  Defense?: number;
  Range?: number;
  Slots?: number;
  Jobs?: Record<string, boolean>;
  Classes?: Record<string, boolean>;
  Gender?: string;
  Locations?: Record<string, boolean>;
  WeaponLevel?: number;
  ArmorLevel?: number;
  EquipLevelMin?: number;
  EquipLevelMax?: number;
  Refineable?: boolean;
  Gradable?: boolean;
  View?: number;
  AliasName?: string;
  Flags?: Record<string, unknown>;
  Delay?: { Duration?: number; Status?: string };
  Stack?: { Amount?: number; Inventory?: boolean; Cart?: boolean; Storage?: boolean; GuildStorage?: boolean };
  NoUse?: { Override?: number; Sitting?: boolean };
  Trade?: Record<string, unknown>;
  Script?: string;
  EquipScript?: string;
  UnEquipScript?: string;
}

function mapJobs(jobs: Record<string, boolean> | undefined): string[] {
  if (!jobs) return ["all"];
  const entries = Object.entries(jobs);
  const allTrue = jobs["All"] === true;
  if (allTrue) {
    // "All: true" + explicit "X: false" exclusions → ["all", "-x"]
    const exclusions = entries
      .filter(([k, v]) => k !== "All" && v === false)
      .map(([k]) => `-${k.toLowerCase()}`);
    return ["all", ...exclusions];
  }
  return entries.filter(([, v]) => v === true).map(([k]) => k.toLowerCase());
}

function mapKeyedFlags<T>(
  raw: Record<string, boolean> | undefined,
  table: Record<string, T | T[]>,
  unknownSink: string[],
  context: string,
): T[] {
  if (!raw) return [];
  const out: T[] = [];
  for (const [key, on] of Object.entries(raw)) {
    if (!on) continue;
    if (key.toLowerCase() === "all") continue; // handled by caller semantics where relevant
    const mapped = ciLookup(table, key);
    if (mapped === undefined) {
      unknownSink.push(`${context}:${key}`);
      continue;
    }
    if (Array.isArray(mapped)) out.push(...mapped);
    else out.push(mapped);
  }
  return out;
}

/** rAthena's YAML enum matching is case-insensitive — mirror that. */
function ciLookup<T>(table: Record<string, T>, key: string): T | undefined {
  if (table[key] !== undefined) return table[key];
  const hit = Object.keys(table).find((k) => k.toLowerCase() === key.toLowerCase());
  return hit !== undefined ? table[hit] : undefined;
}

function mapSubType(type: string | undefined, subType: string | undefined, unknownSink: string[]) {
  if (!subType) return undefined;
  const t = type?.toLowerCase();
  const table = t === "ammo" ? AMMO_SUBTYPE_MAP : t === "card" ? CARD_SUBTYPE_MAP : WEAPON_SUBTYPE_MAP;
  const mapped = ciLookup(table, subType);
  if (!mapped) unknownSink.push(`subtype:${type}/${subType}`);
  return mapped;
}

export function convertRawItem(raw: RawItem, warnings: string[]): unknown {
  const type = raw.Type ? ciLookup(ITEM_TYPE_MAP, raw.Type) : "etc";
  if (raw.Type && !type) warnings.push(`item ${raw.Id}: unknown Type ${raw.Type}`);

  // rAthena pricing rule (item_db header): missing Buy = 2×Sell, missing Sell = Buy/2
  const buy = raw.Buy ?? (raw.Sell !== undefined ? raw.Sell * 2 : 0);
  const sell = raw.Sell ?? Math.floor(buy / 2);

  const classesRaw = raw.Classes ?? {};
  const classes =
    classesRaw["All"] === true
      ? [] // empty = no restriction (all variants)
      : mapKeyedFlags(classesRaw as Record<string, boolean>, CLASS_MAP, warnings, `item ${raw.Id} class`);

  const item = {
    id: raw.Id,
    aegisName: raw.AegisName,
    name: raw.Name,
    type: type ?? "etc",
    subType: mapSubType(raw.Type, raw.SubType, warnings),
    buyPrice: buy,
    sellPrice: sell,
    weight: raw.Weight ?? 0,
    attack: raw.Attack ?? 0,
    magicAttack: raw.MagicAttack ?? 0,
    defense: raw.Defense ?? 0,
    range: raw.Range ?? 0,
    slots: raw.Slots ?? 0,
    jobs: mapJobs(raw.Jobs),
    classes,
    gender: raw.Gender ? (raw.Gender.toLowerCase() as "male" | "female" | "both") : "both",
    locations: mapKeyedFlags(raw.Locations, LOCATION_MAP, warnings, `item ${raw.Id} location`),
    weaponLevel: raw.WeaponLevel ?? (type === "weapon" ? 1 : undefined),
    armorLevel: raw.ArmorLevel ?? (type === "armor" ? 1 : undefined),
    equipLevelMin: raw.EquipLevelMin ?? 0,
    equipLevelMax: raw.EquipLevelMax ?? 0,
    refineable: raw.Refineable ?? false,
    gradable: raw.Gradable ?? false,
    viewSprite: raw.View ?? 0,
    aliasName: raw.AliasName,
    flags: raw.Flags
      ? {
          buyingStore: raw.Flags["BuyingStore"] === true,
          deadBranch: raw.Flags["DeadBranch"] === true,
          container: raw.Flags["Container"] === true,
          uniqueId: raw.Flags["UniqueId"] === true,
          bindOnEquip: raw.Flags["BindOnEquip"] === true,
          dropAnnounce: raw.Flags["DropAnnounce"] === true,
          noConsume: raw.Flags["NoConsume"] === true,
          dropEffect: typeof raw.Flags["DropEffect"] === "string" ? (raw.Flags["DropEffect"] as string) : undefined,
        }
      : undefined,
    delay: raw.Delay
      ? {
          durationMs: Math.round((raw.Delay.Duration ?? 0) * 1000),
          statusId: raw.Delay.Status ? raw.Delay.Status.replace(/^SC_/i, "").toLowerCase() : undefined,
        }
      : undefined,
    stack: raw.Stack?.Amount
      ? {
          amount: raw.Stack.Amount,
          inventory: raw.Stack.Inventory ?? true,
          cart: raw.Stack.Cart ?? false,
          storage: raw.Stack.Storage ?? false,
          guildStorage: raw.Stack.GuildStorage ?? false,
        }
      : undefined,
    noUse: raw.NoUse
      ? { overrideGroupLevel: raw.NoUse.Override ?? 100, sitting: raw.NoUse.Sitting ?? false }
      : undefined,
    trade: raw.Trade
      ? {
          overrideGroupLevel: (raw.Trade["Override"] as number) ?? 100,
          noDrop: raw.Trade["NoDrop"] === true,
          noTrade: raw.Trade["NoTrade"] === true,
          tradePartnerOnly: raw.Trade["TradePartner"] === true,
          noSell: raw.Trade["NoSell"] === true,
          noCart: raw.Trade["NoCart"] === true,
          noStorage: raw.Trade["NoStorage"] === true,
          noGuildStorage: raw.Trade["NoGuildStorage"] === true,
          noMail: raw.Trade["NoMail"] === true,
          noAuction: raw.Trade["NoAuction"] === true,
        }
      : undefined,
    onUse: parseItemScript(raw.Script),
    onEquip: parseItemScript(raw.EquipScript),
    onUnequip: parseItemScript(raw.UnEquipScript),
  };
  return item;
}

function main() {
  const args = process.argv.slice(2);
  const ruleset = args.includes("--ruleset") ? args[args.indexOf("--ruleset") + 1] : "re";
  const outPath = args.includes("--out")
    ? args[args.indexOf("--out") + 1]!
    : join(__dirname, "..", "output", "items.json");

  if (ruleset !== "re" && ruleset !== "pre-re") {
    console.error(`invalid --ruleset ${ruleset} (expected re | pre-re)`);
    process.exit(1);
  }

  const dbDir = join(REPO_ROOT, "rathena", "db", ruleset);
  const files =
    ruleset === "re"
      ? ["item_db_equip.yml", "item_db_etc.yml", "item_db_usable.yml"]
      : ["item_db.yml"];

  const items: Item[] = [];
  const warnings: string[] = [];
  const invalid: { id: number; errors: string }[] = [];
  let unmappedScriptCount = 0;

  for (const file of files) {
    const full = join(dbDir, file);
    if (!existsSync(full)) {
      console.warn(`skipping missing ${full}`);
      continue;
    }
    console.log(`parsing ${file}...`);
    const doc = parseYaml(readFileSync(full, "utf-8"), { maxAliasCount: -1, uniqueKeys: false }) as { Body?: RawItem[] };
    for (const raw of doc.Body ?? []) {
      const converted = convertRawItem(raw, warnings);
      const result = ItemSchema.safeParse(converted);
      if (result.success) {
        const it = result.data;
        if (
          (it.onUse?.unmappedEffects.length ?? 0) +
            (it.onEquip?.unmappedEffects.length ?? 0) +
            (it.onUnequip?.unmappedEffects.length ?? 0) >
          0
        ) {
          unmappedScriptCount++;
        }
        items.push(it);
      } else {
        invalid.push({ id: raw.Id, errors: JSON.stringify(result.error.issues.slice(0, 3)) });
      }
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(items, null, 1), "utf-8");
  writeFileSync(
    join(dirname(outPath), "items-migration-report.json"),
    JSON.stringify(
      {
        ruleset,
        total: items.length,
        invalid: invalid.length,
        invalidSamples: invalid.slice(0, 20),
        itemsWithUnmappedScripts: unmappedScriptCount,
        warnings: [...new Set(warnings)].slice(0, 200),
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`done: ${items.length} items ok, ${invalid.length} invalid, ${unmappedScriptCount} with unmapped scripts (flagged for review)`);
  console.log(`output: ${outPath}`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("migrate-items.ts");
if (isMain) main();
