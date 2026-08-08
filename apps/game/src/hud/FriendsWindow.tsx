import { useEffect, useMemo, useRef, useState } from "react";
import { gateway } from "../net/gateway";
import { useFriendStore, type Friend, type GuildMember } from "../net/friendStore";
import { usePlayerStore } from "../net/playerStore";
import { JOB_NAMES } from "../character/jobNames";
import { useHudStore } from "./hudStore";
import { IconSquare } from "../ui/rpg";
import { CHAR_FRAME, FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { CHAT_ART } from "../ui/chatFrame";
import { CurvedBox } from "../ui/CurvedBox";
import { useNineSlice } from "../ui/nineSlice";
import { SLOT_FRAME } from "../ui/skillBar";
import { CHROME, TYPE } from "../ui/windowChrome";
import { ScrollbarHider } from "../ui/ScrollbarHider";
import { ChatScrollbar } from "./ChatScrollbar";
import {
  FL_ART,
  FL_AVATAR_INSET,
  FL_COLORS,
  FL_LAYOUT,
  FL_PLATE,
  FL_ROW,
  FL_SCROLL_W,
  FL_TABS,
  FL_WIDTH,
  type FriendTab,
} from "../ui/friends";

const escala = FL_WIDTH / FL_PLATE.w;
const px = (v: number) => v * escala;
const caixa = (r: { x: number; y: number; w: number; h: number }) => ({
  position: "absolute" as const,
  left: px(r.x),
  top: px(r.y),
  width: px(r.w),
  height: px(r.h),
});

/**
 * Uma linha da lista, já traduzida para o que a janela desenha.
 *
 * `nivel` e `classe` são OPCIONAIS porque nem toda aba os conhece: só a guilda
 * recebe os dois do servidor (ZC_MEMBERMGR_INFO). Amigo, recente e bloqueado
 * chegam só com nome — e onde não há dado a linha escreve "—", nunca um palpite.
 */
interface Linha {
  chave: string;
  nome: string;
  nivel?: number;
  classe?: string;
  online?: boolean;
  /** texto da segunda coluna, embaixo do estado */
  detalhe: string;
  /** ação do botão da direita (remover amigo, desbloquear, convidar) */
  acao?: { rotulo: string; titulo: string; fn: () => void };
}

/**
 * Lista de Amigos vestida com a arte de `ui_definitiva/friend-list`.
 *
 * Como o inventário e o status, ela NÃO entra no `Panel` genérico de
 * `Windows.tsx` — traz a própria moldura, o próprio título e o próprio botão de
 * fechar, e a página pixel-art do TravelBook por baixo brigaria com a madeira.
 *
 * A diferença para as outras duas é que aqui não há PNG de fundo: a moldura é o
 * 9-slice das barras de HP/SP em escala grande, que é justamente o desenho que
 * a referência mostra.
 *
 * O que cada aba mostra é o que o SERVIDOR manda, e as quatro mandam coisas
 * diferentes — ver `ui/friends.ts`. A coluna de nível/classe fica vazia na aba
 * de amigos de propósito: o ZC_FRIENDS_LIST de PACKETVER 20130618 carrega
 * `{ AID, CID, nome }` e nada mais (clif.cpp:15355).
 */
export function FriendsWindow() {
  const [aba, setAba] = useState<FriendTab>("amigos");
  const [novo, setNovo] = useState<string | null>(null);
  const online = usePlayerStore((s) => s.known);
  const friends = useFriendStore((s) => s.friends);
  const guild = useFriendStore((s) => s.guild);
  const recentes = useFriendStore((s) => s.recentes);
  const ignored = useFriendStore((s) => s.ignored);
  const pedido = useFriendStore((s) => s.pedido);
  const aviso = useFriendStore((s) => s.aviso);
  const rolagem = useRef<HTMLDivElement>(null);
  const fechar = () => useHudStore.getState().closeWindow("friends");

  // O aviso ("vocês agora são amigos", "recusado") some sozinho: ele é resposta
  // a um gesto, não estado — deixar na tela faria parecer erro permanente.
  useEffect(() => {
    if (!aviso) return;
    const id = setTimeout(() => useFriendStore.getState().setAviso(null), 6000);
    return () => clearTimeout(id);
  }, [aviso]);

  // Guilda e ignorados só chegam quando pedidos. O gateway já pede no
  // `world:ready`, mas alguém pode ter entrado numa guilda desde então.
  useEffect(() => {
    if (!online) return;
    if (aba === "guilda") gateway().emit("guild:request");
  }, [aba, online]);

  const linhas = useMemo<Linha[]>(() => {
    if (aba === "amigos") return friends.map(linhaDeAmigo);
    if (aba === "guilda") return guild.map(linhaDeGuilda);
    if (aba === "bloqueados")
      return ignored.map((nome) => ({
        chave: `bloq-${nome}`,
        nome,
        detalhe: "ignorado",
        acao: {
          rotulo: "Desbloquear",
          titulo: `voltar a receber sussurro de ${nome}`,
          fn: () => gateway().emit("ignore:remove", { name: nome }),
        },
      }));
    return recentes.map((r) => ({
      chave: `rec-${r.name}`,
      nome: r.name,
      detalhe: r.visto === "cena" ? "visto no mapa" : "falou no chat",
      acao: {
        rotulo: "Adicionar",
        titulo: `convidar ${r.name} para a lista de amigos`,
        fn: () => gateway().emit("friend:add", { name: r.name }),
      },
    }));
  }, [aba, friends, guild, recentes, ignored]);

  const alturaLinha = px(FL_ROW.h);

  return (
    <div style={{ position: "relative", width: FL_WIDTH, height: (FL_WIDTH * FL_PLATE.h) / FL_PLATE.w }}>
      <ScrollbarHider />

      {/* moldura: o 9-slice das barras esticado ao tamanho da janela */}
      <CurvedBox
        border={px(10)}
        background={FL_COLORS.panel}
        style={{ position: "absolute", inset: 0 }}
      />

      <div
        style={{
          ...caixa(FL_LAYOUT.title),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(TYPE.title),
          lineHeight: 1,
          color: FL_COLORS.ink,
          textShadow: `0 1px 3px ${FL_COLORS.shadow}`,
          pointerEvents: "none",
        }}
      >
        Lista de Amigos
      </div>

      <Aro rect={FL_LAYOUT.icon}>
        {/* o ícone é o único arquivo novo do pacote */}
        <img
          src={FL_ART.icon}
          alt=""
          draggable={false}
          style={{ width: "52%", height: "52%", display: "block", objectFit: "contain" }}
        />
      </Aro>

      <div style={{ ...caixa(FL_LAYOUT.tabs), display: "flex", gap: px(4) }}>
        {FL_TABS.map((t) => (
          <Aba
            key={t.key}
            label={t.label}
            contagem={contagem(t.key, friends, guild, recentes, ignored)}
            ativa={aba === t.key}
            onClick={() => setAba(t.key)}
          />
        ))}
      </div>

      <div style={{ ...caixa(FL_LAYOUT.field), display: "flex", gap: px(3) }}>
        <div
          ref={rolagem}
          className="chat-scroll"
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: "auto",
            overflowX: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: px(FL_ROW.gap),
            background: FL_COLORS.field,
            borderRadius: px(4),
            padding: px(3),
          }}
        >
          {linhas.length === 0 ? (
            <div
              style={{
                margin: "auto",
                padding: px(10),
                textAlign: "center",
                font: `${px(TYPE.label)}px ${FRAME_FONT}`,
                lineHeight: 1.4,
                color: FL_COLORS.inkDim,
                textShadow: `0 1px 2px ${FL_COLORS.shadow}`,
              }}
            >
              {vazio(aba, online)}
            </div>
          ) : (
            linhas.map((l) => <LinhaLista key={l.chave} linha={l} altura={alturaLinha} />)
          )}
        </div>
        <div style={{ width: px(FL_SCROLL_W), flex: "none", display: "flex" }}>
          <ChatScrollbar alvo={rolagem} revisao={linhas.length} largura={px(FL_SCROLL_W)} />
        </div>
      </div>

      <Adicionar
        aberto={novo !== null}
        valor={novo ?? ""}
        onAbrir={() => setNovo("")}
        onFechar={() => setNovo(null)}
        onDigitar={setNovo}
        onEnviar={() => {
          const nome = (novo ?? "").trim();
          if (!nome) return;
          gateway().emit("friend:add", { name: nome });
          setNovo(null);
        }}
      />

      {/* Convite recebido: o script do rAthena fica ESPERANDO a resposta, então
          a caixa não pode ser dispensável — só some com sim ou não. */}
      {pedido && (
        <Convite
          nome={pedido.name}
          onResponder={(accept) => {
            gateway().emit("friend:answer", {
              accountId: pedido.accountId,
              charId: pedido.charId,
              accept,
            });
            useFriendStore.getState().setPedido(null);
          }}
        />
      )}

      {aviso && (
        <div
          style={{
            position: "absolute",
            left: px(FL_LAYOUT.add.x + FL_LAYOUT.add.w + 8),
            top: px(FL_LAYOUT.add.y),
            height: px(FL_LAYOUT.add.h),
            display: "flex",
            alignItems: "center",
            maxWidth: px(FL_PLATE.w - FL_LAYOUT.add.x - FL_LAYOUT.add.w - 40),
            font: `${px(TYPE.small)}px ${FRAME_FONT}`,
            color: FL_COLORS.inkDim,
            textShadow: `0 1px 2px ${FL_COLORS.shadow}`,
            pointerEvents: "none",
          }}
        >
          {aviso}
        </div>
      )}

      <Aro rect={FL_LAYOUT.close} onClick={fechar} titulo="Fechar (Alt+Z)" tinta={FL_COLORS.closeTint}>
        <img src={CHAT_ART.closeTab} alt="x" draggable={false} style={{ width: "40%", height: "40%", display: "block" }} />
      </Aro>
    </div>
  );
}

/** amigo: nome e online. Nível/classe NÃO existem neste pacote. */
function linhaDeAmigo(f: Friend): Linha {
  return {
    chave: `am-${f.accountId}-${f.charId}`,
    nome: f.name,
    online: f.online,
    // O rAthena não manda o mapa do amigo em pacote nenhum desta faixa; o
    // travessão é o mesmo que a referência mostra na linha offline.
    detalhe: "—",
    acao: {
      rotulo: "Remover",
      titulo: `tirar ${f.name} da lista de amigos`,
      fn: () => gateway().emit("friend:remove", { accountId: f.accountId, charId: f.charId }),
    },
  };
}

/** guilda: a única lista do protocolo com nível e classe na mesma linha */
function linhaDeGuilda(m: GuildMember): Linha {
  return {
    chave: `gu-${m.accountId}-${m.charId}`,
    nome: m.name,
    nivel: m.level,
    classe: JOB_NAMES[m.job] ?? `classe ${m.job}`,
    online: m.online,
    detalhe: m.position === 0 ? "líder" : `cargo ${m.position}`,
  };
}

function contagem(
  aba: FriendTab,
  friends: Friend[],
  guild: GuildMember[],
  recentes: unknown[],
  ignored: string[],
): number {
  if (aba === "amigos") return friends.length;
  if (aba === "guilda") return guild.length;
  if (aba === "recentes") return recentes.length;
  return ignored.length;
}

function vazio(aba: FriendTab, online: boolean): string {
  if (!online) return "Sem sessão: estas listas são do personagem logado no rAthena.";
  if (aba === "amigos") return "Nenhum amigo ainda. Use “+ Adicionar Amigo”.";
  if (aba === "guilda") return "Você não está em uma guilda.";
  if (aba === "recentes") return "Ninguém visto ainda nesta sessão.";
  return "Ninguém bloqueado.";
}

/**
 * Uma linha de pergaminho.
 *
 * Duas linhas de texto de cada lado, como na referência: à esquerda nome em
 * cima e "Nv. X · classe" embaixo; à direita o estado em cima e o detalhe
 * embaixo. O que não se sabe vai "—".
 */
function LinhaLista({ linha, altura }: { linha: Linha; altura: number }) {
  const [hover, setHover] = useState(false);
  const moldura = useNineSlice(SLOT_FRAME);
  const avatar = altura - px(FL_AVATAR_INSET) * 2;
  const borda = Math.max(5, avatar * 0.22);

  return (
    <div
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        flex: "none",
        height: altura,
        display: "flex",
        alignItems: "center",
        gap: px(6),
        padding: `0 ${px(6)}px 0 ${px(FL_AVATAR_INSET)}px`,
        borderRadius: px(3),
        background: hover ? FL_COLORS.rowHover : FL_COLORS.row,
        boxShadow: `0 1px 0 rgba(20,12,4,0.55)`,
        transition: "background 110ms ease-out",
      }}
    >
      {/* Retrato: sem arte de rosto por jogador, entra o quadrado determinístico
          do projeto (a mesma peça dos ícones de item/skill), na moldura dos
          slots de habilidade — que é o quadrado que a referência desenha. */}
      <div style={{ position: "relative", width: avatar, height: avatar, flex: "none" }}>
        <div style={{ position: "absolute", inset: borda / 3, overflow: "hidden", borderRadius: borda * 0.5 }}>
          <IconSquare seed={`jogador-${linha.nome}`} size={avatar} label={linha.nome} />
        </div>
        {moldura && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderStyle: "solid",
              borderWidth: borda,
              borderImageSource: `url(${moldura})`,
              borderImageSlice: SLOT_FRAME.slice ?? 24,
              borderImageWidth: `${borda}px`,
              borderImageRepeat: "stretch",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: px(1) }}>
        <span
          style={{
            font: `700 ${px(TYPE.name)}px ${FRAME_FONT}`,
            lineHeight: 1,
            color: FL_COLORS.rowInk,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {linha.nome}
        </span>
        <span
          style={{
            display: "flex",
            gap: px(8),
            font: `${px(TYPE.small)}px ${FRAME_FONT}`,
            lineHeight: 1,
            color: FL_COLORS.rowInkDim,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <span style={{ fontFamily: FRAME_NUM_FONT, fontVariantNumeric: FRAME_NUM_VARIANT }}>
            Nv. {linha.nivel ?? "—"}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{linha.classe ?? "—"}</span>
        </span>
      </div>

      <div
        style={{
          flex: "none",
          width: px(96),
          display: "flex",
          flexDirection: "column",
          gap: px(1),
          overflow: "hidden",
        }}
      >
        {linha.online != null && (
          <span style={{ display: "flex", alignItems: "center", gap: px(4) }}>
            <span
              style={{
                width: px(6),
                height: px(6),
                borderRadius: "50%",
                flex: "none",
                background: linha.online ? FL_COLORS.online : FL_COLORS.offline,
                boxShadow: `inset 0 0 0 1px rgba(20,12,4,0.4)`,
              }}
            />
            <span style={{ font: `${px(TYPE.label)}px ${FRAME_FONT}`, lineHeight: 1, color: FL_COLORS.rowInk }}>
              {linha.online ? "Online" : "Offline"}
            </span>
          </span>
        )}
        <span
          style={{
            font: `${px(TYPE.small)}px ${FRAME_FONT}`,
            lineHeight: 1,
            color: FL_COLORS.rowInkDim,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {linha.detalhe}
        </span>
      </div>

      {linha.acao && (
        <button
          onClick={linha.acao.fn}
          title={linha.acao.titulo}
          style={{
            flex: "none",
            border: "none",
            borderRadius: px(3),
            padding: `${px(4)}px ${px(6)}px`,
            background: "rgba(58,43,24,0.16)",
            font: `700 ${px(TYPE.small)}px ${FRAME_FONT}`,
            lineHeight: 1,
            color: FL_COLORS.rowInkDim,
            cursor: "pointer",
            // só aparece com o mouse em cima: sete botões acesos ao mesmo tempo
            // competiriam com o nome, que é o que se lê na lista
            opacity: hover ? 1 : 0,
            transition: "opacity 110ms ease-out",
          }}
        >
          {linha.acao.rotulo}
        </button>
      )}
    </div>
  );
}

/** aba: a moldura curva das barras, tingida — a mesma receita do inventário */
function Aba({
  label,
  contagem,
  ativa,
  onClick,
}: {
  label: string;
  contagem: number;
  ativa: boolean;
  onClick: () => void;
}) {
  return (
    <CurvedBox
      border={px(CHROME.tabBorder)}
      background={ativa ? FL_COLORS.tabActive : FL_COLORS.tabIdle}
      style={{
        flex: 1,
        cursor: "pointer",
        filter: ativa ? "brightness(1.12)" : undefined,
        transition: "filter 120ms ease-out",
      }}
      inner={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: px(4),
        overflow: "hidden",
        padding: `0 ${px(3)}px`,
      }}
      onPointerDown={onClick}
      title={label}
    >
      <span
        style={{
          font: `700 ${px(TYPE.tab)}px ${FRAME_FONT}`,
          lineHeight: 1,
          color: FL_COLORS.ink,
          textShadow: `0 1px 2px ${FL_COLORS.shadow}`,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      {contagem > 0 && (
        <span
          style={{
            fontFamily: FRAME_NUM_FONT,
            fontVariantNumeric: FRAME_NUM_VARIANT,
            fontSize: px(TYPE.small),
            lineHeight: 1,
            color: FL_COLORS.inkDim,
            flex: "none",
          }}
        >
          {contagem}
        </span>
      )}
    </CurvedBox>
  );
}

/**
 * "+ Adicionar Amigo" e o balão que ele abre.
 *
 * O balão é a segunda peça da referência (o retângulo solto embaixo dela), e
 * mora ANCORADO ao botão em vez de no meio da tela: é resposta a um clique
 * daqui, não uma janela por si.
 */
function Adicionar({
  aberto,
  valor,
  onAbrir,
  onFechar,
  onDigitar,
  onEnviar,
}: {
  aberto: boolean;
  valor: string;
  onAbrir: () => void;
  onFechar: () => void;
  onDigitar: (v: string) => void;
  onEnviar: () => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (aberto) campo.current?.focus();
  }, [aberto]);

  return (
    <>
      <CurvedBox
        border={px(CHROME.tabBorder)}
        background={FL_COLORS.add}
        style={{ ...caixa(FL_LAYOUT.add), cursor: "pointer" }}
        inner={{ display: "flex", alignItems: "center", justifyContent: "center", gap: px(5) }}
        onPointerDown={onAbrir}
        title="convidar alguém pelo nome"
      >
        <img
          src={CHAT_ART.addTab}
          alt=""
          draggable={false}
          style={{ height: px(CHROME.iconH), width: "auto", flex: "none" }}
        />
        <span
          style={{
            font: `700 ${px(TYPE.label)}px ${FRAME_FONT}`,
            lineHeight: 1,
            color: FL_COLORS.ink,
            textShadow: `0 1px 2px ${FL_COLORS.shadow}`,
            whiteSpace: "nowrap",
          }}
        >
          Adicionar Amigo
        </span>
      </CurvedBox>

      {aberto && (
        <CurvedBox
          border={px(CHROME.boxBorder)}
          background="rgba(46,38,24,0.97)"
          style={{
            position: "absolute",
            left: px(FL_LAYOUT.add.x),
            // acima do botão: para baixo ele sairia da moldura da janela
            bottom: px(FL_PLATE.h - FL_LAYOUT.add.y + 6),
            width: px(180),
            zIndex: 3,
          }}
          inner={{ display: "flex", flexDirection: "column", gap: px(6), padding: px(9) }}
        >
          <span
            style={{
              font: `700 ${px(TYPE.name)}px ${FRAME_FONT}`,
              lineHeight: 1,
              color: FL_COLORS.ink,
              textShadow: `0 1px 2px ${FL_COLORS.shadow}`,
            }}
          >
            Adicionar Amigo
          </span>
          <input
            ref={campo}
            value={valor}
            placeholder="Digite o nome.."
            onChange={(e) => onDigitar(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEnviar();
              if (e.key === "Escape") onFechar();
              // o campo come a tecla: sem isto, digitar "a" no nome abriria a
              // janela de status por trás (hud/hotkeys ouve Alt+letra, mas o
              // chat também escuta Enter)
              e.stopPropagation();
            }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: `${px(6)}px ${px(7)}px`,
              borderRadius: px(3),
              border: "none",
              outline: "none",
              background: "rgba(18,16,10,0.85)",
              font: `${px(TYPE.label)}px ${FRAME_FONT}`,
              color: FL_COLORS.ink,
            }}
          />
          <div style={{ display: "flex", gap: px(6), justifyContent: "flex-end" }}>
            <Botao onClick={onFechar}>cancelar</Botao>
            <Botao onClick={onEnviar} destaque>
              enviar
            </Botao>
          </div>
        </CurvedBox>
      )}
    </>
  );
}

/** convite recebido — o script do servidor está esperando sim ou não */
function Convite({ nome, onResponder }: { nome: string; onResponder: (accept: boolean) => void }) {
  return (
    <CurvedBox
      border={px(CHROME.boxBorder)}
      background="rgba(46,38,24,0.97)"
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-50%)",
        width: px(230),
        zIndex: 4,
      }}
      inner={{ display: "flex", flexDirection: "column", gap: px(8), padding: px(11) }}
    >
      <span
        style={{
          font: `${px(TYPE.label)}px ${FRAME_FONT}`,
          lineHeight: 1.4,
          color: FL_COLORS.ink,
          textShadow: `0 1px 2px ${FL_COLORS.shadow}`,
        }}
      >
        <b>{nome}</b> quer ser seu amigo.
      </span>
      <div style={{ display: "flex", gap: px(6), justifyContent: "flex-end" }}>
        <Botao onClick={() => onResponder(false)}>recusar</Botao>
        <Botao onClick={() => onResponder(true)} destaque>
          aceitar
        </Botao>
      </div>
    </CurvedBox>
  );
}

function Botao({
  children,
  onClick,
  destaque,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destaque?: boolean;
}) {
  return (
    <CurvedBox
      border={px(CHROME.tabBorder)}
      background={destaque ? FL_COLORS.add : "rgba(38,32,20,0.9)"}
      style={{ cursor: "pointer" }}
      inner={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `${px(5)}px ${px(10)}px`,
      }}
      onPointerDown={onClick}
    >
      <span
        style={{
          font: `700 ${px(TYPE.label)}px ${FRAME_FONT}`,
          lineHeight: 1,
          color: FL_COLORS.ink,
          textShadow: `0 1px 2px ${FL_COLORS.shadow}`,
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
    </CurvedBox>
  );
}

/**
 * Aro de madeira do canto — o mesmo `ring-level` da placa do personagem.
 *
 * Vale aqui a regra dos outros aros: o disco do miolo tem que SOBRAR (8% para
 * dentro), porque o vazado do PNG é levemente ovalado e um disco justo deixa um
 * fio do jogo aparecendo por trás.
 */
function Aro({
  rect,
  children,
  onClick,
  titulo,
  tinta,
}: {
  rect: { cx: number; cy: number; d: number };
  children: React.ReactNode;
  onClick?: () => void;
  titulo?: string;
  tinta?: string;
}) {
  const [hover, setHover] = useState(false);
  const d = px(rect.d);
  return (
    <button
      onClick={onClick}
      title={titulo}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: px(rect.cx) - d / 2,
        top: px(rect.cy) - d / 2,
        width: d,
        height: d,
        border: "none",
        background: "none",
        padding: 0,
        cursor: onClick ? "pointer" : "default",
        transform: hover && onClick ? "scale(1.08)" : "none",
        transition: "transform 120ms ease-out",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "8%",
          borderRadius: "50%",
          background: tinta
            ? `radial-gradient(circle at 50% 30%, ${tinta}, #4d160f)`
            : "radial-gradient(circle at 50% 30%, #4a3a20, #2a1f10)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        {children}
      </div>
      <img
        src={CHAR_FRAME.ring}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
    </button>
  );
}
