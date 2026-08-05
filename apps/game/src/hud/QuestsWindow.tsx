import { useMemo, useRef, useState } from "react";
import { useHudStore } from "./hudStore";
import { useQuestUi } from "./questStore";
import { CHAR_FRAME, FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { CHAT_ART } from "../ui/chatFrame";
import { useNineSlice } from "../ui/nineSlice";
import { SLOT_FRAME } from "../ui/skillBar";
import { CurvedBox } from "../ui/CurvedBox";
import { CHROME, TYPE } from "../ui/windowChrome";
import { ScrollbarHider } from "../ui/ScrollbarHider";
import { ChatScrollbar } from "./ChatScrollbar";
import {
  QT_ART,
  QT_CLOSE_D,
  QT_COLORS,
  QT_LAYOUT_ART,
  QT_PAPER_PAD,
  QT_PLATE,
  QT_REWARD_ART,
  QT_ROW_ART,
  QT_WIDTH,
  QUEST_MOCK,
  caixaDaArte,
  daArte,
  type Quest,
  type QuestState,
} from "../ui/quest";

const escala = QT_WIDTH / QT_PLATE.w;
const px = (v: number) => v * escala;
/** px da ARTE → px de tela (a placa é normalizada; ver `ui/quest.ts`) */
const pxArte = (v: number) => px(daArte(v));
const caixa = (r: { x: number; y: number; w: number; h: number }) => {
  const c = caixaDaArte(r);
  return {
    position: "absolute" as const,
    left: px(c.x),
    top: px(c.y),
    width: px(c.w),
    height: px(c.h),
  };
};

/**
 * Tipografia da janela, num lugar só.
 *
 * Sete papéis e nada fora deles — antes cada bloco escolhia o corpo no lugar de
 * uso, e o nome da missão saía do mesmo tamanho do título da janela, sem
 * hierarquia. Todos os degraus vêm de `TYPE`, a escada comum às janelas com
 * arte própria, e a família é sempre a mesma: `FRAME_FONT` no texto e
 * `FRAME_NUM_FONT` em número.
 */
const FONTE = {
  /** "Missões", na barra do topo */
  janela: () => `700 ${px(TYPE.title)}px ${FRAME_FONT}`,
  /** nome da missão no pergaminho, e o glifo de estado da lista */
  titulo: () => `700 ${px(TYPE.section)}px ${FRAME_FONT}`,
  /** nome na lista */
  item: () => `${px(TYPE.name)}px ${FRAME_FONT}`,
  /** corpo do texto */
  corpo: () => `${px(TYPE.label)}px ${FRAME_FONT}`,
  /** rótulo de recompensa e de botão */
  corpoForte: () => `700 ${px(TYPE.label)}px ${FRAME_FONT}`,
  /** legenda: origem, objetivo, número da recompensa */
  legenda: () => `${px(TYPE.small)}px ${FRAME_FONT}`,
  /** faixas "MISSÃO EM ANDAMENTO" e "RECOMPENSAS" */
  faixa: () => `700 ${px(TYPE.tab)}px ${FRAME_FONT}`,
} as const;

/** números usam os algarismos alinhados das outras janelas */
const NUM = { fontFamily: FRAME_NUM_FONT, fontVariantNumeric: FRAME_NUM_VARIANT } as const;

/**
 * Marcador de estado à esquerda do nome.
 *
 * São dois glifos, não três: "?" enquanto a missão não acabou (disponível ou em
 * andamento) e "✓" quando ela está pronta para entregar. O "!" da referência
 * não é usado — pedido do projeto. Quem separa disponível de em andamento é a
 * COR: dourada chama atenção, apagada não.
 */
const MARCA: Record<QuestState, { glifo: string; cor: string; titulo: string }> = {
  available: { glifo: "?", cor: QT_COLORS.markOpen, titulo: "disponível" },
  active: { glifo: "?", cor: QT_COLORS.markProgress, titulo: "em andamento" },
  done: { glifo: "✓", cor: QT_COLORS.markDone, titulo: "pronta para entregar" },
};

/**
 * Janela de Missões vestida com a arte de `ui_definitiva/quest`.
 *
 * Como o inventário, o status, os amigos e as habilidades, ela sai do `Panel`
 * genérico de `Windows.tsx`: a placa já traz moldura, barra de título e os dois
 * painéis (a lista escura à esquerda, a cena de floresta do detalhe à direita).
 *
 * As missões são um MOCKUP (`QUEST_MOCK` em `ui/quest.ts`) — o projeto não vai
 * usar as do rAthena e o sistema próprio ainda não existe. Nada aqui fala com o
 * gateway: quando houver missão de verdade, é a constante que sai, e nenhum
 * componente desta tela conhece a origem dos dados de perto.
 */
export function QuestsWindow() {
  const fechar = () => useHudStore.getState().setWindow(null);
  // Rastreada e aberta moram no `questStore`: o painel fixo da esquerda
  // (`QuestTracker`) mexe nas duas, e as telas têm que concordar.
  const rastreada = useQuestUi((s) => s.rastreada);
  const aberta = useQuestUi((s) => s.aberta);
  const rolagem = useRef<HTMLDivElement>(null);

  const quest = useMemo(
    () => QUEST_MOCK.find((q) => q.id === aberta) ?? QUEST_MOCK[0],
    [aberta],
  );

  return (
    <div style={{ position: "relative", width: QT_WIDTH, height: (QT_WIDTH * QT_PLATE.h) / QT_PLATE.w }}>
      <ScrollbarHider />
      <img
        src={QT_ART.plate}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />

      <div
        style={{
          ...caixa(QT_LAYOUT_ART.title),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: FONTE.janela(),
          lineHeight: 1,
          color: QT_COLORS.ink,
          textShadow: `0 1px 3px ${QT_COLORS.shadow}`,
          pointerEvents: "none",
        }}
      >
        Missões
      </div>

      {/* ---- lista, no painel escuro da esquerda ---- */}
      <div style={{ ...caixa(QT_LAYOUT_ART.list), display: "flex", gap: pxArte(14) }}>
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
            gap: pxArte(QT_ROW_ART.gap),
          }}
        >
          {QUEST_MOCK.map((q) => (
            <LinhaQuest
              key={q.id}
              quest={q}
              ativa={q.id === quest?.id}
              rastreada={q.id === rastreada}
              onClick={() => useQuestUi.getState().abrir(q.id)}
            />
          ))}
        </div>
        {/* `auto` também aqui: com poucas missões a lista não rola, e o trilho
            vazio ao lado dela parecia defeito — mesma regra do texto. */}
        <div style={{ flex: "none", display: "flex" }}>
          <ChatScrollbar alvo={rolagem} revisao={QUEST_MOCK.length} largura={px(CHROME.scrollW)} auto />
        </div>
      </div>

      {/* Painel do detalhe: marrom translúcido sobre a floresta. Sem ele o
          conteúdo da direita flutuava sobre a mata e parecia fora do painel —
          e é ele que dá o CONTORNO em que tudo da direita tem que caber. */}
      <div
        style={{
          ...caixa(QT_LAYOUT_ART.detailPanel),
          background: QT_COLORS.detailPanel,
          borderRadius: pxArte(10),
          pointerEvents: "none",
        }}
      />

      {quest && (
        <Detalhe
          quest={quest}
          rastreada={quest.id === rastreada}
          onRastrear={() => useQuestUi.getState().rastrear(quest.id)}
          onAbandonar={() => useQuestUi.getState().parar(quest.id)}
        />
      )}

      <BotaoFechar onClick={fechar} />
    </div>
  );
}

/**
 * Uma linha da lista.
 *
 * O nome pode ocupar DUAS linhas — é o que a referência mostra ("EXTRA LONG
 * FIRST QUEST NAME" quebrado) —, então a altura é mínima e não fixa: um nome
 * curto encolhe a linha em vez de deixar um vão.
 */
function LinhaQuest({
  quest,
  ativa,
  rastreada,
  onClick,
}: {
  quest: Quest;
  ativa: boolean;
  rastreada: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const marca = MARCA[quest.estado];

  return (
    <button
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      title={`${quest.nome} — ${marca.titulo}`}
      style={{
        flex: "none",
        minHeight: pxArte(QT_ROW_ART.h),
        display: "flex",
        alignItems: "center",
        gap: pxArte(28),
        padding: `${pxArte(14)}px ${pxArte(24)}px`,
        border: "none",
        borderRadius: pxArte(8),
        // a selecionada clareia; a rastreada ganha um filete de ouro à esquerda
        background: ativa ? QT_COLORS.rowActive : hover ? QT_COLORS.rowHover : QT_COLORS.row,
        boxShadow: rastreada ? `inset ${pxArte(8)}px 0 0 ${QT_COLORS.markOpen}` : undefined,
        cursor: "pointer",
        textAlign: "left",
        transition: "background 110ms ease-out",
      }}
    >
      <span
        style={{
          flex: "none",
          width: pxArte(30),
          font: FONTE.titulo(),
          lineHeight: 1,
          color: marca.cor,
          textShadow: `0 1px 2px ${QT_COLORS.shadow}`,
        }}
      >
        {marca.glifo}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          font: FONTE.item(),
          lineHeight: 1.2,
          letterSpacing: "0.02em",
          color: ativa ? QT_COLORS.ink : QT_COLORS.inkDim,
          textShadow: `0 1px 2px ${QT_COLORS.shadow}`,
        }}
      >
        {quest.nome}
      </span>
    </button>
  );
}

/** o pergaminho da direita: nome, texto, objetivos, recompensas e os botões */
function Detalhe({
  quest,
  rastreada,
  onRastrear,
  onAbandonar,
}: {
  quest: Quest;
  rastreada: boolean;
  onRastrear: () => void;
  onAbandonar: () => void;
}) {
  const texto = useRef<HTMLDivElement>(null);
  const titulo =
    quest.estado === "available"
      ? "Missão Disponível"
      : quest.estado === "done"
        ? "Pronta para Entregar"
        : "Missão em Andamento";

  return (
    <>
      <Faixa rect={QT_LAYOUT_ART.detailHeader} fundo={QT_COLORS.headerBand} cor={QT_COLORS.headerInk}>
        {titulo}
      </Faixa>

      {/* pergaminho: sem ele o texto cai direto na mata e some entre as folhas */}
      <div
        style={{
          ...caixa(QT_LAYOUT_ART.paper),
          background: QT_COLORS.paper,
          borderRadius: pxArte(6),
          boxShadow: `0 ${pxArte(6)}px ${pxArte(18)}px rgba(20,14,6,0.35)`,
          display: "flex",
          flexDirection: "column",
          padding: `${pxArte(QT_PAPER_PAD.top)}px ${pxArte(QT_PAPER_PAD.x)}px ${pxArte(QT_PAPER_PAD.bottom)}px`,
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        <div style={{ font: FONTE.titulo(), lineHeight: 1.1, color: QT_COLORS.paperTitle, textAlign: "center" }}>
          {quest.nome}
        </div>
        <div
          style={{
            marginTop: pxArte(8),
            font: FONTE.legenda(),
            lineHeight: 1,
            color: QT_COLORS.paperInkDim,
            textAlign: "center",
          }}
        >
          {quest.origem} · nível {quest.nivel}
        </div>

        {/* Só o CORPO rola. Título e objetivos ficam fixos: o contador é o que o
            jogador confere, e ele não pode sair da vista por causa de uma
            descrição comprida. */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: pxArte(12), marginTop: pxArte(QT_PAPER_PAD.gap) }}>
          <div
            ref={texto}
            className="chat-scroll"
            style={{
              flex: 1,
              minWidth: 0,
              overflowY: "auto",
              font: FONTE.corpo(),
              lineHeight: 1.55,
              color: QT_COLORS.paperInk,
              textAlign: "justify",
            }}
          >
            {quest.descricao}
          </div>
          {/* `auto`: a barra só aparece quando o texto não cabe. Descrição curta
              não precisa de barra, e o trilho vazio ao lado do parágrafo parecia
              defeito. Ela continua MONTADA (com largura zero) porque é o trilho
              no DOM que permite medir se passou a ser necessária. */}
          <div style={{ flex: "none", display: "flex" }}>
            <ChatScrollbar alvo={texto} revisao={quest.id} largura={px(CHROME.scrollW)} auto />
          </div>
        </div>

        <div
          style={{
            flex: "none",
            marginTop: pxArte(QT_PAPER_PAD.gap),
            display: "flex",
            flexDirection: "column",
            gap: pxArte(10),
          }}
        >
          {quest.objetivos.map((o) => {
            const pronto = o.feito >= o.total;
            return (
              <div
                key={o.texto}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: pxArte(14),
                  font: FONTE.legenda(),
                  lineHeight: 1.3,
                  color: pronto ? QT_COLORS.paperInkDim : QT_COLORS.paperInk,
                }}
              >
                <span style={{ flex: "none", color: pronto ? QT_COLORS.markDone : QT_COLORS.paperInkDim }}>
                  {pronto ? "✓" : "•"}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    textDecoration: pronto ? "line-through" : undefined,
                  }}
                >
                  {o.texto}
                </span>
                <span style={{ flex: "none", ...NUM, fontWeight: 700 }}>
                  {o.feito} / {o.total}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Faixa rect={QT_LAYOUT_ART.rewardsHeader} fundo={QT_COLORS.rewardsBand} cor={QT_COLORS.ink}>
        Recompensas
      </Faixa>

      {/* As recompensas ficam CENTRADAS num bloco recuado das bordas do painel:
          com uma ou duas delas a fileira encostava num lado só. */}
      <div
        style={{
          ...caixa(QT_LAYOUT_ART.rewards),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: pxArte(QT_REWARD_ART.gap),
        }}
      >
        {quest.recompensas.map((r) => (
          <Recompensa key={r.kind + r.label} kind={r.kind} label={r.label} amount={r.amount} />
        ))}
      </div>

      {/*
        Os dois botões dividem a largura em partes IGUAIS (`flex: 1 1 0`), e o
        rótulo é curto de propósito: "Parar de rastrear" não cabia e empurrava o
        vizinho, deixando os dois de tamanhos diferentes. Quem diz que a missão
        está sendo rastreada é o ESTADO do botão, não o comprimento da frase.
      */}
      <div style={{ ...caixa(QT_LAYOUT_ART.actions), display: "flex", alignItems: "stretch", gap: pxArte(40) }}>
        <Botao cor={rastreada ? QT_COLORS.tracking : QT_COLORS.track} onClick={onRastrear}>
          {rastreada ? "Rastreando" : "Rastrear"}
        </Botao>
        <Botao cor={QT_COLORS.abandon} tinta={QT_COLORS.abandonInk} onClick={onAbandonar}>
          Abandonar
        </Botao>
      </div>
    </>
  );
}

/** faixa de seção ("MISSÃO EM ANDAMENTO", "RECOMPENSAS") */
function Faixa({
  rect,
  fundo,
  cor,
  children,
}: {
  rect: { x: number; y: number; w: number; h: number };
  fundo: string;
  cor: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        ...caixa(rect),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: fundo,
        borderRadius: pxArte(4),
        font: FONTE.faixa(),
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        lineHeight: 1,
        color: cor,
        textShadow: `0 1px 2px ${QT_COLORS.shadow}`,
        pointerEvents: "none",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Quadrado de recompensa, na moldura dos slots de habilidade.
 *
 * Ele fica sobre a CENA DE FLORESTA, não sobre o pergaminho, então a tinta é
 * clara — o marrom do texto do detalhe some neste fundo.
 */
function Recompensa({
  kind,
  label,
  amount,
}: {
  kind: "xp" | "job" | "zeny" | "item";
  label: string;
  amount?: number;
}) {
  const moldura = useNineSlice(SLOT_FRAME);
  const lado = pxArte(QT_REWARD_ART.size);
  const borda = Math.max(6, lado * 0.2);
  const cor =
    kind === "xp" ? "#8fc46a" : kind === "job" ? "#7fa8dc" : kind === "zeny" ? "#e0b455" : QT_COLORS.ink;

  return (
    <div
      title={amount != null ? `${label}: ${amount.toLocaleString("pt-BR")}` : label}
      style={{ position: "relative", width: lado, height: lado, flex: "none" }}
    >
      <div style={{ position: "absolute", inset: borda / 3, borderRadius: borda * 0.4, background: QT_COLORS.rewardSlot }} />
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
      <div
        style={{
          position: "absolute",
          inset: borda * 0.8,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: pxArte(6),
          pointerEvents: "none",
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            font: FONTE.corpoForte(),
            lineHeight: 1,
            color: cor,
            textShadow: `0 1px 2px ${QT_COLORS.shadow}`,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "100%",
          }}
        >
          {label}
        </span>
        {amount != null && (
          <span
            style={{
              ...NUM,
              fontSize: px(TYPE.small),
              lineHeight: 1,
              color: QT_COLORS.ink,
              textShadow: `0 1px 2px ${QT_COLORS.shadow}`,
            }}
          >
            {amount.toLocaleString("pt-BR")}
          </span>
        )}
      </div>
    </div>
  );
}

/** botão de ação: a moldura curva das barras, tingida */
function Botao({
  children,
  cor,
  tinta,
  onClick,
}: {
  children: React.ReactNode;
  cor: string;
  /** cor do texto; padrão é o creme das outras janelas */
  tinta?: string;
  onClick: () => void;
}) {
  return (
    <CurvedBox
      border={px(CHROME.tabBorder)}
      background={cor}
      // `flex: 1 1 0` reparte a largura em partes IGUAIS; com `flexBasis: auto`
      // o botão de rótulo mais longo roubava espaço do vizinho
      style={{ flex: "1 1 0", minWidth: 0, cursor: "pointer" }}
      inner={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        height: "100%",
        padding: `0 ${pxArte(12)}px`,
      }}
      onPointerDown={onClick}
    >
      <span
        style={{
          font: FONTE.corpoForte(),
          lineHeight: 1,
          color: tinta ?? QT_COLORS.ink,
          textShadow: `0 1px 2px ${QT_COLORS.shadow}`,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {children}
      </span>
    </CurvedBox>
  );
}

/** aro com o "x": o mesmo `ring-level` das outras janelas */
function BotaoFechar({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const d = px(QT_CLOSE_D);
  const c = caixaDaArte({ x: QT_LAYOUT_ART.close.cx, y: QT_LAYOUT_ART.close.cy, w: 0, h: 0 });
  return (
    <button
      onClick={onClick}
      title="Fechar (Alt+U)"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: px(c.x) - d / 2,
        top: px(c.y) - d / 2,
        width: d,
        height: d,
        border: "none",
        background: "none",
        padding: 0,
        cursor: "pointer",
        transform: hover ? "scale(1.08)" : "none",
        transition: "transform 120ms ease-out",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "8%",
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 30%, ${QT_COLORS.closeTint}, #4d160f)`,
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
        <img src={CHAT_ART.closeTab} alt="x" draggable={false} style={{ width: "40%", height: "40%", display: "block" }} />
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
