import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHudStore } from "./hudStore";
import { gateway } from "../net/gateway";
import { usePlayerStore } from "../net/playerStore";
import { FRAME_FONT } from "../ui/charFrame";
import { CurvedBox } from "../ui/CurvedBox";
import { ScrollbarHider } from "../ui/ScrollbarHider";
import { ChatFrame } from "./ChatFrame";
import { ChatScrollbar } from "./ChatScrollbar";
import {
  CHAT_ART,
  CHAT_ART_SIZE,
  CHAT_BG,
  CHAT_INK,
  CHAT_TABS,
  CONTENT_PAD,
  FRAME_SCALE,
  FIXED_TAB,
  SCOPE_TO_TAB,
  TAB_COLOR,
  TAB_LABEL,
  TAB_PREFIX,
  TAB_SCOPE,
  type ChatTab,
} from "../ui/chatFrame";

interface Linha {
  tab: ChatTab;
  /** quem falou; ausente em aviso do servidor e fala de NPC */
  autor?: string;
  texto: string;
}

/**
 * O rAthena já manda a linha montada como "Nome : mensagem" — `clif_GlobalMessage`
 * envia o `output` de `clif_process_message`, que inclui o nome (clif.cpp:11525).
 * Vale para fala de mapa, party, guilda e canal. Por isso NÃO se procura o nome
 * pelo `gid`: o código antigo fazia isso e a linha saía com o nome DUAS vezes.
 *
 * Canal ainda vem com o apelido na frente ("[Global] Fulano : oi",
 * channel.cpp:466) — ele sai daqui porque a aba já diz de que canal é.
 */
function separarLinha(bruto: string): { autor?: string; texto: string } {
  const semApelido = bruto.replace(/^\[[^\]]+\]\s*/, "");
  const corte = semApelido.indexOf(" : ");
  if (corte < 0) return { texto: semApelido };
  return { autor: semApelido.slice(0, corte), texto: semApelido.slice(corte + 3) };
}

const LARGURA = 440;
const ALTURA = 210;
const ALTURA_ABA = 24;
const ALTURA_CAMPO = 30;
const BORDA = 8; // moldura curva das caixas de dentro

/**
 * Chat (baixo-esquerda) vestido com a arte de `ui_definitiva/chat`.
 *
 * Estrutura: moldura ornamentada por cima (`ChatFrame`), e por baixo a fileira
 * de abas, o canvas de mensagens com barra de rolagem própria (`ChatScrollbar`)
 * e o campo de digitar com o botão de enviar.
 *
 * Com sessão, o que sai daqui vira CZ.REQUEST_CHAT e o que chega vem do
 * servidor — inclusive `@comandos` de GM, que o rAthena reconhece pelo `@` no
 * começo da mensagem. Sem sessão continua sendo eco local (modo demo).
 *
 * IMPORTANTE sobre os canais: o gateway só sabe distinguir
 * `self | public | announce | system` (`ChatScope` em protocol.ts). Ou seja,
 * hoje só GERAL e GLOBAL recebem alguma coisa de verdade — Party, Guild e
 * Comércio existem como filtro pronto, e vão encher quando o gateway souber
 * separá-los.
 */
export function Chat() {
  const tab = useHudStore((s) => s.chatTab);
  const setTab = useHudStore((s) => s.setChatTab);
  const tabs = useHudStore((s) => s.chatTabs);
  const addTab = useHudStore((s) => s.addChatTab);
  const removeTab = useHudStore((s) => s.removeChatTab);
  const online = usePlayerStore((s) => s.known);
  const [msgs, setMsgs] = useState<Linha[]>([{ tab: "geral", texto: "Bem-vindo ao mundo." }]);
  const [text, setText] = useState("");
  const [abrindoMenu, setAbrindoMenu] = useState(false);
  const rolagem = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = gateway();
    const onMessage = (p: { gid?: number; text: string; scope: string }) => {
      const tab = SCOPE_TO_TAB[p.scope] ?? "geral";
      setMsgs((m) => [...m.slice(-99), { tab, ...separarLinha(p.text) }]);
    };
    socket.on("chat:message", onMessage);
    return () => {
      socket.off("chat:message", onMessage);
    };
  }, []);

  // o menu do "+" fecha ao clicar em qualquer outro lugar — sem isso ele ficava
  // aberto por cima das mensagens até alguém escolher um canal
  useEffect(() => {
    if (!abrindoMenu) return;
    const fechar = () => setAbrindoMenu(false);
    // `setTimeout` porque o próprio clique que ABRIU o menu ainda está subindo
    const id = setTimeout(() => window.addEventListener("pointerdown", fechar), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", fechar);
    };
  }, [abrindoMenu]);

  // conversa nova desce sozinha — mas só se o jogador já estava no fim; se ele
  // subiu para reler, puxar a rolagem seria tirar a página da mão dele
  const colado = useRef(true);
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (el && colado.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  /**
   * Trocar de aba SEMPRE cai na última mensagem.
   *
   * O `scrollTop` é do mesmo elemento nas duas abas, mas a lista renderizada
   * muda de tamanho: quem estava no fim de uma conversa curta aparecia no meio
   * (ou no topo) de uma longa. E enquanto a aba estava escondida as mensagens
   * continuavam entrando sem ninguém rolar, então o `scrollTop` guardado já
   * nascia velho. Vale para o Geral também, que junta todos os canais.
   *
   * Roda em `useLayoutEffect` porque o DOM da aba nova já está montado aqui —
   * num `useEffect` o navegador chegaria a pintar um quadro na posição errada.
   */
  useLayoutEffect(() => {
    colado.current = true;
    const el = rolagem.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tab]);

  const send = () => {
    const value = text.trim();
    if (!value) return;
    if (online) {
      // A ABA escolhe o canal: o gateway troca o pacote conforme o escopo
      // (party 0x108, guilda 0x17e, #global/#trade pelo sussurro). Sem isso
      // toda fala saía como conversa de mapa e voltava no Geral, o que fazia as
      // outras abas nunca receberem nada.
      gateway().emit("chat:send", { text: value, scope: TAB_SCOPE[tab] });
      // Não ecoa localmente: o servidor devolve a própria fala — ecoar aqui
      // duplicaria a linha.
    } else {
      setMsgs((m) => [...m, { tab, autor: "Você", texto: value }]);
    }
    setText("");
  };

  // O Geral é o apanhado: mostra tudo, como o RO faz com a aba principal.
  const visiveis = msgs.filter((m) => tab === FIXED_TAB || m.tab === tab);
  const restantes = CHAT_TABS.filter((t) => !tabs.includes(t));

  return (
    <div style={{ position: "relative", width: LARGURA, height: ALTURA }}>
      <ScrollbarHider />

      <div style={{ position: "absolute", inset: 0, background: CHAT_BG.panel, borderRadius: 10 }} />
      <ChatFrame />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          gap: 5,
          padding: `${CONTENT_PAD.top}px ${CONTENT_PAD.right}px ${CONTENT_PAD.bottom}px ${CONTENT_PAD.left}px`,
          boxSizing: "border-box",
        }}
      >
        {/* abas: recuadas à esquerda para não passar sob a folhagem do canto */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginLeft: CONTENT_PAD.tabsLeft,
            height: ALTURA_ABA,
            position: "relative",
          }}
        >
          {tabs.map((t) => (
            <Aba
              key={t}
              canal={t}
              ativa={t === tab}
              onSelect={() => setTab(t)}
              onClose={t === FIXED_TAB ? undefined : () => removeTab(t)}
            />
          ))}
          {/* o menu é filho do PRÓPRIO botão "+" para cair embaixo dele; solto
              na fileira ele abria alinhado à primeira aba */}
          {restantes.length > 0 && (
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setAbrindoMenu((v) => !v)}
                title="Adicionar canal"
                style={{
                  border: "none",
                  background: "none",
                  padding: 0,
                  cursor: "pointer",
                  width: ALTURA_ABA,
                  height: ALTURA_ABA,
                  lineHeight: 0,
                  filter: abrindoMenu ? "brightness(1.2)" : undefined,
                }}
              >
                <img
                  src={CHAT_ART.addTab}
                  alt="+"
                  draggable={false}
                  style={{ width: "100%", height: "100%", display: "block" }}
                />
              </button>
              {abrindoMenu && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: ALTURA_ABA + 4,
                    zIndex: 3,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  {restantes.map((t) => (
                    <Aba
                      key={t}
                      canal={t}
                      ativa
                      onSelect={() => {
                        addTab(t);
                        setAbrindoMenu(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* canvas + rolagem */}
        <CurvedBox
          border={BORDA}
          background={CHAT_BG.canvas}
          style={{ flex: 1, minHeight: 0 }}
          inner={{ display: "flex", gap: 2, padding: BORDA / 2 }}
        >
          <div
            ref={rolagem}
            className="chat-scroll"
            onScroll={(e) => {
              const el = e.currentTarget;
              colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 6;
            }}
            style={{
              flex: 1,
              minWidth: 0,
              overflowY: "auto",
              font: `12px ${FRAME_FONT}`,
              lineHeight: 1.35,
              padding: "2px 4px",
            }}
          >
            {visiveis.map((m, i) => (
              <Mensagem key={i} linha={m} mostrarCanal={tab === FIXED_TAB} />
            ))}
          </div>
          {/* a aba entra na revisão: duas abas podem ter a MESMA contagem de
              linhas, e aí o cursor ficaria do tamanho da lista antiga */}
          <ChatScrollbar alvo={rolagem} revisao={`${tab}:${visiveis.length}`} />
        </CurvedBox>

        {/* campo de digitar + enviar */}
        <div style={{ display: "flex", gap: 5, height: ALTURA_CAMPO }}>
          <CurvedBox
            border={BORDA}
            background={CHAT_BG.input}
            style={{ flex: 1 }}
            inner={{ display: "flex", alignItems: "center", padding: `0 ${BORDA}px` }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Digite sua mensagem..."
              style={{
                width: "100%",
                border: "none",
                background: "none",
                outline: "none",
                font: `13px ${FRAME_FONT}`,
                color: "#f2ead9",
              }}
            />
          </CurvedBox>
          <button
            onClick={send}
            title="Enviar"
            style={{
              border: "none",
              background: "none",
              padding: 0,
              cursor: "pointer",
              height: ALTURA_CAMPO,
              width: (ALTURA_CAMPO * CHAT_ART_SIZE.send.w) / CHAT_ART_SIZE.send.h,
              lineHeight: 0,
            }}
          >
            <img
              src={CHAT_ART.send}
              alt=""
              draggable={false}
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Uma linha da conversa.
 *
 * No GERAL cada linha diz de onde veio, com o canal na cor dele e o resto em
 * branco — "#Guild - Fulano : mensagem" (ui-change.txt). Dentro da aba do
 * próprio canal o prefixo sai: repetir "#Guild" em toda linha da aba Guild
 * seria ruído.
 */
function Mensagem({ linha, mostrarCanal }: { linha: Linha; mostrarCanal: boolean }) {
  const prefixo = mostrarCanal ? TAB_PREFIX[linha.tab] : null;
  return (
    <div style={{ color: CHAT_INK, textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}>
      {prefixo && <span style={{ color: TAB_COLOR[linha.tab].ink }}>{prefixo} - </span>}
      {linha.autor && <span>{linha.autor} : </span>}
      {linha.texto}
    </div>
  );
}

/**
 * Aba de canal: a mesma moldura curva das barras, com o fundo tingido da cor do
 * canal e o "x" da arte no canto de cima à direita.
 *
 * O "x" fica FORA do fluxo do texto (absoluto) para o rótulo continuar
 * centrado — e o Geral não recebe nenhum, porque ele é o apanhado e não fecha.
 */
function Aba({
  canal,
  ativa,
  onSelect,
  onClose,
}: {
  canal: ChatTab;
  ativa: boolean;
  onSelect: () => void;
  onClose?: () => void;
}) {
  const cor = TAB_COLOR[canal];
  const x = CHAT_ART_SIZE.closeTab.w * FRAME_SCALE;
  return (
    <div style={{ position: "relative" }}>
      <CurvedBox
        border={7}
        background={cor.tab}
        style={{
          height: ALTURA_ABA,
          cursor: "pointer",
          opacity: ativa ? 1 : 0.72,
          filter: ativa ? "brightness(1.12)" : undefined,
          transition: "opacity 120ms ease-out, filter 120ms ease-out",
        }}
        inner={{
          display: "flex",
          alignItems: "center",
          padding: `0 ${onClose ? x + 4 : 9}px 0 9px`,
        }}
        onPointerDown={onSelect}
        title={TAB_LABEL[canal]}
      >
        {/* rótulo em BRANCO em qualquer aba (ui-change.txt): quem diz o canal é
            a cor do FUNDO, e texto verde sobre verde some */}
        <span
          style={{
            font: `700 11px ${FRAME_FONT}`,
            color: CHAT_INK,
            textShadow: "0 1px 2px rgba(0,0,0,0.85)",
            whiteSpace: "nowrap",
          }}
        >
          {TAB_LABEL[canal]}
        </span>
      </CurvedBox>
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation(); // senão o clique no "x" também selecionaria a aba
            onClose();
          }}
          title={`Fechar ${TAB_LABEL[canal]}`}
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: x,
            height: x,
            border: "none",
            background: "none",
            padding: 0,
            cursor: "pointer",
            lineHeight: 0,
            zIndex: 1,
          }}
        >
          <img
            src={CHAT_ART.closeTab}
            alt="x"
            draggable={false}
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        </button>
      )}
    </div>
  );
}
