import type { ReactNode } from "react";
import { useEditorStore, type TerrainFeatures } from "./editorStore";
import { ink } from "../ui/rpg";

/**
 * Terreno procedural, dividido por ASSUNTO em vez de uma lista só:
 *   Relevo  — colinas (altura do chão)
 *   Água    — lagos e rio
 *   Estradas — rede ligando os nós
 * Cada item tem ♻ próprio (re-randomiza só ele). Relevo/lagos regeneram o
 * terreno do zero, então gere rio/estrada DEPOIS deles — o aviso está no painel.
 *
 * Montanha NÃO é mais altura esculpida aqui — virou asset espalhável (como
 * árvore/construção) em "Vegetação & construções", com cada modelo
 * ativável/desativável e escala real (regra do usuário: montanha é objeto, não
 * relevo procedural — evita o degrau artificial + rampa forçada de antes).
 */

const RELIEF: { key: keyof TerrainFeatures; label: string; color: string; hint: string }[] = [
  { key: "hill", label: "Colinas", color: "#a3e635", hint: "ondulação suave do chão" },
];
const WATER: { key: keyof TerrainFeatures; label: string; color: string; hint: string }[] = [
  { key: "lake", label: "Lagos", color: "#38bdf8", hint: "bacias de água — a margem vira praia" },
];

const btnBase = {
  padding: "6px",
  borderRadius: 6,
  border: `1px solid ${ink.border}`,
  background: "rgba(255,255,255,0.06)",
  color: ink.text,
  font: "600 11px system-ui",
  cursor: "pointer",
} as const;

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ font: "700 10px system-ui", letterSpacing: 0.6, textTransform: "uppercase", color: ink.faint, marginBottom: 6 }}>{title}</div>
      {hint && <p style={{ font: "9px system-ui", color: ink.faint, margin: "0 0 6px" }}>{hint}</p>}
      {children}
    </div>
  );
}

/** slider de feature com bolinha de cor e ♻ próprio */
function FeatureRow({ item }: { item: { key: keyof TerrainFeatures; label: string; color: string; hint: string } }) {
  // a camada é do ESCOPO ativo (barra de cima): relevo do miolo e da borda são
  // sliders diferentes, cada um com seu valor
  const amt = useEditorStore((s) => s.terrainFeatures[s.editScope][item.key]);
  const setFeature = useEditorStore((s) => s.setTerrainFeature);
  const reseedFeature = useEditorStore((s) => s.reseedFeature);
  const beginStroke = useEditorStore((s) => s.beginStroke);
  return (
    <div style={{ marginBottom: 8 }} title={item.hint}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: item.color }} />
        <span style={{ font: "600 11px system-ui", color: ink.text }}>{item.label}</span>
        <span style={{ font: "10px system-ui", color: ink.faint }}>{amt}%</span>
        <button
          title={`Re-randomizar ${item.label} em outro lugar`}
          onClick={() => { beginStroke(); reseedFeature(item.key); }}
          disabled={amt <= 0}
          style={{ marginLeft: "auto", ...btnBase, padding: "1px 7px", font: "12px system-ui", cursor: amt <= 0 ? "default" : "pointer", opacity: amt <= 0 ? 0.35 : 1 }}
        >
          ♻
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={amt}
        onPointerDown={() => beginStroke()}
        onChange={(e) => setFeature(item.key, Number(e.target.value))}
        style={{ width: "100%" }}
      />
    </div>
  );
}

/** botão de gerar + ♻ (rio/estrada usam o mesmo formato — sempre 1 hex de largura).
 * O ♻ chama `onReroll`, que NÃO é o mesmo que gerar: o traçado da estrada é
 * determinístico (pra arrastar um nó religar sem redesenhar o resto), então
 * clicar duas vezes em "Estradas" dá a mesma rede — quem sorteia outra é o ♻. */
function PathRow({ label, icon, onGenerate, onReroll, badge }: { label: string; icon: string; onGenerate: () => void; onReroll?: () => void; badge?: string }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
      <button onClick={onGenerate} style={{ ...btnBase, flex: 1 }}>{icon} {label}{badge ? ` ${badge}` : ""}</button>
      <button onClick={onReroll ?? onGenerate} title={`Sortear outra ${label.toLowerCase()}`} style={{ ...btnBase, padding: "6px 9px" }}>♻</button>
    </div>
  );
}

export function TerrainPanel() {
  const escopo = useEditorStore((s) => s.editScope);
  const reseed = useEditorStore((s) => s.reseedTerrain);
  const beginStroke = useEditorStore((s) => s.beginStroke);
  const generateRoads = useEditorStore((s) => s.generateRoads);
  const generateRiver = useEditorStore((s) => s.generateRiver);
  const clearPaths = useEditorStore((s) => s.clearPaths);
  const roadNodes = useEditorStore((s) => s.map?.spawns.filter((sp) => sp.kind === "road_node").length ?? 0);

  return (
    <>
      <div style={{ font: "10px system-ui", color: ink.dim, marginBottom: 8 }}>
        Camada:{" "}
        <b style={{ color: ink.text }}>
          {escopo === "inside" ? "dentro do mapa" : escopo === "border" ? "borda" : escopo === "hole" ? "buraco" : "tudo"}
        </b>{" "}
        — relevo e água entram só nessa parte, por cima do que já existe.
      </div>

      <Group title="Relevo" hint="Gera o relevo na camada escolhida na barra de cima (os props ficam). Montanhas ficam em Vegetação & construções, como asset.">
        {RELIEF.map((f) => <FeatureRow key={f.key} item={f} />)}
      </Group>

      <Group title="Água" hint="Lago = massa parada (margem vira praia). Rio = canal que atravessa o mapa e escava um vale.">
        {WATER.map((f) => <FeatureRow key={f.key} item={f} />)}
        <PathRow label="Rio" icon="🌊" onGenerate={generateRiver} />
      </Group>

      <Group title="Estradas" hint="Clicar já cria nós aleatórios e liga em rede. Ponha nós de estrada (Spawn) pra fixar pontos.">
        <PathRow
          label="Estradas"
          icon="🛣"
          onGenerate={() => generateRoads()}
          onReroll={() => generateRoads(true)}
          badge={roadNodes >= 2 ? `(${roadNodes})` : undefined}
        />
      </Group>

      <div style={{ height: 1, background: ink.border, margin: "0 0 8px" }} />
      <p style={{ font: "9px system-ui", color: ink.faint, margin: "0 0 6px" }}>
        Ordem: <b>relevo e lagos primeiro</b>, depois rio e estradas. Em mapa importado do rAthena o
        relevo NÃO mexe em parede nem buraco — para esses use os pincéis Elevar/Afundar buraco.
      </p>
      <button onClick={() => { beginStroke(); reseed(); }} style={{ ...btnBase, width: "100%", font: "600 12px system-ui", marginBottom: 6 }}>
        ♻ Novo relevo (re-seed geral)
      </button>
      <button onClick={clearPaths} style={{ ...btnBase, width: "100%" }}>Limpar rios/estradas</button>
    </>
  );
}
