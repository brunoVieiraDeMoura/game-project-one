import { useState } from "react";
import { useEditorStore } from "./editorStore";
import { Panel, RpgButton, ink } from "../ui/rpg";

/**
 * Painel Prefabs: agrupa a seleção atual (lote ou 1 prop) num prefab reutilizável
 * (persiste no localStorage, compartilhado entre mapas). Armar um prefab entra no
 * modo "carimbar": cada clique no terreno estampa o grupo inteiro no hex.
 */
export function PrefabPanel({ embedded }: { embedded?: boolean } = {}) {
  const prefabs = useEditorStore((s) => s.prefabs);
  const currentPrefab = useEditorStore((s) => s.currentPrefab);
  const savePrefab = useEditorStore((s) => s.savePrefab);
  const deletePrefab = useEditorStore((s) => s.deletePrefab);
  const armPrefab = useEditorStore((s) => s.armPrefab);
  const close = useEditorStore((s) => s.togglePrefabs);
  const selCount = useEditorStore((s) => (s.multi.length > 1 ? s.multi.length : s.selected != null ? 1 : 0));
  const [name, setName] = useState("");

  const onSave = () => {
    if (selCount === 0) return;
    savePrefab(name);
    setName("");
  };

  const body = (
    <>
      {/* salvar seleção */}
      <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 6 }}>
        {selCount > 0 ? `${selCount} objeto${selCount > 1 ? "s" : ""} selecionado${selCount > 1 ? "s" : ""}` : "Selecione props (Shift+clique) pra criar"}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
          placeholder="nome do prefab"
          disabled={selCount === 0}
          style={{ flex: 1, minWidth: 0, background: ink.slot, border: `1px solid ${ink.border}`, borderRadius: 6, color: ink.text, font: "12px system-ui", padding: "5px 8px" }}
        />
        <RpgButton color="blue" onClick={onSave}>Salvar</RpgButton>
      </div>

      <div style={{ height: 1, background: ink.border, margin: "0 0 8px" }} />
      <div style={{ font: "700 11px system-ui", color: ink.text, marginBottom: 6 }}>Catálogo ({prefabs.length})</div>

      {prefabs.length === 0 && <div style={{ font: "11px system-ui", color: ink.faint }}>Nenhum prefab ainda.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
        {prefabs.map((pf) => {
          const armed = currentPrefab === pf.id;
          return (
            <div key={pf.id} style={{ display: "flex", alignItems: "center", gap: 6, background: armed ? "rgba(79,70,229,0.18)" : ink.slot, border: `1px solid ${armed ? "#4f46e5" : ink.border}`, borderRadius: 6, padding: "5px 6px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "600 12px system-ui", color: ink.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pf.name}</div>
                <div style={{ font: "10px system-ui", color: ink.faint }}>{pf.items.length} props</div>
              </div>
              <RpgButton color={armed ? "blue" : "grey"} active={armed} onClick={() => armPrefab(armed ? null : pf.id)}>{armed ? "Carimbando…" : "Colocar"}</RpgButton>
              <RpgButton color="grey" onClick={() => deletePrefab(pf.id)}>🗑</RpgButton>
            </div>
          );
        })}
      </div>

      {currentPrefab && <p style={{ font: "10px system-ui", color: ink.dim, marginTop: 8 }}>Clique no terreno pra carimbar. Clique "Carimbando…" pra desarmar.</p>}
    </>
  );

  if (embedded) return body;
  return (
    <Panel style={{ width: 240 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <div style={{ font: "700 13px system-ui", color: ink.text }}>Prefabs</div>
        <div style={{ marginLeft: "auto" }}><RpgButton color="grey" onClick={close}>✕</RpgButton></div>
      </div>
      {body}
    </Panel>
  );
}
