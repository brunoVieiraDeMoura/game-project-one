"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ItemSubTypeSchema,
  JobClassSchema,
  type JobClass,
} from "@ragnarok/game-data";
import { createJobClass, getJobClass, getSkill, listJobClasses, listSkills, updateJobClass } from "@/lib/api";
import { Button, CatalogPickerField, Field, Input, NumberField, Section, Select, type CatalogOption } from "./ui";
import { JOB_LIMITS } from "@/lib/field-limits";

/** Fase 3: `skills[].skillId` tem write-path real —
 * `jobClassToSkillTreeEntry`/`rawTreeSkillFromEntry` (`job-class-mapper.ts`)
 * resolve o id pro aegis name via `SkillIdResolver.nameOf` antes de gravar
 * `Tree[].Name` no `skill_tree.yml` (diferente do bug confirmado em
 * `SkillForm.requirements.itemsConsumed`, que grava o ID cru). */
async function searchSkillsForPicker(query: string): Promise<CatalogOption[]> {
  if (!query.trim()) return [];
  const res = await listSkills({ page: 1, pageSize: 20, search: query });
  return res.skills.map((s) => ({ value: String(s.id), label: `${s.name} (${s.id})` }));
}
async function resolveSkillLabel(value: string): Promise<string | undefined> {
  const id = Number(value);
  if (!Number.isFinite(id)) return undefined;
  const s = await getSkill(id);
  return `${s.name} (${s.id})`;
}

/** A22: `skillTreeInherit[]` (não `parentClassId`) é a fonte real que
 * `jobClassToSkillTreeEntry` usa pra gerar `Inherit:` no skill_tree.yml —
 * mesmo padrão de picker de `skills[].skillId` acima, agora sobre classes. */
async function searchJobClassesForPicker(query: string): Promise<CatalogOption[]> {
  if (!query.trim()) return [];
  const res = await listJobClasses(1, 20, query);
  return res.jobClasses.map((j) => ({ value: String(j.id), label: `${j.name} (${j.id})` }));
}
async function resolveJobClassLabel(value: string): Promise<string | undefined> {
  const id = Number(value);
  if (!Number.isFinite(id)) return undefined;
  const j = await getJobClass(id);
  return `${j.name} (${j.id})`;
}

/** Full-coverage job class form (soul.txt §5.2). */

type BonusRow = JobClass["bonusStatsPerLevel"][number];
type SkillRow = JobClass["skills"][number];
type AspdRow = JobClass["aspdModifiers"][number];

const STAT_KEYS = ["str", "agi", "vit", "int", "dex", "luk"] as const;
const ASPD_WEAPONS = ["bare_hand", "shield", ...ItemSubTypeSchema.options] as const;

const EMPTY: JobClass = {
  ...JobClassSchema.parse({
    id: 0,
    name: "Nova Classe",
    maxBaseLevel: 99,
    maxJobLevel: 50,
    baseStats: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
    maxWeight: 20000,
  }),
};

/** "1, 2, 3" ↔ number[] editor for per-level tables. */
function NumberListField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: number[];
  onChange: (v: number[]) => void;
}) {
  const [text, setText] = useState(values.join(", "));
  return (
    <Field label={`${label} (${values.length} níveis, separado por vírgula)`}>
      <textarea
        className="h-20 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const nums = e.target.value
            .split(/[,\s]+/)
            .filter((s) => s !== "")
            .map(Number)
            .filter((n) => !Number.isNaN(n));
          onChange(nums);
        }}
      />
    </Field>
  );
}

export function JobClassForm({ initial, mode }: { initial?: JobClass; mode: "create" | "edit" }) {
  const router = useRouter();
  const [jc, setJc] = useState<JobClass>(initial ?? EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof JobClass>(key: K, value: JobClass[K]) =>
    setJc((p) => ({ ...p, [key]: value }));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = JobClassSchema.safeParse(jc);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      if (mode === "create") await createJobClass(parsed.data);
      else await updateJobClass(initial!.id, parsed.data);
      router.push("/classes");
    } catch (err) {
      setErrors([(err as Error).message]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  const updateBonus = (i: number, patch: Partial<BonusRow>) =>
    set("bonusStatsPerLevel", jc.bonusStatsPerLevel.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const updateSkill = (i: number, patch: Partial<SkillRow>) =>
    set("skills", jc.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const updateAspd = (i: number, patch: Partial<AspdRow>) =>
    set("aspdModifiers", jc.aspdModifiers.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  /** troca só o índice `i`, preservando a ordem dos demais — ordem importa de
   * verdade pro rAthena (SkillTreeDatabase::loadingFinished: skill repetido
   * em mais de um pai, o ÚLTIMO da lista vence). Bloqueia duplicar o mesmo
   * pai em duas linhas. */
  const updateInherit = (i: number, v: string | undefined) => {
    const parentId = v ? Number(v) : (undefined as unknown as number);
    if (v && jc.skillTreeInherit.some((p, j) => j !== i && p === parentId)) return;
    set("skillTreeInherit", jc.skillTreeInherit.map((p, j) => (j === i ? parentId : p)));
  };

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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="ID">
            <Input type="number" value={jc.id} onChange={(e) => set("id", num(e.target.value))} disabled={mode === "edit"} />
          </Field>
          <Field label="Nome">
            <Input value={jc.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Classe pai (metadado, não editável)">
            <p className="flex min-h-[2.25rem] items-center px-2.5 text-sm text-zinc-500">
              {jc.parentClassId ?? "—"} — só exibição/agrupamento; quem gera a
              herança de skills é "Herança de Skill Tree" abaixo.
            </p>
          </Field>
          <NumberField
            label="Nível base máximo"
            value={jc.maxBaseLevel}
            onChange={(v) => set("maxBaseLevel", v as JobClass["maxBaseLevel"])}
            {...JOB_LIMITS.maxBaseLevel}
          />
          <NumberField
            label="Nível de job máximo"
            value={jc.maxJobLevel}
            onChange={(v) => set("maxJobLevel", v as JobClass["maxJobLevel"])}
            {...JOB_LIMITS.maxJobLevel}
          />
          <NumberField
            label="Peso máximo"
            value={jc.maxWeight}
            onChange={(v) => set("maxWeight", v as JobClass["maxWeight"])}
            {...JOB_LIMITS.maxWeight}
          />
        </div>
      </Section>

      <Section title="Atributos iniciais">
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          {STAT_KEYS.map((k) => (
            <NumberField
              key={k}
              label={k.toUpperCase()}
              value={jc.baseStats[k]}
              onChange={(v) => set("baseStats", { ...jc.baseStats, [k]: v as number })}
            />
          ))}
        </div>
      </Section>

      <Section
        title={`Bônus de atributo por nível de job (${jc.bonusStatsPerLevel.length})`}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => set("bonusStatsPerLevel", [...jc.bonusStatsPerLevel, { level: 1, stats: {} }])}
          >
            + Linha
          </Button>
        }
      >
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {jc.bonusStatsPerLevel.map((b, i) => (
            <div key={i} className="flex items-end gap-2">
              <NumberField
                label="Nível"
                className="w-20"
                value={b.level}
                onChange={(v) => updateBonus(i, { level: v as number })}
                {...JOB_LIMITS.bonusStatsLevel}
              />
              {STAT_KEYS.map((k) => (
                <NumberField
                  key={k}
                  label={k.toUpperCase()}
                  className="w-16"
                  value={b.stats[k]}
                  onChange={(v) => updateBonus(i, { stats: { ...b.stats, [k]: v } })}
                  {...JOB_LIMITS.bonusStat}
                />
              ))}
              {b.traits && Object.keys(b.traits).length > 0 && (
                <span className="pb-2 text-xs text-amber-400">
                  traits: {Object.entries(b.traits).map(([k, v]) => `${k}+${v}`).join(" ")}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => set("bonusStatsPerLevel", jc.bonusStatsPerLevel.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tabelas por nível">
        <div className="grid gap-3 md:grid-cols-2">
          <NumberListField label="HP base" values={jc.baseHpByLevel} onChange={(v) => set("baseHpByLevel", v)} />
          <NumberListField label="SP base" values={jc.baseSpByLevel} onChange={(v) => set("baseSpByLevel", v)} />
          <NumberListField label="EXP base" values={jc.baseExpByLevel} onChange={(v) => set("baseExpByLevel", v)} />
          <NumberListField label="EXP de job" values={jc.jobExpByLevel} onChange={(v) => set("jobExpByLevel", v)} />
        </div>
        {(jc.hpGrowth || jc.spGrowth) && (
          <p className="mt-2 rounded bg-amber-950/60 px-3 py-2 text-xs text-amber-300">
            UNCLEAR-FORMULA: esta classe usa parâmetros de crescimento fallback
            (HP {jc.hpGrowth ? `linear ${jc.hpGrowth.perLevel}, fator ${jc.hpGrowth.factor}` : "—"};
            SP {jc.spGrowth ? `linear ${jc.spGrowth.perLevel}, fator ${jc.spGrowth.factor}` : "—"})
            — validar contra status.cpp antes de usar no engine.
          </p>
        )}
      </Section>

      <Section
        title={`Skills da árvore (${jc.skills.length})`}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => set("skills", [...jc.skills, { skillId: 1, maxLevel: 1, requires: [] }])}
          >
            + Skill
          </Button>
        }
      >
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {jc.skills.map((s, i) => (
            <div key={i} className="flex items-end gap-2">
              <CatalogPickerField
                label="Skill"
                className="w-56"
                value={String(s.skillId)}
                onChange={(v) => updateSkill(i, { skillId: v ? Number(v) : (undefined as unknown as number) })}
                search={searchSkillsForPicker}
                resolveLabel={resolveSkillLabel}
              />
              <NumberField
                label="Nível máx"
                className="w-24"
                value={s.maxLevel}
                onChange={(v) => updateSkill(i, { maxLevel: v as number })}
                {...JOB_LIMITS.skillMaxLevel}
              />
              <Field label="Pré-requisitos (id:nível, id:nível)" className="flex-1">
                <Input
                  value={s.requires.map((r) => `${r.skillId}:${r.level}`).join(", ")}
                  onChange={(e) => {
                    const requires = e.target.value
                      .split(",")
                      .map((part) => part.trim())
                      .filter(Boolean)
                      .map((part) => {
                        const [id, lvl] = part.split(":");
                        return { skillId: Number(id), level: Number(lvl ?? 1) };
                      })
                      .filter((r) => !Number.isNaN(r.skillId) && !Number.isNaN(r.level));
                    updateSkill(i, { requires });
                  }}
                />
              </Field>
              <Button type="button" variant="ghost" onClick={() => set("skills", jc.skills.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title={`Herança de Skill Tree — Inherit (${jc.skillTreeInherit.length})`}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => set("skillTreeInherit", [...jc.skillTreeInherit, -1])}
          >
            + Herança
          </Button>
        }
      >
        <p className="mb-2 text-xs text-zinc-500">
          Fonte real do <code>Inherit:</code> gravado em skill_tree.yml (não a
          "Classe pai" acima). Ordem importa: se o mesmo skill existe em mais
          de um pai com config diferente, o ÚLTIMO da lista vence (rAthena,
          SkillTreeDatabase::loadingFinished).
        </p>
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {jc.skillTreeInherit.map((parentId, i) => (
            <div key={i} className="flex items-end gap-2">
              <CatalogPickerField
                label={`Pai ${i + 1}`}
                className="w-64"
                value={String(parentId)}
                onChange={(v) => updateInherit(i, v)}
                search={searchJobClassesForPicker}
                resolveLabel={resolveJobClassLabel}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => set("skillTreeInherit", jc.skillTreeInherit.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title={`ASPD base por arma (${jc.aspdModifiers.length})`}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => set("aspdModifiers", [...jc.aspdModifiers, { weaponType: "bare_hand", baseAspd: 40 }])}
          >
            + Arma
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {jc.aspdModifiers.map((a, i) => (
            <div key={i} className="flex items-end gap-1">
              <Field label="Arma" className="flex-1">
                <Select
                  value={a.weaponType}
                  onChange={(e) => updateAspd(i, { weaponType: e.target.value as AspdRow["weaponType"] })}
                >
                  {ASPD_WEAPONS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </Select>
              </Field>
              <NumberField
                label="ASPD"
                className="w-20"
                value={a.baseAspd}
                onChange={(v) => updateAspd(i, { baseAspd: v as number })}
                {...JOB_LIMITS.aspdModifierBaseAspd}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => set("aspdModifiers", jc.aspdModifiers.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/classes")}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
