"use client";

import { useState } from "react";
import type React from "react";

/** Minimal shadcn-style primitives (project has no shadcn CLI setup yet). */

export function Button({
  variant = "default",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "danger" | "ghost" }) {
  const styles = {
    default: "bg-indigo-600 hover:bg-indigo-500 text-white",
    outline: "border border-zinc-700 hover:bg-zinc-800 text-zinc-200",
    danger: "bg-red-700 hover:bg-red-600 text-white",
    ghost: "hover:bg-zinc-800 text-zinc-300",
  }[variant];
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <label className={`mb-1 block text-xs font-medium text-zinc-400 ${className}`}>{children}</label>;
}

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-indigo-600"
      />
      {label}
    </label>
  );
}

/** Paginador de 4 botões (« / Anterior / Próxima / ») — extraído das 6 páginas de lista, que tinham o bloco idêntico copiado. */
export function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="text-zinc-500">
        Página {page} de {totalPages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => onPage(1)}>
          «
        </Button>
        <Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <Button variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Próxima
        </Button>
        <Button variant="outline" disabled={page >= totalPages} onClick={() => onPage(totalPages)}>
          »
        </Button>
      </div>
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  neutral: "bg-zinc-800 text-zinc-400",
  sky: "bg-sky-950 text-sky-400",
  emerald: "bg-emerald-950 text-emerald-400",
  indigo: "bg-indigo-950 text-indigo-400",
  amber: "bg-amber-950 text-amber-400",
  red: "bg-red-950 text-red-400",
  zinc: "bg-zinc-800 text-zinc-500",
};

/** Chip de célula de tabela — mesma marcação repetida em items/monsters/npcs/statuses/skills. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return <span className={`rounded px-1.5 py-0.5 text-xs ${BADGE_TONES[tone]}`}>{children}</span>;
}

/** Select de filtro de lista: recebe as opções já com a sentinela "todos" (ver `selectOptions` em @ragnarok/game-data). */
export function FilterSelect<T extends string>({
  value,
  onChange,
  options,
  className = "w-auto",
}: {
  value: "" | T;
  onChange: (v: "" | T) => void;
  options: { value: "" | T; label: string }[];
  className?: string;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as "" | T)} className={className}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/** Campo numérico que NUNCA grava 0 ao ser limpo — emite `undefined` (o
 * schema reaplica `.default()`/`.optional()` sozinho no submit, que já
 * manda `parsed.data`). Substitui o padrão `num = (v) => v === "" ? 0 :
 * Number(v)` duplicado nas 5 telas: limpar um campo virava corrupção
 * silenciosa (drop rate 0 é REJEITADO pelo rAthena — `docs/audit/
 * monsters.md`). `min`/`max`/`step` vêm de `apps/admin/lib/field-limits.ts`,
 * sempre citando `arquivo:linha` do rAthena real — nunca inventados. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
  disabled,
  className = "",
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const n = Number(text);
  const outOfRange =
    text.trim() !== "" &&
    !Number.isNaN(n) &&
    ((min !== undefined && n < min) || (max !== undefined && n > max));
  return (
    <Field label={label} className={className}>
      <Input
        type="number"
        className={outOfRange ? "border-red-600" : ""}
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === "") {
            onChange(undefined);
            return;
          }
          // regex antes de Number() — Number() sozinho aceita "1e5"/"0x10"/
          // "Infinity", que não é o que um operador digitando um número quis.
          if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) return;
          const parsed = Number(raw);
          if (!Number.isNaN(parsed)) onChange(parsed);
        }}
      />
      {(hint || outOfRange) && (
        <p className={`mt-1 text-xs ${outOfRange ? "text-red-500" : "text-zinc-500"}`}>
          {outOfRange ? `Fora da faixa (${min ?? "–"}..${max ?? "–"})` : hint}
        </p>
      )}
    </Field>
  );
}

/** Editor de CSV pra arrays de tokens (flags de texto livre). Consolidado
 * aqui — antes existia triplicado (SkillForm/MonsterForm/StatusForm, cada
 * um com sua própria cópia). Continua servindo campos de conjunto ABERTO
 * ou que ainda não migraram pra `MultiSelectField` (auditoria: docs/audit/
 * risk-report.md, Fase 2 é quem faz essa migração — aqui é só consolidação,
 * comportamento idêntico ao de antes). */
export function TokenListField({
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

export type MultiOption = {
  value: string;
  label: string;
  description?: string;
  deprecated?: boolean;
};

/** Multi-select pesquisável pra flag/enum fechado — NÃO usado por nenhum
 * campo ainda (Fase 0 só constrói o primitivo; ligar a campos é Fase 2,
 * fora do escopo desta rodada — ver `docs/audit/risk-report.md`).
 *
 * Zero estado espelhado de propósito: `values` é sempre lido de `props`,
 * só a busca (`q`) é local. É o oposto do bug do `TokenListField`
 * (`useState(initial)` nunca resincroniza — linha deletada no meio de uma
 * lista indexada deixava texto de outra linha em componente sobrevivente).
 *
 * Valor salvo sem opção correspondente (dado legado, servidor rAthena mais
 * novo/antigo que o catálogo local) sempre aparece como chip âmbar
 * "(fora do catálogo)" e é preservado ao salvar — nunca apagado por estar
 * fora da lista mostrada. */
export function MultiSelectField({
  label,
  values,
  options,
  onChange,
  searchPlaceholder = "Buscar...",
  max,
  emptyMeans,
  className = "",
}: {
  label: string;
  values: string[];
  options: MultiOption[];
  onChange: (v: string[]) => void;
  searchPlaceholder?: string;
  max?: number;
  emptyMeans?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const byValue = new Map(options.map((o) => [o.value, o]));
  const query = q.trim().toLowerCase();
  const filtered = query
    ? options.filter(
        (o) =>
          o.value.toLowerCase().includes(query) ||
          o.label.toLowerCase().includes(query) ||
          (o.description ?? "").toLowerCase().includes(query),
      )
    : options;

  function toggle(v: string) {
    if (values.includes(v)) {
      onChange(values.filter((x) => x !== v));
    } else {
      if (max !== undefined && values.length >= max) return;
      onChange([...values, v]);
    }
  }

  return (
    <Field label={label} className={`relative ${className}`}>
      <div
        className="flex min-h-[2.25rem] w-full flex-wrap items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 cursor-text"
        onClick={() => setOpen(true)}
      >
        {values.length === 0 && emptyMeans && <span className="text-xs text-zinc-500">{emptyMeans}</span>}
        {values.map((v) => {
          const opt = byValue.get(v);
          const legacy = !opt;
          return (
            <span
              key={v}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                legacy ? "bg-amber-950 text-amber-400" : "bg-zinc-800 text-zinc-200"
              }`}
            >
              {legacy ? `${v} (fora do catálogo)` : (opt?.label ?? v)}
              <button
                type="button"
                className="text-red-400 hover:text-red-300"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(values.filter((x) => x !== v));
                }}
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
          <div className="border-b border-zinc-800 p-2">
            <Input
              autoFocus
              placeholder={searchPlaceholder}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.map((o) => (
              <label
                key={o.value}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-800 ${
                  o.deprecated ? "opacity-60" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={values.includes(o.value)}
                  onChange={() => toggle(o.value)}
                  className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-indigo-600"
                />
                <span className="flex-1 text-zinc-200">
                  {o.label}
                  {o.deprecated && " (obsoleto)"}
                </span>
                {o.description && <span className="text-xs text-zinc-500">{o.description}</span>}
              </label>
            ))}
            {filtered.length === 0 && <p className="p-2 text-xs text-zinc-500">Nenhuma opção encontrada.</p>}
          </div>
          <div className="border-t border-zinc-800 p-1.5 text-right">
            <button
              type="button"
              className="text-xs text-indigo-400 hover:text-indigo-300"
              onClick={() => setOpen(false)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </Field>
  );
}

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-925 p-4" style={{ backgroundColor: "#101014" }}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
