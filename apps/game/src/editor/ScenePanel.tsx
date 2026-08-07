import { useEditorStore, LAYERS, type LayerId } from "./editorStore";
import { useGameplayConfig } from "../play/useGameplayConfig";
import { Panel, RpgButton, ink } from "../ui/rpg";

/**
 * Painel Cena: iluminação (sol azimute/elevação/intensidade + ambiente) e
 * camadas (mostrar/ocultar terreno/vegetação/rochas/spawns no editor).
 */
export function ScenePanel({ embedded }: { embedded?: boolean } = {}) {
  const lighting = useEditorStore((s) => s.lighting);
  const setLighting = useEditorStore((s) => s.setLighting);
  const hiddenLayers = useEditorStore((s) => s.hiddenLayers);
  const toggleLayer = useEditorStore((s) => s.toggleLayer);
  const close = useEditorStore((s) => s.toggleScene);

  const slider = (label: string, val: number, min: number, max: number, step: number, on: (n: number) => void) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 2 }}>{label}: {val}</div>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={val} onChange={(e) => on(Number(e.target.value))} style={{ width: "100%" }} />
    </div>
  );

  const body = (
    <>
      <div style={{ font: "700 11px system-ui", color: ink.dim, marginBottom: 6 }}>Iluminação</div>
      {slider("Sol — direção", lighting.sunAzimuth, 0, 360, 1, (n) => setLighting({ sunAzimuth: n }))}
      {slider("Sol — altura", lighting.sunElevation, 5, 90, 1, (n) => setLighting({ sunElevation: n }))}
      {slider("Sol — intensidade", lighting.sunIntensity, 0, 3, 0.1, (n) => setLighting({ sunIntensity: n }))}
      {slider("Ambiente", lighting.ambient, 0, 2, 0.05, (n) => setLighting({ ambient: n }))}

      <div style={{ height: 1, background: ink.border, margin: "8px 0" }} />
      <GroundPreview />

      <div style={{ height: 1, background: ink.border, margin: "8px 0" }} />
      <RetroPreviewToggle />

      <div style={{ height: 1, background: ink.border, margin: "8px 0" }} />
      <div style={{ font: "700 11px system-ui", color: ink.dim, marginBottom: 6 }}>Camadas</div>
      {LAYERS.map((l) => {
        const hidden = hiddenLayers.includes(l.id as LayerId);
        return (
          <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, font: "12px system-ui", color: ink.text, marginBottom: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={!hidden} onChange={() => toggleLayer(l.id as LayerId)} /> {l.label}
          </label>
        );
      })}
    </>
  );

  if (embedded) return body;
  return (
    <Panel style={{ width: 230 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <div style={{ font: "700 13px system-ui", color: ink.text }}>Cena</div>
        <div style={{ marginLeft: "auto" }}><RpgButton color="grey" title="Fechar" onClick={close}>✕</RpgButton></div>
      </div>
      {body}
    </Panel>
  );
}

/**
 * Prévia do filtro retrô (16 bits) no editor. Desligada por padrão: com a
 * pixelização é difícil posicionar asset com precisão — serve pra conferir como
 * o mapa fica no visual final do /play. Os parâmetros (tamanho do pixel, cores,
 * dither) são os salvos em /game-editor; aqui só liga/desliga.
 */
function RetroPreviewToggle() {
  const gameplay = useGameplayConfig();
  const on = useEditorStore((s) => s.retroPreview);
  const toggle = useEditorStore((s) => s.toggleRetroPreview);
  const modo = gameplay.retroMode === "off" ? "16bit (padrão da prévia)" : gameplay.retroMode;
  return (
    <>
      <div style={{ font: "700 11px system-ui", color: ink.dim, marginBottom: 6 }}>Filtro retrô</div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, font: "12px system-ui", color: ink.text, cursor: "pointer" }}>
        <input type="checkbox" checked={on} onChange={toggle} /> Prévia 16 bits
      </label>
      <p style={{ font: "9px system-ui", color: ink.faint, margin: "4px 0 0" }}>
        {on ? `modo: ${modo} · pixel ${gameplay.retroPixelSize}` : "só visual — ajuste em admin → Editor do game"}
      </p>
    </>
  );
}

/**
 * Chão (grama): troca entre o visual original do KayKit, cor chapada e textura
 * procedural — AO VIVO, sem salvar. É preview local do editor (store), pra
 * comparar os três antes de gravar o escolhido no /game-editor, que é o valor
 * que o /play usa. "Voltar ao salvo" descarta o preview.
 */
function GroundPreview() {
  const gameplay = useGameplayConfig();
  const preview = useEditorStore((s) => s.groundPreview);
  const setPreview = useEditorStore((s) => s.setGroundPreview);
  const cur = { ...gameplay, ...(preview ?? {}) };
  const MODES = [
    { id: "atlas", label: "Original" },
    { id: "color", label: "Cor" },
    { id: "texture", label: "Textura" },
  ] as const;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ font: "700 11px system-ui", color: ink.dim }}>Chão (grama)</span>
        {preview && <span style={{ font: "9px system-ui", color: "#fbbf24" }}>preview</span>}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {MODES.map((m) => {
          const on = cur.groundMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              onClick={() => setPreview({ groundMode: m.id })}
              style={{
                flex: 1,
                padding: "4px 0",
                borderRadius: 6,
                border: `1px solid ${on ? "#4f46e5" : ink.border}`,
                background: on ? "#4f46e5" : "rgba(255,255,255,0.05)",
                color: on ? "#fff" : ink.text,
                font: "600 10px system-ui",
                cursor: "pointer",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {cur.groundMode !== "atlas" && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, font: "11px system-ui", color: ink.text }}>
            <input
              type="color"
              value={cur.groundColor}
              onChange={(e) => setPreview({ groundColor: e.target.value })}
              style={{ width: 34, height: 22, background: "none", border: `1px solid ${ink.border}`, borderRadius: 4, padding: 0, cursor: "pointer" }}
            />
            Cor da grama
          </label>
          {cur.groundMode === "texture" && (
            <>
              <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 2 }}>Tamanho do padrão: {cur.groundTextureScale}</div>
              <input
                type="range"
                min={0.5}
                max={12}
                step={0.5}
                value={cur.groundTextureScale}
                onChange={(e) => setPreview({ groundTextureScale: Number(e.target.value) })}
                style={{ width: "100%", marginBottom: 6 }}
              />
              <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 2 }}>Intensidade: {cur.groundTextureStrength}</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={cur.groundTextureStrength}
                onChange={(e) => setPreview({ groundTextureStrength: Number(e.target.value) })}
                style={{ width: "100%", marginBottom: 6 }}
              />
            </>
          )}
        </>
      )}
      {preview && (
        <>
          <RpgButton color="grey" onClick={() => setPreview(null)} style={{ width: "100%" }}>
            Voltar ao salvo
          </RpgButton>
          <p style={{ font: "9px system-ui", color: ink.faint, margin: "6px 0 0" }}>
            Preview local. Pra valer no /play, grave em <b>admin → Editor do game</b>.
          </p>
        </>
      )}
    </>
  );
}
