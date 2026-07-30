import { useEditorStore } from "./editorStore";
import { RailButton } from "./EditorUi";
import { ink } from "../ui/rpg";
import { IcSelect, IcTerrain, IcTree, IcPin, IcArea, IcPath, IcRuler, IcPrefab } from "../ui/icons";

/**
 * Barra de ferramentas vertical (esquerda), estilo editor gráfico. Cada modo de
 * interação é um ícone com a tecla de atalho embaixo. Painéis (Assets, Camadas,
 * etc.) ficam no dock direito — aqui só as FERRAMENTAS.
 */
export function ToolRail() {
  const tool = useEditorStore((s) => s.tool);
  const currentPrefab = useEditorStore((s) => s.currentPrefab);
  const npcSelected = useEditorStore((s) => s.selectedSpawn != null && s.map?.spawns[s.selectedSpawn]?.kind === "npc");
  const brush = useEditorStore((s) => s.brush);
  const spawnKind = useEditorStore((s) => s.spawnKind);
  const triggerKind = useEditorStore((s) => s.triggerKind);
  const selectTool = useEditorStore((s) => s.selectTool);
  const setBrush = useEditorStore((s) => s.setBrush);
  const setTool = useEditorStore((s) => s.setTool);
  const setSpawnKind = useEditorStore((s) => s.setSpawnKind);
  const setTriggerKind = useEditorStore((s) => s.setTriggerKind);
  const editPath = useEditorStore((s) => s.editPath);
  const armPrefab = useEditorStore((s) => s.armPrefab);
  const clearMeasure = useEditorStore((s) => s.clearMeasure);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "8px 6px",
        background: ink.panel,
        backdropFilter: "blur(7px)",
        WebkitBackdropFilter: "blur(7px)",
        borderRight: `1px solid ${ink.border}`,
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <RailButton icon={<IcSelect />} label="Selecionar / mover (arraste)" shortcut="V" active={tool === "select"} onClick={selectTool} />
      <RailButton icon={<IcTerrain />} label="Terreno — pincéis de relevo e superfície" shortcut="B" active={tool === "brush"} onClick={() => setBrush(brush)} />
      <RailButton icon={<IcTree />} label="Decoração — depois escolha um asset no dock à direita" shortcut="P" active={tool === "place"} onClick={() => setTool("place")} />
      <div style={{ width: 26, height: 1, background: ink.border, margin: "2px 0" }} />
      <RailButton icon={<IcPin />} label="Spawn — player / monstro / NPC" shortcut="S" active={tool === "spawn"} onClick={() => setSpawnKind(spawnKind)} />
      <RailButton icon={<IcArea />} label="Área — gatilho (warp / dano / cura / save)" shortcut="A" active={tool === "area"} onClick={() => setTriggerKind(triggerKind)} />
      <RailButton icon={<IcPath />} label={npcSelected ? "Rota — patrulha do NPC selecionado" : "Rota — selecione um NPC primeiro"} shortcut="R" active={tool === "path"} disabled={!npcSelected} onClick={editPath} />
      <RailButton icon={<IcPrefab />} label={currentPrefab ? "Prefab — carimbar grupo armado" : "Prefab — arme um prefab no dock (direita)"} active={tool === "prefab"} disabled={!currentPrefab} onClick={() => armPrefab(tool === "prefab" ? null : currentPrefab)} />
      <div style={{ width: 26, height: 1, background: ink.border, margin: "2px 0" }} />
      <RailButton icon={<IcRuler />} label="Medir distância" shortcut="M" active={tool === "measure"} onClick={() => { clearMeasure(); setTool("measure"); }} />
    </div>
  );
}
