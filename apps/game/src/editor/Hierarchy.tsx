import { Children, useState, type ReactNode } from "react";
import { useEditorStore, SPAWN_MONSTERS, SPAWN_NPCS } from "./editorStore";
import { propLabel } from "../props/registry";
import { Panel, ink } from "../ui/rpg";

const refLabel = (key?: string) =>
  SPAWN_MONSTERS.find((m) => m.key === key)?.label ?? SPAWN_NPCS.find((m) => m.key === key)?.label ?? key ?? "?";

/** rótulo do escopo ativo, para o aviso do botão de apagar camada */
const SCOPE_LABEL: Record<string, string> = {
  all: "todo o mapa",
  inside: "dentro do mapa",
  border: "a borda",
  hole: "os buracos",
};

/**
 * Hierarquia (direita): Terreno + props + spawns. Cada seção com mais de 3
 * itens vira um dropdown recolhido por padrão (esconde o resto) — evita listar
 * centenas de props procedurais.
 *
 * Clicar num item seleciona; **Shift+clique marca a faixa** do último
 * selecionado até ele, e Delete apaga o lote. Cada camada tem um 🗑 que apaga
 * tudo dela DENTRO DO ESCOPO escolhido na barra de cima — a mesma regra que vale
 * para criar vale para limpar.
 */
export function Hierarchy({ embedded }: { embedded?: boolean } = {}) {
  const map = useEditorStore((s) => s.map);
  const selected = useEditorStore((s) => s.selected);
  const selectedSpawn = useEditorStore((s) => s.selectedSpawn);
  const multi = useEditorStore((s) => s.multi);
  const multiSpawn = useEditorStore((s) => s.multiSpawn);
  const select = useEditorStore((s) => s.select);
  const selectRange = useEditorStore((s) => s.selectRange);
  const selectSpawn = useEditorStore((s) => s.selectSpawn);
  const toggleMultiSpawn = useEditorStore((s) => s.toggleMultiSpawn);
  const selectSpawnRange = useEditorStore((s) => s.selectSpawnRange);
  const toggleMulti = useEditorStore((s) => s.toggleMulti);
  const deleteLayer = useEditorStore((s) => s.deleteLayer);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const escopo = useEditorStore((s) => s.editScope);
  const props = map?.props ?? [];
  const spawns = map?.spawns ?? [];

  const row = (
    label: string,
    active: boolean,
    onClick: (e: React.MouseEvent) => void,
    key: string | number,
    marcado = false,
  ) => (
    <button
      key={key}
      type="button"
      aria-pressed={active || marcado}
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "4px 8px",
        borderRadius: 5,
        border: "none",
        background: active ? "#4f46e5" : marcado ? "rgba(79,70,229,0.28)" : "transparent",
        color: active || marcado ? "#fff" : ink.text,
        font: "12px system-ui",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  /** clique com Shift = faixa; com Ctrl/Cmd = liga/desliga um; sozinho = seleciona */
  const cliquePro = (i: number, tipo: "prop" | "spawn") => (e: React.MouseEvent) => {
    if (e.shiftKey) return tipo === "prop" ? selectRange(i) : selectSpawnRange(i);
    if (e.ctrlKey || e.metaKey) return tipo === "prop" ? toggleMulti(i) : toggleMultiSpawn(i);
    return tipo === "prop" ? select(i) : selectSpawn(i);
  };

  const body = (
    <>
      {row("🗺 Terreno", selected == null && selectedSpawn == null, () => select(null), "terrain")}

      <div style={{ font: "9px system-ui", color: ink.faint, margin: "2px 0 6px" }}>
        Shift+clique marca a faixa · Ctrl+clique marca um a um · Delete apaga o marcado
      </div>

      <Section
        title="Objetos"
        count={props.length}
        empty="Nenhum objeto."
        onDeleteAll={() => deleteLayer("props")}
        escopo={escopo}
        marcados={multi.length}
        onDeleteMarcados={deleteSelected}
      >
        {props.map((p, i) => {
          const tag = p.tags?.[0] && p.tags[0] !== "_gen" ? p.tags[0] : propLabel(p.assetId);
          return row(`▪ ${tag}`, selected === i, cliquePro(i, "prop"), p.id, multi.includes(i));
        })}
      </Section>

      <Section
        title="Spawns"
        count={spawns.length}
        empty="Nenhum spawn."
        onDeleteAll={() => deleteLayer("spawns")}
        escopo={escopo}
        marcados={multiSpawn.length}
        onDeleteMarcados={deleteSelected}
      >
        {spawns.map((sp, i) =>
          row(
            sp.kind === "player_start"
              ? "🟢 Player start"
              : sp.kind === "npc"
                ? `🔵 ${refLabel(sp.refId)}`
                : sp.kind === "road_node"
                  ? "🟤 Nó de estrada"
                  : `🔴 ${refLabel(sp.refId)} ×${sp.count ?? 1}`,
            selectedSpawn === i,
            cliquePro(i, "spawn"),
            sp.id,
            multiSpawn.includes(i),
          ),
        )}
      </Section>

      <Section
        title="Gatilhos"
        count={map?.triggers?.length ?? 0}
        empty="Nenhum gatilho."
        onDeleteAll={() => deleteLayer("triggers")}
        escopo={escopo}
      >
        {(map?.triggers ?? []).map((t, i) =>
          row(`⬛ ${t.kind} ${t.area.w}×${t.area.h}`, false, () => useEditorStore.getState().selectTrigger(i), t.id),
        )}
      </Section>
    </>
  );

  if (embedded) return <div style={{ maxHeight: "34vh", overflow: "auto" }}>{body}</div>;
  return (
    <Panel style={{ width: 240, maxHeight: "40vh", overflow: "auto" }}>
      <div style={{ font: "700 13px system-ui", color: ink.text, marginBottom: 8 }}>Hierarquia</div>
      {body}
    </Panel>
  );
}

/** itens por página, quando a seção precisa paginar (ver `Section`) */
const PAGINA = 200;

/** seção: >3 itens vira dropdown recolhido (esconde o resto até expandir) */
function Section({
  title,
  count,
  empty,
  children,
  onDeleteAll,
  escopo,
  marcados = 0,
  onDeleteMarcados,
}: {
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
  /** apaga tudo da camada (no escopo ativo) */
  onDeleteAll?: () => void;
  escopo?: string;
  /** quantos itens desta camada estão marcados (Shift/Ctrl) */
  marcados?: number;
  onDeleteMarcados?: () => void;
}) {
  const [open, setOpen] = useState(false);
  /**
   * Quantos itens mostrar de uma vez, quando a seção tem MUITOS.
   *
   * Um mapa com geração procedural densa passa fácil de mil props, e sem
   * limite abrir "Objetos" criava um `<button>` de DOM por item de uma vez
   * só — trava perceptível, e reconciliação cara a cada seleção. Paginar em
   * vez de virtualizar: mais simples, sem dependência nova, e o caso comum
   * (dezenas a poucas centenas de itens) nunca precisa do botão.
   */
  const [visiveis, setVisiveis] = useState(PAGINA);
  const collapsible = count > 3;
  const alvo = SCOPE_LABEL[escopo ?? "all"] ?? "todo o mapa";
  const lista = Children.toArray(children);
  const cortada = lista.length > visiveis;
  const mostrar = cortada ? lista.slice(0, visiveis) : lista;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, margin: "6px 0 2px" }}>
        <button
          type="button"
          aria-expanded={collapsible ? open : undefined}
          onClick={() => collapsible && setOpen(!open)}
          disabled={!collapsible}
          style={{ flex: 1, textAlign: "left", background: "none", border: "none", color: ink.faint, font: "600 10px system-ui", cursor: collapsible ? "pointer" : "default", padding: 0 }}
        >
          {collapsible ? (open ? "▾ " : "▸ ") : ""}
          {title} ({count})
        </button>
        {marcados > 1 && onDeleteMarcados && (
          <button
            type="button"
            title={`Apagar os ${marcados} marcados`}
            onClick={onDeleteMarcados}
            style={{ background: "rgba(239,68,68,0.18)", border: `1px solid ${ink.border}`, borderRadius: 5, color: "#fca5a5", cursor: "pointer", font: "9px system-ui", padding: "1px 5px" }}
          >
            🗑 {marcados}
          </button>
        )}
        {count > 0 && onDeleteAll && (
          <button
            type="button"
            title={`Apagar TODOS os ${count} de "${title}" em ${alvo}`}
            aria-label={`Apagar todos os ${count} de ${title} em ${alvo}`}
            onClick={() => {
              if (confirm(`Apagar ${title.toLowerCase()} em ${alvo}?`)) onDeleteAll();
            }}
            style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${ink.border}`, borderRadius: 5, color: ink.text, cursor: "pointer", font: "10px system-ui", padding: "1px 5px" }}
          >
            🗑
          </button>
        )}
      </div>
      {count === 0 ? (
        <div style={{ font: "11px system-ui", color: ink.faint, padding: "2px 8px" }}>{empty}</div>
      ) : !collapsible || open ? (
        <div style={collapsible ? { maxHeight: "24vh", overflow: "auto" } : undefined}>
          {mostrar}
          {cortada && (
            <button
              type="button"
              onClick={() => setVisiveis((v) => v + PAGINA)}
              style={{ width: "100%", textAlign: "center", background: "rgba(255,255,255,0.04)", border: `1px solid ${ink.border}`, borderRadius: 5, color: ink.faint, cursor: "pointer", font: "10px system-ui", padding: "4px", marginTop: 2 }}
            >
              carregar mais ({lista.length - visiveis} restantes)
            </button>
          )}
        </div>
      ) : (
        <div style={{ font: "10px system-ui", color: ink.faint, padding: "2px 8px" }}>… {count} itens (clique pra ver)</div>
      )}
    </div>
  );
}
