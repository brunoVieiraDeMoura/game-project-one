import { LOGIN_FRAME_ART, LOGIN_FRAME_SIZE, CANVA_RAIL, CANVA_BOTTOM_LEAD_IN } from "./loginFrameArt";

/**
 * O quadro "canva principal" — a moldura de madeira+vinha que envolve a tela
 * INTEIRA (leia1.txt: "TODO O CANVA TEM UM ADORNO EM VOLTA ... [tudo tem que
 * ser renderizado dentro desse canva]").
 *
 * Estrutura igual a `hud/ChatFrame` (trechos retos primeiro, cantos por cima
 * cobrindo as pontas deles), mas com só DOIS desenhos de canto — cada um
 * espelhado pro lado oposto — em vez de quatro distintos, porque é assim que
 * a arte nova veio.
 *
 * Monta como OVERLAY em `LoginBackdrop` (`position:absolute; inset:0`, dentro
 * do mesmo `PalcoPx.Provider`), nunca como wrapper com padding próprio: as
 * âncoras em `%`/`u()` de `LoginDecor` (as quatro placas de região, presas a
 * feições da PINTURA) contam com o palco continuar sendo o mesmo elemento de
 * sempre. Um wrapper novo mudaria essa referência e desalinharia as quatro
 * placas dos marcos que elas apontam.
 */
export function CanvaFrame({ escala }: { escala: number }) {
  const k = escala;
  const top = { w: LOGIN_FRAME_SIZE.canvaTop.w * k, h: LOGIN_FRAME_SIZE.canvaTop.h * k };
  const bottom = { w: LOGIN_FRAME_SIZE.canvaBottom.w * k, h: LOGIN_FRAME_SIZE.canvaBottom.h * k };
  const railTop = CANVA_RAIL.top * k;
  const railSide = CANVA_RAIL.side * k;
  const leadIn = CANVA_BOTTOM_LEAD_IN * k;
  // ladrilhado no tamanho NATIVO (× escala) — ver o comentário grande abaixo
  const edgeTopTileW = LOGIN_FRAME_SIZE.canvaEdgeTop.w * k;
  const edgeBottomTileW = LOGIN_FRAME_SIZE.canvaEdgeBottom.w * k;
  const edgeSideTileH = LOGIN_FRAME_SIZE.canvaEdgeSide.h * k;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}>
      {/**
       * As faixas retas são LADRILHADAS (`repeat`), não esticadas.
       *
       * `background-size: 100% 100%` esticava as ~50-88 px nativas da peça
       * pra cobrir o vão INTEIRO entre os cantos — e esse vão cresce com a
       * largura da JANELA, não com a arte. Numa tela larga (>1200 px) a
       * textura de madeira borrava e ainda abria uma costura dura na emenda
       * com cada canto, porque o trecho esticado parava de bater com o grão
       * da vinha ao lado. A arte é um tábua repetível — ladrilhar no tamanho
       * NATIVO (× escala) mantém o grão do mesmo tamanho em qualquer largura
       * de palco, e a emenda com o canto (que É a mesma arte, na mesma
       * escala) fecha sozinha.
       */}
      <div
        style={{
          position: "absolute",
          left: top.w,
          right: top.w,
          top: 0,
          height: railTop,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaEdgeTop})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: `${edgeTopTileW}px 100%`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: bottom.w,
          right: bottom.w,
          bottom: 0,
          height: bottom.h,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaEdgeBottom})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: `${edgeBottomTileW}px 100%`,
        }}
      />
      {/* faixa lateral: do pé do canto de cima até o topo da parte OPACA do
          canto de baixo — que começa `CANVA_BOTTOM_LEAD_IN` px adentro dele
          (a base é vazada nas primeiras linhas), daí o desconto no `bottom`. */}
      <div
        style={{
          position: "absolute",
          top: top.h,
          bottom: bottom.h - leadIn,
          left: 0,
          width: railSide,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaEdgeSide})`,
          backgroundRepeat: "repeat-y",
          backgroundSize: `100% ${edgeSideTileH}px`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: top.h,
          bottom: bottom.h - leadIn,
          right: 0,
          width: railSide,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaEdgeSide})`,
          backgroundRepeat: "repeat-y",
          backgroundSize: `100% ${edgeSideTileH}px`,
          transform: "scaleX(-1)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: top.w,
          height: top.h,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaTop})`,
          backgroundSize: "100% 100%",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: top.w,
          height: top.h,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaTop})`,
          backgroundSize: "100% 100%",
          transform: "scaleX(-1)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: bottom.w,
          height: bottom.h,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaBottom})`,
          backgroundSize: "100% 100%",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: bottom.w,
          height: bottom.h,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaBottom})`,
          backgroundSize: "100% 100%",
          transform: "scaleX(-1)",
        }}
      />
    </div>
  );
}

/**
 * O quadro do `/char-select` (`ui_definitiva/character-create`,
 * ui-change.txt: "borda-top-principal ... ROTACIONE PARA TODOS OS LADOS").
 *
 * MESMOS arquivos de `canvaTop`/`canvaEdgeTop`/`canvaEdgeSide` (byte a byte
 * conferido — o pacote de char-select reusa o de login), mas SEM canto nem
 * faixa de baixo dedicados: aqui um canto SÓ, espelhado nos 4 sentidos (igual
 * o `CardFrame` já faz por canvas, só que aqui por CSS/absolute porque a
 * moldura precisa ficar por CIMA do conteúdo, não como `border-image` de uma
 * caixa). O resultado é um quadro fino e uniforme nos quatro lados — sem a
 * banda grossa de baixo que o `/login` tem — que é exatamente o que a
 * referência (WoW) mostra.
 */
export function CharSelectFrame({ escala }: { escala: number }) {
  const k = escala;
  const corner = { w: LOGIN_FRAME_SIZE.canvaTop.w * k, h: LOGIN_FRAME_SIZE.canvaTop.h * k };
  const railTop = CANVA_RAIL.top * k;
  const railSide = CANVA_RAIL.side * k;
  // ladrilhado, não esticado — mesma razão do `CanvaFrame` (ver comentário lá)
  const edgeTopTileW = LOGIN_FRAME_SIZE.canvaEdgeTop.w * k;
  const edgeSideTileH = LOGIN_FRAME_SIZE.canvaEdgeSide.h * k;

  const canto = (pos: React.CSSProperties, espelhoX: boolean, espelhoY: boolean) => (
    <div
      style={{
        position: "absolute",
        width: corner.w,
        height: corner.h,
        backgroundImage: `url(${LOGIN_FRAME_ART.canvaTop})`,
        backgroundSize: "100% 100%",
        transform: `scale(${espelhoX ? -1 : 1}, ${espelhoY ? -1 : 1})`,
        ...pos,
      }}
    />
  );

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}>
      <div
        style={{
          position: "absolute",
          left: corner.w,
          right: corner.w,
          top: 0,
          height: railTop,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaEdgeTop})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: `${edgeTopTileW}px 100%`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: corner.w,
          right: corner.w,
          bottom: 0,
          height: railTop,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaEdgeTop})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: `${edgeTopTileW}px 100%`,
          transform: "scaleY(-1)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: corner.h,
          bottom: corner.h,
          left: 0,
          width: railSide,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaEdgeSide})`,
          backgroundRepeat: "repeat-y",
          backgroundSize: `100% ${edgeSideTileH}px`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: corner.h,
          bottom: corner.h,
          right: 0,
          width: railSide,
          backgroundImage: `url(${LOGIN_FRAME_ART.canvaEdgeSide})`,
          backgroundRepeat: "repeat-y",
          backgroundSize: `100% ${edgeSideTileH}px`,
          transform: "scaleX(-1)",
        }}
      />
      {canto({ left: 0, top: 0 }, false, false)}
      {canto({ right: 0, top: 0 }, true, false)}
      {canto({ left: 0, bottom: 0 }, false, true)}
      {canto({ right: 0, bottom: 0 }, true, true)}
    </div>
  );
}

/** trilho do quadro de char-select — fino e igual nos 4 lados (um canto só) */
export function charSelectTrilhos(escala: number): { top: number; bottom: number; left: number; right: number } {
  const top = CANVA_RAIL.top * escala;
  const side = CANVA_RAIL.side * escala;
  return { top, bottom: top, left: side, right: side };
}

/**
 * A escala do quadro, a partir do PALCO — 1402 é a largura da `referencia.png`,
 * onde a arte lê 1:1 (topo 15 px, lateral 18 px). `clamp` evita a vinha virar
 * fio numa janela estreita ou engolir a tela numa 4K.
 */
export function escalaDoCanva(palcoPx: number): number {
  return Math.max(0.5, Math.min(1.2, palcoPx / 1402));
}

/** o recuo seguro de cada lado — quem precisa desviar do quadro chama isto */
export function canvaTrilhos(escala: number): { top: number; bottom: number; left: number; right: number } {
  return {
    top: CANVA_RAIL.top * escala,
    bottom: LOGIN_FRAME_SIZE.canvaBottom.h * escala,
    left: CANVA_RAIL.side * escala,
    right: CANVA_RAIL.side * escala,
  };
}
