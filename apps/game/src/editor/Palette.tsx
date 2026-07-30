import { useState } from "react";
import { PROP_BY_CATEGORY, preloadProp, propUrl, type PropCatalogEntry } from "../props/registry";
import { useEditorStore } from "./editorStore";
import { useThumbnail } from "./thumbnailer";
import { Panel, ink } from "../ui/rpg";

/**
 * Paleta de assets (esquerda): categorias com os modelos. Cada botão mostra
 * uma miniatura 3D do asset (gerada uma vez, cacheada) + o nome. Clicar entra
 * no modo "colocar"; clicar no ativo sai.
 */
export function Palette({ embedded }: { embedded?: boolean } = {}) {
  const currentAsset = useEditorStore((s) => s.currentAsset);
  const [open, setOpen] = useState<string | null>(PROP_BY_CATEGORY[0]?.cat ?? null);

  const body = (
    <>
      {PROP_BY_CATEGORY.map((group) => (
        <div key={group.cat} style={{ marginBottom: 6 }}>
          <button
            onClick={() => setOpen(open === group.cat ? null : group.cat)}
            style={{
              width: "100%",
              textAlign: "left",
              font: "600 12px system-ui",
              color: ink.dim,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${ink.border}`,
              borderRadius: 6,
              padding: "5px 8px",
              cursor: "pointer",
            }}
          >
            {open === group.cat ? "▾" : "▸"} {group.label} ({group.items.length})
          </button>
          {open === group.cat && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 4 }}>
              {group.items.map((it) => (
                <AssetButton key={it.id} item={it} active={currentAsset === it.id} />
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );

  if (embedded) return body;
  return (
    <Panel style={{ width: 230, maxHeight: "82vh", overflow: "auto" }}>
      <div style={{ font: "700 13px system-ui", color: ink.text, marginBottom: 8 }}>Assets</div>
      {body}
    </Panel>
  );
}

function AssetButton({ item, active }: { item: PropCatalogEntry; active: boolean }) {
  const setAsset = useEditorStore((s) => s.setAsset);
  const thumb = useThumbnail(propUrl(item.id));
  return (
    <button
      title={item.label}
      onPointerEnter={() => preloadProp(item.id)}
      onClick={() => {
        preloadProp(item.id); // carrega antes de colocar (sem suspender a cena)
        setAsset(active ? null : item.id);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        color: active ? "#fff" : ink.text,
        background: active ? "#4f46e5" : "rgba(255,255,255,0.05)",
        border: `1px solid ${active ? "#4f46e5" : ink.border}`,
        borderRadius: 6,
        padding: "4px 3px",
        cursor: "pointer",
      }}
    >
      {/* miniatura do asset */}
      <div style={{ width: 48, height: 48, borderRadius: 4, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {thumb ? (
          <img src={thumb} alt={item.label} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <span style={{ font: "9px system-ui", color: ink.faint }}>…</span>
        )}
      </div>
      <span style={{ font: "600 9px system-ui", width: "100%", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.label}
      </span>
    </button>
  );
}
