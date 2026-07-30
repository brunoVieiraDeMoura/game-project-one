"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusEffectDefSchema, type StatusEffectDef } from "@ragnarok/game-data";
import { createStatus, updateStatus } from "@/lib/api";
import { Button, Field, Input, Section, Select } from "./ui";

/** Form do catálogo de statuses (soul.txt §5.3). */

const CATEGORIES = ["buff", "debuff", "neutral"] as const;

const EMPTY: StatusEffectDef = StatusEffectDefSchema.parse({
  id: "novo_status",
  name: "Novo Status",
});

function TokenListField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState(values.join(", "));
  return (
    <Field label={label}>
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

export function StatusForm({ initial, mode }: { initial?: StatusEffectDef; mode: "create" | "edit" }) {
  const router = useRouter();
  const [st, setSt] = useState<StatusEffectDef>(initial ?? EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof StatusEffectDef>(key: K, value: StatusEffectDef[K]) =>
    setSt((p) => ({ ...p, [key]: value }));
  const optNum = (v: string) => (v === "" ? undefined : Number(v));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = StatusEffectDefSchema.safeParse(st);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      if (mode === "create") await createStatus(parsed.data);
      else await updateStatus(initial!.id, parsed.data);
      router.push("/statuses");
    } catch (err) {
      setErrors([(err as Error).message]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  const unmapped = st.effects?.unmappedEffects ?? [];

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
          <Field label="ID (slug)">
            <Input value={st.id} onChange={(e) => set("id", e.target.value)} disabled={mode === "edit"} />
          </Field>
          <Field label="Nome">
            <Input value={st.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Categoria">
            <Select value={st.category} onChange={(e) => set("category", e.target.value as StatusEffectDef["category"])}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Ícone (EFST_*)">
            <Input
              value={st.icon ?? ""}
              onChange={(e) => set("icon", e.target.value === "" ? undefined : e.target.value)}
            />
          </Field>
          <Field label="Descrição" className="col-span-2 md:col-span-4">
            <Input
              value={st.description ?? ""}
              onChange={(e) => set("description", e.target.value === "" ? undefined : e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Comportamento">
        <div className="grid gap-3 md:grid-cols-2">
          <TokenListField label="Estados bloqueados (no_move, no_cast, no_attack, ...)" values={st.states} onChange={(v) => set("states", v)} />
          <TokenListField label="Stats recalculados (def, mdef, speed, ...)" values={st.calcFlags} onChange={(v) => set("calcFlags", v)} />
          <TokenListField label="Flags (no_dispell, boss_resist, debuff, ...)" values={st.flags} onChange={(v) => set("flags", v)} />
          <TokenListField label="Options (client)" values={st.options} onChange={(v) => set("options", v)} />
          <Field label="Opt1 (overlay exclusivo: stone, freeze, ...)">
            <Input value={st.opt1 ?? ""} onChange={(e) => set("opt1", e.target.value === "" ? undefined : e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <TokenListField label="Opt2" values={st.opt2} onChange={(v) => set("opt2", v)} />
            <TokenListField label="Opt3" values={st.opt3} onChange={(v) => set("opt3", v)} />
          </div>
        </div>
      </Section>

      <Section title="Duração e resistência">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Skill de duração (aegis, DurationLookup)">
            <Input
              value={st.durationLookupSkill ?? ""}
              onChange={(e) => set("durationLookupSkill", e.target.value === "" ? undefined : e.target.value)}
            />
          </Field>
          <Field label="Duração padrão (ms)">
            <Input type="number" value={st.defaultDurationMs ?? ""} onChange={(e) => set("defaultDurationMs", optNum(e.target.value))} />
          </Field>
          <Field label="Taxa mínima (10000 = 100%)">
            <Input type="number" value={st.minRate ?? ""} onChange={(e) => set("minRate", optNum(e.target.value))} />
          </Field>
          <Field label="Duração mínima (ms)">
            <Input type="number" value={st.minDurationMs ?? ""} onChange={(e) => set("minDurationMs", optNum(e.target.value))} />
          </Field>
        </div>
      </Section>

      <Section title="Interações com outros statuses (IDs do catálogo)">
        <div className="grid gap-3 md:grid-cols-2">
          <TokenListField label="Falha se ativos (failOn)" values={st.failOn} onChange={(v) => set("failOn", v)} />
          <TokenListField label="Encerra ao iniciar (endOnStart)" values={st.endOnStart} onChange={(v) => set("endOnStart", v)} />
          <TokenListField label="Encerra sem aplicar efeito (endReturn)" values={st.endReturn} onChange={(v) => set("endReturn", v)} />
          <TokenListField label="Encerra ao terminar (endOnEnd)" values={st.endOnEnd} onChange={(v) => set("endOnEnd", v)} />
        </div>
      </Section>

      {(st.effects?.effects.length || unmapped.length > 0) && (
        <Section title="Efeitos migrados do Script">
          {st.effects && st.effects.effects.length > 0 && (
            <pre className="mb-2 max-h-40 overflow-auto rounded bg-zinc-900 p-2 font-mono text-xs text-zinc-300">
              {JSON.stringify(st.effects.effects, null, 1)}
            </pre>
          )}
          {unmapped.length > 0 && (
            <div className="rounded bg-amber-950/60 px-3 py-2 text-xs text-amber-300">
              <p className="mb-1 font-semibold">Fragmentos de script não mapeados (revisão manual, nunca descartados):</p>
              {unmapped.map((u, i) => (
                <p key={i} className="font-mono">{u}</p>
              ))}
            </div>
          )}
        </Section>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/statuses")}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
