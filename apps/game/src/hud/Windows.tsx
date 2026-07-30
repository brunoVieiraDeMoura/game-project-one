import { useEffect, useState, type ReactElement } from "react";
import { useHudStore, type WindowKey } from "./hudStore";
import { usePlayStore } from "../play/playStore";
import { useCharacterStore } from "../character/characterStore";
import { usePlayerStore } from "../net/playerStore";
import { useSkillCatalog } from "../net/skillCatalog";
import { gateway } from "../net/gateway";
import { Panel, IconSquare, RpgButton, Slot, UI_PACK_CREDIT } from "../ui/rpg";
import { InventoryWindow } from "./InventoryWindow";
import { StatusWindow as StatusArtWindow } from "./StatusWindow";

/** janela central genérica: título + fechar. Conteúdo por chave. */
export function Windows() {
  const open = useHudStore((s) => s.openWindow);
  const close = () => useHudStore.getState().setWindow(null);
  if (!open) return null;
  const meta = TITLES[open];
  const Content = CONTENT[open];

  // Inventário e Status têm arte PRÓPRIA — moldura, título e botão de fechar
  // vêm no desenho —, então não entram no `Panel` genérico: a página pixel-art
  // do TravelBook por baixo brigaria com a madeira pintada deles.
  const comArte = open === "inventory" ? <InventoryWindow /> : open === "status" ? <StatusArtWindow /> : null;
  if (comArte) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ pointerEvents: "auto" }}>{comArte}</div>
      </div>
    );
  }

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

const TITLES: Record<Exclude<WindowKey, null>, { title: string; width: number }> = {
  skills: { title: "Habilidades", width: 520 },
  status: { title: "Atributos & Equipamentos", width: 620 },
  inventory: { title: "Inventário", width: 460 },
  friends: { title: "Amigos & Party", width: 460 },
  quests: { title: "Quests", width: 460 },
  settings: { title: "Configurações", width: 420 },
  map: { title: "Mapa", width: 420 },
};

const CONTENT: Record<Exclude<WindowKey, null>, () => ReactElement> = {
  skills: SkillsWindow,
  status: StatusWindow,
  inventory: InventoryWindow,
  friends: FriendsWindow,
  quests: QuestsWindow,
  settings: SettingsWindow,
  map: MapWindow,
};

// ---- Habilidades: árvore real da classe (Swordman) vinda do admin /skills ----
function SkillsWindow() {
  const data = useCharacterStore((s) => s.data);
  const online = usePlayerStore((s) => s.known);
  const netSkills = usePlayerStore((s) => s.skills);
  const skillPoint = usePlayerStore((s) => s.stats.skillPoint);

  // Online: a árvore é a que o personagem REALMENTE tem no servidor
  // (ZC.SKILLINFO_LIST), com o nível aprendido. `maxLevel` não vem no pacote —
  // o rAthena manda o nível atual e se dá para subir; mostrar um teto inventado
  // seria pior que não mostrar.
  // O pacote traz a CONSTANTE ("SM_BASH"); o nome que o jogador conhece está no
  // catálogo do admin, buscado por id.
  const catalog = useSkillCatalog((s) => s.byId);
  useEffect(() => {
    if (online) useSkillCatalog.getState().ensure(netSkills.map((sk) => sk.id));
  }, [online, netSkills]);

  const skills = online
    ? netSkills.map((sk) => ({ id: sk.id, name: catalog[sk.id]?.name ?? sk.name, level: sk.level, maxLevel: 0 }))
    : (data?.skills ?? []);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, font: "12px system-ui", color: "#493333" }}>
        <span>
          Classe: <b>{data?.jobName ?? "—"}</b>
        </span>
        {online && <span style={{ color: "#6b4a35" }}>· {skillPoint} pontos de habilidade</span>}
      </div>
      {skills.length === 0 ? (
        <p style={{ font: "12px system-ui", color: "#6b4a35" }}>
          {online
            ? "Este personagem ainda não aprendeu nenhuma habilidade."
            : "Sem sessão: a árvore de habilidades é do personagem no servidor."}
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {skills.map((sk) => (
            <div
              key={sk.id}
              // arrastar para a barra de skills (o jeito do RO de montar a barra)
              draggable={online}
              onDragStart={(e) => e.dataTransfer.setData("application/x-ro-skill", String(sk.id))}
              title={online ? "arraste para a barra de habilidades" : undefined}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center", cursor: online ? "grab" : "default" }}
            >
              <IconSquare seed={`sk-${sk.id}`} label={sk.name} size={42} />
              <div style={{ font: "11px system-ui", color: "#493333", lineHeight: 1.1, minHeight: 26 }}>{sk.name}</div>
              <div style={{ font: "10px system-ui", color: "#6b4a35" }}>
                Lv {sk.level}{sk.maxLevel ? `/${sk.maxLevel}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
      <p style={{ font: "10px system-ui", color: "#8a7868", marginTop: 10 }}>
        {online
          ? "Arraste uma habilidade para a barra embaixo. Lista do servidor (ZC.SKILLINFO_LIST)."
          : `Habilidades reais do ${data?.jobName ?? "Swordman"} (catálogo do admin).`}
      </p>
    </div>
  );
}

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

function FriendsWindow() {
  return (
    <div style={{ font: "12px system-ui", color: "#493333" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input placeholder="nome do amigo" style={{ flex: 1, padding: "6px 8px", borderRadius: 5, border: "1px solid rgba(73,51,51,0.35)", background: "rgba(255,215,168,0.55)", color: "#493333", outline: "none" }} />
        <RpgButton color="blue">Adicionar</RpgButton>
      </div>
      <div style={{ font: "700 12px system-ui", color: "#6b4a35", marginBottom: 4 }}>Amigos</div>
      <div style={{ background: "rgba(222,169,116,0.45)", borderRadius: 6, padding: 10, minHeight: 150, marginBottom: 12, color: "#6b4a35" }}>
        Sem amigos ainda.
      </div>
      <div style={{ font: "700 12px system-ui", color: "#6b4a35", marginBottom: 4 }}>Party</div>
      <div style={{ background: "rgba(222,169,116,0.45)", borderRadius: 6, padding: 10, minHeight: 90, marginBottom: 10, color: "#6b4a35" }}>
        Você não está em uma party.
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <RpgButton color="blue">Criar party</RpgButton>
        <RpgButton color="blue">Convidar</RpgButton>
        <RpgButton color="grey">Expulsar</RpgButton>
      </div>
    </div>
  );
}

function QuestsWindow() {
  const [quests, setQuests] = useState([
    { id: 1, name: "Limpar o campo", desc: "Derrote 5 skeletons." },
    { id: 2, name: "Explorar Prontera", desc: "Visite a fonte central." },
  ]);
  return (
    <div style={{ font: "12px system-ui", color: "#493333" }}>
      {quests.map((q) => (
        <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderBottom: "1px solid rgba(0,0,0,0.1)" }}>
          <IconSquare seed={`q-${q.id}`} size={28} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{q.name}</div>
            <div style={{ font: "11px system-ui", opacity: 0.8 }}>{q.desc}</div>
          </div>
          <RpgButton color="grey" onClick={() => setQuests((qs) => qs.filter((x) => x.id !== q.id))}>
            deletar
          </RpgButton>
        </div>
      ))}
      {quests.length === 0 && <div>Sem quests.</div>}
    </div>
  );
}

function SettingsWindow() {
  const mode = usePlayStore((s) => s.mode);
  const setMode = usePlayStore((s) => s.setMode);
  return (
    <div style={{ font: "12px system-ui", color: "#493333" }}>
      <div style={{ marginBottom: 14 }}>
        <b>Movimento</b>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <RpgButton color="blue" active={mode === "grid"} onClick={() => setMode("grid")}>
            Clique-tile (RO)
          </RpgButton>
          <RpgButton color="blue" active={mode === "free"} onClick={() => setMode("free")}>
            WASD livre
          </RpgButton>
        </div>
      </div>
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
  ["Amigos & Party", "Alt+Z"],
  ["Configurações", "Alt+O"],
];

function MapWindow() {
  return (
    <div style={{ font: "12px system-ui", color: "#493333" }}>
      <div style={{ height: 220, background: "rgba(0,0,0,0.08)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
        mapa atual (render entra aqui)
      </div>
      <div style={{ marginTop: 8 }}>
        <RpgButton color="blue">Abrir mapa-múndi</RpgButton>
      </div>
    </div>
  );
}

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
