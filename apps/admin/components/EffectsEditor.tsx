"use client";

import type { EffectList, GameEffect } from "@ragnarok/game-data";
import { StatBonusTargetSchema } from "@ragnarok/game-data";
import { Button, Field, Input, Select } from "./ui";

/**
 * Typed effects editor (soul.txt §5.1: effects are structured data, never a
 * free script string). unmappedEffects = legacy script fragments pending
 * manual conversion — shown read-only, removable once converted.
 */

const KIND_LABEL: Record<GameEffect["kind"], string> = {
  heal: "Cura (HP/SP)",
  statBonus: "Bônus de atributo",
  grantStatus: "Aplica status/buff",
  castSkill: "Conjura skill",
};

function defaultEffect(kind: GameEffect["kind"]): GameEffect {
  switch (kind) {
    case "heal":
      return { kind: "heal", resource: "hp", min: 0, max: 0 };
    case "statBonus":
      return { kind: "statBonus", stat: "str", value: 0 };
    case "grantStatus":
      return { kind: "grantStatus", statusId: "", durationMs: 0 };
    case "castSkill":
      return { kind: "castSkill", skillId: 0, level: 1 };
  }
}

export function EffectsEditor({
  label,
  value,
  onChange,
  /** A9: `onUse`/`onEquip`/`onUnequip` não têm write-path nenhum sob o
   * backend MySQL ativo (`mysql-item-row.ts` nunca lê nem grava esses
   * campos — só `rawScript`/`rawEquipScript`/`rawUnequipScript`, o texto
   * cru, persiste de verdade). Sem trava, o componente deixava editar
   * livremente algo que o Save descarta em silêncio — obrigatório, não
   * opcional, pra todo chamador decidir isto de propósito. */
  readOnly,
}: {
  label: string;
  value: EffectList | undefined;
  onChange: (v: EffectList | undefined) => void;
  readOnly: boolean;
}) {
  const list: EffectList = value ?? { effects: [], unmappedEffects: [] };

  function commit(next: EffectList) {
    onChange(next.effects.length === 0 && next.unmappedEffects.length === 0 ? undefined : next);
  }

  function setEffect(idx: number, effect: GameEffect) {
    const effects = list.effects.map((e, i) => (i === idx ? effect : e));
    commit({ ...list, effects });
  }

  return (
    <fieldset disabled={readOnly} className="rounded-md border border-zinc-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-zinc-400">{label}</span>
        <Button
          type="button"
          variant="outline"
          onClick={() => commit({ ...list, effects: [...list.effects, defaultEffect("heal")] })}
        >
          + Efeito
        </Button>
      </div>

      {list.effects.length === 0 && list.unmappedEffects.length === 0 && (
        <p className="text-xs text-zinc-600">Sem efeitos.</p>
      )}

      <div className="space-y-2">
        {list.effects.map((effect, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2 rounded bg-zinc-900/70 p-2">
            <Field label="Tipo" className="w-44">
              <Select
                value={effect.kind}
                onChange={(e) => setEffect(idx, defaultEffect(e.target.value as GameEffect["kind"]))}
              >
                {(Object.keys(KIND_LABEL) as GameEffect["kind"][]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>

            {effect.kind === "heal" && (
              <>
                <Field label="Recurso" className="w-24">
                  <Select
                    value={effect.resource}
                    onChange={(e) => setEffect(idx, { ...effect, resource: e.target.value as "hp" | "sp" })}
                  >
                    <option value="hp">HP</option>
                    <option value="sp">SP</option>
                  </Select>
                </Field>
                <Field label="Mín" className="w-20">
                  <Input
                    type="number"
                    value={effect.min}
                    onChange={(e) => setEffect(idx, { ...effect, min: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Máx" className="w-20">
                  <Input
                    type="number"
                    value={effect.max}
                    onChange={(e) => setEffect(idx, { ...effect, max: Number(e.target.value) })}
                  />
                </Field>
                <label className="flex items-center gap-1 pb-1.5 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={effect.percent ?? false}
                    onChange={(e) => setEffect(idx, { ...effect, percent: e.target.checked || undefined })}
                  />
                  %
                </label>
              </>
            )}

            {effect.kind === "statBonus" && (
              <>
                <Field label="Atributo" className="w-32">
                  <Select
                    value={effect.stat}
                    onChange={(e) =>
                      setEffect(idx, { ...effect, stat: e.target.value as typeof effect.stat })
                    }
                  >
                    {StatBonusTargetSchema.options.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Valor" className="w-20">
                  <Input
                    type="number"
                    value={effect.value}
                    onChange={(e) => setEffect(idx, { ...effect, value: Number(e.target.value) })}
                  />
                </Field>
                <label className="flex items-center gap-1 pb-1.5 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={effect.perRefine ?? false}
                    onChange={(e) => setEffect(idx, { ...effect, perRefine: e.target.checked || undefined })}
                  />
                  por refino
                </label>
              </>
            )}

            {effect.kind === "grantStatus" && (
              <>
                {/* TODO: trocar por dropdown do catálogo de status quando o módulo de status existir (soul.txt §5.3) */}
                <Field label="Status ID" className="w-36">
                  <Input
                    value={effect.statusId}
                    onChange={(e) => setEffect(idx, { ...effect, statusId: e.target.value })}
                  />
                </Field>
                <Field label="Duração (ms)" className="w-28">
                  <Input
                    type="number"
                    value={effect.durationMs}
                    onChange={(e) => setEffect(idx, { ...effect, durationMs: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Chance %" className="w-24">
                  <Input
                    type="number"
                    value={effect.chance ?? ""}
                    onChange={(e) =>
                      setEffect(idx, {
                        ...effect,
                        chance: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </>
            )}

            {effect.kind === "castSkill" && (
              <>
                <Field label="Skill ID" className="w-24">
                  <Input
                    type="number"
                    value={effect.skillId}
                    onChange={(e) => setEffect(idx, { ...effect, skillId: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Nível" className="w-20">
                  <Input
                    type="number"
                    value={effect.level}
                    onChange={(e) => setEffect(idx, { ...effect, level: Number(e.target.value) })}
                  />
                </Field>
              </>
            )}

            <Button
              type="button"
              variant="ghost"
              className="ml-auto text-red-400"
              onClick={() => commit({ ...list, effects: list.effects.filter((_, i) => i !== idx) })}
            >
              Remover
            </Button>
          </div>
        ))}
      </div>

      {list.unmappedEffects.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-amber-400">
            Script legado não convertido (revisar manualmente):
          </p>
          <ul className="space-y-1">
            {list.unmappedEffects.map((frag, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between rounded bg-amber-950/40 px-2 py-1 font-mono text-xs text-amber-200"
              >
                <span className="truncate">{frag}</span>
                <button
                  type="button"
                  className="ml-2 shrink-0 text-amber-500 hover:text-amber-300"
                  onClick={() =>
                    commit({ ...list, unmappedEffects: list.unmappedEffects.filter((_, i) => i !== idx) })
                  }
                >
                  resolvido ✓
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
