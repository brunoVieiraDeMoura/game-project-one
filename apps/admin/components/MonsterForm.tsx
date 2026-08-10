"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ELEMENT_LABELS,
  MONSTER_AI_CODE_LABELS,
  MONSTER_AI_MODE_LABELS,
  MONSTER_CLASS_LABELS,
  MONSTER_MODE_OPTIONS,
  MONSTER_RACE_GROUP_OPTIONS,
  MonsterSchema,
  RACE_LABELS,
  SIZE_LABELS,
  labelOf,
  type Monster,
} from "@ragnarok/game-data";
import { createMonster, getItem, getMonsterCapabilities, listItems, updateMonster } from "@/lib/api";
import { Button, CatalogPickerField, Checkbox, Field, Input, MultiSelectField, NumberField, Section, Select, type CatalogOption } from "./ui";
import { MONSTER_LIMITS } from "@/lib/field-limits";

/** Fase 3: `drops[].itemId`/`mvpDrops[].itemId` são de verdade resolvidos
 * pro aegis name antes de gravar (`mysql-monster-row.ts:
 * resolveItemName`) — write-path real, confirmado na auditoria (não é o
 * mesmo bug do ItemCost de Skill). Busca assíncrona: catálogo de item é
 * grande demais pra carregar inteiro (soul.txt/CLAUDE.md: 29k itens). */
async function searchItemsForPicker(query: string): Promise<CatalogOption[]> {
  if (!query.trim()) return [];
  const res = await listItems({ page: 1, pageSize: 20, search: query });
  return res.items.map((it) => ({ value: String(it.id), label: `${it.name} (${it.id})` }));
}
async function resolveItemLabel(value: string): Promise<string | undefined> {
  const id = Number(value);
  if (!Number.isFinite(id)) return undefined;
  const it = await getItem(id);
  return `${it.name} (${it.id})`;
}

/** Full-coverage monster form (soul.txt §5.4). */

type DropRow = Monster["drops"][number];
type SpawnRow = Monster["spawns"][number];

const STAT_KEYS = ["str", "agi", "vit", "int", "dex", "luk"] as const;
const AI_MODES = ["passive", "aggressive", "assist", "looter", "plant"] as const;
const CLASSES = ["normal", "boss", "guardian", "battlefield", "event"] as const;
const RACES = [
  "formless", "undead", "brute", "plant", "insect", "fish",
  "demon", "demihuman", "angel", "dragon", "player_human", "player_doram",
] as const;
const ELEMENTS = [
  "neutral", "water", "earth", "fire", "wind", "poison",
  "holy", "shadow", "ghost", "undead",
] as const;
const SIZES = ["small", "medium", "large"] as const;

const EMPTY: Monster = MonsterSchema.parse({
  id: 1001,
  aegisName: "NEW_MOB",
  name: "Novo Monstro",
  level: 1,
  hp: 1,
  baseExp: 0,
  jobExp: 0,
  stats: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
  attack: 0,
  race: "formless",
  element: { type: "neutral", level: 1 },
  size: "small",
});

function DropRows({
  title,
  drops,
  onChange,
}: {
  title: string;
  drops: DropRow[];
  onChange: (v: DropRow[]) => void;
}) {
  const update = (i: number, patch: Partial<DropRow>) =>
    onChange(drops.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <Section
      title={`${title} (${drops.length})`}
      actions={
        <Button type="button" variant="outline" onClick={() => onChange([...drops, { itemId: 501, rate: 1, stealProtected: false }])}>
          + Drop
        </Button>
      }
    >
      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {drops.map((d, i) => (
          <div key={i} className="flex items-end gap-2">
            <CatalogPickerField
              label="Item"
              className="w-56"
              value={String(d.itemId)}
              onChange={(v) => update(i, { itemId: v ? Number(v) : (undefined as unknown as number) })}
              search={searchItemsForPicker}
              resolveLabel={resolveItemLabel}
            />
            <NumberField
              label="Taxa (%)"
              className="w-28"
              value={d.rate}
              onChange={(v) => update(i, { rate: v as number })}
              {...MONSTER_LIMITS.dropRate}
            />
            <Field label="Grupo de opção aleatória" className="flex-1">
              <Input
                value={d.randomOptionGroup ?? ""}
                onChange={(e) => update(i, { randomOptionGroup: e.target.value === "" ? undefined : e.target.value })}
              />
            </Field>
            <div className="pb-2">
              <Checkbox label="anti-furto" checked={d.stealProtected} onChange={(v) => update(i, { stealProtected: v })} />
            </div>
            <Button type="button" variant="ghost" onClick={() => onChange(drops.filter((_, j) => j !== i))}>
              ✕
            </Button>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function MonsterForm({ initial, mode }: { initial?: Monster; mode: "create" | "edit" }) {
  const router = useRouter();
  const [mob, setMob] = useState<Monster>(initial ?? EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  /** achado A23: default otimista (não trava a seção enquanto a sonda não
   * respondeu) — mesma regra de degradar sem bloquear já usada nos pickers
   * de catálogo (`.catch(() => setStatuses([]))` no SkillForm). */
  const [spawnsWritable, setSpawnsWritable] = useState(true);

  useEffect(() => {
    getMonsterCapabilities()
      .then((c) => setSpawnsWritable(c.spawnsWritable))
      .catch(() => {});
  }, []);

  const set = <K extends keyof Monster>(key: K, value: Monster[K]) => setMob((p) => ({ ...p, [key]: value }));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = MonsterSchema.safeParse(mob);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      if (mode === "create") await createMonster(parsed.data);
      else await updateMonster(initial!.id, parsed.data);
      router.push("/monsters");
    } catch (err) {
      setErrors([(err as Error).message]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  const updateSpawn = (i: number, patch: Partial<SpawnRow>) =>
    set("spawns", mob.spawns.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errors.length > 0 && (
        <div className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      <Section title="Identificação">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="ID">
            <Input type="number" value={mob.id} onChange={(e) => set("id", num(e.target.value))} disabled={mode === "edit"} />
          </Field>
          <Field label="Nome Aegis">
            <Input value={mob.aegisName} onChange={(e) => set("aegisName", e.target.value)} />
          </Field>
          <Field label="Nome">
            <Input value={mob.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Título">
            <Input value={mob.title ?? ""} onChange={(e) => set("title", e.target.value === "" ? undefined : e.target.value)} />
          </Field>
          <NumberField label="Nível" value={mob.level} onChange={(v) => set("level", v as Monster["level"])} {...MONSTER_LIMITS.level} />
          <NumberField label="HP" value={mob.hp} onChange={(v) => set("hp", v as Monster["hp"])} {...MONSTER_LIMITS.hp} />
          <NumberField label="SP" value={mob.sp} onChange={(v) => set("sp", v as Monster["sp"])} {...MONSTER_LIMITS.sp} />
          <NumberField
            label="Grupo (GroupId)"
            value={mob.groupId}
            onChange={(v) => set("groupId", v as Monster["groupId"])}
            {...MONSTER_LIMITS.groupId}
          />
          <NumberField
            label="EXP base"
            value={mob.baseExp}
            onChange={(v) => set("baseExp", v as Monster["baseExp"])}
            {...MONSTER_LIMITS.baseExp}
          />
          <NumberField
            label="EXP de job"
            value={mob.jobExp}
            onChange={(v) => set("jobExp", v as Monster["jobExp"])}
            {...MONSTER_LIMITS.jobExp}
          />
          <NumberField
            label="EXP de MVP"
            value={mob.mvpExp}
            onChange={(v) => set("mvpExp", v as Monster["mvpExp"])}
            {...MONSTER_LIMITS.mvpExp}
          />
          <div className="flex items-end pb-2">
            <Checkbox label="MVP" checked={mob.mvp} onChange={(v) => set("mvp", v)} />
          </div>
        </div>
      </Section>

      <Section title="Atributos">
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          {STAT_KEYS.map((k) => (
            <NumberField
              key={k}
              label={k.toUpperCase()}
              value={mob.stats[k]}
              onChange={(v) => set("stats", { ...mob.stats, [k]: v as number })}
              {...MONSTER_LIMITS.stat}
            />
          ))}
        </div>
      </Section>

      <Section title="Combate (renewal: ATK/MATK base)">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumberField label="ATK base" value={mob.attack} onChange={(v) => set("attack", v as Monster["attack"])} {...MONSTER_LIMITS.attack} />
          <NumberField
            label="MATK base"
            value={mob.magicAttack}
            onChange={(v) => set("magicAttack", v as Monster["magicAttack"])}
            {...MONSTER_LIMITS.magicAttack}
          />
          <NumberField label="DEF" value={mob.defense} onChange={(v) => set("defense", v as Monster["defense"])} {...MONSTER_LIMITS.defense} />
          <NumberField
            label="MDEF"
            value={mob.magicDefense}
            onChange={(v) => set("magicDefense", v as Monster["magicDefense"])}
            {...MONSTER_LIMITS.magicDefense}
          />
          <NumberField
            label="RES"
            value={mob.resistance}
            onChange={(v) => set("resistance", v as Monster["resistance"])}
            {...MONSTER_LIMITS.resistance}
          />
          <NumberField
            label="MRES"
            value={mob.magicResistance}
            onChange={(v) => set("magicResistance", v as Monster["magicResistance"])}
            {...MONSTER_LIMITS.magicResistance}
          />
          <NumberField
            label="Alcance de ataque"
            value={mob.attackRange}
            onChange={(v) => set("attackRange", v as Monster["attackRange"])}
            {...MONSTER_LIMITS.attackRange}
          />
          <NumberField
            label="Alcance de skill"
            value={mob.skillRange}
            onChange={(v) => set("skillRange", v as Monster["skillRange"])}
            {...MONSTER_LIMITS.skillRange}
          />
          <NumberField
            label="Alcance de perseguição"
            value={mob.chaseRange}
            onChange={(v) => set("chaseRange", v as Monster["chaseRange"])}
            {...MONSTER_LIMITS.chaseRange}
          />
          <NumberField
            label="Velocidade (ms/célula)"
            value={mob.walkSpeed}
            onChange={(v) => set("walkSpeed", v as Monster["walkSpeed"])}
            {...MONSTER_LIMITS.walkSpeed}
          />
          <NumberField
            label="Delay de ataque (ms)"
            value={mob.attackDelayMs}
            onChange={(v) => set("attackDelayMs", v as Monster["attackDelayMs"])}
            {...MONSTER_LIMITS.attackDelayMs}
          />
          <NumberField
            label="Animação de ataque (ms)"
            value={mob.attackMotionMs}
            onChange={(v) => set("attackMotionMs", v as Monster["attackMotionMs"])}
            {...MONSTER_LIMITS.attackMotionMs}
          />
          <NumberField
            label="Animação de dano (ms)"
            value={mob.damageMotionMs}
            onChange={(v) => set("damageMotionMs", v as Monster["damageMotionMs"])}
            {...MONSTER_LIMITS.damageMotionMs}
          />
          <NumberField
            label="Dano recebido (%)"
            value={mob.damageTaken}
            onChange={(v) => set("damageTaken", v as Monster["damageTaken"])}
            {...MONSTER_LIMITS.damageTaken}
          />
          <NumberField
            label="Flee (override, vazio = derivado)"
            value={mob.fleeOverride}
            onChange={(v) => set("fleeOverride", v)}
          />
          <NumberField
            label="Hit (override, vazio = derivado)"
            value={mob.hitOverride}
            onChange={(v) => set("hitOverride", v)}
          />
        </div>
      </Section>

      <Section title="Comportamento e classificação">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Código AI (Aegis, fonte da verdade)">
            {/* NÃO deriva aiMode/chasesAttacker automaticamente — os 3 campos
             * ficam editáveis de forma independente até A5 (docs/audit/
             * risk-report.md) ser decidido pelo usuário. */}
            <Select value={mob.ai} onChange={(e) => set("ai", e.target.value)}>
              {!(mob.ai in MONSTER_AI_CODE_LABELS) && <option value={mob.ai}>{mob.ai} (fora do catálogo!)</option>}
              {Object.keys(MONSTER_AI_CODE_LABELS).map((code) => (
                <option key={code} value={code}>
                  {labelOf(MONSTER_AI_CODE_LABELS, code)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Modo de IA (derivado)">
            <Select value={mob.aiMode} onChange={(e) => set("aiMode", e.target.value as Monster["aiMode"])}>
              {AI_MODES.map((m) => (
                <option key={m} value={m}>{labelOf(MONSTER_AI_MODE_LABELS, m)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Classe">
            <Select value={mob.class} onChange={(e) => set("class", e.target.value as Monster["class"])}>
              {CLASSES.map((c) => (
                <option key={c} value={c}>{labelOf(MONSTER_CLASS_LABELS, c)}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Persegue atacante" checked={mob.chasesAttacker} onChange={(v) => set("chasesAttacker", v)} />
          </div>
          <Field label="Raça">
            <Select value={mob.race} onChange={(e) => set("race", e.target.value as Monster["race"])}>
              {RACES.map((r) => (
                <option key={r} value={r}>{labelOf(RACE_LABELS, r)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Elemento">
            <Select
              value={mob.element.type}
              onChange={(e) => set("element", { ...mob.element, type: e.target.value as Monster["element"]["type"] })}
            >
              {ELEMENTS.map((el) => (
                <option key={el} value={el}>{labelOf(ELEMENT_LABELS, el)}</option>
              ))}
            </Select>
          </Field>
          <NumberField
            label="Nível do elemento (1-4)"
            value={mob.element.level}
            onChange={(v) => set("element", { ...mob.element, level: v as number })}
            {...MONSTER_LIMITS.elementLevel}
          />
          <Field label="Tamanho">
            <Select value={mob.size} onChange={(e) => set("size", e.target.value as Monster["size"])}>
              {SIZES.map((s) => (
                <option key={s} value={s}>{labelOf(SIZE_LABELS, s)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <MultiSelectField
            label="Modos (MD_*)"
            values={mob.modes}
            options={MONSTER_MODE_OPTIONS}
            onChange={(v) => set("modes", v)}
          />
          <MultiSelectField
            label="Grupos de raça (RC2_*)"
            values={mob.raceGroups}
            options={MONSTER_RACE_GROUP_OPTIONS}
            onChange={(v) => set("raceGroups", v)}
          />
        </div>
      </Section>

      <DropRows title="Drops" drops={mob.drops} onChange={(v) => set("drops", v)} />
      <DropRows title="Drops de MVP" drops={mob.mvpDrops} onChange={(v) => set("mvpDrops", v)} />

      <Section
        title={`Spawns (${mob.spawns.length})`}
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={!spawnsWritable}
            onClick={() => set("spawns", [...mob.spawns, { mapId: "prontera", amount: 1, respawnTimeMs: 5000, respawnVarianceMs: 0, boss: false }])}
          >
            + Spawn
          </Button>
        }
      >
        {!spawnsWritable && (
          <p className="mb-2 rounded bg-amber-950/60 px-3 py-2 text-xs text-amber-300">
            Este servidor lê monstros direto do MySQL (mob_db_re), que não tem
            coluna pra spawn — spawn real do rAthena é script NPC. Editar aqui
            não é gravado; a seção está travada pra não fingir que salvou.
          </p>
        )}
        <fieldset disabled={!spawnsWritable} className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {mob.spawns.map((s, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label="Mapa" className="w-36">
                <Input className="font-mono text-xs" value={s.mapId} onChange={(e) => updateSpawn(i, { mapId: e.target.value })} />
              </Field>
              <NumberField
                label="Qtd"
                className="w-20"
                min={1}
                value={s.amount}
                onChange={(v) => updateSpawn(i, { amount: v as number })}
              />
              <NumberField
                label="Respawn (ms)"
                className="w-32"
                min={0}
                value={s.respawnTimeMs}
                onChange={(v) => updateSpawn(i, { respawnTimeMs: v as number })}
              />
              <NumberField
                label="Variação (ms)"
                className="w-32"
                min={0}
                value={s.respawnVarianceMs}
                onChange={(v) => updateSpawn(i, { respawnVarianceMs: v as number })}
              />
              <Field label="Área x,y,xs,ys (vazio = mapa todo)" className="flex-1">
                <Input
                  className="font-mono text-xs"
                  value={s.area ? `${s.area.x},${s.area.y},${s.area.xs},${s.area.ys}` : ""}
                  onChange={(e) => {
                    const parts = e.target.value.split(",").map((p) => Number(p.trim()));
                    if (e.target.value.trim() === "") {
                      updateSpawn(i, { area: undefined });
                    } else if (parts.length >= 2 && parts.every((n) => !Number.isNaN(n))) {
                      updateSpawn(i, { area: { x: parts[0]!, y: parts[1]!, xs: parts[2] ?? 0, ys: parts[3] ?? 0 } });
                    }
                  }}
                />
              </Field>
              <div className="pb-2">
                <Checkbox label="boss" checked={s.boss} onChange={(v) => updateSpawn(i, { boss: v })} />
              </div>
              <Button type="button" variant="ghost" onClick={() => set("spawns", mob.spawns.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
        </fieldset>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/monsters")}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
