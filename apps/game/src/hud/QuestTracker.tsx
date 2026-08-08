import { useState } from "react";
import { CurvedBox } from "../ui/CurvedBox";
import { FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { TYPE } from "../ui/windowChrome";
import { useHudStore } from "./hudStore";
import { useQuestUi } from "./questStore";
import { QT_COLORS, QUEST_MOCK, type Quest } from "../ui/quest";
import { MINIMAP_WIDTH } from "../ui/minimap";

/**
 * Painel fixo de acesso rápido às missões, logo abaixo do minimapa.
 *
 * A moldura é a mesma do pacote de missões (`curva-das-bordas-barra-hp-sp` +
 * `reta-barra-hp-sp`, o 9-slice das barras) — nenhum arquivo novo.
 *
 * Regras do pedido:
 *
 * - mostra as TRÊS primeiras missões aceitas, para acesso rápido;
 * - cada uma tem um botão de rastrear ao lado;
 * - só UMA fica ativa por vez, o que sai de graça de `rastreada` ser um id só
 *   no `questStore` — rastrear outra sobrescreve;
 * - o painel SOME quando não há missão aceita, em vez de ficar um quadro vazio
 *   na tela.
 *
 * Missão aceita = `active` ou `done`. A `available` ainda não foi pega, e pôr
 * no rastreador algo que o jogador não aceitou seria mentira.
 */

/** quantas cabem no acesso rápido */
const QUANTAS = 3;
/**
 * Largura: a MESMA do minimapa (`MINIMAP_WIDTH`).
 *
 * O quadro fica logo abaixo dele, na mesma coluna do HUD — com largura própria
 * a coluna ficava escalonada, com uma borda sobrando da outra.
 */
const LARGURA = MINIMAP_WIDTH;

export function QuestTracker() {
  const rastreada = useQuestUi((s) => s.rastreada);
  const rastrear = useQuestUi((s) => s.rastrear);
  const abrir = useQuestUi((s) => s.abrir);

  const aceitas = QUEST_MOCK.filter((q) => q.estado !== "available").slice(0, QUANTAS);
  if (aceitas.length === 0) return null;

  const abrirJanela = (id: string) => {
    abrir(id);
    useHudStore.getState().openWindow("quests");
  };

  return (
    <CurvedBox
      border={10}
      background="rgba(34,26,16,0.82)"
      style={{ width: LARGURA }}
      inner={{ display: "flex", flexDirection: "column", gap: 6, padding: "9px 10px" }}
    >
      <div
        style={{
          font: `700 ${TYPE.tab}px ${FRAME_FONT}`,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: QT_COLORS.inkDim,
          textShadow: `0 1px 2px ${QT_COLORS.shadow}`,
          textAlign: "center",
        }}
      >
        Missões
      </div>

      {aceitas.map((q) => (
        <Linha
          key={q.id}
          quest={q}
          rastreada={q.id === rastreada}
          onAbrir={() => abrirJanela(q.id)}
          onRastrear={() => rastrear(q.id)}
        />
      ))}
    </CurvedBox>
  );
}

/**
 * Uma missão no acesso rápido: nome, progresso e o botão de rastrear.
 *
 * O progresso mostrado é o do PRIMEIRO objetivo não cumprido — é o que o
 * jogador está fazendo agora. Listar todos aqui viraria a janela inteira, e o
 * painel existe justamente para não precisar abri-la.
 */
function Linha({
  quest,
  rastreada,
  onAbrir,
  onRastrear,
}: {
  quest: Quest;
  rastreada: boolean;
  onAbrir: () => void;
  onRastrear: () => void;
}) {
  const [hover, setHover] = useState(false);
  const atual = quest.objetivos.find((o) => o.feito < o.total) ?? quest.objetivos[quest.objetivos.length - 1];
  const pronta = quest.estado === "done";

  return (
    <div
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 6px",
        borderRadius: 4,
        background: rastreada ? "rgba(74,58,30,0.85)" : hover ? "rgba(52,40,26,0.7)" : "transparent",
        // o filete de ouro à esquerda é o mesmo sinal da lista da janela
        boxShadow: rastreada ? `inset 3px 0 0 ${QT_COLORS.markOpen}` : undefined,
        transition: "background 110ms ease-out",
      }}
    >
      <button
        onClick={onAbrir}
        title={`${quest.nome} — abrir na janela de missões`}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 2,
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            maxWidth: "100%",
            font: `${TYPE.small}px ${FRAME_FONT}`,
            lineHeight: 1.15,
            color: rastreada ? QT_COLORS.ink : QT_COLORS.inkDim,
            textShadow: `0 1px 2px ${QT_COLORS.shadow}`,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {quest.nome}
        </span>
        {atual && (
          <span
            style={{
              display: "flex",
              gap: 5,
              maxWidth: "100%",
              font: `${TYPE.small - 1}px ${FRAME_FONT}`,
              lineHeight: 1,
              color: pronta ? QT_COLORS.markDone : QT_COLORS.inkDim,
              opacity: 0.85,
            }}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pronta ? "pronta para entregar" : atual.texto}
            </span>
            {!pronta && (
              <span style={{ flex: "none", fontFamily: FRAME_NUM_FONT, fontVariantNumeric: FRAME_NUM_VARIANT }}>
                {atual.feito}/{atual.total}
              </span>
            )}
          </span>
        )}
      </button>

      <BotaoRastrear ativo={rastreada} onClick={onRastrear} nome={quest.nome} />
    </div>
  );
}

/**
 * Botão de rastrear: um alvo desenhado em SVG.
 *
 * Não há peça de arte para ele no pacote, e um "R" ou um texto ocupariam a
 * largura do nome — que é o que o painel tem de mais escasso.
 */
function BotaoRastrear({ ativo, onClick, nome }: { ativo: boolean; onClick: () => void; nome: string }) {
  const [hover, setHover] = useState(false);
  const cor = ativo ? QT_COLORS.markOpen : hover ? QT_COLORS.ink : QT_COLORS.inkDim;
  return (
    <button
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      title={ativo ? `parar de rastrear ${nome}` : `rastrear ${nome}`}
      style={{
        flex: "none",
        width: 20,
        height: 20,
        border: "none",
        background: "none",
        padding: 0,
        cursor: "pointer",
        lineHeight: 0,
      }}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
        <circle cx="10" cy="10" r="6.5" fill="none" stroke={cor} strokeWidth="1.6" />
        <circle cx="10" cy="10" r="2.2" fill={cor} />
        <g stroke={cor} strokeWidth="1.6" strokeLinecap="round">
          <line x1="10" y1="1.5" x2="10" y2="4" />
          <line x1="10" y1="16" x2="10" y2="18.5" />
          <line x1="1.5" y1="10" x2="4" y2="10" />
          <line x1="16" y1="10" x2="18.5" y2="10" />
        </g>
      </svg>
    </button>
  );
}
