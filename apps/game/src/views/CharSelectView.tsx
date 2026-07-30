import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { gateway, type CharSummary } from "../net/gateway";
import { useSessionStore } from "../net/sessionStore";
import { usePlayerStore } from "../net/playerStore";
import { JOB_NAMES } from "../character/jobNames";
import { Panel, RpgBar, RpgButton, ink } from "../ui/rpg";

/**
 * Seleção de personagem, no formato do RO: fileira de slots, painel com a ficha
 * do escolhido, e as ações criar/apagar/entrar. Quem manda na lista é o
 * char-server — aqui só desenhamos o que veio pelo gateway.
 */
export function CharSelectView() {
  const navigate = useNavigate();
  const phase = useSessionStore((s) => s.phase);
  const chars = useSessionStore((s) => s.chars);
  const slots = useSessionStore((s) => s.slots);
  const error = useSessionStore((s) => s.error);
  const [cursor, setCursor] = useState(0);
  const [creatingAt, setCreatingAt] = useState<number | null>(null);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (phase === "offline") {
      navigate("/login");
    }
    if (phase === "playing") {
      navigate("/play");
    }
  }, [phase, navigate]);

  useEffect(() => {
    // Personagem recém-criado aparece na lista: fecha o formulário sozinho.
    if (creatingAt !== null && chars.some((c) => c.slot === creatingAt)) {
      setCreatingAt(null);
      setNewName("");
    }
  }, [chars, creatingAt]);

  // O char-server anuncia 12 slots mas o RO mostra 9 (3 páginas de 3); ficamos
  // no que ele disser, com um mínimo de 3 para nunca renderizar fileira vazia.
  const total = Math.max(3, Math.min(slots || 3, 9));
  const bySlot = new Map(chars.map((c) => [c.slot, c]));
  const current = bySlot.get(cursor) ?? null;

  const enter = (slot: number) => {
    useSessionStore.getState().selectSlot(slot);
    // A ficha da lista é o estado INICIAL do personagem: nível, zeny, classe e
    // atributos não vêm em pacote depois (o servidor só avisa quando mudam), e
    // o nome é exigido pelo pacote de fala ("Nome : mensagem").
    const chosen = chars.find((c) => c.slot === slot);
    if (chosen) usePlayerStore.getState().seedFromChar(chosen);
    gateway().emit("char:select", { slot });
  };

  const create = () => {
    if (creatingAt === null || !newName.trim()) return;
    gateway().emit("char:create", {
      slot: creatingAt,
      name: newName.trim(),
      hair: 1,
      hairColor: 1,
    });
  };

  return (
    <div style={backdrop}>
      <Panel style={{ width: 720, padding: 20 }}>
        <h1 style={title}>Escolha seu personagem</h1>

        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          {Array.from({ length: total }, (_, slot) => (
            <SlotCard
              key={slot}
              slot={slot}
              char={bySlot.get(slot) ?? null}
              selected={cursor === slot}
              onSelect={() => {
                setCursor(slot);
                setCreatingAt(null);
              }}
              onCreate={() => {
                setCursor(slot);
                setCreatingAt(slot);
              }}
            />
          ))}
        </div>

        {creatingAt !== null ? (
          <div style={{ marginTop: 18, display: "flex", gap: 8, alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 4, font: "12px system-ui", color: ink.dim }}>
              Nome do personagem (slot {creatingAt})
              <input
                autoFocus
                value={newName}
                maxLength={23}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
                style={input}
              />
            </label>
            <RpgButton color="blue" onClick={create}>
              Criar
            </RpgButton>
            <RpgButton onClick={() => setCreatingAt(null)}>Cancelar</RpgButton>
          </div>
        ) : (
          <div style={{ marginTop: 18, display: "flex", gap: 20, alignItems: "flex-start" }}>
            <CharSheet char={current} />
            <div style={{ display: "grid", gap: 8 }}>
              <RpgButton
                color="blue"
                onClick={() => current && enter(current.slot)}
                style={{ padding: "8px 18px", opacity: current ? 1 : 0.4 }}
              >
                Entrar no jogo
              </RpgButton>
              <RpgButton
                color="brown"
                onClick={() => current && gateway().emit("char:delete", { gid: current.gid, email: "" })}
                style={{ opacity: current ? 1 : 0.4 }}
              >
                Apagar
              </RpgButton>
            </div>
          </div>
        )}

        {phase === "entering" && <p style={{ ...hint, color: ink.dim }}>entrando no mapa…</p>}
        {error && <p style={errorStyle}>{error}</p>}
      </Panel>
    </div>
  );
}

function SlotCard({
  slot,
  char,
  selected,
  onSelect,
  onCreate,
}: {
  slot: number;
  char: CharSummary | null;
  selected: boolean;
  onSelect: () => void;
  onCreate: () => void;
}) {
  return (
    <button
      onClick={char ? onSelect : onCreate}
      style={{
        width: 150,
        height: 130,
        borderRadius: 10,
        border: `1px solid ${selected ? "#6366f1" : ink.border}`,
        background: selected ? "rgba(99,102,241,0.14)" : "rgba(255,255,255,0.04)",
        color: ink.text,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        gap: 4,
        padding: 8,
        textAlign: "center",
      }}
    >
      {char ? (
        <>
          <span style={{ font: "600 14px system-ui" }}>{char.name}</span>
          <span style={{ font: "11px system-ui", color: ink.dim }}>
            {JOB_NAMES[char.job] ?? `classe ${char.job}`}
          </span>
          <span style={{ font: "11px system-ui", color: ink.faint }}>Base {char.level}</span>
        </>
      ) : (
        <>
          <span style={{ font: "22px system-ui", color: ink.faint }}>+</span>
          <span style={{ font: "11px system-ui", color: ink.faint }}>slot {slot} vazio</span>
        </>
      )}
    </button>
  );
}

function CharSheet({ char }: { char: CharSummary | null }) {
  if (!char) {
    return <div style={{ flex: 1, color: ink.faint, font: "12px system-ui" }}>Nenhum personagem no slot.</div>;
  }

  return (
    <div style={{ flex: 1, display: "grid", gap: 8 }}>
      <div style={{ font: "600 16px system-ui", color: ink.text }}>{char.name}</div>
      <div style={{ font: "12px system-ui", color: ink.dim }}>
        {JOB_NAMES[char.job] ?? `classe ${char.job}`} · Base {char.level} · Job {char.jobLevel} ·{" "}
        {char.mapName || "—"}
      </div>
      <RpgBar value={char.hp} max={char.maxHp} color="red" width={260} label={`HP ${char.hp}/${char.maxHp}`} />
      <RpgBar value={char.sp} max={char.maxSp} color="yellow" width={260} label={`SP ${char.sp}/${char.maxSp}`} />
      <div style={{ display: "flex", gap: 12, font: "12px system-ui", color: ink.dim, flexWrap: "wrap" }}>
        <span>STR {char.str}</span>
        <span>AGI {char.agi}</span>
        <span>VIT {char.vit}</span>
        <span>INT {char.int}</span>
        <span>DEX {char.dex}</span>
        <span>LUK {char.luk}</span>
      </div>
      <div style={{ font: "12px system-ui", color: ink.faint }}>{char.zeny.toLocaleString("pt-BR")} zeny</div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  background: "radial-gradient(circle at 50% 30%, #1b2233 0%, #070910 70%)",
  overflow: "auto",
};

const title: React.CSSProperties = { margin: 0, font: "700 20px system-ui", color: ink.text };

const input: React.CSSProperties = {
  background: "rgba(0,0,0,0.45)",
  border: `1px solid ${ink.border}`,
  borderRadius: 7,
  color: ink.text,
  font: "13px system-ui",
  padding: "8px 10px",
  outline: "none",
  width: 240,
};

const hint: React.CSSProperties = { margin: "12px 0 0", font: "12px system-ui" };

const errorStyle: React.CSSProperties = {
  margin: "12px 0 0",
  padding: "8px 10px",
  borderRadius: 7,
  background: "rgba(220,38,38,0.14)",
  border: "1px solid rgba(248,113,113,0.4)",
  color: "#fca5a5",
  font: "12px system-ui",
};
