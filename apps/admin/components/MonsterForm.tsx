"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ELEMENT_LABELS,
  MONSTER_AI_MODE_LABELS,
  MONSTER_CLASS_LABELS,
  MonsterSchema,
  RACE_LABELS,
  SIZE_LABELS,
  labelOf,
  type Monster,
} from "@ragnarok/game-data";
import { createMonster, updateMonster } from "@/lib/api";
import { Button, Checkbox, Field, Input, Section, Select } from "./ui";

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

function TokenListField({
  label,
  values,
  onChange,
  className = "",
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  className?: string;
}) {
  const [text, setText] = useState(values.join(", "));
  return (
    <Field label={label} className={className}>
      <Input
        className="font-mono text-xs"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }}
      />
    </Field>
  );
}

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
            <Field label="Item ID" className="w-28">
              <Input type="number" value={d.itemId} onChange={(e) => update(i, { itemId: Number(e.target.value) })} />
            </Field>
            <Field label="Taxa (%)" className="w-28">
              <Input
                type="number"
                step="0.01"
                value={d.rate}
                onChange={(e) => update(i, { rate: Number(e.target.value) })}
              />
            </Field>
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
          <Field label="Nível">
            <Input type="number" value={mob.level} onChange={(e) => set("level", num(e.target.value))} />
          </Field>
          <Field label="HP">
            <Input type="number" value={mob.hp} onChange={(e) => set("hp", num(e.target.value))} />
          </Field>
          <Field label="SP">
            <Input type="number" value={mob.sp} onChange={(e) => set("sp", num(e.target.value))} />
          </Field>
          <Field label="Grupo (GroupId)">
            <Input type="number" value={mob.groupId} onChange={(e) => set("groupId", num(e.target.value))} />
          </Field>
          <Field label="EXP base">
            <Input type="number" value={mob.baseExp} onChange={(e) => set("baseExp", num(e.target.value))} />
          </Field>
          <Field label="EXP de job">
            <Input type="number" value={mob.jobExp} onChange={(e) => set("jobExp", num(e.target.value))} />
          </Field>
          <Field label="EXP de MVP">
            <Input type="number" value={mob.mvpExp} onChange={(e) => set("mvpExp", num(e.target.value))} />
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox label="MVP" checked={mob.mvp} onChange={(v) => set("mvp", v)} />
          </div>
        </div>
      </Section>

      <Section title="Atributos">
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          {STAT_KEYS.map((k) => (
            <Field key={k} label={k.toUpperCase()}>
              <Input
                type="number"
                value={mob.stats[k]}
                onChange={(e) => set("stats", { ...mob.stats, [k]: num(e.target.value) })}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Combate (renewal: ATK/MATK base)">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="ATK base">
            <Input type="number" value={mob.attack} onChange={(e) => set("attack", num(e.target.value))} />
          </Field>
          <Field label="MATK base">
            <Input type="number" value={mob.magicAttack} onChange={(e) => set("magicAttack", num(e.target.value))} />
          </Field>
          <Field label="DEF">
            <Input type="number" value={mob.defense} onChange={(e) => set("defense", num(e.target.value))} />
          </Field>
          <Field label="MDEF">
            <Input type="number" value={mob.magicDefense} onChange={(e) => set("magicDefense", num(e.target.value))} />
          </Field>
          <Field label="RES">
            <Input type="number" value={mob.resistance} onChange={(e) => set("resistance", num(e.target.value))} />
          </Field>
          <Field label="MRES">
            <Input type="number" value={mob.magicResistance} onChange={(e) => set("magicResistance", num(e.target.value))} />
          </Field>
          <Field label="Alcance de ataque">
            <Input type="number" value={mob.attackRange} onChange={(e) => set("attackRange", num(e.target.value))} />
          </Field>
          <Field label="Alcance de skill">
            <Input type="number" value={mob.skillRange} onChange={(e) => set("skillRange", num(e.target.value))} />
          </Field>
          <Field label="Alcance de perseguição">
            <Input type="number" value={mob.chaseRange} onChange={(e) => set("chaseRange", num(e.target.value))} />
          </Field>
          <Field label="Velocidade (ms/célula)">
            <Input type="number" value={mob.walkSpeed} onChange={(e) => set("walkSpeed", num(e.target.value))} />
          </Field>
          <Field label="Delay de ataque (ms)">
            <Input type="number" value={mob.attackDelayMs} onChange={(e) => set("attackDelayMs", num(e.target.value))} />
          </Field>
          <Field label="Animação de ataque (ms)">
            <Input type="number" value={mob.attackMotionMs} onChange={(e) => set("attackMotionMs", num(e.target.value))} />
          </Field>
          <Field label="Animação de dano (ms)">
            <Input type="number" value={mob.damageMotionMs} onChange={(e) => set("damageMotionMs", num(e.target.value))} />
          </Field>
          <Field label="Dano recebido (%)">
            <Input type="number" value={mob.damageTaken} onChange={(e) => set("damageTaken", num(e.target.value))} />
          </Field>
          <Field label="Flee (override, vazio = derivado)">
            <Input
              type="number"
              value={mob.fleeOverride ?? ""}
              onChange={(e) => set("fleeOverride", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Field>
          <Field label="Hit (override, vazio = derivado)">
            <Input
              type="number"
              value={mob.hitOverride ?? ""}
              onChange={(e) => set("hitOverride", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Field>
        </div>
      </Section>

      <Section title="Comportamento e classificação">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Código AI (Aegis, fonte da verdade)">
            <Input className="font-mono" value={mob.ai} onChange={(e) => set("ai", e.target.value)} />
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
          <Field label="Nível do elemento (1-4)">
            <Input
              type="number"
              min={1}
              max={4}
              value={mob.element.level}
              onChange={(e) => set("element", { ...mob.element, level: num(e.target.value) })}
            />
          </Field>
          <Field label="Tamanho">
            <Select value={mob.size} onChange={(e) => set("size", e.target.value as Monster["size"])}>
              {SIZES.map((s) => (
                <option key={s} value={s}>{labelOf(SIZE_LABELS, s)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TokenListField label="Modos (detector, teleport_block, ignore_melee, ...)" values={mob.modes} onChange={(v) => set("modes", v)} />
          <TokenListField label="Grupos de raça (goblin, treasure, biolab, ...)" values={mob.raceGroups} onChange={(v) => set("raceGroups", v)} />
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
            onClick={() => set("spawns", [...mob.spawns, { mapId: "prontera", amount: 1, respawnTimeMs: 5000, respawnVarianceMs: 0, boss: false }])}
          >
            + Spawn
          </Button>
        }
      >
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {mob.spawns.map((s, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label="Mapa" className="w-36">
                <Input className="font-mono text-xs" value={s.mapId} onChange={(e) => updateSpawn(i, { mapId: e.target.value })} />
              </Field>
              <Field label="Qtd" className="w-20">
                <Input type="number" value={s.amount} onChange={(e) => updateSpawn(i, { amount: num(e.target.value) })} />
              </Field>
              <Field label="Respawn (ms)" className="w-32">
                <Input type="number" value={s.respawnTimeMs} onChange={(e) => updateSpawn(i, { respawnTimeMs: num(e.target.value) })} />
              </Field>
              <Field label="Variação (ms)" className="w-32">
                <Input type="number" value={s.respawnVarianceMs} onChange={(e) => updateSpawn(i, { respawnVarianceMs: num(e.target.value) })} />
              </Field>
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
        </div>
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
