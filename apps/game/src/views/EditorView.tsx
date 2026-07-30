import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState, useCallback } from "react";
import type { GameMap } from "@ragnarok/map-format";
import { useMap } from "../map/useMap";
import { useEditorStore } from "../editor/editorStore";
import { EditorScene } from "../editor/EditorScene";
import { TopBar } from "../editor/TopBar";
import { ToolRail } from "../editor/ToolRail";
import { ToolOptions } from "../editor/ToolOptions";
import { RightDock } from "../editor/RightDock";
import { saveDraft } from "../editor/draftStorage";
import { buildHexDemo } from "../hex/hexPrefab";
import { getHexScale, clampHexScale } from "../hex/hexGrid";
import { scaleMapPositions } from "../hex/mapScale";
import { useGameplayConfig } from "../play/useGameplayConfig";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const params = new URLSearchParams(window.location.search);
const MAP_ID = params.get("map");
const NEW_MAP = params.get("new") === "1" || !MAP_ID;
// prefab: abre o mapa de demo em código (não existe no banco ainda) pra editar
// e salvar (o admin faz create-ou-update)
const IS_PREFAB = MAP_ID === "hexdemo";

/**
 * Editor de mapas 3D hexagonal (substitui o /maps 2D do admin). Carrega um
 * GameMap existente ou começa um novo em branco; edita terreno hex (pincéis de
 * grama/água/altura) e decorações (props com gizmo). Salvamento: embutido no
 * admin (iframe) delega ao pai autenticado via postMessage; standalone tenta
 * PUT direto (precisa de auth).
 */
export function EditorView() {
  // busca do banco (inclusive hexdemo): se existir usa a versão salva, senão
  // (404) cai pro prefab. Assim editar+salvar hexdemo passa a refletir de fato.
  const { map, error } = useMap(NEW_MAP ? "" : MAP_ID!);
  const storeMap = useEditorStore((s) => s.map);
  const init = useEditorStore((s) => s.init);
  const newMap = useEditorStore((s) => s.newMap);
  const markSaved = useEditorStore((s) => s.markSaved);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (NEW_MAP) newMap();
  }, [newMap]);
  // O EDITOR desenha no hexScale atual (EditorScene faz setHexScale), mas as
  // posições salvas estão na escala em que o mapa foi AUTORADO. Sem converter,
  // um mapa autorado em escala 1 aberto em escala 10 tem o terreno 10× maior e
  // os props amontoados perto da origem — e o /play, que converte, mostrava as
  // árvores em outro lugar do que o editor. Os dois passam pela MESMA função.
  const hexScale = clampHexScale(useGameplayConfig().hexScale);
  const naEscalaAtual = useCallback(
    // Só o mundo hexagonal tem escala variável: a grade quadrada dos mapas do
    // rAthena mede 2 unidades por célula, fixo (grid/squareGrid.ts). Reescalar
    // um mapa desses só moveria props e spawns para longe do lugar.
    (m: GameMap) => (m.terrainMode === "blocks" ? scaleMapPositions(m, hexScale) : m),
    [hexScale],
  );

  useEffect(() => {
    if (NEW_MAP) return;
    if (IS_PREFAB) {
      // hexdemo: usa a versão do banco SÓ se salva corretamente como "blocks";
      // senão (smooth/stale/404) cai pro prefab — evita carregar versão quebrada
      if (map) init(naEscalaAtual(map.terrainMode === "blocks" ? map : buildHexDemo()));
      else if (error) init(naEscalaAtual(buildHexDemo()));
    } else if (map) {
      init(naEscalaAtual(map));
    }
  }, [map, error, init, naEscalaAtual]);

  // Projeto novo começa em branco: NÃO regenera procedural nem restaura ajustes
  // salvos (regra do usuário — geradores começam desmarcados). Mapas do banco já
  // trazem seus props salvos.

  // AUTO-SAVE: a cada 12s, se houver alterações não salvas, grava um rascunho no
  // localStorage (por id de mapa). Se cair/F5, dá pra restaurar o rascunho.
  //
  // O rascunho de um mapa hex passa de 1 MB, e o localStorage inteiro tem ~5 MB
  // para o domínio: sem poda, os rascunhos velhos entupiam a cota e QUEBRAVAM
  // qualquer outra coisa persistida — foi assim que a barra de habilidades do
  // JOGO parou de guardar os slots (QuotaExceededError vindo do editor).
  const [autoAt, setAutoAt] = useState("");
  const [draft, setDraft] = useState<{ ts: number } | null>(null);
  const draftKey = `ragnarok.editor.draft.${storeMap?.id ?? "novo"}`;
  useEffect(() => {
    const t = setInterval(() => {
      const s = useEditorStore.getState();
      if (!s.dirty || !s.map) return;
      if (saveDraft(s.map)) setAutoAt(new Date().toLocaleTimeString("pt-BR"));
    }, 12000);
    return () => clearInterval(t);
  }, []);
  // ao carregar um mapa, verifica se há rascunho mais recente pra oferecer
  useEffect(() => {
    if (!storeMap) return;
    try {
      const raw = localStorage.getItem(`ragnarok.editor.draft.${storeMap.id}`);
      setDraft(raw ? { ts: JSON.parse(raw).ts } : null);
    } catch { setDraft(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeMap?.id]);
  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) init(JSON.parse(raw).map);
      setDraft(null);
    } catch { /* noop */ }
  };

  // teclas: Espaço = mover câmera (segura), Ctrl+Z/Y undo/redo, Delete remove
  // prop, G/R/S gizmo, Esc deseleciona
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const s = useEditorStore.getState();
      if (e.code === "Space") {
        e.preventDefault();
        if (!s.camMove) s.setCamMove(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        s.duplicateSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        s.copySelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        s.paste();
      } else if (e.key === "f" || e.key === "F") {
        s.requestFocus();
      } else if (e.key === "Delete" || e.key === "Backspace") s.deleteSelected();
      else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // move o selecionado 1 hex por tecla, relativo à câmera; segurar =
        // repete (o navegador já auto-repete o keydown). 1 undo por "segurada"
        // inteira: beginStroke só na 1ª (e.repeat=false), não em cada repique.
        if (s.selected == null && s.selectedSpawn == null) return;
        e.preventDefault();
        if (!e.repeat) s.beginStroke();
        const dir = e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "ArrowLeft" ? "left" : "right";
        s.nudgeSelected(dir);
      } else if (e.key === "Escape") {
        s.select(null);
        s.setAsset(null);
        s.armPrefab(null); // sai do modo carimbar prefab
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // atalhos de ferramenta (mesmas letras da ToolRail)
        const k = e.key.toLowerCase();
        if (k === "v") s.selectTool();
        else if (k === "b") s.setBrush(s.brush);
        else if (k === "p") s.setTool("place");
        else if (k === "s") s.setSpawnKind(s.spawnKind);
        else if (k === "a") s.setTriggerKind(s.triggerKind);
        else if (k === "r") s.editPath();
        else if (k === "m") { s.clearMeasure(); s.setTool("measure"); }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") useEditorStore.getState().setCamMove(false);
    };
    const onBlur = () => useEditorStore.getState().setCamMove(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // resposta do pai (admin) após salvar
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "ragnarok:save-result") {
        setSaving(false);
        if (e.data.ok) {
          markSaved();
          setStatus("salvo ✓");
          // salvou no banco → descarta o rascunho local
          try { const id = useEditorStore.getState().map?.id; if (id) localStorage.removeItem(`ragnarok.editor.draft.${id}`); } catch { /* noop */ }
          setDraft(null);
        } else setStatus(`erro: ${e.data.error ?? "falha ao salvar"}`);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [markSaved]);

  const onSave = useCallback(async () => {
    const cur = useEditorStore.getState().map;
    if (!cur) return;
    // carimba a escala de bloco em que as posições foram autoradas: sem isso,
    // abrir o mapa com outro hexScale espalha o terreno mas deixa props e
    // spawns parados perto da origem (ver hex/mapScale.ts)
    const next: GameMap = { ...cur, authoredHexScale: getHexScale() };
    setSaving(true);
    setStatus("");
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "ragnarok:save-map", id: next.id, map: next, isNew: NEW_MAP || IS_PREFAB }, "*");
      return;
    }
    try {
      const r = await fetch(`${API_URL}/maps/${encodeURIComponent(next.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!r.ok) throw new Error(`${r.status} (login admin necessário)`);
      markSaved();
      setStatus("salvo ✓");
    } catch (err) {
      setStatus(`erro: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [markSaved]);

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "#0b0d12" }} onContextMenu={(e) => e.preventDefault()}>
      {/* barra superior (arquivo + views + salvar) */}
      <TopBar onSave={onSave} saving={saving} status={status || (autoAt ? `auto-salvo ${autoAt}` : "")} />

      {/* corpo: rail esquerda · canvas · dock direita */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <ToolRail />

        {/* área do canvas (preenche o meio); options bar flutua no topo-esquerda */}
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <Canvas camera={{ position: [40, 50, 60], fov: 50, near: 0.5, far: 4000 }} shadows style={{ position: "absolute", inset: 0 }}>
            <Suspense fallback={null}>{storeMap && <EditorScene />}</Suspense>
          </Canvas>

          <div style={{ position: "absolute", top: 10, left: 10, right: 10, display: "flex", justifyContent: "flex-start", pointerEvents: "none" }}>
            <div style={{ pointerEvents: "auto" }}><ToolOptions /></div>
          </div>

          {/* banner de restaurar rascunho (auto-save) */}
          {draft && (
            <div style={{ position: "absolute", top: 64, left: "50%", transform: "translateX(-50%)", background: "rgba(15,17,23,0.95)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 10px", display: "flex", alignItems: "center", gap: 10, font: "12px system-ui", color: "#e6e8ee", zIndex: 5 }}>
              Rascunho auto-salvo às {new Date(draft.ts).toLocaleTimeString("pt-BR")}
              <button onClick={restoreDraft} style={{ background: "#4f46e5", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", font: "600 12px system-ui", padding: "4px 10px" }}>Restaurar</button>
              <button onClick={() => setDraft(null)} style={{ background: "none", border: "none", color: "#9aa0ad", cursor: "pointer", font: "12px system-ui" }}>✕</button>
            </div>
          )}

          {error && !NEW_MAP && !IS_PREFAB && (
            <div style={{ position: "absolute", bottom: 10, left: 10, color: "#f87171", font: "12px monospace" }}>
              erro ao carregar mapa: {error}
            </div>
          )}
        </div>

        {/* dock direito (inspetor · assets · camadas · procedural · prefabs · hierarquia) */}
        <RightDock />
      </div>
    </div>
  );
}
