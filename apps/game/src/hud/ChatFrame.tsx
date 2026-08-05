import { CHAT_ART, CHAT_ART_SIZE, FRAME_SCALE, RAIL } from "../ui/chatFrame";

/**
 * Moldura ornamentada do chat: quatro cantos + três trechos retos esticados.
 *
 * Não dá para usar `border-image` aqui — os quatro cantos são DESENHOS
 * diferentes e de tamanhos diferentes, e a folhagem de cada um invade o painel
 * de um jeito próprio. Então cada peça é ancorada no seu canto e os trechos
 * retos preenchem o vão entre elas.
 *
 * O que faz a emenda sumir é o alinhamento medido na arte (ver `ui/chatFrame`):
 * o trilho de cima começa 1 px abaixo do topo, o da esquerda 1 px da borda, e
 * os retos são desenhados exatamente nessas faixas. Os PNGs de extensão têm o
 * traço na MESMA posição relativa, então esticá-los na direção longa não
 * desalinha nada.
 *
 * Fica por CIMA do conteúdo (`zIndex`) porque a folhagem tem que passar na
 * frente do canvas, e inteiramente com `pointer-events: none` — é decoração.
 */
export function ChatFrame({ escala = FRAME_SCALE }: { escala?: number } = {}) {
  /**
   * A escala é PARÂMETRO porque a moldura serve duas telas.
   *
   * Ela nasceu para o chat (0,5), e o login/char-select usam a MESMA arte num
   * painel muito maior — os quatro cantos são byte a byte (md5 conferido) os do
   * pacote do chat. Copiar o componente para mudar um número duplicaria as oito
   * peças e o alinhamento medido entre elas, que é a parte difícil.
   */
  const k = escala;
  const S = CHAT_ART_SIZE;
  const tl = { w: S.cornerTopLeft.w * k, h: S.cornerTopLeft.h * k };
  const tr = { w: S.cornerTopRight.w * k, h: S.cornerTopRight.h * k };
  const bl = { w: S.cornerBottomLeft.w * k, h: S.cornerBottomLeft.h * k };
  const br = { w: S.cornerBottomRight.w * k, h: S.cornerBottomRight.h * k };

  const canto = (url: string, w: number, h: number, pos: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    width: w,
    height: h,
    backgroundImage: `url(${url})`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
    ...pos,
  });

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}>
      {/* trechos retos primeiro: os cantos cobrem as pontas deles */}
      {/* Cada reto é a FATIA exata do canto vizinho (as 19 primeiras linhas em
          cima, as 9 últimas embaixo), então basta ancorar na mesma borda e
          desenhar na altura nativa: nada de corte, espelho ou correção de
          brilho — a emenda casa sozinha. */}
      <div
        style={{
          position: "absolute",
          left: tl.w,
          right: tr.w,
          top: 0,
          height: RAIL.top * (escala / FRAME_SCALE),
          backgroundImage: `url(${CHAT_ART.edgeTop})`,
          backgroundSize: "100% 100%",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: bl.w,
          right: br.w,
          bottom: 0,
          height: RAIL.bottom * (escala / FRAME_SCALE),
          backgroundImage: `url(${CHAT_ART.edgeBottom})`,
          backgroundSize: "100% 100%",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: tl.h,
          bottom: bl.h,
          left: 0,
          width: S.edgeLeft.w * k,
          backgroundImage: `url(${CHAT_ART.edgeLeft})`,
          backgroundSize: "100% 100%",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: tr.h,
          bottom: br.h,
          right: 0,
          width: S.edgeRight.w * k,
          backgroundImage: `url(${CHAT_ART.edgeRight})`,
          backgroundSize: "100% 100%",
        }}
      />

      <div style={canto(CHAT_ART.cornerTopLeft, tl.w, tl.h, { left: 0, top: 0 })} />
      <div style={canto(CHAT_ART.cornerTopRight, tr.w, tr.h, { right: 0, top: 0 })} />
      <div style={canto(CHAT_ART.cornerBottomLeft, bl.w, bl.h, { left: 0, bottom: 0 })} />
      <div style={canto(CHAT_ART.cornerBottomRight, br.w, br.h, { right: 0, bottom: 0 })} />
    </div>
  );
}
