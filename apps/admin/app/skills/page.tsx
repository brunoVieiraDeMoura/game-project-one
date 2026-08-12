"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Skill } from "@ragnarok/game-data";
import {
  SKILL_DAMAGE_NATURE_LABELS,
  SKILL_TARGET_LABELS,
  SKILL_TYPE_LABELS,
  classeDaSkill,
  labelOf,
  skillClassFilterOptions,
} from "@ragnarok/game-data";
import { deleteSkill, listSkills } from "@/lib/api";
import { Badge, Button, Checkbox, Input, Pager, Select } from "@/components/ui";

const PAGE_SIZES = [10, 20, 50, 100];
const CLASS_OPTIONS = skillClassFilterOptions();

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(new Set());
  const [classPickerOpen, setClassPickerOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const classPrefix = useMemo(() => {
    const prefixes = new Set<string>();
    for (const opt of CLASS_OPTIONS) {
      if (selectedClasses.has(opt.value)) for (const p of opt.prefixes) prefixes.add(p);
    }
    return [...prefixes];
  }, [selectedClasses]);

  const load = useCallback(() => {
    setLoading(true);
    listSkills({ page, pageSize, search: debouncedSearch, classPrefix: classPrefix.length ? classPrefix : undefined })
      .then((res) => {
        setSkills(res.skills);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, pageSize, debouncedSearch, classPrefix]);

  useEffect(load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggleClass(value: string) {
    setSelectedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    setPage(1);
  }

  async function onDelete(s: Skill) {
    if (!confirm(`Excluir skill #${s.id} — ${s.name}?`)) return;
    try {
      await deleteSkill(s.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Skills</h1>
        <Link href="/skills/new">
          <Button>Nova skill</Button>
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por nome, nome Aegis ou ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="relative">
          <Button type="button" variant="outline" onClick={() => setClassPickerOpen((v) => !v)}>
            Classe {selectedClasses.size > 0 ? `(${selectedClasses.size})` : ""}
          </Button>
          {classPickerOpen && (
            <div className="absolute z-10 mt-1 max-h-80 w-80 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-400">Filtrar por classe</span>
                {selectedClasses.size > 0 && (
                  <button
                    className="text-xs text-indigo-400 hover:underline"
                    onClick={() => {
                      setSelectedClasses(new Set());
                      setPage(1);
                    }}
                  >
                    Limpar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {CLASS_OPTIONS.map((opt) => (
                  <Checkbox
                    key={opt.value}
                    label={opt.label}
                    checked={selectedClasses.has(opt.value)}
                    onChange={() => toggleClass(opt.value)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <Select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          className="w-auto"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} / página
            </option>
          ))}
        </Select>
        <span className="text-sm text-zinc-500">{total.toLocaleString("pt-BR")} skills</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Aegis</th>
              <th className="px-3 py-2">Classe</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Natureza</th>
              <th className="px-3 py-2">Alvo</th>
              <th className="px-3 py-2">Nv máx</th>
              <th className="px-3 py-2">Fórmula</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-zinc-500">
                  Carregando...
                </td>
              </tr>
            ) : skills.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-zinc-500">
                  Nenhuma skill encontrada
                </td>
              </tr>
            ) : (
              skills.map((s) => (
                <tr key={s.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                  <td className="px-3 py-2 text-zinc-400">{s.id}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {s.icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/assets/skills/${s.icon}`}
                          alt=""
                          className="h-5 w-5 rounded object-contain"
                          onError={(e) => {
                            e.currentTarget.style.visibility = "hidden";
                          }}
                        />
                      )}
                      {s.name}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{s.aegisName}</td>
                  <td className="px-3 py-2">
                    <Badge tone="indigo">{classeDaSkill(s.aegisName).label}</Badge>
                  </td>
                  <td className="px-3 py-2">{labelOf(SKILL_TYPE_LABELS, s.type)}</td>
                  <td className="px-3 py-2 text-zinc-400">{labelOf(SKILL_DAMAGE_NATURE_LABELS, s.damageNature)}</td>
                  <td className="px-3 py-2 text-zinc-400">{labelOf(SKILL_TARGET_LABELS, s.target)}</td>
                  <td className="px-3 py-2">{s.maxLevel}</td>
                  <td className="px-3 py-2">
                    {s.damageFormula ? (
                      s.damageFormula.needsReview ? (
                        <span className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-400">revisar</span>
                      ) : (
                        <span className="text-xs text-emerald-400">ok</span>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {s.appliedStatuses.length > 0 ? s.appliedStatuses.map((a) => a.statusId).join(", ") : "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link href={`/skills/${s.id}`} className="mr-2 text-indigo-400 hover:underline">
                      Editar
                    </Link>
                    <button onClick={() => onDelete(s)} className="text-red-400 hover:underline">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={setPage} />
    </main>
  );
}
