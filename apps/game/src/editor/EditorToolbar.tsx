import { useEditorStore, SPAWN_MONSTERS, SPAWN_NPCS, TRIGGER_KINDS, type Brush } from "./editorStore";
import type { TriggerKind } from "@ragnarok/map-format";
import { propLabel } from "../props/registry";
import { Panel, RpgButton, ink } from "../ui/rpg";

const BRUSHES: { brush: Brush; label: string; color: string }[] = [
  { brush: "grass", label: "Grama", color: "#4ade80" },
  { brush: "water", label: "Água", color: "#38bdf8" },
  { brush: "raise", label: "Subir ▲", color: "#fbbf24" },
  { brush: "lower", label: "Descer ▼", color: "#f87171" },
  { brush: "smooth", label: "Suavizar", color: "#a78bfa" },
  { brush: "flatten", label: "Nivelar", color: "#22d3ee" },
  { brush: "noise", label: "Ruído", color: "#f472b6" },
];
const ROT_STEP = Math.PI / 12; // 15° por clique (giro horizontal, eixo Y)

/**
 * Barra de ferramentas do editor hex: Novo mapa, pincéis de terreno
 * (grama/água/subir/descer), modo do gizmo dos props, deletar, contador e
 * salvar. O salvar é delegado ao EditorView.
 */
export function EditorToolbar({ onSave, saving, status }: { onSave: () => void; saving: boolean; status: string }) {
  const tool = useEditorStore((s) => s.tool);
  const brush = useEditorStore((s) => s.brush);
  const setBrush = useEditorStore((s) => s.setBrush);
  const currentAsset = useEditorStore((s) => s.currentAsset);
  const setAsset = useEditorStore((s) => s.setAsset);
  const selectTool = useEditorStore((s) => s.selectTool);
  const rotateSelected = useEditorStore((s) => s.rotateSelected);
  const scaleSelected = useEditorStore((s) => s.scaleSelected);
  const selected = useEditorStore((s) => s.selected);
  const selectedSpawn = useEditorStore((s) => s.selectedSpawn);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const copySelected = useEditorStore((s) => s.copySelected);
  const paste = useEditorStore((s) => s.paste);
  const requestFocus = useEditorStore((s) => s.requestFocus);
  const hasClipboard = useEditorStore((s) => s.clipboard != null);
  const showProcedural = useEditorStore((s) => s.showProcedural);
  const toggleProcedural = useEditorStore((s) => s.toggleProcedural);
  const snap = useEditorStore((s) => s.snap);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const setTool = useEditorStore((s) => s.setTool);
  const clearMeasure = useEditorStore((s) => s.clearMeasure);
  const showScene = useEditorStore((s) => s.showScene);
  const toggleScene = useEditorStore((s) => s.toggleScene);
  const showPrefabs = useEditorStore((s) => s.showPrefabs);
  const togglePrefabs = useEditorStore((s) => s.togglePrefabs);
  const triggerKind = useEditorStore((s) => s.triggerKind);
  const setTriggerKind = useEditorStore((s) => s.setTriggerKind);
  const triggerCount = useEditorStore((s) => s.map?.triggers?.length ?? 0);
  const hasSel = selected != null || selectedSpawn != null;
  const newMap = useEditorStore((s) => s.newMap);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const mapId = useEditorStore((s) => s.map?.id);
  const requestView = useEditorStore((s) => s.requestView);
  const count = useEditorStore((s) => s.map?.props.length ?? 0);
  const dirty = useEditorStore((s) => s.dirty);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const hover = useEditorStore((s) => s.hover);
  const spawnKind = useEditorStore((s) => s.spawnKind);
  const setSpawnKind = useEditorStore((s) => s.setSpawnKind);
  const monsterKey = useEditorStore((s) => s.monsterKey);
  const setMonsterKey = useEditorStore((s) => s.setMonsterKey);
  const spawnCount = useEditorStore((s) => s.spawnCount);
  const setSpawnCount = useEditorStore((s) => s.setSpawnCount);
  const spawnRadius = useEditorStore((s) => s.spawnRadius);
  const setSpawnRadius = useEditorStore((s) => s.setSpawnRadius);
  const propPaint = useEditorStore((s) => s.propPaint);
  const setPropPaint = useEditorStore((s) => s.setPropPaint);
  const propDensity = useEditorStore((s) => s.propDensity);
  const setPropDensity = useEditorStore((s) => s.setPropDensity);

  // Play: joga o mapa ATUAL em memória (reflete edições não salvas, inclusive
  // mapa novo sem id no banco). Passa via sessionStorage → /play?preview=1.
  const playCurrent = () => {
    const m = useEditorStore.getState().map;
    if (!m) return;
    try { sessionStorage.setItem("ragnarok.play.preview", JSON.stringify(m)); } catch { /* quota */ }
    window.open("/play?preview=1", "_blank");
  };

  return (
    <Panel style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ font: "700 13px system-ui", color: ink.text }}>Editor de mapa</span>
      <RpgButton color="grey" onClick={() => { if (confirm("Novo mapa em branco? Alterações não salvas serão perdidas.")) newMap(); }}>
        + Novo
      </RpgButton>
      <RpgButton color="grey" onClick={undo} style={{ opacity: canUndo ? 1 : 0.4 }}>↶ Undo</RpgButton>
      <RpgButton color="grey" onClick={redo} style={{ opacity: canRedo ? 1 : 0.4 }}>↷ Redo</RpgButton>
      <RpgButton color="blue" onClick={playCurrent}>▶ Play</RpgButton>
      <span style={{ width: 1, height: 20, background: ink.border }} />
      {/* visões de câmera */}
      <span style={{ font: "11px system-ui", color: ink.dim }}>Visão</span>
      <RpgButton color="grey" onClick={() => requestView("top")} style={{ padding: "0 7px" }}>Topo</RpgButton>
      <RpgButton color="grey" onClick={() => requestView("front")} style={{ padding: "0 7px" }}>Frente</RpgButton>
      <RpgButton color="grey" onClick={() => requestView("side")} style={{ padding: "0 7px" }}>Lado</RpgButton>
      <RpgButton color="grey" onClick={() => requestView("reset")} style={{ padding: "0 7px" }}>⟲</RpgButton>
      <span style={{ width: 1, height: 20, background: ink.border }} />


      {/* pincéis de terreno */}
      <span style={{ font: "11px system-ui", color: ink.dim }}>Terreno:</span>
      {BRUSHES.map((b) => (
        <RpgButton
          key={b.brush}
          color="grey"
          active={tool === "brush" && brush === b.brush}
          onClick={() => setBrush(b.brush)}
          style={{ borderColor: tool === "brush" && brush === b.brush ? b.color : undefined }}
        >
          {b.label}
        </RpgButton>
      ))}
      {/* tamanho do pincel */}
      <span style={{ font: "11px system-ui", color: ink.dim }}>Pincel {brushSize}</span>
      <input
        type="range"
        min={0}
        max={5}
        value={brushSize}
        onChange={(e) => setBrushSize(Number(e.target.value))}
        style={{ width: 70 }}
      />

      <span style={{ width: 1, height: 20, background: ink.border }} />
      {/* decoração ativa + pincel de vegetação */}
      {tool === "place" && currentAsset ? (
        <>
          <RpgButton color="grey" onClick={() => setAsset(null)}>✕ {propLabel(currentAsset)}</RpgButton>
          <RpgButton color="blue" active={propPaint} onClick={() => setPropPaint(!propPaint)}>
            Pincel
          </RpgButton>
          {propPaint && (
            <>
              <span style={{ font: "11px system-ui", color: ink.dim }}>Densidade {propDensity}</span>
              <input type="range" min={1} max={10} value={propDensity} onChange={(e) => setPropDensity(Number(e.target.value))} style={{ width: 60 }} />
            </>
          )}
        </>
      ) : (
        <span style={{ font: "11px system-ui", color: ink.faint }}>ou pegue uma decoração na paleta →</span>
      )}

      <span style={{ width: 1, height: 20, background: ink.border }} />
      {/* spawns: player / monstro (+ tipo, quantidade, raio) */}
      <span style={{ font: "11px system-ui", color: ink.dim }}>Spawn:</span>
      <RpgButton color="grey" active={tool === "spawn" && spawnKind === "player"} onClick={() => setSpawnKind("player")}>
        Player
      </RpgButton>
      <RpgButton color="grey" active={tool === "spawn" && spawnKind === "mob"} onClick={() => setSpawnKind("mob")}>
        Monstro
      </RpgButton>
      <RpgButton color="grey" active={tool === "spawn" && spawnKind === "npc"} onClick={() => setSpawnKind("npc")}>
        NPC
      </RpgButton>
      {tool === "spawn" && spawnKind === "mob" && (
        <>
          <select
            value={monsterKey}
            onChange={(e) => setMonsterKey(e.target.value)}
            style={{ padding: "3px 5px", borderRadius: 5, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.text, font: "11px system-ui" }}
          >
            {SPAWN_MONSTERS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <span style={{ font: "11px system-ui", color: ink.dim }}>Qtd {spawnCount}</span>
          <input type="range" min={1} max={20} value={spawnCount} onChange={(e) => setSpawnCount(Number(e.target.value))} style={{ width: 60 }} />
          <span style={{ font: "11px system-ui", color: ink.dim }}>Raio {spawnRadius}</span>
          <input type="range" min={0} max={30} value={spawnRadius} onChange={(e) => setSpawnRadius(Number(e.target.value))} style={{ width: 60 }} />
        </>
      )}
      {tool === "spawn" && spawnKind === "npc" && (
        <select
          value={monsterKey}
          onChange={(e) => setMonsterKey(e.target.value)}
          style={{ padding: "3px 5px", borderRadius: 5, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.text, font: "11px system-ui" }}
        >
          {SPAWN_NPCS.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
      )}

      <span style={{ width: 1, height: 20, background: ink.border }} />
      {/* Selecionar (mover = arrastar) · Girar ◄► (horizontal) · Escalar ▲▼ (+1/-1) */}
      <RpgButton color="blue" active={tool === "select"} onClick={selectTool}>Selecionar</RpgButton>
      <span style={{ font: "11px system-ui", color: ink.dim }}>Girar</span>
      <RpgButton color="grey" onClick={() => rotateSelected(-ROT_STEP)} style={{ opacity: selected == null ? 0.4 : 1, padding: "0 8px" }}>◄</RpgButton>
      <RpgButton color="grey" onClick={() => rotateSelected(ROT_STEP)} style={{ opacity: selected == null ? 0.4 : 1, padding: "0 8px" }}>►</RpgButton>
      <span style={{ font: "11px system-ui", color: ink.dim }}>Escalar</span>
      <RpgButton color="grey" onClick={() => scaleSelected(1)} style={{ opacity: selected == null ? 0.4 : 1, padding: "0 8px" }}>▲</RpgButton>
      <RpgButton color="grey" onClick={() => scaleSelected(-1)} style={{ opacity: selected == null ? 0.4 : 1, padding: "0 8px" }}>▼</RpgButton>
      <RpgButton color="grey" onClick={duplicateSelected} style={{ opacity: hasSel ? 1 : 0.4 }}>Duplicar</RpgButton>
      <RpgButton color="grey" onClick={copySelected} style={{ opacity: hasSel ? 1 : 0.4 }}>Copiar</RpgButton>
      <RpgButton color="grey" onClick={paste} style={{ opacity: hasClipboard ? 1 : 0.4 }}>Colar</RpgButton>
      <RpgButton color="grey" onClick={requestFocus} style={{ opacity: hasSel ? 1 : 0.4 }}>Focar</RpgButton>
      <RpgButton color="grey" onClick={deleteSelected} style={{ opacity: hasSel ? 1 : 0.5 }}>
        Deletar
      </RpgButton>
      <RpgButton color="blue" active={showProcedural} onClick={toggleProcedural}>Gerar</RpgButton>
      <span style={{ width: 1, height: 20, background: ink.border }} />
      <RpgButton color="grey" active={snap} onClick={toggleSnap}>⊞ Snap</RpgButton>
      <RpgButton color="grey" active={tool === "measure"} onClick={() => { clearMeasure(); setTool("measure"); }}>Medir</RpgButton>
      <RpgButton color="blue" active={showScene} onClick={toggleScene}>Cena</RpgButton>
      <RpgButton color="blue" active={showPrefabs} onClick={togglePrefabs}>Prefabs</RpgButton>
      <span style={{ width: 1, height: 20, background: ink.border }} />
      {/* gatilhos de área: escolhe o tipo e entra no modo desenhar (arrastar) */}
      <RpgButton color="grey" active={tool === "area"} onClick={() => setTriggerKind(triggerKind)}>▧ Área</RpgButton>
      <select
        value={triggerKind}
        onChange={(e) => setTriggerKind(e.target.value as TriggerKind)}
        style={{ background: ink.slot, border: `1px solid ${ink.border}`, borderRadius: 6, color: ink.text, font: "12px system-ui", padding: "4px 6px" }}
      >
        {TRIGGER_KINDS.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
      </select>

      <span style={{ marginLeft: "auto", font: "12px system-ui", color: ink.dim }}>
        {hover ? `hex ${hover.col},${hover.row} · alt ${hover.level} · ` : ""}
        {count} props{triggerCount ? ` · ${triggerCount} gatilhos` : ""}{dirty ? " · não salvo" : ""} {status && `· ${status}`}
      </span>
      <RpgButton color="blue" active onClick={onSave}>
        {saving ? "Salvando…" : "Salvar"}
      </RpgButton>
    </Panel>
  );
}
