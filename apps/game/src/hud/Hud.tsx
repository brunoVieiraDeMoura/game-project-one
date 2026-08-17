import type * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { useCombatStore } from "../combat/combatStore";
import { useHudStore } from "./hudStore";
import { PlayerFrame, TargetFrame } from "./PlayerFrame";
import { Minimap } from "./Minimap";
import { StatusEffectIcons } from "./StatusEffectIcons";
import { MINIMAP_WIDTH } from "../ui/minimap";
import { useWorldStore } from "../net/worldStore";
import { SkillBar } from "./SkillBar";
import { CastBar } from "./CastBar";
import { MenuBar } from "./MenuBar";
import { Chat } from "./Chat";
import { Windows } from "./Windows";
import { QuestTracker } from "./QuestTracker";
import { LootToast } from "./LootToast";
import { WorldDropDialog } from "./WorldDropDialog";
import { ItemInfoWindow } from "./ItemInfoWindow";
import { CardApplyDialog } from "./CardApplyDialog";
import { useHudHotkeys } from "./hotkeys";
import { NpcDialog } from "./NpcDialog";
import { Panel, RpgButton } from "../ui/rpg";
import { SondaDeMontagem } from "../core/diagnostics/SondaDeCanvas";

const wrap: React.CSSProperties = { position: "absolute", userSelect: "none" };

/**
 * Painel grande de buffs/debuffs: 6 colunas, mesma largura aproximada do
 * minimapa (divisão 1fr/1fr — pedido explícito 2026-08-14). SEM `Panel`
 * (sem fundo/texto/canto arredondado, pedido explícito) — só a grade de
 * ícones redondos, sem moldura (`bordered={false}`, pedido explícito
 * 2026-08-17, mesmo tratamento do `TargetFrame`/`PlayerFrame`).
 */
const BUFF_PANEL_COLUMNS = 6;
/** mesmo `gap:4` que `StatusEffectIcons` já usa na grade (`columns` presente) */
const BUFF_PANEL_GAP = 4;
const BUFF_PANEL_ICON_SIZE = Math.floor((MINIMAP_WIDTH - BUFF_PANEL_GAP * (BUFF_PANEL_COLUMNS - 1)) / BUFF_PANEL_COLUMNS);
const BUFF_PANEL_WIDTH =
  BUFF_PANEL_ICON_SIZE * BUFF_PANEL_COLUMNS + BUFF_PANEL_GAP * (BUFF_PANEL_COLUMNS - 1);

/** HUD completo do /play (soul + antes.txt): frames, minimapa, skillbar, menu,
 * chat, quests ativas, janelas e overlay de morte. Renderizado sobre o Canvas. */
export function Hud({
  map,
  playerPos,
  aquecendo = false,
}: {
  map: GameMap;
  playerPos: React.MutableRefObject<THREE.Vector3>;
  /**
   * A cortina de carregamento ainda está no ar, mas a cena já desenha
   * (fase 2 do `play/aquecimento`). Repassado só ao `TargetFrame`: é ele quem
   * decide nascer cedo (Fase E1 da auditoria de render) — o resto do HUD não
   * muda nada com isto.
   */
  aquecendo?: boolean;
}) {
  useHudHotkeys(); // Alt+A/E/S/Q… como no RO
  const selfGid = useWorldStore((s) => s.selfGid);
  return (
    <>
      {/*
        O HUD inteiro é montado por `{map && !carregando && <Hud/>}` no
        `PlayView` — ou seja, ele DESAPARECE enquanto a tela de carregamento
        está no ar, e num portal isso acontece. Se ele levar junto os retratos,
        cada portal destrói e recria contextos WebGL, e é essa a suspeita que
        esta sonda existe para confirmar ou derrubar: se `hud/desmontou-em` vier
        imediatamente antes dos `retrato:*`, a causa é o HUD, não o retrato.
      */}
      {import.meta.env.DEV && <SondaDeMontagem nome="hud" />}
      {/* topo-esquerda: frame do personagem + alvo */}
      <div style={{ ...wrap, top: 10, left: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
        <PlayerFrame />
        <TargetFrame aquecendo={aquecendo} />
      </div>

      {/* topo-centro: o que acabou de entrar na bolsa. Sem `wrap` (que ancora
          num canto) — ele se centraliza sozinho e não recebe clique. */}
      <LootToast />

      {/* topo-direita: painel de buffs/debuffs à ESQUERDA do minimapa (nunca
          acima/abaixo — pedido explícito da "auditoria buffs/debuffs"
          2026-08-14), divisão ~1fr/1fr — o painel usa a MESMA largura do
          minimapa. À direita, minimapa e, logo abaixo dele, o acesso rápido
          às missões: os dois na MESMA coluna para o quadro acompanhar a
          altura do minimapa em vez de depender de um `top` cravado — e como
          o tracker some quando não há missão aceita, o `gap` do flex não
          deixa buraco. */}
      <div style={{ ...wrap, top: 10, right: 10, display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ width: BUFF_PANEL_WIDTH }}>
          <StatusEffectIcons gid={selfGid} size={BUFF_PANEL_ICON_SIZE} columns={BUFF_PANEL_COLUMNS} tooltipBelow bordered={false} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <Minimap map={map} playerPos={playerPos} />
          <QuestTracker />
        </div>
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
      <Windows map={map} playerPos={playerPos} />
      <WorldDropDialog />
      <ItemInfoWindow />
      <CardApplyDialog />
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

/*
 * O cursor saiu daqui: agora é global e pintado (`ui/cursors` + `ui/cursorStore`).
 *
 * O que existia era uma espada desenhada em SVG, lida de
 * `hudStore.hoverMonster` — e NINGUÉM nunca chamou `setHoverMonster`, então ela
 * jamais apareceu na tela. A arte de `ui_definitiva/cursor` substituiu os dois,
 * o valor passou a ser aplicado no `body` (vale em todas as telas, não só na
 * cena) e o estado é posto por quem de fato sabe o que está sob o ponteiro:
 * `NetEntity` (monstro), `GroundItems` (drop) e `GroundInteract` (bloqueio).
 */
