"use client";

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
