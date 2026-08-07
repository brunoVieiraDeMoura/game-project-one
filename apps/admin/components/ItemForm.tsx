"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CharacterVariantSchema,
  EquipLocationSchema,
  ITEM_SUBTYPE_LABELS,
  ITEM_TYPE_LABELS,
  ItemSchema,
  ItemSubTypeSchema,
  ItemTypeSchema,
  labelOf,
  type Item,
} from "@ragnarok/game-data";
import { createItem, updateItem } from "@/lib/api";
import { Button, Checkbox, Field, Input, Label, Select, Section } from "./ui";
import { EffectsEditor } from "./EffectsEditor";

/** Full-coverage item form (soul.txt §5: all entity fields, not a subset). */

/**
 * Item como o servidor guarda: os campos `raw*` são o script cru do rAthena,
 * que a API preserva no round-trip (ver apps/api/src/store/mysql-item-row.ts).
 */
type EditableItem = Item & {
  rawScript?: string;
  rawEquipScript?: string;
  rawUnequipScript?: string;
};

function RawScriptField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={value ? Math.min(14, value.split(/\n/).length + 1) : 3}
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-900 outline-none focus:border-zinc-500"
        placeholder="vazio = item sem script"
      />
    </div>
  );
}

const COMMON_JOBS = [
  "novice", "swordman", "mage", "archer", "acolyte", "merchant", "thief",
  "knight", "priest", "wizard", "blacksmith", "hunter", "assassin",
  "crusader", "monk", "sage", "rogue", "alchemist", "bard", "dancer",
  "supernovice", "taekwon", "stargladiator", "soullinker", "gunslinger", "ninja",
];

// id 0 = "not filled yet"; submit-time validation forces a real positive id
const EMPTY: Item = {
  ...ItemSchema.parse({ id: 1, aegisName: "New_Item", name: "Novo Item", type: "etc" }),
  id: 0,
};

export function ItemForm({ initial, mode }: { initial?: EditableItem; mode: "create" | "edit" }) {
  const router = useRouter();
  const [item, setItem] = useState<EditableItem>(initial ?? EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof EditableItem>(key: K, value: EditableItem[K]) =>
    setItem((p) => ({ ...p, [key]: value }));

  const num = (v: string) => (v === "" ? 0 : Number(v));

  function toggleArray<T>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // O schema não conhece os campos raw* (são do formato do rAthena, não do
    // nosso): valida o que ele conhece e manda os scripts junto.
    const parsed = ItemSchema.safeParse(item);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      // parsed.data perde os raw* (o schema os desconhece) — reanexa, senão
      // salvar pelo painel apagaria o script do item no servidor.
      const payload = {
        ...parsed.data,
        rawScript: item.rawScript,
        rawEquipScript: item.rawEquipScript,
        rawUnequipScript: item.rawUnequipScript,
      };
      if (mode === "create") await createItem(payload);
      else await updateItem(initial!.id, payload);
      router.push("/items");
    } catch (err) {
      setErrors([(err as Error).message]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  const isEquip = ["armor", "weapon", "shadow_gear"].includes(item.type);

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
            <Input type="number" value={item.id || ""} onChange={(e) => set("id", num(e.target.value))} disabled={mode === "edit"} />
          </Field>
          <Field label="Aegis name (interno)">
            <Input value={item.aegisName} onChange={(e) => set("aegisName", e.target.value)} />
          </Field>
          <Field label="Nome de exibição">
            <Input value={item.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Alias (visual de outro item)">
            <Input value={item.aliasName ?? ""} onChange={(e) => set("aliasName", e.target.value || undefined)} />
          </Field>
          <Field label="Tipo">
            <Select value={item.type} onChange={(e) => set("type", e.target.value as Item["type"])}>
              {ItemTypeSchema.options.map((t) => (
                <option key={t} value={t}>{labelOf(ITEM_TYPE_LABELS, t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Subtipo">
            <Select value={item.subType ?? ""} onChange={(e) => set("subType", (e.target.value || undefined) as Item["subType"])}>
              <option value="">—</option>
              {ItemSubTypeSchema.options.map((t) => (
                <option key={t} value={t}>{labelOf(ITEM_SUBTYPE_LABELS, t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Sprite (view id)">
            <Input type="number" value={item.viewSprite} onChange={(e) => set("viewSprite", num(e.target.value))} />
          </Field>
        </div>
      </Section>

      <Section title="Comércio e peso">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Preço de compra (zeny)">
            <Input type="number" value={item.buyPrice} onChange={(e) => set("buyPrice", num(e.target.value))} />
          </Field>
          <Field label="Preço de venda (zeny)">
            <Input type="number" value={item.sellPrice} onChange={(e) => set("sellPrice", num(e.target.value))} />
          </Field>
          <Field label="Peso (10 = 1.0)">
            <Input type="number" value={item.weight} onChange={(e) => set("weight", num(e.target.value))} />
          </Field>
        </div>
      </Section>

      <Section title="Combate">
        <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
          <Field label="ATK">
            <Input type="number" value={item.attack} onChange={(e) => set("attack", num(e.target.value))} />
          </Field>
          <Field label="MATK">
            <Input type="number" value={item.magicAttack} onChange={(e) => set("magicAttack", num(e.target.value))} />
          </Field>
          <Field label="Defesa">
            <Input type="number" value={item.defense} onChange={(e) => set("defense", num(e.target.value))} />
          </Field>
          <Field label="Alcance">
            <Input type="number" value={item.range} onChange={(e) => set("range", num(e.target.value))} />
          </Field>
          <Field label="Slots (0-4)">
            <Input type="number" min={0} max={4} value={item.slots} onChange={(e) => set("slots", num(e.target.value))} />
          </Field>
        </div>
      </Section>

      <Section title="Restrições de uso">
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-zinc-400">Classes (jobs) — vazio ou “all” = todas</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Checkbox
                label="all (todas)"
                checked={item.jobs.includes("all")}
                onChange={() => set("jobs", item.jobs.includes("all") ? [] : ["all"])}
              />
              {COMMON_JOBS.map((job) => (
                <Checkbox
                  key={job}
                  label={item.jobs.includes("all") ? `-${job} (excluir)` : job}
                  checked={
                    item.jobs.includes("all") ? item.jobs.includes(`-${job}`) : item.jobs.includes(job)
                  }
                  onChange={() =>
                    set("jobs", toggleArray(item.jobs, item.jobs.includes("all") ? `-${job}` : job))
                  }
                />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Tipo de personagem (vazio = todos)">
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                {CharacterVariantSchema.options.map((v) => (
                  <Checkbox
                    key={v}
                    label={v}
                    checked={item.classes.includes(v)}
                    onChange={() => set("classes", toggleArray(item.classes, v))}
                  />
                ))}
              </div>
            </Field>
            <Field label="Gênero">
              <Select value={item.gender} onChange={(e) => set("gender", e.target.value as Item["gender"])}>
                <option value="both">Ambos</option>
                <option value="male">Masculino</option>
                <option value="female">Feminino</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nível mín.">
                <Input type="number" value={item.equipLevelMin} onChange={(e) => set("equipLevelMin", num(e.target.value))} />
              </Field>
              <Field label="Nível máx. (0 = sem)">
                <Input type="number" value={item.equipLevelMax} onChange={(e) => set("equipLevelMax", num(e.target.value))} />
              </Field>
            </div>
          </div>
        </div>
      </Section>

      {isEquip && (
        <Section title="Equipamento">
          <div className="space-y-3">
            <Field label="Local de equipamento">
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                {EquipLocationSchema.options.map((loc) => (
                  <Checkbox
                    key={loc}
                    label={loc}
                    checked={item.locations.includes(loc)}
                    onChange={() => set("locations", toggleArray(item.locations, loc))}
                  />
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Nível da arma (1-5)">
                <Input
                  type="number"
                  value={item.weaponLevel ?? ""}
                  onChange={(e) => set("weaponLevel", e.target.value === "" ? undefined : num(e.target.value))}
                />
              </Field>
              <Field label="Nível da armadura (1-2)">
                <Input
                  type="number"
                  value={item.armorLevel ?? ""}
                  onChange={(e) => set("armorLevel", e.target.value === "" ? undefined : num(e.target.value))}
                />
              </Field>
              <div className="flex items-end pb-1.5">
                <Checkbox label="Refinável" checked={item.refineable} onChange={(v) => set("refineable", v)} />
              </div>
              <div className="flex items-end pb-1.5">
                <Checkbox label="Gradável" checked={item.gradable} onChange={(v) => set("gradable", v)} />
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section
        title="Flags"
        actions={
          <Button type="button" variant="ghost" onClick={() => set("flags", item.flags ? undefined : ItemSchema.shape.flags.unwrap().parse({}))}>
            {item.flags ? "Remover" : "Adicionar"}
          </Button>
        }
      >
        {item.flags ? (
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(
              [
                ["buyingStore", "Buying store"],
                ["deadBranch", "Dead branch"],
                ["container", "Container"],
                ["uniqueId", "Unique ID"],
                ["bindOnEquip", "Bind on equip"],
                ["dropAnnounce", "Anunciar drop"],
                ["noConsume", "Não consome ao usar"],
              ] as const
            ).map(([key, label]) => (
              <Checkbox
                key={key}
                label={label}
                checked={item.flags![key]}
                onChange={(v) => set("flags", { ...item.flags!, [key]: v })}
              />
            ))}
            <Field label="Drop effect" className="w-40">
              <Input
                value={item.flags.dropEffect ?? ""}
                onChange={(e) => set("flags", { ...item.flags!, dropEffect: e.target.value || undefined })}
              />
            </Field>
          </div>
        ) : (
          <p className="text-xs text-zinc-600">Sem flags.</p>
        )}
      </Section>

      <Section
        title="Delay de uso"
        actions={
          <Button type="button" variant="ghost" onClick={() => set("delay", item.delay ? undefined : { durationMs: 0 })}>
            {item.delay ? "Remover" : "Adicionar"}
          </Button>
        }
      >
        {item.delay ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duração (ms)">
              <Input type="number" value={item.delay.durationMs} onChange={(e) => set("delay", { ...item.delay!, durationMs: num(e.target.value) })} />
            </Field>
            <Field label="Status de controle (opcional)">
              <Input value={item.delay.statusId ?? ""} onChange={(e) => set("delay", { ...item.delay!, statusId: e.target.value || undefined })} />
            </Field>
          </div>
        ) : (
          <p className="text-xs text-zinc-600">Sem delay.</p>
        )}
      </Section>

      <Section
        title="Empilhamento (stack)"
        actions={
          <Button
            type="button"
            variant="ghost"
            onClick={() => set("stack", item.stack ? undefined : { amount: 1, inventory: true, cart: false, storage: false, guildStorage: false })}
          >
            {item.stack ? "Remover" : "Adicionar"}
          </Button>
        }
      >
        {item.stack ? (
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Quantidade máx." className="w-32">
              <Input type="number" value={item.stack.amount} onChange={(e) => set("stack", { ...item.stack!, amount: num(e.target.value) })} />
            </Field>
            {(
              [
                ["inventory", "Inventário"],
                ["cart", "Carrinho"],
                ["storage", "Armazém"],
                ["guildStorage", "Armazém de guilda"],
              ] as const
            ).map(([key, label]) => (
              <Checkbox key={key} label={label} checked={item.stack![key]} onChange={(v) => set("stack", { ...item.stack!, [key]: v })} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">Sem limite de stack.</p>
        )}
      </Section>

      <Section
        title="Condições de não-uso"
        actions={
          <Button type="button" variant="ghost" onClick={() => set("noUse", item.noUse ? undefined : { overrideGroupLevel: 100, sitting: false })}>
            {item.noUse ? "Remover" : "Adicionar"}
          </Button>
        }
      >
        {item.noUse ? (
          <div className="flex items-end gap-4">
            <Field label="Nível de grupo p/ ignorar" className="w-40">
              <Input type="number" value={item.noUse.overrideGroupLevel} onChange={(e) => set("noUse", { ...item.noUse!, overrideGroupLevel: num(e.target.value) })} />
            </Field>
            <Checkbox label="Bloqueado sentado" checked={item.noUse.sitting} onChange={(v) => set("noUse", { ...item.noUse!, sitting: v })} />
          </div>
        ) : (
          <p className="text-xs text-zinc-600">Sem condições.</p>
        )}
      </Section>

      <Section
        title="Restrições de troca"
        actions={
          <Button type="button" variant="ghost" onClick={() => set("trade", item.trade ? undefined : ItemSchema.shape.trade.unwrap().parse({}))}>
            {item.trade ? "Remover" : "Adicionar"}
          </Button>
        }
      >
        {item.trade ? (
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
            <Field label="Nível de grupo p/ ignorar" className="w-40">
              <Input type="number" value={item.trade.overrideGroupLevel} onChange={(e) => set("trade", { ...item.trade!, overrideGroupLevel: num(e.target.value) })} />
            </Field>
            {(
              [
                ["noDrop", "Não dropa"],
                ["noTrade", "Não troca"],
                ["tradePartnerOnly", "Só troca com parceiro"],
                ["noSell", "Não vende"],
                ["noCart", "Não vai ao carrinho"],
                ["noStorage", "Não vai ao armazém"],
                ["noGuildStorage", "Não vai ao armazém de guilda"],
                ["noMail", "Não vai por correio"],
                ["noAuction", "Não vai a leilão"],
              ] as const
            ).map(([key, label]) => (
              <Checkbox key={key} label={label} checked={item.trade![key]} onChange={(v) => set("trade", { ...item.trade!, [key]: v })} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">Sem restrições.</p>
        )}
      </Section>

      <Section title="Script do rAthena (o que o servidor executa)">
        <p className="mb-3 text-xs text-zinc-600">
          Este é o texto que o map-server roda de verdade. É gravado como veio: o editor de
          efeitos abaixo é só leitura, porque a estrutura tipada não consegue reescrever todo
          script legado sem perder comportamento — reescrever a partir dela quebraria o item.
        </p>
        <div className="space-y-3">
          <RawScriptField label="Script (ao usar)" value={item.rawScript} onChange={(v) => set("rawScript", v)} />
          <RawScriptField label="Script ao equipar" value={item.rawEquipScript} onChange={(v) => set("rawEquipScript", v)} />
          <RawScriptField label="Script ao desequipar" value={item.rawUnequipScript} onChange={(v) => set("rawUnequipScript", v)} />
        </div>
      </Section>

      <Section title="Efeitos reconhecidos (leitura)">
        <div className="space-y-3">
          <EffectsEditor label="Ao usar" value={item.onUse} onChange={(v) => set("onUse", v)} />
          <EffectsEditor label="Ao equipar" value={item.onEquip} onChange={(v) => set("onEquip", v)} />
          <EffectsEditor label="Ao desequipar" value={item.onUnequip} onChange={(v) => set("onUnequip", v)} />
        </div>
      </Section>

      <div className="flex justify-end gap-2 pb-8">
        <Button type="button" variant="outline" onClick={() => router.push("/items")}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : mode === "create" ? "Criar item" : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}
