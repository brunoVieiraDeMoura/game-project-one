import type { CSSProperties, ReactNode } from "react";

/**
 * Fita de banner (kit 5 do leia1.txt): uma ponta com bico em V, espelhada nos
 * DOIS lados, com um trecho liso esticando o miolo. Serve as duas fitas da
 * tela de login — "A ERA DE ASTERION" (`eraCap`/`eraExt`) e "Entre em sua
 * jornada" (`headerCap`/`headerExt`) — com peças diferentes por prop.
 *
 * As duas pontas do pacote são a MESMA mão (bico à direita, face reta à
 * esquerda): a arte vai como veio do lado direito e espelhada
 * (`scaleX(-1)`) do esquerdo.
 *
 * Ponta e extensor têm banda de arte em OFFSETS diferentes dentro do próprio
 * canvas (`RIBBON_BAND` em `ui/loginFrameArt.ts`, medido no alpha) — alinhar
 * pelo topo do PNG deixaria um degrau na emenda. `margin-top` compensa a
 * diferença, e por isso o container pede `overflow: visible`.
 */
export function Ribbon({
  cap,
  ext,
  tam,
  banda,
  escala,
  largura,
  children,
  estiloTexto,
}: {
  /** URL da ponta (bico à direita) */
  cap: string;
  /** URL do trecho que estica no meio */
  ext: string;
  tam: { cap: { w: number; h: number }; ext: { w: number; h: number } };
  /** banda útil de cada peça, medida no alpha (`RIBBON_BAND.era` / `.header`) */
  banda: { cap: { top: number; h: number }; ext: { top: number; h: number } };
  /** px de tela por px de arte */
  escala: number;
  /** largura total em CSS; omitida = a fita se ajusta ao texto */
  largura?: string;
  children: ReactNode;
  estiloTexto?: CSSProperties;
}) {
  const capW = tam.cap.w * escala;
  const capH = tam.cap.h * escala;
  const extH = tam.ext.h * escala;
  /**
   * A ponta fica na referência (marginTop 0); o miolo desce o suficiente pra
   * a BANDA dele (não o topo do PNG) alinhar com a banda da ponta:
   * `bandaCap.top - bandaExt.top` — positivo quando a banda do extensor
   * nasce mais perto do topo do PRÓPRIO canvas que a da ponta (os dois casos
   * medidos: era +7, cabeçalho +11). Conferido: `bandaCap.top + bandaCap.h`
   * bate com `offsetMeio + bandaExt.top + bandaExt.h` nos dois pares.
   */
  const offsetMeio = (banda.cap.top - banda.ext.top) * escala;
  const offsetCap = 0;

  const capStyle: CSSProperties = {
    flex: "0 0 auto",
    width: capW,
    height: capH,
    backgroundImage: `url(${cap})`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
    marginTop: offsetCap,
  };

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "flex-start",
        overflow: "visible",
        width: largura,
        pointerEvents: "none",
      }}
    >
      {/* esquerda: espelhada (o bico da arte é do lado direito) */}
      <div style={{ ...capStyle, transform: "scaleX(-1)" }} />
      <div
        style={{
          flex: "1 1 auto",
          minWidth: tam.ext.w * escala,
          height: extH,
          marginTop: offsetMeio,
          backgroundImage: `url(${ext})`,
          // ESTICADO, não ladrilhado: o extensor é grão de madeira sem
          // repetição desenhada (não é um padrão cíclico), e `repeat-x`
          // deixava uma emenda vertical visível a cada 47 px de arte — um
          // "código de barras" atravessando a fita. Esticar é a mesma regra
          // que já vale pros outros trechos retos do projeto (`bar-edge`
          // etc): sem textura repetitiva, esticar não mostra costura.
          backgroundRepeat: "no-repeat",
          backgroundSize: "100% 100%",
        }}
      />
      {/* direita: a arte como veio, bico já apontando pra fora */}
      <div style={capStyle} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...estiloTexto,
        }}
      >
        {children}
      </div>
    </div>
  );
}
