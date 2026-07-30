"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NpcSchema, type Npc, type DialogueNode } from "@ragnarok/game-data";
import { createNpc, updateNpc } from "@/lib/api";
import { Button, Checkbox, Field, Input, Section, Select } from "./ui";

/** Form de NPC (soul.txt §5.5): warp, shop e árvore de diálogo. Nós
 * legacyScript (needsReview) mostram o script original intacto em amber. */

type ShopItemRow = NonNullable<Npc["shop"]>["items"][number];

const EMPTY: Npc = NpcSchema.parse({
  id: "novo_npc",
  name: "Novo NPC",
  sprite: "1_M_01",
  mapId: "prontera",
  position: [150, 150, 0],
});

export function NpcForm({ initial, mode }: { initial?: Npc; mode: "create" | "edit" }) {
  const router = useRouter();
  const [npc, setNpc] = useState<Npc>(initial ?? EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Npc>(key: K, value: Npc[K]) => setNpc((p) => ({ ...p, [key]: value }));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = NpcSchema.safeParse(npc);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      if (mode === "create") await createNpc(parsed.data);
      else await updateNpc(initial!.id, parsed.data);
      router.push("/npcs");
    } catch (err) {
      setErrors([(err as Error).message]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  const flaggedNodes = npc.dialogue.filter(
    (n) => n.kind === "action" && n.action?.kind === "legacyScript",
  ).length;

  const updateNode = (i: number, patch: Partial<DialogueNode>) =>
    set("dialogue", npc.dialogue.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  const updateShopItem = (i: number, patch: Partial<ShopItemRow>) =>
    set("shop", npc.shop ? { ...npc.shop, items: npc.shop.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) } : npc.shop);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errors.length > 0 && (
        <div className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {flaggedNodes > 0 && (
        <p className="rounded bg-amber-950/60 px-3 py-2 text-xs text-amber-300">
          {flaggedNodes} nó(s) de diálogo com script legado não convertido (needsReview) — o
          código original está preservado abaixo, nada foi descartado.
        </p>
      )}

      <Section title="Identificação">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="ID (slug)">
            <Input value={npc.id} onChange={(e) => set("id", e.target.value)} disabled={mode === "edit"} />
          </Field>
          <Field label="Nome">
            <Input value={npc.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Sprite">
            <Input className="font-mono text-xs" value={npc.sprite} onChange={(e) => set("sprite", e.target.value)} />
          </Field>
          <Field label="Mapa (- = flutuante)">
            <Input className="font-mono text-xs" value={npc.mapId} onChange={(e) => set("mapId", e.target.value)} />
          </Field>
          <Field label="X">
            <Input type="number" value={npc.position[0]} onChange={(e) => set("position", [num(e.target.value), npc.position[1], npc.position[2]])} />
          </Field>
          <Field label="Y">
            <Input type="number" value={npc.position[1]} onChange={(e) => set("position", [npc.position[0], num(e.target.value), npc.position[2]])} />
          </Field>
          <Field label="Direção (0-7)">
            <Input type="number" value={npc.direction} onChange={(e) => set("direction", num(e.target.value))} />
          </Field>
          <Field label="Área de toque xs,ys (vazio = nenhuma)">
            <Input
              className="font-mono text-xs"
              value={npc.touchArea ? `${npc.touchArea.xs},${npc.touchArea.ys}` : ""}
              onChange={(e) => {
                const t = e.target.value.trim();
                if (t === "") return set("touchArea", undefined);
                const [xs, ys] = t.split(",").map((p) => Number(p.trim()));
                if (!Number.isNaN(xs) && !Number.isNaN(ys)) set("touchArea", { xs: xs!, ys: ys! });
              }}
            />
          </Field>
        </div>
        {(npc.duplicateOf || npc.legacyRef) && (
          <p className="mt-2 text-xs text-zinc-500">
            {npc.duplicateOf && (
              <>
                duplicata de <span className="font-mono text-zinc-400">{npc.duplicateOf}</span> ·{" "}
              </>
            )}
            {npc.legacyRef && <span className="font-mono">{npc.legacyRef}</span>}
          </p>
        )}
      </Section>

      <Section
        title="Warp"
        actions={
          npc.warp ? (
            <Button type="button" variant="outline" onClick={() => set("warp", undefined)}>
              Remover
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => set("warp", { mapId: "prontera", position: [150, 150, 0], triggerSpan: { xs: 1, ys: 1 } })}
            >
              + Tornar warp
            </Button>
          )
        }
      >
        {npc.warp ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Field label="Mapa destino">
              <Input className="font-mono text-xs" value={npc.warp.mapId} onChange={(e) => set("warp", { ...npc.warp!, mapId: e.target.value })} />
            </Field>
            <Field label="X destino">
              <Input type="number" value={npc.warp.position[0]} onChange={(e) => set("warp", { ...npc.warp!, position: [num(e.target.value), npc.warp!.position[1], 0] })} />
            </Field>
            <Field label="Y destino">
              <Input type="number" value={npc.warp.position[1]} onChange={(e) => set("warp", { ...npc.warp!, position: [npc.warp!.position[0], num(e.target.value), 0] })} />
            </Field>
            <Field label="Gatilho xs">
              <Input type="number" value={npc.warp.triggerSpan.xs} onChange={(e) => set("warp", { ...npc.warp!, triggerSpan: { ...npc.warp!.triggerSpan, xs: num(e.target.value) } })} />
            </Field>
            <Field label="Gatilho ys">
              <Input type="number" value={npc.warp.triggerSpan.ys} onChange={(e) => set("warp", { ...npc.warp!, triggerSpan: { ...npc.warp!.triggerSpan, ys: num(e.target.value) } })} />
            </Field>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">Não é warp.</p>
        )}
      </Section>

      <Section
        title={`Shop${npc.shop ? ` (${npc.shop.items.length} itens)` : ""}`}
        actions={
          npc.shop ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => set("shop", { ...npc.shop!, items: [...npc.shop!.items, { itemId: 501, price: -1 }] })}
              >
                + Item
              </Button>
              <Button type="button" variant="outline" onClick={() => set("shop", undefined)}>
                Remover shop
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => set("shop", { id: `${npc.id}_shop`, currency: "zeny", items: [] })}
            >
              + Tornar shop
            </Button>
          )
        }
      >
        {npc.shop ? (
          <>
            <div className="mb-3 flex items-end gap-3">
              <Field label="Moeda" className="w-36">
                <Select
                  value={npc.shop.currency}
                  onChange={(e) => set("shop", { ...npc.shop!, currency: e.target.value as NonNullable<Npc["shop"]>["currency"] })}
                >
                  <option value="zeny">zeny</option>
                  <option value="cash">cash</option>
                  <option value="item">item</option>
                </Select>
              </Field>
              {npc.shop.currency === "item" && (
                <Field label="Item-moeda (ID)" className="w-36">
                  <Input
                    type="number"
                    value={npc.shop.currencyItemId ?? ""}
                    onChange={(e) => set("shop", { ...npc.shop!, currencyItemId: e.target.value === "" ? undefined : Number(e.target.value) })}
                  />
                </Field>
              )}
              <div className="pb-2">
                <Checkbox
                  label="Aceita desconto (DC)"
                  checked={npc.shop.discount ?? false}
                  onChange={(v) => set("shop", { ...npc.shop!, discount: v })}
                />
              </div>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {npc.shop.items.map((it, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Field label="Item ID" className="w-28">
                    <Input type="number" value={it.itemId} onChange={(e) => updateShopItem(i, { itemId: num(e.target.value) })} />
                  </Field>
                  <Field label="Preço (-1 = preço do item)" className="w-44">
                    <Input type="number" value={it.price} onChange={(e) => updateShopItem(i, { price: num(e.target.value) })} />
                  </Field>
                  <Field label="Estoque (vazio = ilimitado)" className="w-44">
                    <Input
                      type="number"
                      value={it.stock ?? ""}
                      onChange={(e) => updateShopItem(i, { stock: e.target.value === "" ? undefined : Number(e.target.value) })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => set("shop", { ...npc.shop!, items: npc.shop!.items.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-zinc-500">Não é shop.</p>
        )}
      </Section>

      <Section title={`Diálogo (${npc.dialogue.length} nós, entrada: ${npc.dialogueEntry ?? "—"})`}>
        {npc.dialogue.length === 0 ? (
          <p className="text-xs text-zinc-500">Sem diálogo.</p>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {npc.dialogue.map((node, i) => (
              <div key={node.id} className="rounded border border-zinc-800 p-2">
                <div className="mb-1 flex items-center gap-2 text-xs text-zinc-400">
                  <span className="font-mono">{node.id}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5">{node.kind}</span>
                  {node.next && <span>→ {node.next}</span>}
                </div>
                {node.kind === "say" && (
                  <textarea
                    className="h-20 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                    value={node.text ?? ""}
                    onChange={(e) => updateNode(i, { text: e.target.value })}
                  />
                )}
                {node.kind === "action" && node.action?.kind === "legacyScript" && (
                  <pre className="max-h-40 overflow-auto rounded bg-amber-950/40 p-2 font-mono text-xs text-amber-200">
                    {node.action.legacySource}
                  </pre>
                )}
                {node.kind === "choice" && (
                  <ul className="text-xs text-zinc-300">
                    {node.choices?.map((c, ci) => (
                      <li key={ci}>
                        {c.label} → <span className="font-mono">{c.next}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/npcs")}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
