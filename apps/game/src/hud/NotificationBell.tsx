import { useRef, useState } from "react";
import { CHAR_FRAME, FRAME_COLORS, FRAME_FONT } from "../ui/charFrame";
import { CHAT_ART, CHAT_BG } from "../ui/chatFrame";
import { CurvedBox } from "../ui/CurvedBox";
import { ScrollbarHider } from "../ui/ScrollbarHider";
import { ChatScrollbar } from "./ChatScrollbar";
import { MM_ART, MM_COLORS } from "../ui/minimap";
import { useNotifications } from "./notificationStore";

/**
 * Sino de notificações: fica no aro ao lado do minimapa, com um contador
 * vermelho, e abre um popup com as mensagens.
 *
 * O aro é o MESMO `ring-level.png` da placa do personagem (md5 idêntico ao do
 * pacote do minimapa), e o popup usa a moldura curva das barras mais a rolagem
 * do chat — todas peças que já existem. Nenhum PNG novo entra aqui.
 */
export function NotificationBell({ size }: { size: number }) {
  const itens = useNotifications((s) => s.itens);
  const aberto = useNotifications((s) => s.aberto);
  const abrir = useNotifications((s) => s.abrir);
  const [hover, setHover] = useState(false);

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <button
        onClick={() => abrir(!aberto)}
        title={itens.length ? `${itens.length} notificação(ões)` : "Sem notificações"}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer",
          transform: hover ? "scale(1.06)" : "none",
          filter: aberto ? "brightness(1.18)" : undefined,
          transition: "transform 120ms ease-out, filter 120ms ease-out",
        }}
      >
        {/* miolo do aro, como nos aros de nível: o vazado do PNG é ovalado, e o
            disco precisa SOBRAR para não deixar um fio de fundo aparecer */}
        <div
          style={{
            position: "absolute",
            inset: "8%",
            borderRadius: "50%",
            background: `radial-gradient(circle at 50% 30%, ${FRAME_COLORS.ringBase}, ${FRAME_COLORS.woodDark})`,
          }}
        />
        <img
          src={MM_ART.bell}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: "50%",
            transform: "translate(-50%,-50%)",
          }}
        />
        <img
          src={CHAR_FRAME.ring}
          alt=""
          draggable={false}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      </button>

      {itens.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "-4%",
            right: "-4%",
            minWidth: size * 0.36,
            height: size * 0.36,
            borderRadius: size * 0.18,
            background: "linear-gradient(180deg,#d9483a,#a02418)",
            border: "1px solid rgba(20,10,4,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: `700 ${Math.max(9, size * 0.24)}px ${FRAME_FONT}`,
            color: "#fff5ea",
            textShadow: `0 1px 2px ${MM_COLORS.shadow}`,
            pointerEvents: "none",
          }}
        >
          {itens.length}
        </div>
      )}

      {aberto && <NotificationPopup />}
    </div>
  );
}

const POPUP = { w: 300, h: 190 };
const BORDA = 9;

/**
 * Popup das notificações. Abre à ESQUERDA do sino porque ele já está colado na
 * borda direita da tela — abrindo para o lado natural, metade sairia do campo.
 */
function NotificationPopup() {
  const itens = useNotifications((s) => s.itens);
  const remover = useNotifications((s) => s.remover);
  const abrir = useNotifications((s) => s.abrir);
  const rolagem = useRef<HTMLDivElement>(null);

  return (
    <CurvedBox
      border={BORDA}
      background={CHAT_BG.panel}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 6,
        width: POPUP.w,
        height: POPUP.h,
        zIndex: 5,
        boxShadow: "0 8px 22px rgba(10,6,2,0.55)",
      }}
      inner={{ display: "flex", flexDirection: "column", padding: BORDA / 2 }}
    >
      <ScrollbarHider />
      <div style={{ display: "flex", alignItems: "center", padding: "2px 4px 6px" }}>
        <span style={{ flex: 1, font: `700 13px ${FRAME_FONT}`, color: MM_COLORS.ink }}>Notificações</span>
        <FecharX titulo="Fechar" onClick={() => abrir(false)} tamanho={14} />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 3 }}>
        <div ref={rolagem} className="chat-scroll" style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
          {itens.map((n) => (
            <div
              key={n.id}
              style={{
                position: "relative",
                background: CHAT_BG.canvas,
                borderRadius: 5,
                padding: "6px 22px 7px 8px",
                marginBottom: 4,
              }}
            >
              <div style={{ font: `700 12px ${FRAME_FONT}`, color: MM_COLORS.ink }}>{n.titulo}</div>
              <div style={{ font: `11px ${FRAME_FONT}`, color: "#cdbfa4", marginTop: 2 }}>{n.texto}</div>
              <div style={{ font: `10px ${FRAME_FONT}`, color: "#93866f", marginTop: 2 }}>{n.quando}</div>
              <FecharX
                titulo="Dispensar"
                onClick={() => remover(n.id)}
                tamanho={12}
                style={{ position: "absolute", top: 5, right: 5 }}
              />
            </div>
          ))}
        </div>
        <ChatScrollbar alvo={rolagem} revisao={itens.length} />
      </div>
    </CurvedBox>
  );
}

/** o "x" da arte (`tab-off`), usado no popup e em cada mensagem */
function FecharX({
  onClick,
  titulo,
  tamanho,
  style,
}: {
  onClick: () => void;
  titulo: string;
  tamanho: number;
  style?: React.CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={titulo}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        border: "none",
        background: "none",
        padding: 0,
        cursor: "pointer",
        width: tamanho,
        height: tamanho,
        lineHeight: 0,
        flex: "none",
        transform: hover ? "scale(1.18)" : "none",
        transition: "transform 110ms ease-out",
        ...style,
      }}
    >
      <img
        src={CHAT_ART.closeTab}
        alt="x"
        draggable={false}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </button>
  );
}
