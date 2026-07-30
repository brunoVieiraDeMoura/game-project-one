import { useState } from "react";
import { PROP_BY_CATEGORY, propUrl, getAssetScale, setAssetScale, catalogScale, type PropCatalogEntry } from "../props/registry";
import { useThumbnail } from "../editor/thumbnailer";
import { ink } from "../ui/rpg";

/**
 * Dimensionamento de Assets (embutido no admin /asset-scaling): cada asset com
 * miniatura + nome + escala default editável. O valor definido vira a escala
 * inicial do asset no editor (override do default do catálogo). Persiste em
 * localStorage (mesmo origin do game/editor).
 */
export function AssetScalingView() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0b0d12", overflow: "auto", padding: 16 }}>
      <div style={{ font: "700 18px system-ui", color: ink.text, marginBottom: 4 }}>Dimensionamento de Assets</div>
      <div style={{ font: "12px system-ui", color: ink.dim, marginBottom: 16 }}>
        Defina a escala inicial (default) de cada asset. No editor, colocar esse asset já vem nessa escala.
      </div>
      {PROP_BY_CATEGORY.map((g) => (
        <div key={g.cat} style={{ marginBottom: 20 }}>
          <div style={{ font: "700 13px system-ui", color: ink.text, marginBottom: 8 }}>{g.label} ({g.items.length})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
            {g.items.map((it) => (
              <AssetScaleCard key={it.id} item={it} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AssetScaleCard({ item }: { item: PropCatalogEntry }) {
  const thumb = useThumbnail(propUrl(item.id));
  const [scale, setScale] = useState(getAssetScale(item.id));
  const apply = (v: number) => {
    const n = Math.max(0.1, Math.min(50, v));
    setScale(n);
    setAssetScale(item.id, n);
  };
  const isCustom = scale !== catalogScale(item.id);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 8, borderRadius: 8, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.04)" }}>
      <div style={{ width: 72, height: 72, borderRadius: 6, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {thumb ? <img src={thumb} alt={item.label} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ color: ink.faint, font: "10px system-ui" }}>…</span>}
      </div>
      <div style={{ font: "600 11px system-ui", color: ink.text, textAlign: "center", width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="number"
          value={scale}
          min={0.1}
          max={50}
          step={0.5}
          onChange={(e) => apply(parseFloat(e.target.value) || 1)}
          style={{ width: 62, padding: "4px 6px", borderRadius: 5, border: `1px solid ${isCustom ? "#4f46e5" : ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.text, font: "12px system-ui", textAlign: "center" }}
        />
        {isCustom && (
          <button
            title="Voltar ao default do catálogo"
            onClick={() => apply(catalogScale(item.id))}
            style={{ background: "none", border: "none", color: ink.faint, cursor: "pointer", font: "12px system-ui" }}
          >
            ⟲
          </button>
        )}
      </div>
    </div>
  );
}
