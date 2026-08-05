import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { gateway, type CharSummary } from "../net/gateway";
import { useSessionStore } from "../net/sessionStore";
import { usePlayerStore } from "../net/playerStore";
import { JOB_NAMES } from "../character/jobNames";
import { CharacterPortrait } from "../hud/CharacterPortrait";
import { CurvedBar } from "../ui/CurvedBar";
import { CurvedBox } from "../ui/CurvedBox";
import { FRAME_FONT, HP_FILL, SP_FILL } from "../ui/charFrame";
import { LOGIN_COLORS, LOGIN_PANEL } from "../ui/login";
import {
  LoginBack,
  LoginBackdrop,
  LoginButton,
  LoginError,
  LoginField,
  LoginPanel,
  LoginTitle,
  LOGIN_NUM,
} from "../ui/LoginChrome";

/**
 * Seleção de personagem, no formato do RO: fileira de slots, painel com a ficha
 * do escolhido, e as ações criar/apagar/entrar. Quem manda na lista é o
 * char-server — aqui só desenhamos o que veio pelo gateway.
 *
 * A casa é a mesma do `/login` (`ui/LoginChrome`): cena pintada de fundo e
 * painel com a moldura de folhagem. As duas telas são vistas em sequência, e
 * qualquer diferença de moldura, campo ou botão entre elas salta aos olhos.
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
    <LoginBackdrop>
      {/* o palco posiciona tudo por cima da pintura, então o painel precisa de
          um container próprio para se centrar nele — e de `overflow: auto`,
          porque nove slots numa janela baixa passam da altura da cena */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          overflow: "auto",
          padding: 16,
        }}
      >
      <LoginPanel width={LOGIN_PANEL.charW}>
        {/* Voltar ao login. Sai pelo `reset` da sessão: o gateway derruba as
            conexões de login/char junto, e sem isso a próxima entrada acharia
            uma conta já autenticada do outro lado. */}
        <div style={{ position: "absolute", left: 30, top: 26 }}>
          <LoginBack
            titulo="Voltar ao login"
            onClick={() => {
              useSessionStore.getState().reset();
              navigate("/login");
            }}
          />
        </div>

        <LoginTitle sub={`${chars.length} de ${total} slots`}>Escolha seu personagem</LoginTitle>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
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
          <div style={{ marginTop: 22, display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <LoginField
                label={`Nome do personagem (slot ${creatingAt})`}
                autoFocus
                value={newName}
                maxLength={23}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
            </div>
            <LoginButton primario onClick={create} disabled={!newName.trim()}>
              Criar
            </LoginButton>
            <LoginButton onClick={() => setCreatingAt(null)}>Cancelar</LoginButton>
          </div>
        ) : (
          <div style={{ marginTop: 22, display: "flex", gap: 24, alignItems: "flex-start" }}>
            <CharSheet char={current} />
            <div style={{ display: "grid", gap: 10, minWidth: 170 }}>
              <LoginButton primario disabled={!current} onClick={() => current && enter(current.slot)}>
                Entrar no jogo
              </LoginButton>
              <LoginButton
                disabled={!current}
                onClick={() => current && gateway().emit("char:delete", { gid: current.gid, email: "" })}
              >
                Apagar
              </LoginButton>
            </div>
          </div>
        )}

        {phase === "entering" && (
          <p
            style={{
              margin: "16px 0 0",
              fontFamily: FRAME_FONT,
              fontSize: 13,
              color: LOGIN_COLORS.inkDim,
              textAlign: "center",
            }}
          >
            entrando no mapa…
          </p>
        )}
        {error && <LoginError>{error}</LoginError>}
      </LoginPanel>
      </div>
    </LoginBackdrop>
  );
}

/**
 * Cartão de slot: o personagem, ou o convite para criar.
 *
 * A moldura é a curva das barras (`ui/CurvedBox`), a mesma dos slots do
 * inventário e da barra de habilidades — é a peça que o jogo usa para "uma coisa
 * que se escolhe". O selecionado ganha o mesmo dourado do botão primário: a
 * mesma cor querendo dizer a mesma coisa na tela inteira.
 */
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
        appearance: "none",
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: "pointer",
      }}
    >
      <CurvedBox
        border={9}
        background={selected ? "rgba(150,112,38,0.5)" : "rgba(10,8,5,0.66)"}
        style={{ width: 178, height: 140 }}
        inner={{
          display: "grid",
          placeContent: "center",
          gap: 5,
          padding: 12,
          textAlign: "center",
          fontFamily: FRAME_FONT,
        }}
      >
        {char ? (
          <>
            {/* nome de personagem do RO vai a 23 caracteres e estourava o
                cartão: uma linha só, com reticência, como no inventário */}
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: LOGIN_COLORS.ink,
                textShadow: `0 1px 3px ${LOGIN_COLORS.shadow}`,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 150,
              }}
            >
              {char.name}
            </span>
            <span style={{ fontSize: 12, color: LOGIN_COLORS.inkDim }}>
              {JOB_NAMES[char.job] ?? `classe ${char.job}`}
            </span>
            <span style={{ fontSize: 12, color: LOGIN_COLORS.inkFaint, ...LOGIN_NUM }}>
              Base {char.level}
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 26, color: LOGIN_COLORS.inkFaint, lineHeight: 1 }}>+</span>
            <span style={{ fontSize: 12, color: LOGIN_COLORS.inkFaint }}>slot {slot} vazio</span>
          </>
        )}
      </CurvedBox>
    </button>
  );
}

/**
 * A ficha do personagem escolhido.
 *
 * As barras são as MESMAS do HUD (`ui/CurvedBar` com as curvas de preenchimento
 * de `ui/charFrame`): a primeira vez que o jogador vê o HP dele é aqui, e mudar
 * de barra na tela seguinte seria estranho.
 */
function CharSheet({ char }: { char: CharSummary | null }) {
  if (!char) {
    return (
      <div style={{ flex: 1, fontFamily: FRAME_FONT, fontSize: 14, color: LOGIN_COLORS.inkFaint }}>
        Nenhum personagem neste slot.
      </div>
    );
  }

  const atributos: [string, number][] = [
    ["STR", char.str],
    ["AGI", char.agi],
    ["VIT", char.vit],
    ["INT", char.int],
    ["DEX", char.dex],
    ["LUK", char.luk],
  ];

  return (
    <div style={{ flex: 1, display: "flex", gap: 18, fontFamily: FRAME_FONT }}>
      {/**
       * O MINI PERSONAGEM — o mesmo retrato 3D do HUD (`hud/CharacterPortrait`).
       *
       * Faltava, e ele é o que faz a ficha parecer um personagem em vez de uma
       * tabela: é a primeira vez que o jogador vê o boneco que vai controlar.
       *
       * `inteiro` enquadra dos pés ao topo (não o busto do medalhão), e
       * `giravel` deixa arrastar para girar — a mesma janela de Status já faz
       * isso, e aqui é onde se escolhe o personagem, então poder olhá-lo de
       * todos os lados é o mínimo.
       *
       * O modelo é o `knight` para toda classe: o kit tem três bonecos e nenhum
       * mapeamento classe→modelo existe ainda (é a mesma lacuna que o `/play`
       * tem, ver `CHARACTER_URLS`). Escolher um por classe seria inventar.
       */}
      <div
        style={{
          position: "relative",
          width: 150,
          height: 210,
          flex: "0 0 auto",
          borderRadius: 8,
          overflow: "hidden",
          background: "linear-gradient(180deg, rgba(30,24,14,0.6), rgba(8,6,4,0.75))",
          boxShadow: `inset 0 0 0 1px ${LOGIN_COLORS.goldFaint}`,
        }}
      >
        <CharacterPortrait dono="char-select" characterKey="knight" inteiro fundo={false} giravel />
      </div>

      <div style={{ flex: 1, display: "grid", gap: 10, alignContent: "start", minWidth: 0 }}>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: LOGIN_COLORS.ink,
          textShadow: `0 2px 5px ${LOGIN_COLORS.shadow}`,
        }}
      >
        {char.name}
      </div>
      <div style={{ fontSize: 13, color: LOGIN_COLORS.inkDim }}>
        {JOB_NAMES[char.job] ?? `classe ${char.job}`} ·{" "}
        <span style={LOGIN_NUM}>Base {char.level}</span> ·{" "}
        <span style={LOGIN_NUM}>Job {char.jobLevel}</span> · {char.mapName || "—"}
      </div>

      <div style={{ display: "grid", gap: 6, maxWidth: 340 }}>
        <CurvedBar
          value={char.hp}
          max={char.maxHp}
          height={20}
          fill={HP_FILL}
          left="HP"
          right={`${char.hp} / ${char.maxHp}`}
        />
        <CurvedBar
          value={char.sp}
          max={char.maxSp}
          height={20}
          fill={SP_FILL}
          left="SP"
          right={`${char.sp} / ${char.maxSp}`}
        />
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: LOGIN_COLORS.inkDim }}>
        {atributos.map(([nome, v]) => (
          <span key={nome}>
            {nome} <span style={{ ...LOGIN_NUM, color: LOGIN_COLORS.ink }}>{v}</span>
          </span>
        ))}
      </div>

      <div style={{ fontSize: 13, color: LOGIN_COLORS.inkFaint, ...LOGIN_NUM }}>
        {char.zeny.toLocaleString("pt-BR")} de ouro
      </div>
      </div>
    </div>
  );
}
