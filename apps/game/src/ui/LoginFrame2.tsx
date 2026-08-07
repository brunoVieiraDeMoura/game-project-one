import { LOGIN2_ART, LOGIN2_SIZE } from "./loginPanelArt";
import { LOGIN_COLORS } from "./login";

/**
 * A moldura nova de `/login` e `/char-select` (ver `ui/loginFrame2`).
 *
 * Diferente do `ChatFrame` (4 cantos + 4 faixas retas dedicadas), este pacote
 * só trouxe DOIS cantos por painel e UMA faixa vertical — sem peça reta
 * horizontal própria. Em vez de girar a faixa vertical (o comprimento do topo
 * MUDA com a largura do painel — fluida no login, fixa no canva — e a conta de
 * centralizar um elemento girado dentro de uma largura fluida é frágil demais
 * pro ganho), o topo fecha com um FILETE dourado fino, no mesmo idioma que
 * `LoginDecor.Era` já usa entre "A Era de Asterion" e os traços.
 *
 * `kind` escolhe o par de cantos:
 *  - "login": dois cantos ESQUERDOS (`borda-top/bot-login`), espelhados pro
 *    lado direito — o painel do formulário, mais estreito.
 *  - "canva": canto superior (`borda-top-canva`, espelhado à direita) + a
 *    base INTEIRA (`borda-bot-canva`, larga o bastante pra cobrir de ponta a
 *    ponta esticada) — o painel de personagens, bem mais largo.
 */
export function LoginFrame2({ kind = "login", scale = 1 }: { kind?: "login" | "canva"; scale?: number } = {}) {
  return kind === "canva" ? <CanvaFrame scale={scale} /> : <LoginPanelFrame scale={scale} />;
}

/**
 * Quanto o véu (o fundo escuro do painel) precisa recuar de cada lado pra
 * encostar exatamente no vão da moldura, sem sobrar nem faltar — MESMA conta
 * que `LoginChrome` usava com o `ChatFrame`, só que pras peças novas.
 */
export function loginFrame2Trilhos(
  kind: "login" | "canva",
  scale: number,
): { top: number; bottom: number; left: number; right: number } {
  if (kind === "canva") {
    const top = LOGIN2_SIZE.canvaTop.h * scale;
    const rail = LOGIN2_SIZE.canvaRail.w * scale;
    return { top, bottom: LOGIN2_SIZE.canvaBottom.h * 0.35, left: rail, right: rail };
  }
  const top = LOGIN2_SIZE.loginTop.h * scale;
  const bottom = LOGIN2_SIZE.loginBottom.h * scale;
  const rail = LOGIN2_SIZE.loginRail.w * scale;
  return { top: top * 0.12, bottom: bottom * 0.12, left: rail, right: rail };
}

function LoginPanelFrame({ scale }: { scale: number }) {
  const top = { w: LOGIN2_SIZE.loginTop.w * scale, h: LOGIN2_SIZE.loginTop.h * scale };
  const bottom = { w: LOGIN2_SIZE.loginBottom.w * scale, h: LOGIN2_SIZE.loginBottom.h * scale };
  const rail = LOGIN2_SIZE.loginRail.w * scale;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}>
      {/* faixas verticais: preenchem o vão entre o canto de cima e o de baixo,
          nos dois lados — a da direita é a mesma arte espelhada */}
      <Faixa url={LOGIN2_ART.loginRail} w={rail} top={top.h} bottom={bottom.h} lado="esq" />
      <Faixa url={LOGIN2_ART.loginRail} w={rail} top={top.h} bottom={bottom.h} lado="dir" />
      {/* filete do topo, entre os dois cantos de cima */}
      <Filete w1={top.w} />
      <Canto url={LOGIN2_ART.loginTop} w={top.w} h={top.h} pos={{ left: 0, top: 0 }} />
      <Canto url={LOGIN2_ART.loginTop} w={top.w} h={top.h} pos={{ right: 0, top: 0 }} espelhado />
      <Canto url={LOGIN2_ART.loginBottom} w={bottom.w} h={bottom.h} pos={{ left: 0, bottom: 0 }} />
      <Canto url={LOGIN2_ART.loginBottom} w={bottom.w} h={bottom.h} pos={{ right: 0, bottom: 0 }} espelhado />
    </div>
  );
}

function CanvaFrame({ scale }: { scale: number }) {
  const top = { w: LOGIN2_SIZE.canvaTop.w * scale, h: LOGIN2_SIZE.canvaTop.h * scale };
  const bottomH = LOGIN2_SIZE.canvaBottom.h * scale;
  const rail = LOGIN2_SIZE.canvaRail.w * scale;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}>
      <Faixa url={LOGIN2_ART.canvaRail} w={rail} top={top.h} bottom={bottomH * 0.72} lado="esq" />
      <Faixa url={LOGIN2_ART.canvaRail} w={rail} top={top.h} bottom={bottomH * 0.72} lado="dir" />
      <Filete w1={top.w} />
      <Canto url={LOGIN2_ART.canvaTop} w={top.w} h={top.h} pos={{ left: 0, top: 0 }} />
      <Canto url={LOGIN2_ART.canvaTop} w={top.w} h={top.h} pos={{ right: 0, top: 0 }} espelhado />
      {/* a base INTEIRA, esticada de ponta a ponta — larga o bastante (275 px
          nativos) pra não pixelizar num painel de 900 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: bottomH,
          backgroundImage: `url(${LOGIN2_ART.canvaBottom})`,
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
        }}
      />
    </div>
  );
}

function Canto({
  url,
  w,
  h,
  pos,
  espelhado,
}: {
  url: string;
  w: number;
  h: number;
  pos: React.CSSProperties;
  espelhado?: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        width: w,
        height: h,
        backgroundImage: `url(${url})`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        transform: espelhado ? "scaleX(-1)" : undefined,
        ...pos,
      }}
    />
  );
}

/** faixa vertical de madeira, entre o canto de cima e o de baixo de um lado */
function Faixa({
  url,
  w,
  top,
  bottom,
  lado,
}: {
  url: string;
  w: number;
  top: number;
  bottom: number;
  lado: "esq" | "dir";
}) {
  return (
    <div
      style={{
        position: "absolute",
        top,
        bottom,
        [lado === "esq" ? "left" : "right"]: 0,
        width: w,
        backgroundImage: `url(${url})`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        transform: lado === "dir" ? "scaleX(-1)" : undefined,
      }}
    />
  );
}

/** o filete dourado do topo — ver o porquê no comentário do módulo */
function Filete({ w1 }: { w1: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: w1 * 0.7,
        right: w1 * 0.7,
        top: w1 * 0.16,
        height: 1,
        background: `linear-gradient(90deg, transparent, ${LOGIN_COLORS.goldSoft}, transparent)`,
      }}
    />
  );
}
