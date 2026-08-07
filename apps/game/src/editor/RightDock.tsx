import { Inspector } from "./Inspector";
import { Palette } from "./Palette";
import { ScenePanel } from "./ScenePanel";
import { ProceduralPanel } from "./ProceduralPanel";
import { TerrainPanel } from "./TerrainPanel";
import { TexturePanel } from "./TexturePanel";
import { PrefabPanel } from "./PrefabPanel";
import { Hierarchy } from "./Hierarchy";
import { BlockedPanel } from "./BlockedPanel";
import { DockSection } from "./EditorUi";
import { useEditorStore } from "./editorStore";
import { ink } from "../ui/rpg";
import { IcInfo, IcTree, IcLayers, IcSparkles, IcPrefab, IcList, IcTerrain, IcBrush, IcTrash } from "../ui/icons";

/**
 * Dock direito (estilo editor gráfico): coluna única, rolável, com seções
 * recolhíveis — Inspetor (contextual), Assets, Camadas & Luz, Geração
 * procedural, Prefabs e Hierarquia. Substitui os painéis flutuantes soltos.
 */
export function RightDock() {
  const propCount = useEditorStore((s) => s.map?.props.length ?? 0);
  const spawnCount = useEditorStore((s) => s.map?.spawns.length ?? 0);
  const prefabCount = useEditorStore((s) => s.prefabs.length);
  const importado = useEditorStore((s) => s.map?.terrainMode === "square");

  return (
    <div
      style={{
        width: 276,
        flex: "0 0 276px",
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        background: ink.panel,
        backdropFilter: "blur(7px)",
        WebkitBackdropFilter: "blur(7px)",
        borderLeft: `1px solid ${ink.border}`,
        boxSizing: "border-box",
      }}
    >
      <DockSection icon={<IcInfo size={15} />} title="Inspetor" defaultOpen>
        <Inspector embedded />
      </DockSection>
      <DockSection icon={<IcTree size={15} />} title="Assets" defaultOpen={false}>
        <Palette embedded />
      </DockSection>
      <DockSection icon={<IcLayers size={15} />} title="Camadas & Luz" defaultOpen={false}>
        <ScenePanel embedded />
      </DockSection>
      <DockSection icon={<IcTerrain size={15} />} title="Relevo, água & estradas" defaultOpen={false}>
        <TerrainPanel />
      </DockSection>
      <DockSection icon={<IcBrush size={15} />} title="Texturas do terreno" defaultOpen={false}>
        <TexturePanel />
      </DockSection>
      <DockSection icon={<IcSparkles size={15} />} title="Vegetação & construções" defaultOpen={false}>
        <ProceduralPanel embedded />
      </DockSection>
      {/* só faz sentido em mapa importado do rAthena: é lá que existem os
          bloqueios avulsos herdados do mapa original */}
      {importado && (
        <DockSection icon={<IcTrash size={15} />} title="Limpar terreno bloqueado" defaultOpen={false}>
          <BlockedPanel />
        </DockSection>
      )}
      <DockSection icon={<IcPrefab size={15} />} title="Prefabs" count={prefabCount} defaultOpen={false}>
        <PrefabPanel embedded />
      </DockSection>
      <DockSection icon={<IcList size={15} />} title="Hierarquia" count={propCount + spawnCount} defaultOpen={false}>
        <Hierarchy embedded />
      </DockSection>
    </div>
  );
}
