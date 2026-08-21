"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SKILL_CAST_FLAG_OPTIONS,
  SKILL_DAMAGE_FLAG_OPTIONS,
  SKILL_DAMAGE_NATURE_LABELS,
  SKILL_ELEMENT_LABELS,
  SKILL_FLAG_OPTIONS,
  SKILL_HIT_TYPE_LABELS,
  SKILL_REQUIRED_AMMO_OPTIONS,
  SKILL_REQUIRED_STATE_LABELS,
  SKILL_REQUIRED_WEAPON_OPTIONS,
  SKILL_TARGET_LABELS,
  SKILL_TYPE_LABELS,
  SkillSchema,
  labelOf,
  type DamageFormula,
  type Skill,
  type StatusEffectDef,
} from "@ragnarok/game-data";
import { createSkill, updateSkill, listAllStatuses, removeSkillIcon, uploadSkillIcon } from "@/lib/api";
import { Button, Checkbox, Field, Input, Label, MultiSelectField, NumberField, Section, Select, TokenListField } from "./ui";
import { SKILL_LIMITS } from "@/lib/field-limits";

/** Full-coverage skill form (soul.txt §5.3). Statuses são escolhidos por
 * dropdown do catálogo — nunca texto livre. */

type AppliedRow = Skill["appliedStatuses"][number];
type ItemCostRow = NonNullable<Skill["requirements"]>["itemsConsumed"][number];
type PerLevel = number | number[];

const TYPES = ["damage", "support", "area", "self_buff", "passive"] as const;
const NATURES = ["none", "weapon", "magic", "misc"] as const;
const HIT_TYPES = ["normal", "single", "multi_hit", "critical"] as const;
const TARGETS = ["enemy", "ally", "ground", "self", "party", "trap"] as const;

const EMPTY: Skill = SkillSchema.parse({
  id: 1,
  aegisName: "NEW_SKILL",
  name: "Nova Skill",
  maxLevel: 1,
  type: "damage",
  range: 1,
  castTimeMs: { variable: 0, fixed: 0 },
  target: "enemy",
});

/** perLevel(number): escalar = todos os níveis; CSV = um valor por nível. */
function PerLevelField({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: PerLevel | undefined;
  onChange: (v: PerLevel) => void;
  className?: string;
}) {
  const [text, setText] = useState(
    value === undefined ? "0" : Array.isArray(value) ? value.join(", ") : String(value),
  );
  return (
    <Field label={label} className={className}>
      <Input
        className="font-mono text-xs"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const nums = e.target.value
            .split(/[,\s]+/)
            .filter((s) => s !== "")
            .map(Number)
            .filter((n) => !Number.isNaN(n));
          if (nums.length > 0) onChange(nums.length === 1 ? nums[0]! : nums);
        }}
      />
    </Field>
  );
}

/** Blocos raros (unit/copyFlags/noNearNpc) editados como JSON validado no submit. */
function JsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value, null, 1));
  const [bad, setBad] = useState(false);
  return (
    <Field label={`${label} (JSON, vazio = nenhum)`}>
      <textarea
        className={`h-24 w-full rounded-md border bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 focus:outline-none ${
          bad ? "border-red-600" : "border-zinc-700 focus:border-indigo-500"
        }`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim();
          if (t === "") {
            setBad(false);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(t));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
    </Field>
  );
}

/**
 * Ícone de skill de verdade — upload que processa (redimensiona) no backend
 * e grava em `public/assets/skills/` de ambos os apps (`skills.ts:
 * POST /:id/icon`), e a partir daí aparece sozinho em todo lugar que o jogo
 * mostra ícone de skill (barra, janela de habilidades, badge de cast de mob,
 * ícone de status): todos leem o MESMO `Skill.icon` do catálogo. Mesmo
 * componente/contrato do `IconUploader` de `ItemForm.tsx`.
 *
 * Fora do submit do formulário de propósito — o upload é sua PRÓPRIA
 * requisição (`setIcon` não passa pelo `update()`/`skill_db.yml`, ver
 * `SkillRepository.setIcon`), então soltar o arquivo já salva.
 */
function SkillIconUploader({
  skillId,
  icon,
  onChange,
}: {
  skillId: number;
  icon?: string;
  onChange: (icon: string | undefined) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // cache-bust: o nome do arquivo (`<id>.png`) não muda numa TROCA de ícone.
  const [rev, setRev] = useState(0);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await uploadSkillIcon(skillId, file);
      onChange(updated.icon);
      setRev((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setError(null);
    try {
      const updated = await removeSkillIcon(skillId);
      onChange(updated.icon);
      setRev((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (skillId <= 0) {
    return (
      <div>
        <Label>Ícone</Label>
        <p className="text-xs text-zinc-500">salve a skill primeiro pra poder enviar um ícone</p>
      </div>
    );
  }

  return (
    <div>
      <Label>Ícone (barra, janela de habilidades, cast de mob, status)</Label>
      <div className="flex items-center gap-2">
        {icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/assets/skills/${icon}?v=${rev}`}
            alt=""
            className="h-10 w-10 rounded border border-zinc-700 bg-zinc-900 object-contain"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={onFile}
          disabled={busy}
          className="text-xs text-zinc-400"
        />
        {icon && (
          <Button type="button" onClick={onRemove} disabled={busy}>
            Remover
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function SkillForm({ initial, mode }: { initial?: Skill; mode: "create" | "edit" }) {
  const router = useRouter();
  const [sk, setSk] = useState<Skill>(initial ?? EMPTY);
  const [statuses, setStatuses] = useState<StatusEffectDef[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAllStatuses()
      .then((res) => setStatuses(res.statuses))
      .catch(() => setStatuses([]));
  }, []);

  const set = <K extends keyof Skill>(key: K, value: Skill[K]) => setSk((p) => ({ ...p, [key]: value }));
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const req = sk.requirements ?? SkillSchema.shape.requirements.unwrap().parse({});
  const setReq = <K extends keyof NonNullable<Skill["requirements"]>>(
    key: K,
    value: NonNullable<Skill["requirements"]>[K],
  ) => set("requirements", { ...req, [key]: value });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = SkillSchema.safeParse(sk);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      if (mode === "create") await createSkill(parsed.data);
      else await updateSkill(initial!.id, parsed.data);
      router.push("/skills");
    } catch (err) {
      setErrors([(err as Error).message]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  const updateApplied = (i: number, patch: Partial<AppliedRow>) =>
    set("appliedStatuses", sk.appliedStatuses.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const updateItemCost = (i: number, patch: Partial<ItemCostRow>) =>
    setReq("itemsConsumed", req.itemsConsumed.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const needsReview =
    sk.damageFormula?.needsReview || sk.appliedStatuses.some((a) => a.needsReview);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errors.length > 0 && (
        <div className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {needsReview && (
        <p className="rounded bg-amber-950/60 px-3 py-2 text-xs text-amber-300">
          needsReview: fórmula de dano e/ou chance/duração de status vêm do C++ do rAthena
          (battle.cpp/skill.cpp) e ainda não foram migradas — valores abaixo não são confiáveis
          até a extração da Fase 6.
        </p>
      )}

      <Section title="Identificação">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="ID">
            <Input type="number" value={sk.id} onChange={(e) => set("id", num(e.target.value))} disabled={mode === "edit"} />
          </Field>
          <Field label="Nome Aegis">
            <Input value={sk.aegisName} onChange={(e) => set("aegisName", e.target.value)} />
          </Field>
          <Field label="Nome">
            <Input value={sk.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <SkillIconUploader
            skillId={mode === "edit" ? sk.id : -1}
            icon={sk.icon}
            onChange={(icon) => set("icon", icon)}
          />
          <NumberField
            label="Nível máximo"
            value={sk.maxLevel}
            onChange={(v) => set("maxLevel", v as Skill["maxLevel"])}
            {...SKILL_LIMITS.maxLevel}
          />
          <Field label="Tipo">
            <Select value={sk.type} onChange={(e) => set("type", e.target.value as Skill["type"])}>
              {TYPES.map((t) => (
                <option key={t} value={t}>{labelOf(SKILL_TYPE_LABELS, t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Natureza do dano">
            <Select value={sk.damageNature} onChange={(e) => set("damageNature", e.target.value as Skill["damageNature"])}>
              {NATURES.map((t) => (
                <option key={t} value={t}>{labelOf(SKILL_DAMAGE_NATURE_LABELS, t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo de acerto">
            <Select value={sk.hitType} onChange={(e) => set("hitType", e.target.value as Skill["hitType"])}>
              {HIT_TYPES.map((t) => (
                <option key={t} value={t}>{labelOf(SKILL_HIT_TYPE_LABELS, t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Alvo">
            <Select value={sk.target} onChange={(e) => set("target", e.target.value as Skill["target"])}>
              {TARGETS.map((t) => (
                <option key={t} value={t}>{labelOf(SKILL_TARGET_LABELS, t)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-6">
          <Checkbox label="Cast interrompível ao tomar dano" checked={sk.interruptible} onChange={(v) => set("interruptible", v)} />
          <NumberField
            label="Redução de DEF no cast (%)"
            className="w-52"
            value={sk.castDefenseReduction}
            onChange={(v) => set("castDefenseReduction", v)}
            {...SKILL_LIMITS.castDefenseReduction}
          />
        </div>
      </Section>

      <Section title="Elemento e flags">
        <div className="grid gap-3 md:grid-cols-2">
          <TokenListField
            label="Elemento (1 valor = todos os níveis; CSV = por nível; weapon/endowed/random ok)"
            values={Array.isArray(sk.element) ? sk.element : [sk.element]}
            onChange={(v) => set("element", (v.length === 1 ? v[0]! : v) as Skill["element"])}
          />
          <MultiSelectField
            label="Flags de dano (NK_*)"
            values={sk.damageFlags}
            options={SKILL_DAMAGE_FLAG_OPTIONS}
            onChange={(v) => set("damageFlags", v)}
          />
          <MultiSelectField
            label="Flags de info (INF2_*)"
            values={sk.flags}
            options={SKILL_FLAG_OPTIONS}
            onChange={(v) => set("flags", v)}
          />
          <div className="grid grid-cols-2 gap-3">
            <MultiSelectField
              label="Flags de cast time"
              values={sk.castTimeFlags}
              options={SKILL_CAST_FLAG_OPTIONS}
              onChange={(v) => set("castTimeFlags", v)}
            />
            <MultiSelectField
              label="Flags de delay"
              values={sk.castDelayFlags}
              options={SKILL_CAST_FLAG_OPTIONS}
              onChange={(v) => set("castDelayFlags", v)}
            />
          </div>
        </div>
      </Section>

      <Section title="Valores por nível (escalar = todos os níveis; CSV = nível a nível)">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <PerLevelField label="Alcance (negativo = corpo a corpo)" value={sk.range} onChange={(v) => set("range", v)} />
          <PerLevelField label="Hits (negativo = dano dividido)" value={sk.hits} onChange={(v) => set("hits", v)} />
          <PerLevelField label="Raio de área (0 = alvo único)" value={sk.areaRadius} onChange={(v) => set("areaRadius", v)} />
          <PerLevelField label="Knockback (células)" value={sk.knockback} onChange={(v) => set("knockback", v)} />
          <PerLevelField label="Instâncias no chão" value={sk.activeInstances} onChange={(v) => set("activeInstances", v)} />
          <PerLevelField label="AP ganho" value={sk.giveAp} onChange={(v) => set("giveAp", v)} />
          <PerLevelField label="Custo de SP" value={sk.spCost} onChange={(v) => set("spCost", v)} />
          <PerLevelField
            label="Cast variável (ms)"
            value={sk.castTimeMs.variable}
            onChange={(v) => set("castTimeMs", { ...sk.castTimeMs, variable: v })}
          />
          <PerLevelField
            label="Cast fixo (ms)"
            value={sk.castTimeMs.fixed}
            onChange={(v) => set("castTimeMs", { ...sk.castTimeMs, fixed: v })}
          />
          <PerLevelField label="Cooldown (ms)" value={sk.cooldownMs} onChange={(v) => set("cooldownMs", v)} />
          <PerLevelField label="Delay pós-cast (ms)" value={sk.afterCastDelayMs} onChange={(v) => set("afterCastDelayMs", v)} />
          <PerLevelField label="Delay de andar (ms)" value={sk.afterCastWalkDelayMs} onChange={(v) => set("afterCastWalkDelayMs", v)} />
          <PerLevelField label="Duração 1 (ms)" value={sk.durationMs} onChange={(v) => set("durationMs", v)} />
          <PerLevelField label="Duração 2 (ms)" value={sk.duration2Ms} onChange={(v) => set("duration2Ms", v)} />
        </div>
      </Section>

      <Section title="Requisitos de cast">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <PerLevelField label="Custo de HP" value={req.hpCost} onChange={(v) => setReq("hpCost", v)} />
          <PerLevelField label="Custo de AP" value={req.apCost} onChange={(v) => setReq("apCost", v)} />
          <PerLevelField label="Custo de HP (%)" value={req.hpRateCost} onChange={(v) => setReq("hpRateCost", v)} />
          <PerLevelField label="Custo de SP (%)" value={req.spRateCost} onChange={(v) => setReq("spRateCost", v)} />
          <PerLevelField label="Custo de AP (%)" value={req.apRateCost} onChange={(v) => setReq("apRateCost", v)} />
          <PerLevelField label="Gatilho HP máx" value={req.maxHpTrigger} onChange={(v) => setReq("maxHpTrigger", v)} />
          <PerLevelField label="Esferas espirituais" value={req.spiritSphereCost} onChange={(v) => setReq("spiritSphereCost", v)} />
          <PerLevelField label="Custo em zeny" value={req.zenyCost} onChange={(v) => setReq("zenyCost", v)} />
          <PerLevelField label="Qtd de munição" value={req.ammoAmount} onChange={(v) => setReq("ammoAmount", v)} />
          <Field label="Estado exigido (riding, hiding, ...)">
            <Select
              value={req.requiredState ?? ""}
              onChange={(e) => setReq("requiredState", e.target.value === "" ? undefined : e.target.value)}
            >
              <option value="">—</option>
              {req.requiredState && !(req.requiredState in SKILL_REQUIRED_STATE_LABELS) && (
                <option value={req.requiredState}>{req.requiredState} (fora do catálogo!)</option>
              )}
              {Object.keys(SKILL_REQUIRED_STATE_LABELS).map((v) => (
                <option key={v} value={v}>
                  {labelOf(SKILL_REQUIRED_STATE_LABELS, v)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <MultiSelectField
            label="Armas exigidas (vazio = qualquer)"
            values={req.requiredWeapons}
            options={SKILL_REQUIRED_WEAPON_OPTIONS}
            emptyMeans="qualquer arma"
            onChange={(v) => setReq("requiredWeapons", v as typeof req.requiredWeapons)}
          />
          <MultiSelectField
            label="Munição exigida (vazio = qualquer)"
            values={req.requiredAmmo}
            options={SKILL_REQUIRED_AMMO_OPTIONS}
            emptyMeans="qualquer munição"
            onChange={(v) => setReq("requiredAmmo", v)}
          />
          <TokenListField label="Equipamentos exigidos (IDs de item)" values={req.requiredEquipment.map(String)} onChange={(v) => setReq("requiredEquipment", v.map(Number).filter((n) => !Number.isNaN(n)))} />
        </div>
        <div className="mt-3">
          <Field label={`Status exigidos pra castar (${req.requiredStatuses.length})`}>
            <div className="flex flex-wrap items-center gap-2">
              {req.requiredStatuses.map((s, i) => (
                <span key={i} className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs">
                  {s}
                  <button
                    type="button"
                    className="text-red-400"
                    onClick={() => setReq("requiredStatuses", req.requiredStatuses.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <Select
                className="w-56"
                value=""
                onChange={(e) => {
                  if (e.target.value && !req.requiredStatuses.includes(e.target.value)) {
                    setReq("requiredStatuses", [...req.requiredStatuses, e.target.value]);
                  }
                }}
              >
                <option value="">+ adicionar do catálogo...</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        </div>
        <Section
          title={`Itens consumidos (${req.itemsConsumed.length})`}
          actions={
            <Button type="button" variant="outline" onClick={() => setReq("itemsConsumed", [...req.itemsConsumed, { itemId: 501, amount: 1 }])}>
              + Item
            </Button>
          }
        >
          <div className="space-y-1">
            {req.itemsConsumed.map((c, i) => (
              <div key={i} className="flex items-end gap-2">
                <NumberField
                  label="Item ID"
                  className="w-28"
                  value={c.itemId}
                  onChange={(v) => updateItemCost(i, { itemId: v as number })}
                />
                <NumberField
                  label="Qtd (0 = só exige possuir)"
                  className="w-40"
                  value={c.amount}
                  onChange={(v) => updateItemCost(i, { amount: v as number })}
                  {...SKILL_LIMITS.itemsConsumedAmount}
                />
                <NumberField
                  label="Só no nível (vazio = todos)"
                  className="w-40"
                  value={c.level}
                  onChange={(v) => updateItemCost(i, { level: v })}
                  {...SKILL_LIMITS.itemsConsumedLevel}
                />
                <Button type="button" variant="ghost" onClick={() => setReq("itemsConsumed", req.itemsConsumed.filter((_, j) => j !== i))}>
                  ✕
                </Button>
              </div>
            ))}
          </div>
        </Section>
      </Section>

      <Section title="Fórmula de dano">
        {sk.damageFormula ? (
          <div className="space-y-3">
            {sk.damageFormula.needsReview && (
              <p className="rounded bg-amber-950/60 px-3 py-2 text-xs text-amber-300">
                UNCLEAR-FORMULA: origem — {sk.damageFormula.legacySource ?? "desconhecida"}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Expressão (DSL: baseLevel, skillLevel, str..luk, atk, matk)">
                <Input
                  className="font-mono text-xs"
                  value={sk.damageFormula.expression}
                  onChange={(e) => set("damageFormula", { ...sk.damageFormula!, expression: e.target.value })}
                />
              </Field>
              <Field label="Elemento do dano">
                {/* Campo existia no schema mas nunca teve controle nenhum —
                 * ficava cravado em "weapon" desde a criação. */}
                <Select
                  value={sk.damageFormula.element}
                  onChange={(e) => set("damageFormula", { ...sk.damageFormula!, element: e.target.value as DamageFormula["element"] })}
                >
                  {!(sk.damageFormula.element in SKILL_ELEMENT_LABELS) && (
                    <option value={sk.damageFormula.element}>{sk.damageFormula.element} (fora do catálogo!)</option>
                  )}
                  {Object.keys(SKILL_ELEMENT_LABELS).map((v) => (
                    <option key={v} value={v}>
                      {labelOf(SKILL_ELEMENT_LABELS, v)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end gap-4 pb-1">
                <Checkbox
                  label="needsReview"
                  checked={sk.damageFormula.needsReview}
                  onChange={(v) => set("damageFormula", { ...sk.damageFormula!, needsReview: v })}
                />
                <Button type="button" variant="outline" onClick={() => set("damageFormula", undefined)}>
                  Remover fórmula
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => set("damageFormula", { expression: "", element: "weapon", needsReview: true })}
          >
            + Adicionar fórmula
          </Button>
        )}
      </Section>

      <Section
        title={`Status aplicados (${sk.appliedStatuses.length})`}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              set("appliedStatuses", [
                ...sk.appliedStatuses,
                { statusId: statuses[0]?.id ?? "", chance: 100, durationMs: 0, appliesTo: "target" as const, needsReview: false },
              ])
            }
          >
            + Status
          </Button>
        }
      >
        <div className="space-y-1">
          {sk.appliedStatuses.map((a, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label="Status (catálogo)" className="w-56">
                <Select value={a.statusId} onChange={(e) => updateApplied(i, { statusId: e.target.value })}>
                  {a.statusId === "" && <option value="">selecione...</option>}
                  {!statuses.some((s) => s.id === a.statusId) && a.statusId !== "" && (
                    <option value={a.statusId}>{a.statusId} (fora do catálogo!)</option>
                  )}
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.id})
                    </option>
                  ))}
                </Select>
              </Field>
              <NumberField
                label="Chance %"
                className="w-24"
                value={a.chance}
                onChange={(v) => updateApplied(i, { chance: v as number })}
                {...SKILL_LIMITS.appliedStatusChance}
              />
              <PerLevelField label="Duração (ms)" value={a.durationMs} onChange={(v) => updateApplied(i, { durationMs: v })} className="flex-1" />
              <Field label="Em quem" className="w-28">
                <Select value={a.appliesTo} onChange={(e) => updateApplied(i, { appliesTo: e.target.value as AppliedRow["appliesTo"] })}>
                  <option value="target">target</option>
                  <option value="self">self</option>
                </Select>
              </Field>
              {a.needsReview && <span className="pb-2 text-xs text-amber-400">revisar</span>}
              <Button type="button" variant="ghost" onClick={() => set("appliedStatuses", sk.appliedStatuses.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Avançado (blocos raros)">
        <div className="grid gap-3 md:grid-cols-3">
          <JsonField label="Unidade de chão (unit)" value={sk.unit} onChange={(v) => set("unit", v as Skill["unit"])} />
          <JsonField label="Cópia (copyFlags)" value={sk.copyFlags} onChange={(v) => set("copyFlags", v as Skill["copyFlags"])} />
          <JsonField label="Restrição perto de NPC (noNearNpc)" value={sk.noNearNpc} onChange={(v) => set("noNearNpc", v as Skill["noNearNpc"])} />
        </div>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/skills")}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
