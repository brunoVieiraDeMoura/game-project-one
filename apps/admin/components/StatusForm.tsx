"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  STATUS_CATEGORY_LABELS,
  STATUS_GROUP_LABELS,
  StatusEffectDefSchema,
  StatusGroupSchema,
  classeDaSkill,
  labelOf,
  type StatusEffectDef,
} from "@ragnarok/game-data";
import { createStatus, updateStatus } from "@/lib/api";
import { Badge, Button, Field, Input, NumberField, Section, Select, TokenListField } from "./ui";
import { STATUS_LIMITS } from "@/lib/field-limits";

/** Form do catálogo de statuses (soul.txt §5.3). */

const CATEGORIES = ["buff", "debuff", "neutral"] as const;

const EMPTY: StatusEffectDef = StatusEffectDefSchema.parse({
  id: "novo_status",
  name: "Novo Status",
});

/**
 * Painel de detalhe (pedido do usuário: Descrição/Tipo/Duração/Afeta/
 * Removido por/Origem/Ícone/Stack/Código) — todo campo já existe no schema,
 * isto só compõe leitura a partir deles. "Stack" é DERIVADO, não campo
 * nativo: `status.yml` documenta `Opt1` como "non-stackable special effect",
 * então status com `opt1` preenchido não empilha; sem sinal contrário, os
 * demais são tratados como empilháveis.
 */
function DetailPanel({ st }: { st: StatusEffectDef }) {
  const removidoPor = [...st.failOn, ...st.endOnStart, ...st.endReturn, ...st.endOnEnd];
  const afeta = [...st.calcFlags, ...st.states];
  const origem = st.durationLookupSkill
    ? `Skill ${st.durationLookupSkill} (${classeDaSkill(st.durationLookupSkill).label})`
    : "—";
  const duracao = st.defaultDurationMs
    ? `${st.defaultDurationMs} ms`
    : st.durationLookupSkill
      ? `Variável — segue o nível da skill ${st.durationLookupSkill}`
      : "—";

  const row = (label: string, value: ReactNode) => (
    <div>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-200">{value}</p>
    </div>
  );

  return (
    <Section title="Painel de detalhe">
      <div className="grid gap-3 md:grid-cols-3">
        {row("Descrição", st.description || "—")}
        {row(
          "Tipo",
          <>
            <Badge tone={st.category === "buff" ? "emerald" : st.category === "debuff" ? "red" : "zinc"}>
              {labelOf(STATUS_CATEGORY_LABELS, st.category)}
            </Badge>{" "}
            <Badge tone="indigo">{labelOf(STATUS_GROUP_LABELS, st.group)}</Badge>
          </>,
        )}
        {row("Duração", duracao)}
        {row("Afeta", afeta.length > 0 ? afeta.join(", ") : "—")}
        {row("Pode ser removido por", removidoPor.length > 0 ? removidoPor.join(", ") : "—")}
        {row("Origem (concedido por)", origem)}
        {row("Ícone", st.icon || "—")}
        {row("Stack", st.opt1 ? "Não" : "Sim")}
        {row("Código", `SC_${st.id.toUpperCase()}`)}
      </div>
      {st.params.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-zinc-500">Parâmetros (val1..val4, rathena/doc/status_change.txt)</p>
          <ul className="list-disc pl-5 text-sm text-zinc-300">
            {st.params.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

export function StatusForm({ initial, mode }: { initial?: StatusEffectDef; mode: "create" | "edit" }) {
  const router = useRouter();
  const [st, setSt] = useState<StatusEffectDef>(initial ?? EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof StatusEffectDef>(key: K, value: StatusEffectDef[K]) =>
    setSt((p) => ({ ...p, [key]: value }));

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

      <DetailPanel st={st} />

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
                <option key={c} value={c}>{labelOf(STATUS_CATEGORY_LABELS, c)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Grupo (o que faz)">
            <Select value={st.group} onChange={(e) => set("group", e.target.value as StatusEffectDef["group"])}>
              {StatusGroupSchema.options.map((g) => (
                <option key={g} value={g}>{labelOf(STATUS_GROUP_LABELS, g)}</option>
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
            <textarea
              value={st.description ?? ""}
              onChange={(e) => set("description", e.target.value === "" ? undefined : e.target.value)}
              rows={2}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              placeholder="Vem de rathena/doc/status_change.txt na migração — pode ser editada aqui"
            />
          </Field>
          <TokenListField
            label="Parâmetros (val1..val4)"
            values={st.params}
            onChange={(v) => set("params", v)}
            className="col-span-2 md:col-span-4"
          />
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
          <NumberField
            label="Duração padrão (ms)"
            value={st.defaultDurationMs}
            onChange={(v) => set("defaultDurationMs", v)}
            {...STATUS_LIMITS.defaultDurationMs}
          />
          <NumberField
            label="Taxa mínima (10000 = 100%)"
            value={st.minRate}
            onChange={(v) => set("minRate", v)}
            {...STATUS_LIMITS.minRate}
          />
          <NumberField
            label="Duração mínima (ms)"
            value={st.minDurationMs}
            onChange={(v) => set("minDurationMs", v)}
            {...STATUS_LIMITS.minDurationMs}
          />
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
