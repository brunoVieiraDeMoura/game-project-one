import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChatFrame } from "../hud/ChatFrame";
import { CurvedBox } from "./CurvedBox";
import { FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "./charFrame";
import { CHAT_ART_SIZE, FRAME_SCALE, RAIL } from "./chatFrame";
import { LOGIN_ART, LOGIN_COLORS, LOGIN_FRAME_SCALE, u } from "./login";

/**
 * As peças comuns de `/login` e `/char-select`.
 *
 * As duas telas são a mesma casa: a cena pintada de fundo e os mesmos campos e
 * botões. Deixar isso em um lugar é o que impede as duas de divergirem no
 * primeiro ajuste — e elas são vistas em sequência, então divergir salta aos
 * olhos.
 */

/**
 * O PALCO: a pintura inteira, sem corte e sem ampliação.
 *
 * Antes o fundo era `cover`, que AMPLIA até preencher a janela e corta o que
 * sobra — o "zoom in" do relato, e o motivo de a arte nunca aparecer inteira. O
 * palco tem a proporção NATIVA da pintura (1536×1024) e cresce até o limite da
 * janela; o que sobra em volta é escuro. Numa janela mais larga que 3:2 sobram
 * faixas laterais, numa mais alta sobram em cima e embaixo — "estende só se for
 * necessário".
 *
 * Ele também publica `--palco`, que é 1% da largura dele. TODA medida destas
 * telas sai daí (`u()` em `ui/login`), e é isso que faz as placas de região
 * continuarem em cima do vulcão e das pirâmides em qualquer tamanho de janela.
 */
/**
 * A largura do palco em PIXEL, para quem precisa de número e não de CSS.
 *
 * `u()` resolve em `cqw` e serve para tudo que é estilo. Mas as molduras de ARTE
 * (`CurvedBox`, `ChatFrame`) recebem a espessura como NÚMERO em JS — elas montam
 * a peça 9-slice e escolhem o corte a partir dele. Sem saber o tamanho do palco,
 * a moldura ficaria em px fixo enquanto todo o resto da tela escala, e a
 * proporção entre a folhagem e o painel mudaria a cada tamanho de janela.
 *
 * Zero enquanto não mediu — quem consome trata isso como "ainda não desenha
 * moldura", que dura um quadro.
 */
const PalcoPx = createContext(0);

export function useLarguraDoPalco(): number {
  return useContext(PalcoPx);
}

export function LoginBackdrop({ children }: { children: ReactNode }) {
  const palco = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);

  /**
   * `ResizeObserver` e não `window.resize`: o palco muda de tamanho por
   * proporção da janela, e nem toda mudança de tamanho dele vem de um resize da
   * janela (zoom, barra de rolagem aparecendo, devtools abrindo de lado). Ele
   * observa o elemento, que é o que realmente importa.
   */
  useEffect(() => {
    const el = palco.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width ?? 0;
      // só publica na mudança REAL: o observer dispara com fração de pixel e
      // cada `setState` repinta a tela inteira de decoração
      setLargura((antes) => (Math.abs(antes - w) > 0.5 ? w : antes));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        // o mesmo escuro do véu, para as faixas de sobra não parecerem um bug
        background: "#0a0806",
        overflow: "hidden",
      }}
    >
      <div
        ref={palco}
        style={
          {
            position: "relative",
            /**
             * O palco ocupa a JANELA INTEIRA — sem barras nas laterais.
             *
             * Ele já teve a proporção nativa da pintura, o que deixava faixas
             * escuras dos lados numa tela larga. Agora ele preenche, e a pintura
             * é ESTICADA para caber (`100% 100%`), não ampliada e cortada como
             * fazia o `cover`: nada da cena se perde, que era o ponto do "tira o
             * zoom". A deformação é o preço, e ela é pequena — 16:9 contra os
             * 3:2 da arte dá ~11% de esticada na horizontal.
             *
             * Como a pintura cobre o palco exatamente, uma feição que está a
             * 18,6% da altura da IMAGEM está a 18,6% da altura do PALCO. É por
             * isso que as âncoras verticais da decoração são `%`, e não `u()`.
             */
            width: "100%",
            height: "100%",
            // `100% 100%` e não `cover`: o palco JÁ tem a proporção da imagem,
            // então esticar para as bordas é exatamente desenhá-la 1:1
            background: `url(${LOGIN_ART.background}) center / 100% 100% no-repeat`,
            /**
             * `--palco` é 1% da largura DESTE elemento, e é a unidade de tudo
             * que se desenha por cima (`u()` em `ui/login`).
             *
             * Tem de ser `cqw`, não `%`: percentual em `font-size` resolve
             * contra a fonte do PAI, não contra a largura — o título sairia
             * proporcional ao texto herdado e não à pintura. `cqw` é a largura
             * do container, que é exatamente o que se quer, e vale igual para
             * fonte, recuo e posição. Daí o `containerType`, sem o qual a
             * unidade não tem a que se referir.
             */
            containerType: "inline-size",
            "--palco": "1cqw",
          } as CSSProperties
        }
      >
        {/**
         * Escurecimento por cima da cena.
         *
         * A pintura tem céu claro e areia, e texto claro sobre eles some. Um véu
         * em degradê (leve no meio, forte nas bordas) resolve sem apagar a arte:
         * o olho continua lendo a cena e o conteúdo ganha contraste.
         */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 50% 46%, rgba(6,4,3,0.12) 0%, rgba(6,4,3,0.45) 62%, rgba(6,4,3,0.78) 100%)",
            pointerEvents: "none",
          }}
        />
        <PalcoPx.Provider value={largura}>{children}</PalcoPx.Provider>
      </div>
    </div>
  );
}

/**
 * A COLUNA central: título em cima, painel embaixo, sem sobreposição.
 *
 * Antes o título e o painel eram os dois ABSOLUTOS, cada um com a sua âncora —
 * e numa janela baixa eles se atropelavam: o painel, centrado, subia por cima
 * do nome do jogo, e o que sobrava era a decoração aparecendo debaixo dele.
 * Absoluto não reflui.
 *
 * Aqui os dois vivem em FLUXO, numa coluna centrada que ocupa a altura da tela
 * menos o rodapé. O `gap` garante o vão entre eles e o `min-height: 0` deixa a
 * coluna encolher — em janela baixa o conjunto sobe junto, em vez de um passar
 * por cima do outro. As placas de região continuam absolutas, porque elas estão
 * presas a feições da PINTURA, não ao conteúdo.
 */
export function LoginColuna({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        // o rodapé (classificação, atalhos, epígrafe) ocupa ~14% embaixo
        bottom: "14%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: u(1.6),
        padding: `${u(2)} ${u(2)} 0`,
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}

/**
 * O painel ORNAMENTADO — a moldura com folhagem nos quatro cantos.
 *
 * É a arte mais elaborada do pacote, e por isso vai no painel de LOGIN: ele é o
 * assunto da tela. As placas de região, a classificação e o rodapé ficam com a
 * curva simples (`LoginDecor.Caixa`) — se todas tivessem folhagem, nenhuma
 * chamaria atenção.
 *
 * A moldura é a MESMA do chat (`hud/ChatFrame`): os quatro cantos do pacote de
 * login são byte a byte (md5 conferido) os dele. Ela é decoração absoluta e fica
 * por CIMA, então o conteúdo precisa de recuo próprio para não passar por baixo
 * das folhas — daí o `padding` generoso, que é medido pelo tamanho do canto.
 */
export function LoginPainelOrnado({
  largura,
  children,
  style,
}: {
  /** largura em CSS (aceita `u()`), porque o painel escala com o palco */
  largura: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const palco = useLarguraDoPalco();
  /**
   * A escala da folhagem sai do PALCO, não do painel.
   *
   * Pelo painel, uma tela estreita (onde o painel encolhe) teria cantos
   * minúsculos e a moldura viraria um fio. Presa ao palco, a folhagem tem sempre
   * a mesma presença na tela — que é o que o olho compara.
   */
  const escala = Math.max(0.3, Math.min(0.5, palco * 0.00028));
  const t = trilhos(escala);

  return (
    <div style={{ position: "relative", width: largura, ...style }}>
      {/**
       * O véu vai até ENCOSTAR nos trilhos da moldura.
       *
       * Antes ele era recuado por uma fração do CANTO, o que o deixava pequeno e
       * fora de centro: os quatro cantos da arte têm tamanhos diferentes
       * (171×132, 206×137, 171×121, 206×128), então um recuo uniforme sobra de um
       * lado e falta do outro. Recuando por TRILHO — que é a espessura da borda
       * em cada lado —, o escuro preenche exatamente o vão da moldura.
       */}
      <div
        style={{
          position: "absolute",
          top: t.top,
          bottom: t.bottom,
          left: t.left,
          right: t.right,
          background: LOGIN_COLORS.panel,
          boxShadow: "0 18px 60px rgba(0,0,0,0.6)",
        }}
      />
      <ChatFrame escala={escala} />
      {/**
       * O recuo do CONTEÚDO é maior que o do véu: a folhagem dos cantos entra
       * para dentro do painel (é o que a torna ornamentada), e texto por baixo
       * dela fica ilegível. Medido na arte, ela avança ~50 px no canto
       * superior-esquerdo — daí o recuo sair do tamanho do canto, e não do
       * trilho.
       */}
      <div
        style={{
          position: "relative",
          padding: `${132 * escala * 0.5}px ${171 * escala * 0.42}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Espessura de cada trilho da moldura, na escala pedida.
 *
 * `RAIL` é medido na escala do chat (`FRAME_SCALE`); aqui a moldura é maior, e
 * quem desenha por dentro dela precisa dos mesmos números convertidos. Sem isto
 * cada consumidor recalcularia a conversão à mão e os dois divergiriam.
 */
function trilhos(escala: number) {
  const k = escala / FRAME_SCALE;
  return { top: RAIL.top * k, bottom: RAIL.bottom * k, left: RAIL.left * k, right: RAIL.right * k };
}

/**
 * O painel do `/char-select` — a mesma moldura, em tamanho fixo.
 *
 * Ele não escala com o palco porque o conteúdo dele (nove cartões de slot com
 * nome, classe e nível) tem um piso de legibilidade próprio: encolher com a
 * janela deixaria o nome do personagem miúdo, e é ele o que se vem ler aqui.
 */
export function LoginPanel({
  width,
  children,
  style,
}: {
  width: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const t = trilhos(LOGIN_FRAME_SCALE);
  return (
    <div style={{ position: "relative", width, ...style }}>
      {/* mesma regra do painel de login: o véu encosta nos trilhos, senão sobra
          de um lado e falta do outro (os quatro cantos têm tamanhos diferentes) */}
      <div
        style={{
          position: "absolute",
          top: t.top,
          bottom: t.bottom,
          left: t.left,
          right: t.right,
          background: LOGIN_COLORS.panel,
          boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
        }}
      />
      <ChatFrame escala={LOGIN_FRAME_SCALE} />
      <div
        style={{
          position: "relative",
          padding: `${132 * LOGIN_FRAME_SCALE * 0.62}px ${171 * LOGIN_FRAME_SCALE * 0.5}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** título de painel (char-select), na fonte pintada do jogo */
export function LoginTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 22 }}>
      <h1
        style={{
          margin: 0,
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: 34,
          lineHeight: 1.1,
          letterSpacing: 1,
          color: LOGIN_COLORS.ink,
          textShadow: `0 2px 6px ${LOGIN_COLORS.shadow}`,
        }}
      >
        {children}
      </h1>
      {sub !== undefined && (
        <p
          style={{
            margin: "6px 0 0",
            fontFamily: FRAME_FONT,
            fontSize: 13,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: LOGIN_COLORS.inkFaint,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

/**
 * Campo de digitar do painel de login, com o ícone dentro — o formato da
 * referência.
 *
 * O `input` é o de verdade: autocomplete, gerenciador de senha e navegação por
 * teclado são de graça no elemento certo, e cada um teria de ser reimplementado
 * à mão em qualquer outra coisa. O que se desenha é o CHROME em volta.
 *
 * Sem `<label>` visível: o rótulo é o `placeholder` e o ícone, como no mockup.
 * O `aria-label` continua lá — quem usa leitor de tela não vê ícone nenhum.
 */
export function LoginCampo({
  icone,
  ...input
}: { icone: "usuario" | "senha" } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: u(0.7),
        padding: `${u(0.6)} ${u(0.9)}`,
        background: LOGIN_COLORS.field,
        border: `1px solid ${LOGIN_COLORS.goldSoft}`,
        borderRadius: u(0.3),
      }}
    >
      <IconeDeCampo nome={icone} />
      <input
        {...input}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          fontFamily: FRAME_FONT,
          fontSize: u(0.88),
          color: LOGIN_COLORS.ink,
        }}
      />
    </div>
  );
}

function IconeDeCampo({ nome }: { nome: "usuario" | "senha" }) {
  const cor = LOGIN_COLORS.gold;
  const comum = { width: u(1.05), height: u(1.05), display: "block", flex: "0 0 auto" } as const;
  if (nome === "usuario") {
    return (
      <svg viewBox="0 0 24 24" style={comum} aria-hidden fill={cor}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 4-6 8-6s8 2 8 6z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" style={comum} aria-hidden fill={cor}>
      <path d="M7 10V7a5 5 0 0110 0v3h1a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2v-7a2 2 0 012-2zm2 0h6V7a3 3 0 00-6 0z" />
    </svg>
  );
}

/**
 * Botão largo do painel de login.
 *
 * As cores saem da própria pintura: o vinho de ENTRAR é a capa do imperador, o
 * azul de CRIAR CONTA é o das bandeiras da varanda. Um degradê vertical e uma
 * borda clara dão o relevo — o pacote de arte não traz botão desse tamanho, e
 * esticar uma peça de outro tamanho destoaria mais que desenhar.
 */
export function LoginBotaoLargo({
  children,
  onClick,
  type = "button",
  tom = "entrar",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  tom?: "entrar" | "criar";
  disabled?: boolean;
}) {
  const base = tom === "entrar" ? LOGIN_COLORS.entrar : LOGIN_COLORS.criar;
  const borda = tom === "entrar" ? LOGIN_COLORS.entrarBorda : LOGIN_COLORS.criarBorda;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: "none",
        width: "100%",
        padding: `${u(0.72)} ${u(1)}`,
        borderRadius: u(0.3),
        border: `1px solid ${borda}`,
        background: `linear-gradient(180deg, ${base} 0%, rgba(0,0,0,0.55) 160%)`,
        color: LOGIN_COLORS.ink,
        fontFamily: FRAME_FONT,
        fontSize: u(0.95),
        letterSpacing: u(0.1),
        textTransform: "uppercase",
        textShadow: `0 ${u(0.08)} ${u(0.16)} rgba(0,0,0,0.9)`,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** botão pequeno de madeira — usado no char-select */
export function LoginButton({
  children,
  onClick,
  type = "button",
  primario = false,
  disabled = false,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  primario?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: "none",
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
    >
      <CurvedBox
        border={9}
        background={primario ? "rgba(150,112,38,0.72)" : "rgba(28,22,14,0.72)"}
        inner={{
          padding: "9px 18px",
          textAlign: "center",
          fontFamily: FRAME_FONT,
          fontWeight: primario ? 700 : 400,
          fontSize: 15,
          letterSpacing: 0.5,
          color: LOGIN_COLORS.ink,
          textShadow: `0 1px 3px ${LOGIN_COLORS.shadow}`,
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </CurvedBox>
    </button>
  );
}

/** campo com rótulo em cima — usado no char-select */
export function LoginField({
  label,
  ...input
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontSize: 13,
          letterSpacing: 1,
          color: LOGIN_COLORS.inkDim,
          textShadow: `0 1px 2px ${LOGIN_COLORS.shadow}`,
        }}
      >
        {label}
      </span>
      <CurvedBox border={9} background={LOGIN_COLORS.field} inner={{ padding: "2px 10px" }}>
        <input
          {...input}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            fontFamily: FRAME_FONT,
            fontSize: 16,
            lineHeight: 1.6,
            color: LOGIN_COLORS.ink,
            padding: "6px 0",
          }}
        />
      </CurvedBox>
    </label>
  );
}

/**
 * Seta de voltar, com o rótulo AO LADO.
 *
 * Só o desenho não diz para onde se volta — e esta é a única saída da tela de
 * personagens, então ela não pode depender de o jogador adivinhar. O rótulo fica
 * na mesma peça clicável (um botão só), não num texto solto ao lado: assim a
 * área de clique cobre os dois.
 */
export function LoginBack({ onClick, titulo }: { onClick: () => void; titulo: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      style={{
        appearance: "none",
        border: "none",
        background: "transparent",
        padding: 8,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <img src={LOGIN_ART.back} alt="" draggable={false} style={{ height: 26, display: "block" }} />
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontSize: 14,
          color: LOGIN_COLORS.inkDim,
          textShadow: `0 1px 3px ${LOGIN_COLORS.shadow}`,
          whiteSpace: "nowrap",
        }}
      >
        {titulo}
      </span>
    </button>
  );
}

/** aviso de erro — o vermelho é o mesmo do realce de inimigo */
export function LoginError({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: `${u(1.1)} 0 0`,
        padding: `${u(0.55)} ${u(0.8)}`,
        borderRadius: u(0.3),
        background: "rgba(120,26,20,0.32)",
        border: `1px solid ${LOGIN_COLORS.danger}`,
        fontFamily: FRAME_FONT,
        fontSize: u(0.68),
        color: "#ffcdc8",
        textAlign: "center",
      }}
    >
      {children}
    </p>
  );
}

/** número na fonte de algarismos do jogo (nível, slot) */
export const LOGIN_NUM: CSSProperties = {
  fontFamily: FRAME_NUM_FONT,
  fontVariantNumeric: FRAME_NUM_VARIANT,
};
