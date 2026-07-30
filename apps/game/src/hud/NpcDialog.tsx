import { useNpcStore } from "../net/npcStore";
import { useWorldStore } from "../net/worldStore";
import { Panel, RpgButton, ink } from "../ui/rpg";

/**
 * Janela de diálogo do NPC (embaixo, centralizada — como no RO).
 *
 * O ritmo é do servidor: enquanto ele não mandar "próximo" ou um menu, o
 * jogador só lê. Fechar avisa o servidor, senão o script do NPC fica preso
 * esperando resposta e o jogador não consegue falar com ele de novo.
 */
export function NpcDialog() {
  const dialog = useNpcStore((s) => s.dialog);
  const name = useWorldStore((s) => (dialog ? (s.entities[dialog.gid]?.name ?? "") : ""));

  if (!dialog) return null;
  const hasContent = dialog.lines.length > 0 || dialog.menu.length > 0 || dialog.awaitingNext;
  if (!hasContent) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 120,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(560px, 90vw)",
      }}
    >
      <Panel>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <span style={{ font: "700 13px system-ui", color: ink.text }}>{name || "NPC"}</span>
          <div style={{ marginLeft: "auto" }}>
            <RpgButton color="brown" onClick={() => useNpcStore.getState().dismiss()}>
              ✕
            </RpgButton>
          </div>
        </div>

        {dialog.lines.length > 0 && (
          <div style={{ font: "13px system-ui", color: ink.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {dialog.lines.join("\n")}
          </div>
        )}

        {dialog.menu.length > 0 && (
          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            {dialog.menu.map((option, index) => (
              <RpgButton key={`${option}-${index}`} color="blue" onClick={() => useNpcStore.getState().choose(index)}>
                {option}
              </RpgButton>
            ))}
          </div>
        )}

        {dialog.awaitingNext && dialog.menu.length === 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <RpgButton color="blue" onClick={() => useNpcStore.getState().next()}>
              Próximo ▸
            </RpgButton>
          </div>
        )}
      </Panel>
    </div>
  );
}
