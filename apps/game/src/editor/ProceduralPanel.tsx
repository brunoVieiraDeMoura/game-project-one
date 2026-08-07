import { useState } from "react";
import { PROP_BY_CATEGORY, SCATTER_CATEGORIES, propUrl, type PropCatalogEntry } from "../props/registry";
import { procKey, useEditorStore } from "./editorStore";
import { useThumbnail } from "./thumbnailer";
import { Panel, RpgButton, ink } from "../ui/rpg";

/**
 * Geração procedural por TIPO: slider de densidade + ♻ + um dropdown com as
 * espécies (miniaturas) que dá pra ligar/desligar por asset. A geração usa só
 * os assets ativos. Slider %, seleção e ativação persistem no F5 (localStorage).
 */
export function ProceduralPanel({ embedded }: { embedded?: boolean } = {}) {
  const amounts = useEditorStore((s) => s.procAmounts);
  // Cada escopo da barra de cima é uma CAMADA: gerar vegetação "dentro" não
  // mexe na que foi gerada na "borda" nem no "buraco".
  const escopo = useEditorStore((s) => s.editScope);
  const jitterScale = useEditorStore((s) => s.procJitterScale);
  const jitterRot = useEditorStore((s) => s.procJitterRot);
  const setCategoryAmount = useEditorStore((s) => s.setCategoryAmount);
  const reseedCategory = useEditorStore((s) => s.reseedCategory);
  const setProcJitter = useEditorStore((s) => s.setProcJitter);
  const beginStroke = useEditorStore((s) => s.beginStroke);
  const clearProps = useEditorStore((s) => s.clearProps);
  const close = useEditorStore((s) => s.toggleProcedural);
  const mapW = useEditorStore((s) => s.map?.size.width ?? 32);
  const mapH = useEditorStore((s) => s.map?.size.height ?? 32);
  const cellSize = useEditorStore((s) => s.map?.cellSize ?? 5);
  const props = useEditorStore((s) => s.map?.props ?? []);
  const spawns = useEditorStore((s) => s.map?.spawns ?? []);
  const resizeMap = useEditorStore((s) => s.resizeMap);
  // resizeMap preserva o canto superior-esquerdo mas NÃO remove props/spawns
  // fora da nova borda — eles ficam com posição de mundo válida só que fora do
  // chão. Encolher sem avisar é perder objeto e achar que sumiu sozinho.
  const foraAoEncolher = (w: number, h: number) => {
    const limX = w * cellSize;
    const limZ = h * cellSize;
    const foraP = props.filter((p) => p.position[0] >= limX || p.position[2] >= limZ).length;
    const foraS = spawns.filter((sp) => sp.position[0] >= limX || sp.position[2] >= limZ).length;
    return foraP + foraS;
  };
  const [openCat, setOpenCat] = useState<string | null>(null);
  // só as categorias espalháveis (estradas/rios/costa/rampas são manuais)
  const scatterGroups = PROP_BY_CATEGORY.filter((g) => SCATTER_CATEGORIES.includes(g.cat));

  const body = (
    <>
      {/* tamanho do mapa (grade em células) */}
      <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${ink.border}` }}>
        <div style={{ font: "700 11px system-ui", color: ink.dim, marginBottom: 4 }}>Tamanho do mapa: {mapW} × {mapH}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ font: "10px system-ui", color: ink.faint, width: 14 }}>L</span>
          <input type="range" aria-label="Largura do mapa" min={8} max={500} value={mapW} onPointerDown={() => beginStroke()} onChange={(e) => resizeMap(Number(e.target.value), mapH)} style={{ flex: 1 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ font: "10px system-ui", color: ink.faint, width: 14 }}>A</span>
          <input type="range" aria-label="Altura do mapa" min={8} max={500} value={mapH} onPointerDown={() => beginStroke()} onChange={(e) => resizeMap(mapW, Number(e.target.value))} style={{ flex: 1 }} />
        </div>
        {mapW * mapH > 40000 && (
          <div style={{ font: "10px system-ui", color: "#fbbf24", marginTop: 4 }}>⚠ {mapW}×{mapH} = {(mapW * mapH).toLocaleString("pt-BR")} células — mapas grandes pesam no render.</div>
        )}
        {(() => {
          const fora = foraAoEncolher(mapW, mapH);
          return fora > 0 ? (
            <div style={{ font: "10px system-ui", color: "#f87171", marginTop: 4 }}>
              ⚠ {fora} prop{fora !== 1 ? "s" : ""}/spawn{fora !== 1 ? "s" : ""} fora da grade atual — encolher não apaga, mas o Salvar vai gravar assim mesmo.
            </div>
          ) : null;
        })()}
      </div>

      <div style={{ font: "10px system-ui", color: ink.dim, marginBottom: 8 }}>
        Camada:{" "}
        <b style={{ color: ink.text }}>
          {escopo === "inside" ? "dentro do mapa" : escopo === "border" ? "borda" : escopo === "hole" ? "buraco" : "tudo"}
        </b>{" "}
        — cada parte guarda sua própria quantidade, seed e espécies.
      </div>

      {scatterGroups.map((g) => {
        const amt = amounts[procKey(escopo, g.cat)] ?? 0;
        const open = openCat === g.cat;
        return (
          <div key={g.cat} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenCat(open ? null : g.cat)}
                style={{ background: "none", border: "none", color: ink.text, cursor: "pointer", font: "600 11px system-ui", padding: 0 }}
              >
                {open ? "▾" : "▸"} {g.label}
              </button>
              <span style={{ font: "10px system-ui", color: ink.faint }}>{amt}%</span>
              <button
                type="button"
                title={`Re-randomizar ${g.label}`}
                aria-label={`Re-randomizar ${g.label}`}
                onClick={() => { beginStroke(); reseedCategory(g.cat); }}
                style={{ marginLeft: "auto", background: "rgba(255,255,255,0.06)", border: `1px solid ${ink.border}`, borderRadius: 6, color: ink.text, cursor: "pointer", font: "12px system-ui", padding: "1px 7px" }}
              >
                ♻
              </button>
            </div>
            <input
              type="range"
              aria-label={`Densidade de ${g.label}`}
              min={0}
              max={100}
              value={amt}
              onPointerDown={() => beginStroke()}
              onChange={(e) => setCategoryAmount(g.cat, Number(e.target.value))}
              style={{ width: "100%" }}
            />
            {open && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 4, padding: 4, background: "rgba(0,0,0,0.2)", borderRadius: 6 }}>
                {g.items.map((it) => (
                  <SpeciesToggle key={it.id} category={g.cat} item={it} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ height: 1, background: ink.border, margin: "4px 0 10px" }} />
      <label style={{ display: "flex", alignItems: "center", gap: 6, font: "12px system-ui", color: ink.text, marginBottom: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={jitterScale} onChange={(e) => { beginStroke(); setProcJitter({ scale: e.target.checked }); }} /> Escala aleatória
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, font: "12px system-ui", color: ink.text, marginBottom: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={jitterRot} onChange={(e) => { beginStroke(); setProcJitter({ rot: e.target.checked }); }} /> Rotação aleatória
      </label>

      <RpgButton color="grey" onClick={() => { if (confirm("Remover TODAS as decorações (inclusive manuais)?")) clearProps(); }} style={{ width: "100%" }}>
        Limpar tudo
      </RpgButton>
    </>
  );

  if (embedded) return <div style={{ maxHeight: "48vh", overflow: "auto" }}>{body}</div>;
  return (
    <Panel style={{ width: 270, maxHeight: "82vh", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <div style={{ font: "700 13px system-ui", color: ink.text }}>Geração procedural</div>
        <div style={{ marginLeft: "auto" }}>
          <RpgButton color="grey" title="Fechar" onClick={close}>✕</RpgButton>
        </div>
      </div>
      {body}
    </Panel>
  );
}

/** miniatura + toggle de 1 espécie (ativa = entra na geração daquele tipo) */
function SpeciesToggle({ category, item }: { category: string; item: PropCatalogEntry }) {
  const disabled = useEditorStore((s) => {
    const daCamada = s.procDisabled[procKey(s.editScope, category)];
    // camada nova cai na configuração antiga (sem escopo) até ser tocada
    return (daCamada ?? s.procDisabled[category])?.includes(item.id) ?? false;
  });
  const toggle = useEditorStore((s) => s.toggleSpecies);
  const beginStroke = useEditorStore((s) => s.beginStroke);
  const thumb = useThumbnail(propUrl(item.id));
  return (
    <button
      type="button"
      title={item.label}
      aria-pressed={!disabled}
      onClick={() => { beginStroke(); toggle(category, item.id); }}
      style={{
        position: "relative",
        aspectRatio: "1",
        borderRadius: 5,
        border: `1px solid ${disabled ? ink.border : "#4f46e5"}`,
        background: disabled ? "rgba(255,255,255,0.03)" : "rgba(79,70,229,0.18)",
        cursor: "pointer",
        opacity: disabled ? 0.45 : 1,
        overflow: "hidden",
        padding: 2,
      }}
    >
      {thumb ? <img src={thumb} alt={item.label} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ font: "8px system-ui", color: ink.faint }}>…</span>}
      {!disabled && (
        <span style={{ position: "absolute", top: 1, right: 2, font: "9px system-ui", color: "#a5f3c9" }}>✓</span>
      )}
    </button>
  );
}
