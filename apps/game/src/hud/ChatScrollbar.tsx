import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_ART, CHAT_ART_SIZE, FRAME_SCALE } from "../ui/chatFrame";

const K = FRAME_SCALE;
const LARGURA = CHAT_ART_SIZE.scrollCap.w * K; // o cursor é a peça mais larga
const CAP = CHAT_ART_SIZE.scrollCap.h * K;
const SETA = CHAT_ART_SIZE.scrollArrow.h * K;
const PASSO = 48; // px por clique na seta

/**
 * Barra de rolagem do chat, montada com as peças da arte.
 *
 * O navegador não deixa vestir a barra nativa com imagem, então ela é escondida
 * (`.chat-scroll` em Chat.tsx) e esta desenha por cima: calha repetida, seta em
 * cima e embaixo, e um cursor de três partes — ponta, miolo esticado e a mesma
 * ponta girada 180°.
 *
 * A seta da arte aponta para BAIXO; a de cima é ela espelhada.
 *
 * A posição vem do elemento rolável de verdade (`alvo`), não de um estado
 * paralelo: roda da tarde, `scrollIntoView` e mensagem nova mexem no scrollTop
 * sem passar por aqui, e um estado próprio dessincronizaria.
 */
export function ChatScrollbar({
  alvo,
  /** muda quando chega mensagem — obriga a remedir o conteúdo */
  revisao,
}: {
  alvo: React.RefObject<HTMLDivElement | null>;
  revisao: unknown;
}) {
  const trilho = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ topo: 0, altura: 0, rolavel: false });
  const arrasto = useRef<{ y0: number; scroll0: number } | null>(null);

  const medir = useCallback(() => {
    const el = alvo.current;
    const via = trilho.current;
    if (!el || !via) return;
    const vao = via.clientHeight;
    const excedente = el.scrollHeight - el.clientHeight;
    if (excedente <= 1 || vao <= 0) {
      setPos({ topo: 0, altura: vao, rolavel: false });
      return;
    }
    // o cursor nunca fica menor que duas pontas, senão a arte desmonta
    const altura = Math.max(CAP * 2, (el.clientHeight / el.scrollHeight) * vao);
    const topo = (el.scrollTop / excedente) * (vao - altura);
    setPos({ topo, altura, rolavel: true });
  }, [alvo]);

  useEffect(() => {
    const el = alvo.current;
    if (!el) return;
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", medir);
      ro.disconnect();
    };
  }, [alvo, medir]);

  useEffect(medir, [revisao, medir]);

  const rolar = (delta: number) => {
    const el = alvo.current;
    if (el) el.scrollTop += delta;
  };

  const pegar = (e: React.PointerEvent) => {
    const el = alvo.current;
    if (!el) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    arrasto.current = { y0: e.clientY, scroll0: el.scrollTop };
  };
  const mover = (e: React.PointerEvent) => {
    const el = alvo.current;
    const via = trilho.current;
    const a = arrasto.current;
    if (!el || !via || !a) return;
    const vao = via.clientHeight - pos.altura;
    if (vao <= 0) return;
    // px de tela → px de conteúdo: o cursor percorre `vao` enquanto o conteúdo
    // percorre todo o excedente
    const excedente = el.scrollHeight - el.clientHeight;
    el.scrollTop = a.scroll0 + ((e.clientY - a.y0) / vao) * excedente;
  };
  const soltar = () => {
    arrasto.current = null;
  };

  const seta = (paraCima: boolean) => (
    <button
      onClick={() => rolar(paraCima ? -PASSO : PASSO)}
      style={{
        border: "none",
        background: "none",
        padding: 0,
        cursor: "pointer",
        width: LARGURA,
        height: SETA,
        lineHeight: 0,
        opacity: pos.rolavel ? 1 : 0.4,
      }}
    >
      <img
        src={CHAT_ART.scrollArrow}
        alt=""
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          transform: paraCima ? "scaleY(-1)" : undefined,
        }}
      />
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: LARGURA }}>
      {seta(true)}
      <div
        ref={trilho}
        style={{
          flex: 1,
          width: "100%",
          position: "relative",
          backgroundImage: `url(${CHAT_ART.scrollTrack})`,
          backgroundSize: `${CHAT_ART_SIZE.scrollTrack.w * K}px ${CHAT_ART_SIZE.scrollTrack.h * K}px`,
          backgroundRepeat: "repeat-y",
          backgroundPosition: "center top",
        }}
      >
        {pos.rolavel && (
          <div
            onPointerDown={pegar}
            onPointerMove={mover}
            onPointerUp={soltar}
            onPointerCancel={soltar}
            style={{
              position: "absolute",
              left: 0,
              width: "100%",
              top: pos.topo,
              height: pos.altura,
              cursor: "grab",
              touchAction: "none",
            }}
          >
            {/* A peça é a ponta de BAIXO — o arredondado com o botão fica na
                base do desenho. Então quem espelha é a de cima, não a de baixo
                (estava ao contrário nas duas). */}
            <img
              src={CHAT_ART.scrollCap}
              alt=""
              draggable={false}
              style={{ ...peca(CAP), transform: "scaleY(-1)" }}
            />
            <div
              style={{
                height: `calc(100% - ${CAP * 2}px)`,
                backgroundImage: `url(${CHAT_ART.scrollMid})`,
                backgroundSize: "100% 100%",
              }}
            />
            <img src={CHAT_ART.scrollCap} alt="" draggable={false} style={peca(CAP)} />
          </div>
        )}
      </div>
      {seta(false)}
    </div>
  );
}

const peca = (h: number): React.CSSProperties => ({
  width: "100%",
  height: h,
  display: "block",
  pointerEvents: "none",
});
