import { useState, type ReactElement } from "react";
import type * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { useHudStore, type WindowKey } from "./hudStore";
import { usePlayStore } from "../play/playStore";
import { useCharacterStore } from "../character/characterStore";
import { usePlayerStore } from "../net/playerStore";
import { gateway } from "../net/gateway";
import { Panel, IconSquare, RpgButton, Slot, UI_PACK_CREDIT } from "../ui/rpg";
import { InventoryWindow } from "./InventoryWindow";
import { StatusWindow as StatusArtWindow } from "./StatusWindow";
import { FriendsWindow } from "./FriendsWindow";
import { SkillsWindow as SkillsArtWindow } from "./SkillsWindow";
import { QuestsWindow as QuestsArtWindow } from "./QuestsWindow";
import { MapWindow as MapArtWindow } from "./MapWindow";

/**
 * janela central genérica: título + fechar. Conteúdo por chave.
 *
 * `map`/`playerPos` chegam do `Hud` porque a janela do Alt+M desenha o MAPA em
 * que o personagem está — as mesmas duas coisas que o minimapa recebe, e pelo
 * mesmo motivo: sem sessão (preview do editor) quem sabe onde o boneco está é o
 * ref da cena, não o `worldStore`.
 */
export function Windows({
  map,
  playerPos,
}: {
  map: GameMap;
  playerPos: React.MutableRefObject<THREE.Vector3>;
}) {
  const open = useHudStore((s) => s.openWindow);
  const close = () => useHudStore.getState().setWindow(null);
  if (!open) return null;

  // Inventário, Status, Amigos, Habilidades, Missões e Mapa têm arte PRÓPRIA —
  // moldura, título e botão de fechar vêm no desenho —, então não entram no
  // `Panel` genérico: a página pixel-art do TravelBook por baixo brigaria com a
  // madeira pintada delas. Por isso as seis também não aparecem em
  // TITLES/CONTENT: o desvio é aqui, e o Record cobre só o que ainda usa o Panel.
  switch (open) {
    case "inventory":
      return <Centralizada>{<InventoryWindow />}</Centralizada>;
    case "status":
      return <Centralizada>{<StatusArtWindow />}</Centralizada>;
    case "friends":
      return <Centralizada>{<FriendsWindow />}</Centralizada>;
    case "skills":
      return <Centralizada>{<SkillsArtWindow />}</Centralizada>;
    case "quests":
      return <Centralizada>{<QuestsArtWindow />}</Centralizada>;
    case "map":
      return <Centralizada>{<MapArtWindow map={map} playerPos={playerPos} />}</Centralizada>;
  }

  const meta = TITLES[open];
  const Content = CONTENT[open];

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto" }}>
        <Panel style={{ width: `min(${meta.width}px, 92vw)`, maxHeight: "80vh", overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
            <div style={{ font: "700 16px system-ui", color: "#493333" }}>{meta.title}</div>
            <div style={{ marginLeft: "auto" }}>
              <RpgButton color="brown" onClick={close}>
                ✕
              </RpgButton>
            </div>
          </div>
          <Content />
        </Panel>
      </div>
    </div>
  );
}

/** casca comum das janelas com arte própria: centraliza sem comer o clique */
function Centralizada({ children }: { children: ReactElement }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto" }}>{children}</div>
    </div>
  );
}

type PanelKey = Exclude<WindowKey, null | "friends" | "skills" | "quests" | "map">;

const TITLES: Record<PanelKey, { title: string; width: number }> = {
  status: { title: "Atributos & Equipamentos", width: 620 },
  inventory: { title: "Inventário", width: 460 },
  settings: { title: "Configurações", width: 420 },
};

const CONTENT: Record<PanelKey, () => ReactElement> = {
  status: StatusWindow,
  inventory: InventoryWindow,
  settings: SettingsWindow,
};


// ---- Status: equip (esq) | atributos centralizados + sub-stats derivados (dir) ----
const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"] as const;
const ATTR_LABEL: Record<(typeof ATTR_KEYS)[number], string> = {
  str: "STR", agi: "AGI", vit: "VIT", int: "INT", dex: "DEX", luk: "LUK",
};

function StatusWindow() {
  const data = useCharacterStore((s) => s.data);
  const online = usePlayerStore((s) => s.known);
  const stats = usePlayerStore((s) => s.stats);

  // Com sessão, TODO número aqui é do map-server (inclusive ATK/FLEE/ASPD, que
  // o rAthena já manda calculados em ZC.STATUS). Sem sessão, cai na ficha
  // derivada localmente pelo engine-core.
  const attrs = online
    ? { str: stats.str, agi: stats.agi, vit: stats.vit, int: stats.int, dex: stats.dex, luk: stats.luk }
    : (data?.attrs ?? { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 });
  const upCost: Record<(typeof ATTR_KEYS)[number], number> = {
    str: stats.upStr,
    agi: stats.upAgi,
    vit: stats.upVit,
    int: stats.upInt,
    dex: stats.upDex,
    luk: stats.upLuk,
  };
  const d = data?.derived;
  const derived: [string, string][] = online
    ? [
        ["ATK", `${stats.atk} + ${stats.atkBonus}`],
        ["MATK", `${stats.matkMin} ~ ${stats.matkMax}`],
        ["HIT", `${stats.hit}`],
        ["CRITICAL", `${stats.critical}`],
        // ASPD do pacote é o valor interno (amotion); o RO mostra 200 - x/10.
        ["ASPD", `${(200 - stats.aspd / 10).toFixed(1)}`],
        ["FLEE", `${stats.flee} + ${stats.fleeBonus}`],
        ["DEF", `${stats.def} + ${stats.defBonus}`],
        ["MDEF", `${stats.mdef} + ${stats.mdefBonus}`],
      ]
    : [
        ["ATK", `${d?.atk ?? "—"}`],
        ["MATK", `${d?.matk ?? "—"}`],
        ["HIT", `${d?.hit ?? "—"}`],
        ["CRITICAL", d ? `${d.crit}%` : "—"],
        ["ASPD", `${d?.aspd ?? "—"}`],
        ["FLEE", `${d?.flee ?? "—"}`],
        ["DEF", `${d?.def ?? "—"}`],
        ["MDEF", `${d?.mdef ?? "—"}`],
      ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* equipamentos em volta do boneco */}
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, placeItems: "center" }}>
          <EquipSlot label="Topo" />
          <div style={{ gridColumn: "2 / 4", gridRow: "1 / 5", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 90, height: 150, borderRadius: 10, background: "hsl(210,55%,50%)", boxShadow: "inset 0 0 0 3px rgba(0,0,0,0.25)" }} />
          </div>
          <EquipSlot label="Meio" />
          <EquipSlot label="Boca" />
          <EquipSlot label="Peito" />
          <EquipSlot label="Capa" />
          <EquipSlot label="Mão E" />
          <EquipSlot label="Calça" />
          <EquipSlot label="Mão D" />
          <EquipSlot label="Anel E" />
          <EquipSlot label="Bota" />
          <EquipSlot label="Anel D" />
          <EquipSlot label="Munição" />
        </div>
        <p style={{ font: "10px system-ui", color: "#8a7868", marginTop: 8, textAlign: "center" }}>
          {data?.jobName ?? "Swordman"} · Nv {data?.level ?? "—"}
        </p>
      </div>
      {/* atributos centralizados + sub-stats */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ font: "700 12px system-ui", color: "#493333", marginBottom: 8 }}>
          Atributos{online && ` · ${stats.statusPoint} pontos`}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, auto)", gap: "6px 22px", justifyContent: "center" }}>
          {ATTR_KEYS.map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 78 }}>
              <span style={{ font: "700 12px system-ui", color: "#6b4a35" }}>{ATTR_LABEL[k]}</span>
              <span style={{ font: "700 13px system-ui", color: "#493333" }}>{attrs[k]}</span>
              {online && (
                // "+" do RO: o número é quanto custa o próximo ponto. Desabilita
                // quando não dá — mas quem valida de verdade é o servidor.
                <button
                  title={`custa ${upCost[k]} pontos`}
                  disabled={stats.statusPoint < upCost[k]}
                  onClick={() => gateway().emit("stat:raise", { stat: k })}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: stats.statusPoint >= upCost[k] ? "#4f46e5" : "rgba(255,215,168,0.45)",
                    color: stats.statusPoint >= upCost[k] ? "#fff" : "#8a7868",
                    font: "700 11px system-ui",
                    cursor: stats.statusPoint >= upCost[k] ? "pointer" : "default",
                    lineHeight: 1,
                  }}
                >
                  +
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={{ width: "100%", height: 1, background: "rgba(73,51,51,0.25)", margin: "12px 0" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "5px 14px", width: "100%" }}>
          {derived.map(([label, val]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", font: "12px system-ui" }}>
              <span style={{ color: "#6b4a35" }}>{label}</span>
              <span style={{ color: "#493333", fontWeight: 700 }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EquipSlot({ label }: { label: string }) {
  return (
    <Slot size={40} title={label}>
      {label}
    </Slot>
  );
}



/**
 * Não há mais bloco "Movimento" aqui.
 *
 * Ele oferecia "Clique-tile (RO)" e "WASD livre", e era o ÚNICO jeito de ligar o
 * WASD. O jogo passou a ter um caminho de movimento só — o clique-tile —, então
 * a escolha deixou de existir junto com o outro caminho.
 */
function SettingsWindow() {
  return (
    <div style={{ font: "12px system-ui", color: "#493333" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <b>Volume & Gráfico</b>
          <div style={{ marginTop: 6 }}>Volume<br /><input type="range" style={{ width: "100%" }} /></div>
          <div style={{ marginTop: 6 }}>Qualidade<br /><input type="range" style={{ width: "100%" }} /></div>
          <div style={{ marginTop: 6 }}>Iluminação<br /><input type="range" style={{ width: "100%" }} /></div>
        </div>
        <div>
          <b>Atalhos</b>
          {HOTKEY_HELP.map(([acao, tecla]) => (
            <div key={acao} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span style={{ flex: 1 }}>{acao}</span>
              <b>{tecla}</b>
            </div>
          ))}
        </div>
      </div>
      {/* crédito exigido pela licença do pack de UI (uso comercial liberado,
          revenda proibida) — ver public/assets/ui/travelbook/LICENSE-crusenho.txt */}
      <p style={{ marginTop: 14, font: "10px system-ui", color: "#8a7868" }}>{UI_PACK_CREDIT}</p>
    </div>
  );
}

/** Mesmas teclas de hud/hotkeys.ts — o caminho de dedo do RO. */
const HOTKEY_HELP: [string, string][] = [
  ["Status / Equipamento", "Alt+A / Alt+Q"],
  ["Inventário", "Alt+E"],
  ["Habilidades", "Alt+S"],
  ["Mapa", "Alt+M"],
  ["Lista de Amigos", "Alt+Z"],
  ["Configurações", "Alt+O"],
];

// ---- quests ativas (meio-direita, sempre visível) ----
/**
 * Missões ativas.
 *
 * Com sessão, NÃO mostra nada: quem tem quest é o rAthena (ZC.QUEST_LIST) e o
 * cliente ainda não lê esse pacote — deixar "Limpar o campo: Skeletons 0/5" na
 * tela ao lado de um mundo real é mentira que confunde quem testa. Sem sessão
 * (preview do editor) o cartão de exemplo continua, para o autor ver o encaixe
 * do HUD.
 */
export function ActiveQuests() {
  const online = usePlayerStore((s) => s.known);
  if (online) return null;

  return (
    <Panel style={{ width: 220 }}>
      <div style={{ font: "700 12px system-ui", color: "#493333", marginBottom: 4 }}>Missões ativas</div>
      <div style={{ font: "11px system-ui", color: "#493333" }}>
        <div style={{ fontWeight: 700 }}>exemplo (preview do editor)</div>
        <div style={{ opacity: 0.8 }}>as missões reais vêm do servidor</div>
      </div>
    </Panel>
  );
}
