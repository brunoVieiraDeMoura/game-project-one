import type { MapProp } from "@ragnarok/map-format";
import { useEditorStore, SPAWN_MONSTERS, SPAWN_NPCS, TRIGGER_KINDS, triggerColor } from "./editorStore";
import { PROP_CATALOG } from "../props/registry";
import { Panel, ink } from "../ui/rpg";

/**
 * Inspector (direita): propriedades do objeto selecionado — nome/modelo,
 * posição, rotação (graus), escala, colisor e tag. Editar aplica no prop via
 * updateProp (entra no histórico Undo/Redo).
 */
const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

function NumRow({ label, values, onChange }: { label: string; values: [number, number, number]; onChange: (v: [number, number, number]) => void }) {
  const axes = ["X", "Y", "Z"] as const;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
        {axes.map((ax, i) => (
          <input
            key={ax}
            type="number"
            value={Math.round((values[i] ?? 0) * 100) / 100}
            step={0.5}
            onChange={(e) => {
              const v = [...values] as [number, number, number];
              v[i] = parseFloat(e.target.value) || 0;
              onChange(v);
            }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "4px 5px",
              borderRadius: 5,
              border: `1px solid ${ink.border}`,
              background: "rgba(255,255,255,0.06)",
              color: ink.text,
              font: "11px system-ui",
              outline: "none",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function Inspector({ embedded }: { embedded?: boolean } = {}) {
  // no dock, o Inspector preenche a coluna sem a moldura de painel (o dock já a
  // fornece); standalone, mantém o Panel flutuante.
  const Wrap = embedded
    ? ({ children }: { children: React.ReactNode; style?: React.CSSProperties }) => <div style={{ width: "100%" }}>{children}</div>
    : Panel;
  const wrapStyle = embedded ? undefined : { width: 240 };
  const map = useEditorStore((s) => s.map);
  const selected = useEditorStore((s) => s.selected);
  const multiCount = useEditorStore((s) => s.multi.length);
  const selectedSpawn = useEditorStore((s) => s.selectedSpawn);
  const selectedTrigger = useEditorStore((s) => s.selectedTrigger);
  const updateProp = useEditorStore((s) => s.updateProp);
  const updateSpawn = useEditorStore((s) => s.updateSpawn);
  const updateTrigger = useEditorStore((s) => s.updateTrigger);
  const tool = useEditorStore((s) => s.tool);
  const editPath = useEditorStore((s) => s.editPath);
  const clearPath = useEditorStore((s) => s.clearPath);
  const setPathMode = useEditorStore((s) => s.setPathMode);
  const setPathSpeed = useEditorStore((s) => s.setPathSpeed);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const prop: MapProp | undefined = selected != null ? map?.props[selected] : undefined;
  const spawn = selectedSpawn != null ? map?.spawns[selectedSpawn] : undefined;
  const trigger = selectedTrigger != null ? map?.triggers?.[selectedTrigger] : undefined;

  // ---- gatilho de área selecionado ----
  if (trigger && selectedTrigger != null) {
    const fieldStyle = { width: "100%", boxSizing: "border-box" as const, padding: "4px 6px", borderRadius: 5, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.text, font: "11px system-ui", outline: "none" };
    return (
      <Wrap style={wrapStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: triggerColor(trigger.kind) }} />
          <div style={{ font: "700 13px system-ui", color: ink.text }}>Inspector · Gatilho</div>
        </div>

        <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Nome</div>
        <input value={trigger.name ?? ""} placeholder="(opcional)" onChange={(e) => updateTrigger(selectedTrigger, { name: e.target.value })} style={{ ...fieldStyle, marginBottom: 8 }} />

        <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Tipo</div>
        <select value={trigger.kind} onChange={(e) => updateTrigger(selectedTrigger, { kind: e.target.value as typeof trigger.kind })} style={{ ...fieldStyle, marginBottom: 8 }}>
          {TRIGGER_KINDS.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
        </select>

        <div style={{ font: "10px system-ui", color: ink.faint, marginBottom: 8 }}>
          Área: {trigger.area.w}×{trigger.area.h} células @ ({trigger.area.col},{trigger.area.row})
        </div>

        {trigger.kind === "warp" && (
          <>
            <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Destino — mapa</div>
            <input value={trigger.target?.mapId ?? ""} onChange={(e) => updateTrigger(selectedTrigger, { target: { mapId: e.target.value, col: trigger.target?.col ?? 0, row: trigger.target?.row ?? 0 } })} style={{ ...fieldStyle, marginBottom: 8 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 8 }}>
              <input type="number" value={trigger.target?.col ?? 0} placeholder="col" onChange={(e) => updateTrigger(selectedTrigger, { target: { mapId: trigger.target?.mapId ?? "", col: parseInt(e.target.value) || 0, row: trigger.target?.row ?? 0 } })} style={fieldStyle} />
              <input type="number" value={trigger.target?.row ?? 0} placeholder="row" onChange={(e) => updateTrigger(selectedTrigger, { target: { mapId: trigger.target?.mapId ?? "", col: trigger.target?.col ?? 0, row: parseInt(e.target.value) || 0 } })} style={fieldStyle} />
            </div>
          </>
        )}
        {trigger.kind === "script" && (
          <>
            <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Evento (rótulo)</div>
            <input value={trigger.event ?? ""} onChange={(e) => updateTrigger(selectedTrigger, { event: e.target.value })} style={{ ...fieldStyle, marginBottom: 8 }} />
          </>
        )}
        {(trigger.kind === "damage" || trigger.kind === "heal") && (
          <>
            <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>{trigger.kind === "damage" ? "Dano" : "Cura"} por tick</div>
            <input type="number" value={trigger.value ?? 0} onChange={(e) => updateTrigger(selectedTrigger, { value: parseInt(e.target.value) || 0 })} style={{ ...fieldStyle, marginBottom: 8 }} />
          </>
        )}

        <button onClick={deleteSelected} style={{ width: "100%", padding: "6px", borderRadius: 6, border: `1px solid ${ink.border}`, background: "rgba(248,113,113,0.15)", color: "#f87171", font: "600 12px system-ui", cursor: "pointer", marginTop: 4 }}>Deletar gatilho</button>
      </Wrap>
    );
  }

  // ---- seleção múltipla (lote) ----
  if (multiCount > 1) {
    return (
      <Wrap style={wrapStyle}>
        <div style={{ font: "700 13px system-ui", color: ink.text, marginBottom: 10 }}>Inspector · Lote</div>
        <div style={{ font: "12px system-ui", color: ink.text, marginBottom: 12 }}>
          <b>{multiCount}</b> objetos selecionados. Arraste um deles pra mover todos; ou:
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={duplicateSelected} style={{ flex: 1, padding: "6px", borderRadius: 6, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.text, font: "600 12px system-ui", cursor: "pointer" }}>Duplicar</button>
          <button onClick={deleteSelected} style={{ flex: 1, padding: "6px", borderRadius: 6, border: `1px solid ${ink.border}`, background: "rgba(248,113,113,0.15)", color: "#f87171", font: "600 12px system-ui", cursor: "pointer" }}>Deletar</button>
        </div>
        <p style={{ font: "10px system-ui", color: ink.faint, marginTop: 8 }}>Shift+clique adiciona/remove da seleção.</p>
      </Wrap>
    );
  }

  // ---- spawn selecionado ----
  if (spawn && selectedSpawn != null) {
    const isMob = spawn.kind === "mob";
    const isNpc = spawn.kind === "npc";
    const wpCount = spawn.path?.points.length ?? 0;
    const selStyle = { width: "100%", marginBottom: 10, padding: "4px 5px", borderRadius: 5, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.text, font: "11px system-ui" } as const;
    return (
      <Wrap style={wrapStyle}>
        <div style={{ font: "700 13px system-ui", color: ink.text, marginBottom: 10 }}>Inspector · Spawn</div>
        <div style={{ font: "12px system-ui", color: ink.text, marginBottom: 8 }}>
          Tipo: <b>{spawn.kind === "player_start" ? "Player start" : isNpc ? "NPC" : spawn.kind === "road_node" ? "Nó de estrada" : "Monstro"}</b>
        </div>
        {isNpc && (
          <>
            <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>NPC</div>
            <select value={spawn.refId} onChange={(e) => updateSpawn(selectedSpawn, { refId: e.target.value })} style={selStyle}>
              {SPAWN_NPCS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>

            {/* rota de patrulha (path) */}
            <div style={{ height: 1, background: ink.border, margin: "2px 0 8px" }} />
            <div style={{ font: "700 11px system-ui", color: ink.text, marginBottom: 6 }}>Rota de patrulha</div>
            <button
              onClick={editPath}
              style={{ width: "100%", padding: "6px", borderRadius: 6, border: `1px solid ${tool === "path" ? "#4f46e5" : ink.border}`, background: tool === "path" ? "rgba(79,70,229,0.25)" : "rgba(255,255,255,0.06)", color: ink.text, font: "600 12px system-ui", cursor: "pointer", marginBottom: 8 }}
            >
              {tool === "path" ? "Clicando waypoints… (Esc encerra)" : "Editar rota (clicar células)"}
            </button>
            <div style={{ font: "11px system-ui", color: ink.dim, marginBottom: 8 }}>{wpCount} waypoints</div>
            {wpCount > 0 && (
              <>
                <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Modo</div>
                <select value={spawn.path?.mode ?? "loop"} onChange={(e) => setPathMode(e.target.value as "loop" | "pingpong" | "once")} style={selStyle}>
                  <option value="loop">Loop (fecha o ciclo)</option>
                  <option value="pingpong">Vai-e-volta</option>
                  <option value="once">Uma vez</option>
                </select>
                <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Velocidade: {spawn.path?.speed ?? 3}</div>
                <input type="range" min={0.5} max={12} step={0.5} value={spawn.path?.speed ?? 3} onChange={(e) => setPathSpeed(Number(e.target.value))} style={{ width: "100%", marginBottom: 8 }} />
                <button onClick={clearPath} style={{ width: "100%", padding: "5px", borderRadius: 6, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.dim, font: "600 11px system-ui", cursor: "pointer", marginBottom: 10 }}>Limpar rota</button>
              </>
            )}
          </>
        )}
        {isMob && (
          <>
            <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Monstro</div>
            <select
              value={spawn.refId}
              onChange={(e) => updateSpawn(selectedSpawn, { refId: e.target.value })}
              style={{ width: "100%", marginBottom: 10, padding: "4px 5px", borderRadius: 5, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.text, font: "11px system-ui" }}
            >
              {SPAWN_MONSTERS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Quantidade: {spawn.count ?? 1}</div>
            <input type="range" min={1} max={20} value={spawn.count ?? 1} onChange={(e) => updateSpawn(selectedSpawn, { count: Number(e.target.value) })} style={{ width: "100%", marginBottom: 10 }} />
            <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Raio: {spawn.radius ?? 0}</div>
            <input type="range" min={0} max={30} value={spawn.radius ?? 0} onChange={(e) => updateSpawn(selectedSpawn, { radius: Number(e.target.value) })} style={{ width: "100%", marginBottom: 12 }} />
          </>
        )}
        <button
          onClick={deleteSelected}
          style={{ width: "100%", padding: "6px", borderRadius: 6, border: `1px solid ${ink.border}`, background: "rgba(248,113,113,0.15)", color: "#f87171", font: "600 12px system-ui", cursor: "pointer" }}
        >
          Deletar spawn
        </button>
      </Wrap>
    );
  }

  return (
    <Wrap style={wrapStyle}>
      <div style={{ font: "700 13px system-ui", color: ink.text, marginBottom: 10 }}>Inspector</div>
      {!prop || selected == null ? (
        <div style={{ font: "12px system-ui", color: ink.faint }}>Nenhum objeto selecionado.</div>
      ) : (
        <>
          <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Modelo</div>
          <select
            value={prop.assetId}
            onChange={(e) => updateProp(selected, { assetId: e.target.value })}
            style={{ width: "100%", marginBottom: 10, padding: "4px 5px", borderRadius: 5, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.text, font: "11px system-ui" }}
          >
            {PROP_CATALOG.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>

          <NumRow label="Posição" values={prop.position} onChange={(v) => updateProp(selected, { position: v })} />
          <NumRow
            label="Rotação (graus)"
            values={[prop.rotation[0] * R2D, prop.rotation[1] * R2D, prop.rotation[2] * R2D]}
            onChange={(v) => updateProp(selected, { rotation: [v[0] * D2R, v[1] * D2R, v[2] * D2R] })}
          />
          <NumRow label="Escala" values={prop.scale} onChange={(v) => updateProp(selected, { scale: v })} />

          <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Colisor</div>
          <select
            value={prop.colliderType ?? "none"}
            onChange={(e) => updateProp(selected, { colliderType: e.target.value as MapProp["colliderType"] })}
            style={{ width: "100%", marginBottom: 10, padding: "4px 5px", borderRadius: 5, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.text, font: "11px system-ui" }}
          >
            {["none", "box", "trimesh", "hull"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <div style={{ font: "600 11px system-ui", color: ink.dim, marginBottom: 3 }}>Tag</div>
          <input
            value={prop.tags?.[0] ?? ""}
            onChange={(e) => updateProp(selected, { tags: e.target.value ? [e.target.value] : [] })}
            placeholder="ex: arvore"
            style={{ width: "100%", boxSizing: "border-box", marginBottom: 12, padding: "4px 5px", borderRadius: 5, border: `1px solid ${ink.border}`, background: "rgba(255,255,255,0.06)", color: ink.text, font: "11px system-ui", outline: "none" }}
          />

          <button
            onClick={deleteSelected}
            style={{ width: "100%", padding: "6px", borderRadius: 6, border: `1px solid ${ink.border}`, background: "rgba(248,113,113,0.15)", color: "#f87171", font: "600 12px system-ui", cursor: "pointer" }}
          >
            Deletar objeto
          </button>
        </>
      )}
    </Wrap>
  );
}
