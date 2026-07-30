import { useEditorStore, type EditScope } from "./editorStore";
import { IconBtn, TextBtn, VSep } from "./EditorUi";
import { ink } from "../ui/rpg";
import { IcNew, IcUndo, IcRedo, IcPlay, IcSave, IcSnap } from "../ui/icons";

/**
 * Barra superior slim: ações de arquivo (Novo/Undo/Redo/Play), visões de
 * câmera, snap, leitura de status (hover/contagens) e Salvar. Ferramentas de
 * edição vivem na barra vertical esquerda (ToolRail).
 */
export function TopBar({ onSave, saving, status }: { onSave: () => void; saving: boolean; status: string }) {
  const newMap = useEditorStore((s) => s.newMap);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const requestView = useEditorStore((s) => s.requestView);
  const snap = useEditorStore((s) => s.snap);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const hover = useEditorStore((s) => s.hover);
  const count = useEditorStore((s) => s.map?.props.length ?? 0);
  const triggerCount = useEditorStore((s) => s.map?.triggers?.length ?? 0);
  const dirty = useEditorStore((s) => s.dirty);
  const mapName = useEditorStore((s) => s.map?.name ?? "—");

  const playCurrent = () => {
    const m = useEditorStore.getState().map;
    if (!m) return;
    // abre a aba de play e ENTREGA o mapa por postMessage quando ela sinalizar
    // pronta (sessionStorage estoura cota em mapas grandes → "preview vazio").
    const w = window.open("/play?preview=1", "_blank");
    if (!w) return;
    const onMsg = (e: MessageEvent) => {
      if (e.source === w && e.data?.type === "ragnarok:preview-ready") {
        w.postMessage({ type: "ragnarok:preview-map", map: m }, "*");
        window.removeEventListener("message", onMsg);
      }
    };
    window.addEventListener("message", onMsg);
    // fallback: se a aba não sinalizar em 8s, desiste do listener
    setTimeout(() => window.removeEventListener("message", onMsg), 8000);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 46,
        padding: "0 10px",
        background: ink.panel,
        backdropFilter: "blur(7px)",
        WebkitBackdropFilter: "blur(7px)",
        borderBottom: `1px solid ${ink.border}`,
        boxSizing: "border-box",
      }}
    >
      <span style={{ font: "700 13px system-ui", color: ink.text, marginRight: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
        {mapName}
      </span>
      {dirty && <span title="não salvo" style={{ width: 7, height: 7, borderRadius: 999, background: "#fbbf24", flex: "0 0 auto" }} />}

      <VSep />
      <IconBtn icon={<IcNew />} label="Novo mapa em branco" onClick={() => { if (confirm("Novo mapa em branco? Alterações não salvas serão perdidas.")) newMap(); }} />
      <IconBtn icon={<IcUndo />} label="Desfazer (Ctrl+Z)" shortcut="⌃Z" disabled={!canUndo} onClick={undo} />
      <IconBtn icon={<IcRedo />} label="Refazer (Ctrl+Y)" shortcut="⌃Y" disabled={!canRedo} onClick={redo} />

      <VSep />
      <span style={{ font: "10px system-ui", color: ink.faint }}>Visão</span>
      <TextBtn onClick={() => requestView("top")}>Topo</TextBtn>
      <TextBtn onClick={() => requestView("front")}>Frente</TextBtn>
      <TextBtn onClick={() => requestView("side")}>Lado</TextBtn>
      <TextBtn onClick={() => requestView("reset")}>⟲</TextBtn>
      <IconBtn icon={<IcSnap />} label="Snap na grade hexagonal" active={snap} onClick={toggleSnap} />

      <ScopePicker />

      <VSep />
      <IconBtn icon={<IcPlay />} label="Jogar o mapa atual (preview)" accent="#16a34a" onClick={playCurrent} />

      <span style={{ marginLeft: "auto", font: "11px system-ui", color: ink.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {hover ? `hex ${hover.col},${hover.row} · alt ${hover.level}  ·  ` : ""}
        {count} props{triggerCount ? ` · ${triggerCount} gatilhos` : ""}{status ? `  ·  ${status}` : ""}
      </span>

      <button
        onClick={onSave}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          border: "1px solid #4f46e5", borderRadius: 8, background: "#4f46e5", color: "#fff",
          font: "700 12px system-ui", cursor: "pointer", padding: "7px 14px", whiteSpace: "nowrap",
        }}
      >
        <IcSave size={16} /> {saving ? "Salvando…" : "Salvar"}
      </button>
    </div>
  );
}

/**
 * Onde as edições valem: miolo do mapa, moldura, ou tudo.
 *
 * Fica na barra de cima porque vale para TUDO — pincel de terreno, asset posto
 * à mão, geração procedural, spawn e prefab. Escolher "Dentro" e sair pintando
 * garante que nada encosta no cinturão bloqueado da borda (em prt_fild08 são
 * 63.982 células numa mancha só), e vice-versa.
 *
 * Só aparece em mapa importado do rAthena: mapa autorado no editor não tem essa
 * divisão entre miolo e moldura.
 */
function ScopePicker() {
  const escopo = useEditorStore((s) => s.editScope);
  const setEditScope = useEditorStore((s) => s.setEditScope);
  const importado = useEditorStore((s) => s.map?.terrainMode === "square");
  if (!importado) return null;

  const opcoes: Array<[EditScope, string, string]> = [
    ["inside", "Dentro", "edições só no miolo jogável (não encosta em buraco nem na moldura)"],
    ["border", "Borda", "edições só no cinturão bloqueado da moldura"],
    ["hole", "Buraco", "edições só nas células de buraco (cliff) — ravina e penhasco do miolo"],
    ["all", "Tudo", "sem restrição"],
  ];
  return (
    <>
      <VSep />
      <span style={{ font: "10px system-ui", color: ink.faint }}>Editar em</span>
      {opcoes.map(([valor, rotulo, dica]) => (
        <span key={valor} title={dica} style={{ display: "flex" }}>
          <TextBtn active={escopo === valor} onClick={() => setEditScope(valor)}>
            {rotulo}
          </TextBtn>
        </span>
      ))}
    </>
  );
}
