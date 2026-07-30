import type * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { useCombatStore } from "../combat/combatStore";
import { useHudStore } from "./hudStore";
import { PlayerFrame, TargetFrame } from "./PlayerFrame";
import { Minimap } from "./Minimap";
import { SkillBar } from "./SkillBar";
import { CastBar } from "./CastBar";
import { MenuBar } from "./MenuBar";
import { Chat } from "./Chat";
import { Windows, ActiveQuests } from "./Windows";
import { useHudHotkeys } from "./hotkeys";
import { NpcDialog } from "./NpcDialog";
import { Panel, RpgButton } from "../ui/rpg";

const wrap: React.CSSProperties = { position: "absolute", userSelect: "none" };

/** HUD completo do /play (soul + antes.txt): frames, minimapa, skillbar, menu,
 * chat, quests ativas, janelas e overlay de morte. Renderizado sobre o Canvas. */
export function Hud({ map, playerPos }: { map: GameMap; playerPos: React.MutableRefObject<THREE.Vector3> }) {
  useHudHotkeys(); // Alt+A/E/S/Q… como no RO
  return (
    <>
      {/* topo-esquerda: frame do personagem + alvo */}
      <div style={{ ...wrap, top: 10, left: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
        <PlayerFrame />
        <TargetFrame />
      </div>

      {/* topo-direita: minimapa */}
      <div style={{ ...wrap, top: 10, right: 10 }}>
        <Minimap map={map} playerPos={playerPos} />
      </div>

      {/* meio-direita: quests ativas */}
      <div style={{ ...wrap, top: "40%", right: 10 }}>
        <ActiveQuests />
      </div>

      {/* baixo-esquerda: chat */}
      <div style={{ ...wrap, bottom: 10, left: 10 }}>
        <Chat />
      </div>

      {/* baixo-centro: conjuração em cima da barra de skills. As duas na MESMA
          coluna para a barra de cast nascer centrada com ela — e como o
          `CastBar` some quando não há conjuração, o `gap` do flex não deixa
          buraco no lugar dela. */}
      <div
        style={{
          ...wrap,
          bottom: 10,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <CastBar />
        <SkillBar />
      </div>

      {/* baixo-direita: menu */}
      <div style={{ ...wrap, bottom: 10, right: 10 }}>
        <MenuBar />
      </div>

      <NpcDialog />
      <Windows />
      <DeathOverlay />
    </>
  );
}

/**
 * Tela de morte do PREVIEW (gatilho de dano do editor). No jogo com servidor a
 * morte vem em ZC.NOTIFY_ACT/PAR_CHANGE e ainda não tem tela própria — por isso
 * ela só aparece quando o HP simulado zera, o que nunca acontece online.
 */
function DeathOverlay() {
  const alive = useCombatStore((s) => s.player.alive);
  const respawn = useCombatStore((s) => s.respawnPlayer);
  if (alive) return null;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" }}>
      <Panel style={{ width: 320, textAlign: "center" }}>
        <div style={{ font: "700 26px system-ui", color: "#f87171", margin: "8px 0 16px" }}>Você morreu</div>
        <RpgButton color="brown" onClick={respawn} style={{ font: "600 16px system-ui", padding: "0 20px" }}>
          Reviver
        </RpgButton>
      </Panel>
    </div>
  );
}

/** cursor de espada vermelha ao passar sobre um monstro (senão, padrão) */
const SWORD_CURSOR =
  "url('data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g stroke="#000" stroke-width="1.5"><line x1="6" y1="26" x2="24" y2="8" stroke="#dc2626" stroke-width="4"/><line x1="4" y1="20" x2="12" y2="28" stroke="#9ca3af" stroke-width="3"/><circle cx="24" cy="8" r="2.5" fill="#fca5a5"/></g></svg>`,
  ) +
  "') 6 26, crosshair";

export function useHudCursor(): string {
  const hover = useHudStore((s) => s.hoverMonster);
  return hover ? SWORD_CURSOR : "default";
}
