import { useEditorStore, SPAWN_MONSTERS, SPAWN_NPCS, TRIGGER_KINDS, LEDGE_ANGLES, type Brush } from "./editorStore";
import type { TriggerKind } from "@ragnarok/map-format";
import { propLabel } from "../props/registry";
import { IconBtn, TextBtn, VSep } from "./EditorUi";
import { ink } from "../ui/rpg";
import { IcRotL, IcRotR, IcPlus, IcMinus, IcDuplicate, IcCopy, IcPaste, IcFocus, IcTrash } from "../ui/icons";

// giro restrito aos 6 lados do hexágono (0/60/120/180/240/300°) — bloco só
// pode ficar alinhado com os vizinhos, nunca torto (regra do usuário).
const ROT_STEP = Math.PI / 3; // 60°

/**
 * Paleta de SUPERFÍCIE, com a textura de verdade ao lado do nome.
 *
 * O nome sozinho não diz o que vai aparecer no chão — "pedra" pode ser laje,
 * cascalho ou paredão. A miniatura é a MESMA imagem que o terreno amostra
 * (`public/assets/terrain/thumb/*.png`, gerada pelo `terrain:textures` a partir
 * do mesmo pixel), então o que se escolhe é o que se vê.
 *
 * Água e rio não têm textura: a lâmina é material próprio, colorido por
 * profundidade — a miniatura deles reproduz esse degradê com as mesmas cores do
 * shader.
 */
const SURFACES: { brush: Brush; label: string; thumb: string; title: string }[] = [
  { brush: "grass", label: "Grama", thumb: "grass", title: "campo aberto — o chão padrão do mapa" },
  { brush: "dirt", label: "Terra", thumb: "dirt", title: "terra batida: trilha, praça, chão pisado" },
  { brush: "stone", label: "Pedra", thumb: "stone", title: "rocha — a mesma textura da montanha, mas ANDÁVEL" },
  { brush: "sand", label: "Areia", thumb: "sand", title: "praia e deserto" },
  { brush: "snow", label: "Neve", thumb: "snow", title: "campo nevado" },
  {
    brush: "water",
    label: "Lago",
    thumb: "water",
    title: "água parada: célula ANDÁVEL com lâmina d'água por cima (é assim no rAthena)",
  },
];

const BRUSHES: { brush: Brush; label: string; color: string; title?: string }[] = [
  { brush: "raise", label: "Subir ▲", color: "#fbbf24" },
  { brush: "lower", label: "Descer ▼", color: "#f87171" },
  { brush: "smooth", label: "Suavizar", color: "#a78bfa" },
  {
    brush: "ramp",
    label: "Rampa ⟋",
    color: "#34d399",
    title: "arraste de baixo para cima: faz uma encosta LISA entre os dois níveis (o Suavizar só tira média)",
  },
  { brush: "flatten", label: "Nivelar", color: "#22d3ee" },
  { brush: "noise", label: "Ruído", color: "#f472b6" },
];

/**
 * Pincéis de ESCULTURA (o Sculpt Mode do Blender, adaptado a heightmap).
 *
 * Ficam num grupo à parte porque não trabalham como os de cima: `grab` é um
 * gesto de arrastar e os outros dois moldam a forma em vez de somar altura.
 */
const SCULPT_BRUSHES: { brush: Brush; label: string; color: string; title: string }[] = [
  {
    brush: "grab",
    label: "Puxar ✋",
    color: "#fb923c",
    title: "arraste: a região sobe conforme a distância do gesto (volte ao ponto de partida para desfazer)",
  },
  {
    brush: "inflate",
    label: "Inflar ◯",
    color: "#facc15",
    title: "dá volume ao longo da normal: o topo plano sobe mais que a encosta, arredondando a forma",
  },
  {
    brush: "scrape",
    label: "Raspar ▁",
    color: "#94a3b8",
    title: "raspa só o que está ACIMA do centro do pincel, criando platô (nunca preenche buraco)",
  },
  {
    brush: "ledge",
    label: "Promontório ◤",
    color: "#84cc16",
    title:
      "arraste da raiz para fora: ergue um morro BICUDO com a face no ângulo escolhido, mato em cima e rocha embaixo. Largura pelo Tamanho, altura pelo Ângulo.",
  },
];

/**
 * Pincéis do BURACO — só agem onde já está bloqueado e não mudam a passagem.
 *
 * O `map_cache` do rAthena marca "gap" tanto onde o mapa original tinha um
 * penhasco quanto onde tinha uma encosta de montanha; qual dos dois é, só quem
 * edita sabe. Estes dois pincéis decidem a aparência sem tocar na colisão.
 */
const CLIFF_BRUSHES: { brush: Brush; label: string; color: string; title: string }[] = [
  { brush: "cliffUp", label: "Elevar ⛰", color: "#a3a3a3", title: "vira encosta/montanha (continua bloqueado)" },
  { brush: "cliffDown", label: "Afundar ⤓", color: "#7c5b3f", title: "vira buraco/ravina (continua bloqueado)" },
];

/**
 * Pincéis que MUDAM A PASSAGEM — o resto do editor nunca fecha nem abre célula.
 *
 * Ficam num grupo próprio e nomeado por isso: "Subir ▲" faz morro em que se
 * anda, "Montanha" faz parede. Os dois erguem relevo, e só o rótulo separa um
 * do outro na hora de usar.
 */
const BLOCK_BRUSHES: { brush: Brush; label: string; color: string; title: string }[] = [
  {
    brush: "mountain",
    label: "Montanha ⛰",
    color: "#8b8f98",
    title: "ergue MUITO e fecha a passagem (parede de pedra) — o Subir ▲ faz morro andável",
  },
  {
    brush: "mountainClear",
    label: "Desfazer ⛏",
    color: "#c084fc",
    title: "devolve ao chão a montanha pintada aqui (não toca em mata nem penhasco do mapa original)",
  },
  {
    brush: "riverShallow",
    label: "Rio raso 〰",
    color: "#67e8f9",
    title: "água CORRENTE rasa: atravessa a pé. Diferente do Lago só no visual da lâmina",
  },
  {
    brush: "riverDeep",
    label: "Rio fundo 🌊",
    color: "#1d4ed8",
    title: "canal fundo: bloqueia a passagem (pinte o raso nas margens)",
  },
];

const inputStyle = { background: ink.slot, border: `1px solid ${ink.border}`, borderRadius: 6, color: ink.text, font: "11px system-ui", padding: "4px 6px" } as const;
const lbl = { font: "10px system-ui", color: ink.faint, whiteSpace: "nowrap" as const };

/** botão de superfície: amostra da textura + nome, no lugar de um quadradinho de cor */
function SurfaceBtn({
  item,
  active,
  onPick,
}: {
  item: { brush: Brush; label: string; thumb: string; title: string };
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      title={item.title}
      onClick={onPick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px 3px 3px",
        borderRadius: 7,
        cursor: "pointer",
        font: `${active ? 600 : 400} 11px system-ui`,
        color: active ? ink.text : ink.dim,
        background: active ? "rgba(255,255,255,0.12)" : "transparent",
        border: `1px solid ${active ? ink.text : ink.border}`,
      }}
    >
      <img
        src={`/assets/terrain/thumb/${item.thumb}.png`}
        alt=""
        width={22}
        height={22}
        // a textura ladrilha no chão; a amostra também, senão a miniatura de uma
        // textura de padrão largo vira uma mancha de cor sem informação
        style={{ borderRadius: 4, display: "block", border: `1px solid ${ink.border}`, objectFit: "cover" }}
      />
      {item.label}
    </button>
  );
}

/**
 * Barra de opções contextual (abaixo da top bar): mostra os controles da
 * ferramenta ativa — pincéis do terreno, config de spawn, tipo de gatilho,
 * transformações do objeto selecionado, etc. Some quando não há o que mostrar.
 */
export function ToolOptions() {
  const tool = useEditorStore((s) => s.tool);
  const s = useEditorStore();

  let content: React.ReactNode = null;

  if (tool === "brush") {
    content = (
      <>
        {SURFACES.map((s2) => (
          <SurfaceBtn key={s2.brush} item={s2} active={s.brush === s2.brush} onPick={() => s.setBrush(s2.brush)} />
        ))}
        <VSep />
        {BRUSHES.map((b) => (
          <span key={b.brush} title={b.title} style={{ display: "flex" }}>
            <TextBtn active={s.brush === b.brush} accent={b.color} onClick={() => s.setBrush(b.brush)}>{b.label}</TextBtn>
          </span>
        ))}
        <VSep />
        <span style={lbl}>Escultura</span>
        {SCULPT_BRUSHES.map((b) => (
          <span key={b.brush} title={b.title} style={{ display: "flex" }}>
            <TextBtn active={s.brush === b.brush} accent={b.color} onClick={() => s.setBrush(b.brush)}>{b.label}</TextBtn>
          </span>
        ))}
        {/* buraco/encosta: só em mapa importado, que é onde existe "gap" do rAthena */}
        {s.map?.terrainMode === "square" && (
          <>
            <VSep />
            <span style={lbl}>Bloqueado</span>
            {CLIFF_BRUSHES.map((b) => (
              <span key={b.brush} title={b.title} style={{ display: "flex" }}>
                <TextBtn active={s.brush === b.brush} accent={b.color} onClick={() => s.setBrush(b.brush)}>{b.label}</TextBtn>
              </span>
            ))}
            <VSep />
            <span style={lbl}>Passagem</span>
            {BLOCK_BRUSHES.map((b) => (
              <span key={b.brush} title={b.title} style={{ display: "flex" }}>
                <TextBtn active={s.brush === b.brush} accent={b.color} onClick={() => s.setBrush(b.brush)}>{b.label}</TextBtn>
              </span>
            ))}
          </>
        )}
        <VSep />
        <span style={lbl}>Tamanho {s.brushSize}</span>
        <input type="range" min={0} max={12} value={s.brushSize} onChange={(e) => s.setBrushSize(Number(e.target.value))} style={{ width: 90 }} />
        {/* força só faz sentido nos pincéis de relevo — grama/água é tudo-ou-nada */}
        {s.brush === "mountain" && (
          <span
            title="0 = cúpula lisa. Acima disso a montanha ganha cristas, sulcos e lascas em vez de morro redondo — é a deformidade de rocha da referência."
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={lbl}>Aspereza {s.mountainRough.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.mountainRough}
              onChange={(e) => s.setMountainRough(Number(e.target.value))}
              style={{ width: 90 }}
            />
          </span>
        )}
        {/* o promontório não tem Força: quem decide a altura é o ÂNGULO da face */}
        {s.brush === "ledge" && (
          <span
            title="inclinação da face do morro. Mais graus = mais alto e mais íngreme, porque a altura sai da largura vezes a tangente do ângulo."
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <span style={lbl}>Ângulo</span>
            {LEDGE_ANGLES.map((g) => (
              <TextBtn key={g} active={s.ledgeAngle === g} accent="#84cc16" onClick={() => s.setLedgeAngle(g)}>
                {g}°
              </TextBtn>
            ))}
          </span>
        )}
        {["raise", "lower", "smooth", "flatten", "noise", "grab", "inflate", "scrape", "mountain"].includes(s.brush) && (
          <span title="quanto o CENTRO do pincel se move por aplicação; a vizinhança acompanha em degradê (Proportional Editing)" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={lbl}>Força {s.brushStrength.toFixed(2)}</span>
            <input
              type="range"
              min={0.05}
              max={1.5}
              step={0.05}
              value={s.brushStrength}
              onChange={(e) => s.setBrushStrength(Number(e.target.value))}
              style={{ width: 90 }}
            />
          </span>
        )}
      </>
    );
  } else if (tool === "place") {
    content = s.currentAsset ? (
      <>
        <span style={{ font: "600 11px system-ui", color: ink.text }}>{propLabel(s.currentAsset)}</span>
        <TextBtn onClick={() => s.setAsset(null)}>✕ soltar</TextBtn>
        <VSep />
        <TextBtn active={s.propPaint} onClick={() => s.setPropPaint(!s.propPaint)}>Pincel de props</TextBtn>
        {s.propPaint && (
          <>
            <span style={lbl}>Densidade {s.propDensity}</span>
            <input type="range" min={1} max={10} value={s.propDensity} onChange={(e) => s.setPropDensity(Number(e.target.value))} style={{ width: 80 }} />
            <span style={lbl}>Raio {s.brushSize}</span>
            <input type="range" min={0} max={5} value={s.brushSize} onChange={(e) => s.setBrushSize(Number(e.target.value))} style={{ width: 80 }} />
          </>
        )}
      </>
    ) : (
      <span style={{ font: "11px system-ui", color: ink.faint }}>Escolha um asset no dock <b>Assets</b> (direita) pra colocar no mapa.</span>
    );
  } else if (tool === "spawn") {
    content = (
      <>
        <TextBtn active={s.spawnKind === "player"} onClick={() => s.setSpawnKind("player")}>Player</TextBtn>
        <TextBtn active={s.spawnKind === "mob"} onClick={() => s.setSpawnKind("mob")}>Monstro</TextBtn>
        <TextBtn active={s.spawnKind === "npc"} onClick={() => s.setSpawnKind("npc")}>NPC</TextBtn>
        <TextBtn active={s.spawnKind === "road"} onClick={() => s.setSpawnKind("road")}>Nó de estrada</TextBtn>
        <TextBtn active={s.spawnKind === "river"} onClick={() => s.setSpawnKind("river")}>Nó de rio</TextBtn>
        {s.spawnKind === "road" && <span style={{ font: "11px system-ui", color: ink.faint }}>Ponha ≥2 nós; depois "Estradas" liga eles.</span>}
        {s.spawnKind === "river" && <span style={{ font: "11px system-ui", color: ink.faint }}>Ponha ≥2 nós; depois "Rio" liga eles. Sem nó nenhum, o rio sai de borda a borda.</span>}
        {s.spawnKind === "mob" && (
          <>
            <VSep />
            <select value={s.monsterKey} onChange={(e) => s.setMonsterKey(e.target.value)} style={inputStyle}>
              {SPAWN_MONSTERS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <span style={lbl}>Qtd {s.spawnCount}</span>
            <input type="range" min={1} max={20} value={s.spawnCount} onChange={(e) => s.setSpawnCount(Number(e.target.value))} style={{ width: 70 }} />
            <span style={lbl}>Raio {s.spawnRadius}</span>
            <input type="range" min={0} max={30} value={s.spawnRadius} onChange={(e) => s.setSpawnRadius(Number(e.target.value))} style={{ width: 70 }} />
          </>
        )}
        {s.spawnKind === "npc" && (
          <>
            <VSep />
            <select value={s.monsterKey} onChange={(e) => s.setMonsterKey(e.target.value)} style={inputStyle}>
              {SPAWN_NPCS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </>
        )}
      </>
    );
  } else if (tool === "area") {
    content = (
      <>
        <span style={lbl}>Tipo de gatilho</span>
        <select value={s.triggerKind} onChange={(e) => s.setTriggerKind(e.target.value as TriggerKind)} style={inputStyle}>
          {TRIGGER_KINDS.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
        </select>
        <span style={{ font: "11px system-ui", color: ink.faint }}>Arraste na grade pra desenhar a área.</span>
      </>
    );
  } else if (tool === "path") {
    content = <span style={{ font: "11px system-ui", color: ink.faint }}>Clique células pra adicionar waypoints à rota do NPC selecionado. <b>Esc</b> encerra.</span>;
  } else if (tool === "prefab") {
    content = <span style={{ font: "11px system-ui", color: ink.faint }}>Clique no terreno pra carimbar o prefab. <b>Esc</b> desarma.</span>;
  } else if (tool === "measure") {
    content = (
      <>
        <span style={{ font: "11px system-ui", color: ink.faint }}>Clique 2 pontos pra medir a distância.</span>
        <TextBtn onClick={s.clearMeasure}>Limpar</TextBtn>
      </>
    );
  } else if (tool === "select") {
    const hasSel = s.selected != null || s.selectedSpawn != null || s.multi.length > 0;
    const hasProp = s.selected != null || s.multi.length > 0;
    content = (
      <>
        <span style={lbl}>Girar</span>
        <IconBtn icon={<IcRotL />} label="Girar -60°" disabled={!hasProp} onClick={() => s.rotateSelected(-ROT_STEP)} />
        <IconBtn icon={<IcRotR />} label="Girar +60°" disabled={!hasProp} onClick={() => s.rotateSelected(ROT_STEP)} />
        <span style={lbl}>Escalar</span>
        <IconBtn icon={<IcPlus />} label="Aumentar" disabled={!hasProp} onClick={() => s.scaleSelected(1)} />
        <IconBtn icon={<IcMinus />} label="Diminuir" disabled={!hasProp} onClick={() => s.scaleSelected(-1)} />
        <VSep />
        <IconBtn icon={<IcDuplicate />} label="Duplicar (Ctrl+D)" shortcut="⌃D" disabled={!hasSel} onClick={s.duplicateSelected} />
        <IconBtn icon={<IcCopy />} label="Copiar (Ctrl+C)" shortcut="⌃C" disabled={!hasSel} onClick={s.copySelected} />
        <IconBtn icon={<IcPaste />} label="Colar (Ctrl+V)" shortcut="⌃V" disabled={s.clipboard == null} onClick={s.paste} />
        <IconBtn icon={<IcFocus />} label="Focar câmera (F)" shortcut="F" disabled={!hasSel} onClick={s.requestFocus} />
        <VSep />
        <IconBtn icon={<IcTrash />} label="Deletar" danger disabled={!hasSel} onClick={s.deleteSelected} />
        {!hasSel && <span style={{ font: "11px system-ui", color: ink.faint }}>Clique num objeto pra selecionar · Shift+clique = vários.</span>}
      </>
    );
  }

  if (!content) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        maxWidth: "min(920px, calc(100vw - 360px))",
        padding: "7px 10px",
        background: ink.panel,
        backdropFilter: "blur(7px)",
        WebkitBackdropFilter: "blur(7px)",
        border: `1px solid ${ink.border}`,
        borderRadius: 10,
        boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
      }}
    >
      {content}
    </div>
  );
}
