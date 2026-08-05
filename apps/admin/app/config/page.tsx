"use client";

import { useEffect, useState } from "react";
import type { ServerConfig } from "@ragnarok/game-data";
import { getServerConfig, updateServerConfig } from "@/lib/api";
import { Button, Checkbox, Field, Input, Section, Select } from "@/components/ui";

/** Gerenciador Global (soul.txt §5.7): taxas de EXP/drop globais + overrides
 * por categoria. Salvar reflete no engine-core via cache curto da API, sem
 * restart do game-server. */

type RateOverride = ServerConfig["dropRateOverrides"][number];

const ITEM_TYPES = [
  "healing", "usable", "etc", "armor", "weapon", "card",
  "pet_egg", "pet_armor", "ammo", "delay_consume", "shadow_gear", "cash",
] as const;

function scopeLabel(o: RateOverride): string {
  switch (o.scope.kind) {
    case "itemType":
      return `tipo: ${o.scope.itemType}`;
    case "mvpDrops":
      return "drops de MVP";
    case "mapId":
      return `mapa: ${o.scope.mapId}`;
  }
}

function OverrideList({
  title,
  overrides,
  onChange,
  allowItemType,
}: {
  title: string;
  overrides: RateOverride[];
  onChange: (v: RateOverride[]) => void;
  allowItemType: boolean;
}) {
  const setMul = (i: number, multiplier: number) =>
    onChange(overrides.map((o, j) => (j === i ? { ...o, multiplier } : o)));
  const setScope = (i: number, scope: RateOverride["scope"]) =>
    onChange(overrides.map((o, j) => (j === i ? { ...o, scope } : o)));

  return (
    <Section
      title={`${title} (${overrides.length})`}
      actions={
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange([...overrides, { scope: { kind: "mapId", mapId: "prontera" }, multiplier: 2 }])
          }
        >
          + Override
        </Button>
      }
    >
      <div className="space-y-2">
        {overrides.length === 0 && <p className="text-xs text-zinc-500">Nenhum override.</p>}
        {overrides.map((o, i) => (
          <div key={i} className="flex items-end gap-2">
            <Field label="Escopo" className="w-40">
              <Select
                value={o.scope.kind}
                onChange={(e) => {
                  const kind = e.target.value as RateOverride["scope"]["kind"];
                  setScope(
                    i,
                    kind === "itemType"
                      ? { kind, itemType: "card" }
                      : kind === "mapId"
                        ? { kind, mapId: "prontera" }
                        : { kind: "mvpDrops" },
                  );
                }}
              >
                {allowItemType && <option value="itemType">tipo de item</option>}
                {allowItemType && <option value="mvpDrops">drops de MVP</option>}
                <option value="mapId">mapa</option>
              </Select>
            </Field>
            {o.scope.kind === "itemType" && (
              <Field label="Tipo" className="w-36">
                <Select value={o.scope.itemType} onChange={(e) => setScope(i, { kind: "itemType", itemType: e.target.value as (typeof ITEM_TYPES)[number] })}>
                  {ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </Field>
            )}
            {o.scope.kind === "mapId" && (
              <Field label="Mapa" className="flex-1">
                <Input className="font-mono text-xs" value={o.scope.mapId} onChange={(e) => setScope(i, { kind: "mapId", mapId: e.target.value })} />
              </Field>
            )}
            {o.scope.kind === "mvpDrops" && <div className="flex-1 pb-2 text-xs text-zinc-500">{scopeLabel(o)}</div>}
            <Field label="Multiplicador" className="w-28">
              <Input type="number" step="0.1" min="0.1" value={o.multiplier} onChange={(e) => setMul(i, Number(e.target.value))} />
            </Field>
            <Button type="button" variant="ghost" onClick={() => onChange(overrides.filter((_, j) => j !== i))}>
              ✕
            </Button>
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function ConfigPage() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getServerConfig()
      .then(setConfig)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <main className="mx-auto max-w-4xl p-6"><p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p></main>;
  if (!config) return <main className="mx-auto max-w-4xl p-6"><p className="text-zinc-500">Carregando...</p></main>;

  const set = <K extends keyof ServerConfig>(key: K, value: ServerConfig[K]) => setConfig({ ...config, [key]: value });
  const numF = (v: string) => (v === "" ? 1 : Number(v));

  async function onSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { version: _v, updatedAt: _u, ...rest } = config;
      const next = await updateServerConfig(rest);
      setConfig(next);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Gerenciador Global</h1>
          <p className="mt-1 text-sm text-zinc-500">
            versão {config.version} · atualizado {new Date(config.updatedAt).toLocaleString("pt-BR")} · aplica sem restart (hot-reload)
          </p>
        </div>
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      {saved && <p className="mb-3 rounded bg-emerald-950 px-3 py-2 text-sm text-emerald-300">Salvo — versão {config.version}.</p>}

      <Section title="Taxas globais">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="EXP base (×)">
            <Input type="number" step="0.1" min="0.1" value={config.expRateBase} onChange={(e) => set("expRateBase", numF(e.target.value))} />
          </Field>
          <Field label="EXP de job (×)">
            <Input type="number" step="0.1" min="0.1" value={config.expRateJob} onChange={(e) => set("expRateJob", numF(e.target.value))} />
          </Field>
          <Field label="Drop (×)">
            <Input type="number" step="0.1" min="0.1" value={config.dropRate} onChange={(e) => set("dropRate", numF(e.target.value))} />
          </Field>
        </div>
      </Section>

      <div className="mt-4 space-y-4">
        <OverrideList title="Overrides de drop" overrides={config.dropRateOverrides} onChange={(v) => set("dropRateOverrides", v)} allowItemType />
        <OverrideList title="Overrides de EXP (por mapa)" overrides={config.expRateOverrides} onChange={(v) => set("expRateOverrides", v)} allowItemType={false} />
      </div>
    </main>
  );
}
