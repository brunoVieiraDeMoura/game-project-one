import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { gateway, type CharSummary } from "../net/gateway";
import { useSessionStore } from "../net/sessionStore";
import { usePlayerStore } from "../net/playerStore";
import { JOB_NAMES } from "../character/jobNames";
import { CharacterPortrait } from "../hud/CharacterPortrait";
import { classModelFor } from "../entities/classModels";
import { ChatFrame } from "../hud/ChatFrame";
import { ChatScrollbar } from "../hud/ChatScrollbar";
import { CHAT_ART_SIZE } from "../ui/chatFrame";
import { CardFrame } from "../ui/CardFrame";
import { CurvedBox } from "../ui/CurvedBox";
import { Ribbon } from "../ui/Ribbon";
import { ScrollbarHider } from "../ui/ScrollbarHider";
import { IconSquare } from "../ui/rpg";
import { escalaDoCanva, charSelectTrilhos } from "../ui/CanvaFrame";
import { FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { LOGIN_ART, LOGIN_COLORS, LOGIN_TITLE_FONT } from "../ui/login";
import { LOGIN_FRAME_ART, LOGIN_FRAME_SIZE, RIBBON_BAND } from "../ui/loginFrameArt";
import { LoginBackdrop, LoginError, useLarguraDoPalco } from "../ui/LoginChrome";

/** madeira do fundo do painel direito — asset NOVO, só desta tela (não é
 * reuso de nada do login) */
const RIGHTSECTION_BACKGROUND = "/assets/ui/character-create/rightsection-background.png";

/**
 * Paleta dos botões do painel direito e do "Entrar no Mundo" — base escura
 * comum (#222211) em vez das cores translúcidas ad-hoc que cada botão tinha.
 * DUAS exceções de tom, as duas por SEMÂNTICA, não gosto: "Mudar de Canal"
 * troca de SERVIDOR (#223344, azul-ardósia) e "Excluir Personagem" é
 * destrutivo — vermelho é o aviso, não decoração, e não sai (correção do
 * usuário: "excluir personagem é vermelho").
 */
const BOTAO_DIREITA_BASE = "#222211";
const BOTAO_DIREITA_ESCURA = "#14140a";
const BOTAO_CANAL_BASE = "#223344";
const BOTAO_CANAL_ESCURA = "#15212c";
const BOTAO_PERIGO_BASE = "#441515";
const BOTAO_PERIGO_ESCURA = "#240a0a";

/**
 * Seleção de personagem — refeita no formato da referência
 * (`ui_definitiva/character-create/referencia.jpg`, ui-change.txt): o
 * personagem GRANDE no centro da cena, nome numa fita logo abaixo, "Entrar no
 * Mundo" e as setas de girar embaixo dele; menu de atalhos no canto
 * inferior-esquerdo; lista de personagens (com trocar-de-canal e as ações de
 * criar/excluir/voltar) num painel à direita.
 *
 * O quadro externo é o `charSelectFrame` (`ui/CanvaFrame`) — fino e uniforme
 * nos 4 lados, diferente do de `/login` (que tem banda grossa embaixo): a
 * referência não tem essa banda aqui.
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
  /** ângulo do personagem central, mutado pelas setas — ver `CharacterPortrait.giroRef` */
  const giroRef = useRef(0);

  useEffect(() => {
    if (phase === "offline") navigate("/login");
    if (phase === "playing") navigate("/play");
  }, [phase, navigate]);

  useEffect(() => {
    if (creatingAt !== null && chars.some((c) => c.slot === creatingAt)) {
      setCreatingAt(null);
      setNewName("");
    }
  }, [chars, creatingAt]);

  const total = Math.max(3, Math.min(slots || 3, 9));
  const lista = [...chars].sort((a, b) => a.slot - b.slot);
  const bySlot = new Map(chars.map((c) => [c.slot, c]));

  // o cursor pode apontar pra um slot que não existe mais (ou nunca existiu,
  // no primeiro carregamento) — cai pro primeiro personagem da lista
  useEffect(() => {
    if (!bySlot.has(cursor) && lista[0]) setCursor(lista[0].slot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars]);
  const current = bySlot.get(cursor) ?? lista[0] ?? null;

  const primeiroSlotVazio = (): number | null => {
    for (let i = 0; i < total; i++) if (!bySlot.has(i)) return i;
    return null;
  };

  const enter = (slot: number) => {
    // instrumentação temporária (auditoria "glitch ~30s" 2026-08-14) — mede
    // a partir do clique de verdade, não do carregamento da página inteira.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info(`[GAME_LOAD] T-1 char:select emitido slot=${slot} t=${Math.round(performance.now())}ms`);
    }
    useSessionStore.getState().selectSlot(slot);
    const chosen = chars.find((c) => c.slot === slot);
    if (chosen) usePlayerStore.getState().seedFromChar(chosen);
    gateway().emit("char:select", { slot });
  };

  const create = () => {
    if (creatingAt === null || !newName.trim()) return;
    gateway().emit("char:create", { slot: creatingAt, name: newName.trim(), hair: 1, hairColor: 1 });
  };

  return (
    <LoginBackdrop quadro="charSelect">
      <ScrollbarHider />
      <TopoEsquerdaLogo />
      <MenuLateral />
      <HeroCentral
        current={current}
        giroRef={giroRef}
        podeEntrar={Boolean(current) && phase !== "entering"}
        entrando={phase === "entering"}
        onEntrar={() => current && enter(current.slot)}
      />
      <PainelDireita>
        <BotaoMudarCanal />
        <SecaoListaDePersonagens
          lista={lista}
          cursor={cursor}
          onSelect={(s) => (setCursor(s), setCreatingAt(null))}
        />

        {/**
         * UM filho só pra essa faixa — `PainelDireita` virou grade de TRÊS
         * linhas fixas (`grid-template-rows: auto 1fr auto`, item #2 do
         * pedido: "mudar de canal" no topo, lista no meio [maior espaço],
         * criar/excluir/voltar embaixo). Com `FormularioCriar`/`AcoesRodape`
         * e o erro como filhos SEPARADOS, o quarto filho vazava pra uma
         * quarta linha implícita, fora da moldura de baixo.
         */}
        <div style={{ display: "grid", gap: "0.5vw", alignContent: "end" }}>
          {creatingAt !== null ? (
            <FormularioCriar
              slot={creatingAt}
              nome={newName}
              onNome={setNewName}
              onConfirmar={create}
              onCancelar={() => setCreatingAt(null)}
            />
          ) : (
            <AcoesRodape
              podeExcluir={Boolean(current)}
              onCriar={() => {
                const v = primeiroSlotVazio();
                if (v !== null) {
                  setCursor(v);
                  setCreatingAt(v);
                }
              }}
              onExcluir={() => current && gateway().emit("char:delete", { gid: current.gid, email: "" })}
              onVoltar={() => {
                useSessionStore.getState().reset();
                navigate("/login");
              }}
              criarDesabilitado={primeiroSlotVazio() === null}
            />
          )}
          {error && <LoginError>{error}</LoginError>}
        </div>
      </PainelDireita>
    </LoginBackdrop>
  );
}

/** medida a partir do quadro de char-select — todo canto absoluto usa isto pra
 * não passar por baixo da moldura de madeira */
/**
 * `charSelectTrilhos` só mede o TRILHO fino (a faixa reta entre cantos) — bom
 * para o meio de uma borda, mas qualquer conteúdo que nasce PERTO de um canto
 * (o logo no topo-esquerda, o rodapé do painel da direita, que encosta no
 * canto de baixo) precisa desviar da arte do CANTO inteira, bem maior que o
 * trilho. `canto` é essa medida — a mesma peça (`canvaTop`) que `CharSelectFrame`
 * desenha, só que em px prontos pra quem consome não repetir a conta.
 */
function useTrilho() {
  const palco = useLarguraDoPalco();
  const escala = escalaDoCanva(palco);
  return {
    palco,
    escala,
    t: charSelectTrilhos(escala),
    canto: { w: LOGIN_FRAME_SIZE.canvaTop.w * escala, h: LOGIN_FRAME_SIZE.canvaTop.h * escala },
  };
}

/** ui-change.txt linha 7: "no lugar do ícone do wow, bota o nome IMPÉRIO ANTIGO" */
function TopoEsquerdaLogo() {
  const { canto } = useTrilho();
  return (
    <div
      style={{
        position: "absolute",
        // desvia do CANTO inteiro (a vinha), não só do trilho fino — perto
        // dele o "Í" de "IMPÉRIO" ficava por baixo da folhagem. Mais perto do
        // canto que antes (pedido: "logo mais pra esquerda em cima") — só o
        // suficiente pra não entrar embaixo da vinha.
        left: canto.w * 0.32,
        top: canto.h * 0.21,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: LOGIN_TITLE_FONT,
          fontWeight: 700,
          fontSize: "1.7vw",
          lineHeight: 1.05,
          letterSpacing: "0.12vw",
          textTransform: "uppercase",
          background: "linear-gradient(180deg, #fbf0c4 0%, #e0bb52 38%, #a8801f 72%, #f0d98a 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.95))",
        }}
      >
        Império
        <br />
        Antigo
      </div>
    </div>
  );
}

const ICONES_MENU: Record<string, (cor: string) => React.ReactNode> = {
  loja: (cor) => (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden fill="none" stroke={cor} strokeWidth="1.6">
      <path d="M4 9l1.2-4.5A1 1 0 016.15 3.7h11.7a1 1 0 01.95.75L20 9" />
      <path d="M4 9h16v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18z" />
      <path d="M9 12.5a2.5 2.5 0 005 0" />
    </svg>
  ),
  menu: (cor) => (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden fill="none" stroke={cor} strokeWidth="1.8" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  ),
  discord: (cor) => (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden fill={cor}>
      <path d="M19 6.5A15 15 0 0015 5l-.3.6c1.4.4 2.3 1 3 1.5a12 12 0 00-11.4 0c.7-.5 1.7-1.1 3-1.5L9 5a15 15 0 00-4 1.5C3 9.6 2.4 12.6 2.7 15.6A15 15 0 007.3 18l.9-1.3c-.8-.3-1.5-.7-2-1.1l.5-.4a10.7 10.7 0 009 0l.5.4c-.6.4-1.3.8-2.1 1.1l.9 1.3a15 15 0 004.6-2.4c.4-3.5-.6-6.5-2.6-9.1zM9.3 14c-.8 0-1.5-.8-1.5-1.7S8.5 10.6 9.3 10.6s1.5.8 1.5 1.7-.7 1.7-1.5 1.7zm5.4 0c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7z" />
    </svg>
  ),
  site: (cor) => (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden fill="none" stroke={cor} strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  ),
  noticias: (cor) => (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden fill="none" stroke={cor} strokeWidth="1.5">
      <path d="M6 3h11a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5" />
      <path d="M5 5a2 2 0 002 2h1" />
      <line x1="9" y1="9" x2="16" y2="9" />
      <line x1="9" y1="13" x2="16" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  ),
  suporte: (cor) => (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden fill="none" stroke={cor} strokeWidth="1.5">
      <path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z" />
      <path d="M9.5 12l1.8 1.8 3.4-3.6" />
    </svg>
  ),
};

/**
 * ui-change.txt linha 30: "loja | Menu | discord | site | Noticias | suporte"
 * (SEM addons — linha 36 pede a saída dele).
 */
const ITENS_MENU = [
  { chave: "loja", rotulo: "Loja", href: "" },
  { chave: "menu", rotulo: "Menu", href: "" },
  { chave: "discord", rotulo: "Discord", href: "" },
  { chave: "site", rotulo: "Site Oficial", href: "" },
  { chave: "noticias", rotulo: "Notícias", href: "" },
  { chave: "suporte", rotulo: "Suporte", href: "" },
] as const;

function MenuLateral() {
  const { palco, canto } = useTrilho();
  const borda = Math.max(8, palco * 0.008);
  return (
    <div
      style={{
        position: "absolute",
        // mais perto do canto (pedido: "botões mais pra esquerda e embaixo")
        left: canto.w * 0.28,
        bottom: canto.h * 0.22,
        display: "grid",
        gap: "0.6vw",
      }}
    >
      {ITENS_MENU.map((item) => (
        <button
          key={item.chave}
          type="button"
          title={item.href ? item.rotulo : `${item.rotulo} (em breve)`}
          style={{ appearance: "none", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
        >
          <CardFrame
            border={borda}
            background="rgba(10,8,5,0.6)"
            inner={{
              display: "flex",
              alignItems: "center",
              gap: "0.6vw",
              padding: "0.55vw 1vw",
              width: "9vw",
            }}
          >
            <div style={{ width: "1.3vw", height: "1.3vw", flex: "0 0 auto" }}>
              {ICONES_MENU[item.chave]?.(LOGIN_COLORS.gold)}
            </div>
            <span
              style={{
                fontFamily: FRAME_FONT,
                fontSize: "0.95vw",
                letterSpacing: "0.02vw",
                color: LOGIN_COLORS.ink,
                whiteSpace: "nowrap",
              }}
            >
              {item.rotulo}
            </span>
          </CardFrame>
        </button>
      ))}
    </div>
  );
}

/**
 * O personagem GRANDE, centrado — o "herói" da tela (ui-change.txt: "o avatar
 * do personagem fica acima do nome"). Nome numa fita logo abaixo dele, depois
 * "Entrar no Mundo", depois as duas setas de girar.
 */
function HeroCentral({
  current,
  giroRef,
  podeEntrar,
  entrando,
  onEntrar,
}: {
  current: CharSummary | null;
  giroRef: React.MutableRefObject<number>;
  podeEntrar: boolean;
  entrando: boolean;
  onEntrar: () => void;
}) {
  const { palco, t } = useTrilho();
  const escalaFita = Math.max(0.45, Math.min(1.0, palco * 0.000578));
  const bordaBtn = Math.max(10, palco * 0.011);

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: `calc(${t.bottom}px + 1.2vw)`,
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* o boneco fica ACIMA desta coluna, flutuando — ver `posicao: absolute` embaixo */}
      <div
        style={{
          position: "relative",
          width: "17vw",
          height: "26vw",
          maxWidth: 340,
          maxHeight: 520,
          marginBottom: "-1vw",
        }}
      >
        {current &&
          (() => {
            // aparência = a classe REAL do personagem (`current.job`), não mais
            // um "mage" fixo — mesma tabela que `NetPlayer`/`NetEntity` usam
            const modelo = classModelFor(current.job);
            return (
              // `key={current.slot}`: troca de PERSONAGEM aqui troca de MODELO
              // (`characterKey`), e o `useGLTF` de um char novo SUSPENDE o
              // `Bust` — sem a troca de key, era o MESMO componente pedindo
              // outro glb, e ficava boneco antigo (T-pose) empilhado com o
              // novo até o suspense assentar. Com a key, o React desmonta o
              // retrato INTEIRO (limpa o esqueleto velho de verdade, ver
              // `useCharacter`) antes de montar o novo — o custo é recriar o
              // contexto WebGL a cada clique na lista, aceitável aqui porque
              // é ação deliberada do usuário, não hover por quadro (diferente
              // do retrato de ALVO, que evita desmontar de propósito).
              <CharacterPortrait
                key={current.slot}
                dono="char-select"
                characterKey={modelo.character}
                weapons={modelo.weapons}
                inteiro
                fundo={false}
                giroRef={giroRef}
              />
            );
          })()}
        {/**
         * As setas de girar SAÍRAM da fileira do botão (pedido #5: "nas
         * laterais do char, no meio da tela") — flutuam encostadas nas bordas
         * ESQUERDA/DIREITA desta mesma caixa (a do personagem), centralizadas
         * na ALTURA dela, não na altura da tela inteira: a caixa já engloba o
         * boneco do topo ao pé, então o centro dela É o centro visual dele.
         */}
        <SetaGirar lado="esq" onClick={() => (giroRef.current -= Math.PI / 4)} />
        <SetaGirar lado="dir" onClick={() => (giroRef.current += Math.PI / 4)} />
      </div>

      <Ribbon
        // troca de PNG do usuário (`character-create/papel-nome-do-char.png`)
        // conferida por hash: é byte a byte `lado-a-era-de-asterion.png`, a
        // MESMA arte da fita "A ERA DE ASTERION" do login — não um arquivo
        // novo pra copiar, e sim o par certo de constantes (`eraCap`/`eraExt`
        // em vez de `headerCap`/`headerExt`). Usar as medidas do header antigo
        // numa arte de proporção diferente é o que fazia o papel entortar pra
        // um lado.
        cap={LOGIN_FRAME_ART.eraCap}
        ext={LOGIN_FRAME_ART.eraExt}
        tam={{ cap: LOGIN_FRAME_SIZE.eraCap, ext: LOGIN_FRAME_SIZE.eraExt }}
        banda={RIBBON_BAND.era}
        escala={escalaFita}
        // medido contra o botão "Entrar no Mundo" renderizado — as duas
        // BORDAS na mesma linha, não só o centro (pedido: "centralizar o
        // papel... com o botão de entrar, tá muito pra direita").
        largura="18.4vw"
      >
        <span
          style={{
            fontFamily: LOGIN_TITLE_FONT,
            fontSize: "1.3vw",
            letterSpacing: "0.04vw",
            // mesma correção do `/login` (`ui/LoginDecor.tsx: EraRibbon`):
            // `letter-spacing` só entra depois de cada letra, puxando o nome
            // pra esquerda dentro da fita centralizada por flex.
            marginLeft: "0.04vw",
            color: "#f0e2ae",
            textShadow: "0 2px 4px rgba(0,0,0,0.9)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {current?.name ?? "—"}
        </span>
      </Ribbon>

      <div style={{ marginTop: "0.9vw" }}>
        <button
          type="button"
          onClick={onEntrar}
          disabled={!podeEntrar}
          style={{
            appearance: "none",
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: podeEntrar ? "pointer" : "default",
            opacity: podeEntrar ? 1 : 0.5,
          }}
        >
          <CardFrame
            border={bordaBtn}
            background={`linear-gradient(180deg, ${BOTAO_DIREITA_BASE} 0%, ${BOTAO_DIREITA_ESCURA} 100%)`}
            inner={{
              padding: "0.75vw 2.2vw",
              fontFamily: FRAME_FONT,
              fontSize: "1.3vw",
              letterSpacing: "0.06vw",
              textTransform: "uppercase",
              color: LOGIN_COLORS.ink,
              textShadow: "0 2px 3px rgba(0,0,0,0.9)",
            }}
          >
            {entrando ? "entrando…" : "Entrar no Mundo"}
          </CardFrame>
        </button>
      </div>
    </div>
  );
}

/**
 * `button-arrow-left.png` — mesma peça do "voltar" do login, aqui girando o
 * boneco. Flutua ENCOSTADA na borda esquerda/direita da caixa do personagem
 * (posição do pai: `HeroCentral`, `position:relative`), centralizada na
 * ALTURA dela — pedido #5, saiu de perto do botão "Entrar no Mundo".
 */
function SetaGirar({ lado, onClick }: { lado: "esq" | "dir"; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const espelho = lado === "dir" ? "scaleX(-1) " : "";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={lado === "esq" ? "Girar para a esquerda" : "Girar para a direita"}
      style={{
        position: "absolute",
        top: "50%",
        [lado === "esq" ? "right" : "left"]: "100%",
        appearance: "none",
        border: "none",
        background: "transparent",
        padding: "0.4vw",
        cursor: "pointer",
        transform: `translateY(-50%) ${espelho}${hover ? "scale(1.15)" : "scale(1)"}`,
        transition: "transform 120ms ease-out",
        filter: hover ? "brightness(1.3)" : "none",
        zIndex: 2,
      }}
    >
      {/* maior que antes (1,8vw): flutuando sozinha ao lado do boneco, sem o
          botão "Entrar" perto pra dar escala, precisa ler por si só */}
      <img src={LOGIN_ART.back} alt="" draggable={false} style={{ height: "2.3vw", display: "block" }} />
    </button>
  );
}

/**
 * O painel da direita — moldura PRÓPRIA (pedido #3: `top-rightsection-*` /
 * `mid-*-rightsection-*`), não mais sem borda nenhuma. Conferido por hash: as
 * 6 peças são byte a byte as do `ChatFrame` (chat/login) — mesma vinha, dá
 * pra reusar o componente pronto em vez de remontar canto por canto.
 *
 * TRÊS linhas fixas (pedido #2 — "mudar de canal" no topo, lista no meio com
 * o espaço maior, ações embaixo): `grid-template-rows: auto 1fr auto`, e o
 * painel estica quase do canto de cima ao de baixo (perto da extremidade,
 * pedido #1 — só a folga que evita entrar embaixo da vinha).
 */
function PainelDireita({ children }: { children: React.ReactNode }) {
  const { palco, canto } = useTrilho();
  /**
   * Escala PRÓPRIA, menor que a do quadro externo: a arte tem canto de
   * ~171×132 px nativos, e usando a mesma escala do `CanvaFrame` (tunada pra
   * um painel de ~500px) num painel de ~24vw/380px a vinha comeria quase um
   * terço da largura. Mirando ~18% da largura do painel (como o `ChatFrame`
   * lê no login), a conta é a mesma família de `escalaDoCanva`, só que
   * calibrada pra esta largura.
   */
  const escalaBorda = Math.max(0.28, Math.min(0.42, palco * 0.00026));
  const S = CHAT_ART_SIZE;
  const padY = S.cornerTopLeft.h * escalaBorda * 0.55;
  const padX = S.cornerTopLeft.w * escalaBorda * 0.5;
  return (
    <div
      style={{
        position: "absolute",
        // mais perto da extremidade DIREITA (pedido #1): antes `canto.w*0.5`
        right: canto.w * 0.22,
        // estica quase do canto de cima ao de baixo (pedido #2 — "de cima a
        // baixo"): antes 0.62 dos dois lados deixava o painel curto, metido
        // no meio da tela em vez de tomar a altura do quadro
        top: canto.h * 0.24,
        bottom: canto.h * 0.24,
        width: "min(24vw, 380px)",
      }}
    >
      {/**
       * Madeira de verdade (`rightsection-background.png`, ladrilhado — a
       * textura já vem seamless) no lugar do véu de opacidade flat. O tom
       * escuro do PNG já dá contraste sozinho; o véu ficava chapado e sem
       * grão nenhum, destoando da moldura de vinha entalhada em volta.
       */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${RIGHTSECTION_BACKGROUND})`,
          backgroundRepeat: "repeat",
          // tamanho NATIVO do PNG (276×252) — é um ladrilho seamless pronto,
          // esticar ou encolher só borraria o grão da madeira à toa
          backgroundSize: "276px 252px",
          boxShadow: "0 16px 44px rgba(0,0,0,0.55), inset 0 0 40px rgba(0,0,0,0.5)",
        }}
      />
      <ChatFrame escala={escalaBorda} />
      <div
        style={{
          position: "relative",
          height: "100%",
          boxSizing: "border-box",
          padding: `${padY}px ${padX}px`,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: "0.6vw",
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function BotaoMudarCanal() {
  const palco = useLarguraDoPalco();
  const borda = Math.max(8, palco * 0.008);
  const hover = useHover();
  return (
    <button
      type="button"
      title="em breve"
      style={{
        appearance: "none",
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: "default",
        flex: "0 0 auto",
        width: "100%",
        ...hover.estilo,
      }}
      {...hover.props}
    >
      <CardFrame
        border={borda}
        background={`linear-gradient(180deg, ${BOTAO_CANAL_BASE} 0%, ${BOTAO_CANAL_ESCURA} 100%)`}
        inner={{
          padding: "0.6vw 1vw",
          textAlign: "center",
          fontFamily: FRAME_FONT,
          fontSize: "0.95vw",
          letterSpacing: "0.03vw",
          textTransform: "uppercase",
          color: LOGIN_COLORS.inkDim,
        }}
      >
        Mudar de Canal
      </CardFrame>
    </button>
  );
}

/**
 * O mesmo hover do rodapé do login (`ui/LoginDecor.tsx: useHover`) —
 * `transform`/`filter` porque não empurram vizinho nenhum, e clarear o
 * elemento inteiro acende moldura, ícone e texto de uma vez sem estado por
 * peça. Cópia local: são 10 linhas, e a de lá não é exportada.
 */
function useHover() {
  const [dentro, setDentro] = useState(false);
  return {
    dentro,
    props: {
      onMouseEnter: () => setDentro(true),
      onMouseLeave: () => setDentro(false),
    },
    estilo: {
      transform: dentro ? "translateY(-2px)" : "translateY(0)",
      filter: dentro ? "brightness(1.25) drop-shadow(0 3px 8px rgba(0,0,0,0.6))" : "none",
      transition: "transform 120ms ease-out, filter 120ms ease-out",
    } as React.CSSProperties,
  };
}

/**
 * A SEÇÃO da lista de personagens — moldura própria (pedido: "uma section
 * para conter apenas a lista"), separada do resto do painel direito.
 *
 * `shadow-section-characteres-curve-right`/`-extension` conferidas por hash:
 * são byte a byte `bar-corner.png`/`bar-edge.png`, a MESMA moldura que
 * `CurvedBox` já monta pras barras de HP/SP e pros campos de texto — reusa o
 * componente pronto em vez de montar 9-slice de novo.
 *
 * A rolagem é a `ChatScrollbar` de sempre (as 4 peças de rolo — `arrow`,
 * `background-rolling-bar`, `rolling-bar-and-start`, `rolling-bar-mid` —
 * também batem por hash com as do chat), à DIREITA da seção, fora da
 * moldura — por isso a barra NATIVA do `overflow:auto` precisa sumir
 * (`.chat-scroll`, `ScrollbarHider`), senão apareceriam duas.
 */
function SecaoListaDePersonagens({
  lista,
  cursor,
  onSelect,
}: {
  lista: CharSummary[];
  cursor: number;
  onSelect: (slot: number) => void;
}) {
  const palco = useLarguraDoPalco();
  const borda = Math.max(5, palco * 0.005);
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, gap: "0.4vw" }}>
      <CurvedBox
        border={borda}
        background="rgba(10,8,5,0.6)"
        style={{ flex: "1 1 auto", minWidth: 0 }}
        inner={{ height: "100%", minHeight: 0 }}
      >
        <ListaDePersonagens scrollRef={scrollRef} lista={lista} cursor={cursor} onSelect={onSelect} />
      </CurvedBox>
      <ChatScrollbar alvo={scrollRef} revisao={lista.length} largura={13} auto />
    </div>
  );
}

function ListaDePersonagens({
  lista,
  cursor,
  onSelect,
  scrollRef,
}: {
  lista: CharSummary[];
  cursor: number;
  onSelect: (slot: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const palco = useLarguraDoPalco();
  const borda = Math.max(6, palco * 0.006);
  return (
    <div
      ref={scrollRef}
      className="chat-scroll"
      style={{
        // linha do MEIO do grid de `PainelDireita` (`1fr` — pedido #2, "maior
        // espaço"): preenche a altura inteira que sobra entre "mudar de
        // canal" e as ações de baixo, e só rola quando os personagens passam
        // de verdade da altura disponível.
        height: "100%",
        minHeight: 0,
        overflowY: "auto",
        display: "grid",
        gap: "0.5vw",
        alignContent: "start",
        padding: "0.4vw",
      }}
    >
      {lista.length === 0 && (
        <div
          style={{
            fontFamily: FRAME_FONT,
            fontSize: "0.85vw",
            color: LOGIN_COLORS.inkFaint,
            textAlign: "center",
            padding: "1vw 0",
          }}
        >
          Nenhum personagem ainda.
        </div>
      )}
      {lista.map((c) => {
        const selecionado = c.slot === cursor;
        return (
          <button
            key={c.slot}
            type="button"
            onClick={() => onSelect(c.slot)}
            style={{ appearance: "none", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
          >
            <CurvedBox
              border={borda}
              background={selecionado ? "rgba(150,112,38,0.42)" : "rgba(10,8,5,0.55)"}
              inner={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                alignItems: "center",
                gap: "0.7vw",
                padding: "0.5vw 0.8vw",
                textAlign: "left",
              }}
            >
              <IconSquare seed={`${c.job}-${c.name}`} size={36} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: FRAME_FONT,
                    fontWeight: 700,
                    fontSize: "0.95vw",
                    color: LOGIN_COLORS.ink,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {c.name}
                </div>
                <div
                  style={{
                    fontFamily: FRAME_FONT,
                    fontSize: "0.72vw",
                    color: LOGIN_COLORS.inkDim,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  <span style={{ fontFamily: FRAME_NUM_FONT, fontVariantNumeric: FRAME_NUM_VARIANT }}>
                    Nv. {c.level}
                  </span>{" "}
                  {JOB_NAMES[c.job] ?? `classe ${c.job}`} · {c.mapName || "—"}
                </div>
              </div>
            </CurvedBox>
          </button>
        );
      })}
    </div>
  );
}

function AcoesRodape({
  podeExcluir,
  onCriar,
  onExcluir,
  onVoltar,
  criarDesabilitado,
}: {
  podeExcluir: boolean;
  onCriar: () => void;
  onExcluir: () => void;
  onVoltar: () => void;
  criarDesabilitado: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: "0.5vw", flex: "0 0 auto" }}>
      <BotaoAcao texto="Criar Novo Personagem" onClick={onCriar} desabilitado={criarDesabilitado} />
      <div style={{ display: "flex", gap: "0.5vw" }}>
        <BotaoAcao texto="Excluir Personagem" onClick={onExcluir} desabilitado={!podeExcluir} perigo />
        <BotaoAcao texto="Voltar" onClick={onVoltar} />
      </div>
    </div>
  );
}

/**
 * Um botão de ação do painel direito — extraído de dentro de `AcoesRodape`
 * (era um closure comum, `item(texto, onClick, opts)`, que RETORNAVA jsx mas
 * não podia chamar hook nenhum). Virou componente pra cada botão ter o
 * PRÓPRIO estado de hover — um `useState` só compartilhado entre os três
 * acenderia todos juntos.
 */
function BotaoAcao({
  texto,
  onClick,
  desabilitado,
  perigo,
}: {
  texto: string;
  onClick: () => void;
  desabilitado?: boolean;
  /** "Excluir Personagem" — a ÚNICA exceção da base #222211, de propósito */
  perigo?: boolean;
}) {
  const palco = useLarguraDoPalco();
  const borda = Math.max(7, palco * 0.007);
  const hover = useHover();
  const cor = perigo
    ? `linear-gradient(180deg, ${BOTAO_PERIGO_BASE} 0%, ${BOTAO_PERIGO_ESCURA} 100%)`
    : `linear-gradient(180deg, ${BOTAO_DIREITA_BASE} 0%, ${BOTAO_DIREITA_ESCURA} 100%)`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      {...(desabilitado ? {} : hover.props)}
      style={{
        appearance: "none",
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: desabilitado ? "default" : "pointer",
        opacity: desabilitado ? 0.5 : 1,
        flex: 1,
        ...(desabilitado ? {} : hover.estilo),
      }}
    >
      <CardFrame
        border={borda}
        background={cor}
        inner={{
          padding: "0.55vw 0.4vw",
          textAlign: "center",
          fontFamily: FRAME_FONT,
          fontSize: "0.8vw",
          letterSpacing: "0.02vw",
          textTransform: "uppercase",
          color: LOGIN_COLORS.ink,
          whiteSpace: "nowrap",
        }}
      >
        {texto}
      </CardFrame>
    </button>
  );
}

function FormularioCriar({
  slot,
  nome,
  onNome,
  onConfirmar,
  onCancelar,
}: {
  slot: number;
  nome: string;
  onNome: (v: string) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const palco = useLarguraDoPalco();
  const borda = Math.max(6, palco * 0.007);
  return (
    <div style={{ flex: "0 0 auto", display: "grid", gap: "0.6vw" }}>
      <div style={{ fontFamily: FRAME_FONT, fontSize: "0.8vw", color: LOGIN_COLORS.inkDim }}>
        Nome do personagem (slot {slot})
      </div>
      <CurvedBox border={borda} background={LOGIN_COLORS.field} inner={{ padding: "0.4vw 0.7vw" }}>
        <input
          autoFocus
          value={nome}
          maxLength={23}
          onChange={(e) => onNome(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onConfirmar()}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            fontFamily: FRAME_FONT,
            fontSize: "0.95vw",
            color: LOGIN_COLORS.ink,
          }}
        />
      </CurvedBox>
      <div style={{ display: "flex", gap: "0.5vw" }}>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={!nome.trim()}
          style={{
            appearance: "none",
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: nome.trim() ? "pointer" : "default",
            opacity: nome.trim() ? 1 : 0.5,
            flex: 1,
          }}
        >
          <CardFrame
            border={borda}
            background="rgba(46,66,32,0.6)"
            inner={{
              padding: "0.5vw 0",
              textAlign: "center",
              fontFamily: FRAME_FONT,
              fontSize: "0.85vw",
              textTransform: "uppercase",
              color: LOGIN_COLORS.ink,
            }}
          >
            Criar
          </CardFrame>
        </button>
        <button
          type="button"
          onClick={onCancelar}
          style={{ appearance: "none", border: "none", background: "transparent", padding: 0, cursor: "pointer", flex: 1 }}
        >
          <CardFrame
            border={borda}
            background="rgba(24,19,12,0.75)"
            inner={{
              padding: "0.5vw 0",
              textAlign: "center",
              fontFamily: FRAME_FONT,
              fontSize: "0.85vw",
              textTransform: "uppercase",
              color: LOGIN_COLORS.ink,
            }}
          >
            Cancelar
          </CardFrame>
        </button>
      </div>
    </div>
  );
}
