import type { ReactNode } from "react";
import type { SurfaceType } from "@ragnarok/map-format";
import { useEditorStore, MOUNTAIN_ROCK_LAYER, type TerrainFeatures } from "./editorStore";
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
  { key: "hill", label: "Colinas", color: "#a3e635", hint: "ondulação do chão por todo o mapa — o slider dá altura e quantidade" },
  {
    key: "mountain",
    label: "Montanhas",
    color: "#a8a29e",
    hint: "maciços de rocha espalhados — bloqueiam passagem; o slider dá altura e quantidade",
  },
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

/**
 * Rochas na montanha: mesma linha de slider das outras camadas, mas o alvo são
 * as células que o pincel Montanha ⛰ ergueu (parede + pedra) — não o campo.
 *
 * Fica desabilitado enquanto não houver montanha nenhuma no escopo ativo, com o
 * motivo no `title`: um slider que não faz nada e não explica por quê é pior que
 * um slider apagado.
 */
function MountainRocksRow() {
  const escopo = useEditorStore((s) => s.editScope);
  const amt = useEditorStore((s) => s.procAmounts[`${s.editScope}:${MOUNTAIN_ROCK_LAYER}`] ?? 0);
  const set = useEditorStore((s) => s.setMountainRocks);
  const reseed = useEditorStore((s) => s.reseedMountainRocks);
  const beginStroke = useEditorStore((s) => s.beginStroke);
  const temMontanha = useEditorStore((s) =>
    (s.map?.collision ?? []).some((c, i) => c === "wall" && s.map!.surface[i] === "stone"),
  );
  const dica = temMontanha
    ? "matacões no cume, pedra miúda descendo a encosta (ref3)"
    : "pinte uma montanha com o pincel Montanha ⛰ para poder espalhar rochas nela";
  return (
    <div style={{ marginBottom: 8, opacity: temMontanha ? 1 : 0.45 }} title={dica}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: "#8b8f98" }} />
        <span style={{ font: "600 11px system-ui", color: ink.text }}>Rochas na montanha</span>
        <span style={{ font: "10px system-ui", color: ink.faint }}>{amt}%</span>
        <button
          title="Re-randomizar as rochas"
          onClick={() => { beginStroke(); reseed(); }}
          disabled={!temMontanha || amt <= 0}
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
        disabled={!temMontanha}
        onPointerDown={() => beginStroke()}
        onChange={(e) => set(Number(e.target.value))}
        style={{ width: "100%" }}
        key={escopo}
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
  const larguraRio = useEditorStore((s) => s.riverWidth);
  const setRiverWidth = useEditorStore((s) => s.setRiverWidth);
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

      <Group title="Relevo" hint="Gera o relevo na camada escolhida na barra de cima (os props ficam). Colina = morro ANDÁVEL; montanha = maciço de rocha que BLOQUEIA, a mesma forma do pincel Montanha ⛰.">
        {RELIEF.map((f) => <FeatureRow key={f.key} item={f} />)}
        <MountainRocksRow />
      </Group>

      {/* O LAGO saiu do gerador: ele espalhava bacias aleatórias e competia com
          o pincel de lago, que faz a mesma coisa onde o autor quer — e melhor,
          porque escava a bacia sobre o corpo inteiro em vez de discos soltos. */}
      <Group title="Estrada" hint="O traçado sai dos NÓS de estrada (ferramenta Caminho). A textura vale para a rede inteira e pode ser trocada a qualquer momento — o traçado é redesenhado na hora.">
        <TexturaDaEstrada />
      </Group>
      <Group title="Água" hint="Rio = canal que atravessa o mapa e escava um vale. Para lago, use o pincel de Lago no painel de pincéis.">
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ font: "10px system-ui", color: ink.dim }}>
            Largura do rio <b style={{ color: ink.text }}>{larguraRio === 0 ? "fio" : `${larguraRio * 2 + 1} células`}</b>
          </span>
          <input
            type="range"
            min={0}
            max={6}
            value={larguraRio}
            title="0 = fio de água atravessável em qualquer ponto. De 1 em diante o miolo vira canal FUNDO (bloqueia) com margem rasa (anda)."
            onChange={(e) => setRiverWidth(Number(e.target.value))}
            style={{ marginLeft: "auto", width: 90 }}
          />
        </div>
        <PathRow label="Rio" icon="🌊" onGenerate={generateRiver} />
        <p style={{ font: "9px system-ui", color: ink.faint, margin: "0 0 4px" }}>
          {larguraRio === 0
            ? "Fio de água: atravessa a pé em qualquer ponto."
            : "O miolo do canal BLOQUEIA a passagem; a margem rasa continua andável."}
        </p>
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

/**
 * Textura da estrada gerada.
 *
 * As quatro do pedido: areia, pedra, grama e terra. A miniatura vem do MESMO
 * pixel que o chão amostra (`/assets/terrain/thumb`) — nome sozinho não diz o
 * que vai aparecer, e "pedra" pode ser laje, cascalho ou paredão.
 *
 * Trocar redesenha na hora: o traçado já está no mapa, então a escolha é sobre
 * uma coisa que está na tela.
 */
const TEXTURAS_DE_ESTRADA: { valor: SurfaceType; label: string; dica: string }[] = [
  { valor: "dirt", label: "Terra", dica: "terra batida — a trilha de sempre" },
  { valor: "stone", label: "Pedra", dica: "via calçada, para cidade e estrada imperial" },
  { valor: "sand", label: "Areia", dica: "caminho de duna e de praia" },
  { valor: "grass", label: "Grama", dica: "trilha pisada, quase sem marca no campo" },
];

function TexturaDaEstrada() {
  const atual = useEditorStore((s) => s.roadSurface);
  const setRoadSurface = useEditorStore((s) => s.setRoadSurface);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
      {TEXTURAS_DE_ESTRADA.map((t) => {
        const ativo = atual === t.valor;
        return (
          <button
            key={t.valor}
            title={t.dica}
            onClick={() => setRoadSurface(t.valor)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 7px 3px 3px",
              borderRadius: 7,
              cursor: "pointer",
              font: `${ativo ? 600 : 400} 10px system-ui`,
              color: ativo ? ink.text : ink.dim,
              background: ativo ? "rgba(255,255,255,0.12)" : "transparent",
              border: `1px solid ${ativo ? ink.text : ink.border}`,
            }}
          >
            <img
              src={`/assets/terrain/thumb/${t.valor}.png`}
              alt=""
              width={18}
              height={18}
              style={{ borderRadius: 3, display: "block", border: `1px solid ${ink.border}`, objectFit: "cover" }}
            />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
