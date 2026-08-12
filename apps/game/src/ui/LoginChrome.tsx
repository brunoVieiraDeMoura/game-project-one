import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CurvedBox } from "./CurvedBox";
import { CardFrame } from "./CardFrame";
import { ChatFrame } from "../hud/ChatFrame";
import { FRAME_SCALE, RAIL } from "./chatFrame";
import { FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "./charFrame";
import { LoginFrame2, loginFrame2Trilhos } from "./LoginFrame2";
import { LOGIN2_SIZE } from "./loginPanelArt";
import { CanvaFrame, CharSelectFrame, canvaTrilhos, escalaDoCanva } from "./CanvaFrame";
import { LoginMusic } from "./LoginMusic";
import { LoginVolumeButton } from "./LoginVolume";
import { LOGIN_ART, LOGIN_COLORS, u } from "./login";

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
/**
 * A ALTURA do palco em px — janela larga e BAIXA (ultrawide, ou qualquer
 * proporção mais achatada que a pintura) faz `u()` (que só conhece largura)
 * gerar um título e um painel altos demais para caber: o topo do nome corta
 * no teto da tela e o botão "Criar conta" corta no rodapé. `LoginColuna`
 * consome isto para encolher o conjunto quando ele não cabe — sem mexer no
 * resto (placas de região, atalhos, epígrafe), que são pequenos o bastante
 * pra nunca estourar a altura.
 */
const PalcoAlturaPx = createContext(0);

export function useLarguraDoPalco(): number {
  return useContext(PalcoPx);
}

export function useAlturaDoPalco(): number {
  return useContext(PalcoAlturaPx);
}

export function LoginBackdrop({
  children,
  quadro = "login",
}: {
  children: ReactNode;
  /** qual moldura externa desenhar — `/login` tem banda grossa embaixo,
   * `/char-select` é fina e uniforme nos 4 lados (ui-change.txt) */
  quadro?: "login" | "charSelect";
}) {
  const palco = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);
  const [altura, setAltura] = useState(0);

  /**
   * `ResizeObserver` e não `window.resize`: o palco muda de tamanho por
   * proporção da janela, e nem toda mudança de tamanho dele vem de um resize da
   * janela (zoom, barra de rolagem aparecendo, devtools abrindo de lado). Ele
   * observa o elemento, que é o que realmente importa.
   *
   * `useLayoutEffect`, e com uma leitura SÍNCRONA logo de cara — não só o
   * registro do observer: `largura`/`altura` nasciam em 0 e só ganhavam o
   * valor real no primeiro callback do `ResizeObserver`, que é assíncrono e
   * chega DEPOIS do primeiro paint. Toda escala derivada disso (moldura do
   * painel, borda dos campos/botões, fita do cabeçalho — todas usam
   * `useLarguraDoPalco()`) nascia presa no piso do `clamp` e só saltava para o
   * tamanho certo um quadro depois: o "redimensiona sozinho" relatado ao
   * entrar em `/login` ou dar F5. `getBoundingClientRect()` aqui devolve o
   * tamanho final na hora — o palco já tem `width:100%;height:100%` fixado só
   * por CSS, não depende de imagem nenhuma carregar — e `setState` dentro de
   * `useLayoutEffect` é resolvido pelo React ANTES do browser pintar, então o
   * primeiro quadro exibido já sai com o valor certo, sem o pulo.
   */
  useLayoutEffect(() => {
    const el = palco.current;
    if (!el) return;
    const medir = (w: number, h: number) => {
      // só publica na mudança REAL: o observer dispara com fração de pixel e
      // cada `setState` repinta a tela inteira de decoração
      setLargura((antes) => (Math.abs(antes - w) > 0.5 ? w : antes));
      setAltura((antes) => (Math.abs(antes - h) > 0.5 ? h : antes));
    };
    const rect = el.getBoundingClientRect();
    medir(rect.width, rect.height);
    const ro = new ResizeObserver(([e]) => {
      medir(e?.contentRect.width ?? 0, e?.contentRect.height ?? 0);
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
        <PalcoPx.Provider value={largura}>
          <PalcoAlturaPx.Provider value={altura}>{children}</PalcoAlturaPx.Provider>
        </PalcoPx.Provider>
        {/* o quadro "canva principal" (leia1.txt/ui-change.txt) — por CIMA de
            tudo, e por isso fora do fluxo de `children`: nenhum conteúdo deve
            recuar por causa dele além do necessário (ver `canvaTrilhos`/
            `charSelectTrilhos`) */}
        {largura > 0 &&
          (quadro === "charSelect" ? (
            <CharSelectFrame escala={escalaDoCanva(largura)} />
          ) : (
            <CanvaFrame escala={escalaDoCanva(largura)} />
          ))}
      </div>
      <LoginMusic />
      <LoginVolumeButton />
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
  const palco = useLarguraDoPalco();
  const alturaPalco = useAlturaDoPalco();
  const t = canvaTrilhos(escalaDoCanva(palco));
  const miolo = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);

  /**
   * `u()` só conhece LARGURA — numa janela larga e BAIXA (ultrawide, ou
   * qualquer proporção mais achatada que a pintura 3:2) o título e o painel
   * saem altos demais para a altura disponível: o topo do nome cortava no
   * teto da tela e "Criar conta" cortava no rodapé (relatado com uma janela
   * 1920×925). `min-height:0` sozinho não resolve — flex encolhe CAIXA, não
   * o `fontSize` fixo de dentro.
   *
   * Aqui mede-se a altura NATURAL (sem encolher) do conteúdo via
   * `scrollHeight` — que `transform: scale()` não altera, só a pintura — e
   * encolhe-se o necessário para caber na altura livre. Em qualquer tela
   * onde já cabia (a maioria), a conta dá `escala >= 1` e nada muda.
   */
  useLayoutEffect(() => {
    const el = miolo.current;
    if (!el || alturaPalco <= 0) return;
    const disponivel = alturaPalco - t.top - t.bottom;
    const medir = () => {
      const natural = el.scrollHeight;
      const novo = natural > 0 && disponivel > 0 ? Math.min(1, disponivel / natural) : 1;
      setEscala((antes) => (Math.abs(antes - novo) > 0.004 ? novo : antes));
    };
    // mesma razão de `LoginBackdrop`: medir na hora, não só esperar o
    // primeiro callback (assíncrono) do `ResizeObserver`, senão a janela
    // baixa nasce sem encolher e só encolhe um quadro depois
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [alturaPalco, t.top, t.bottom]);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        // o rodapé (classificação, atalhos, epígrafe) vive na banda de baixo
        // do quadro (`CanvaFrame`) — sem clarear até ali, eles ficavam
        // escondidos atrás da madeira.
        bottom: t.bottom,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        // encolhendo, o conteúdo ancora no TOPO (a única garantia de não
        // cortar em NENHUMA borda é começar do zero) — centralizado ele
        // continuaria estourando os dois lados por igual
        justifyContent: escala < 0.999 ? "flex-start" : "center",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      <div
        ref={miolo}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          // maior que antes: a fita "Entre em sua jornada" ficou maior
          // (medida da referência) e sobe por cima do painel — sem folga
          // extra aqui ela mordia o fim da tagline.
          gap: u(3),
          padding: `${u(2)} ${u(2)} 0`,
          transform: `scale(${escala})`,
          transformOrigin: "50% 0%",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * O painel ORNAMENTADO — a moldura de vinha do painel de login.
 *
 * É `hud/ChatFrame` reaproveitado como veio: os 4 cantos + 3 das 4 bordas
 * retas do pacote `login-new` são byte a byte (md5 conferido) os do chat
 * (`top-login-left-curve` = `top-left-curve.png`, etc. — só falta a lateral
 * DIREITA, que o chat já tem e o login-new não precisava trazer de novo,
 * porque aqui é o COMPONENTE que se reusa, não as peças remontadas uma a
 * uma). Isso troca por CIMA a moldura antiga (`LoginFrame2 kind="login"`),
 * que não tinha borda reta de topo de verdade e cobria o vão com um filete —
 * a arte certa sempre teve essa peça, só não tinha sido usada aqui ainda.
 *
 * A moldura é decoração absoluta e fica por CIMA, então o conteúdo precisa de
 * recuo próprio para não passar por baixo das folhas — daí o `padding`
 * generoso, medido pelo tamanho do canto.
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
   * A escala sai do PALCO, não do painel — presa a ele, a folhagem tem sempre
   * a mesma presença na tela, e não vira fio numa janela estreita.
   *
   * Medida na `referencia.png` (recorte x:440..960,y:335..855): a folhagem do
   * canto superior-esquerdo entra ~95 px num painel de ~470 px (palco 1402),
   * contra 171 px nativos do canto do chat → escala(1402) ≈ 95/171 ≈ 0,56.
   */
  const escala = Math.max(0.35, Math.min(0.75, palco * 0.0004));
  const k = escala / FRAME_SCALE;

  return (
    <div style={{ position: "relative", width: largura, ...style }}>
      {/**
       * O véu vai até ENCOSTAR nos trilhos da moldura, senão sobra escuro
       * quadrado além do vão que a vinha desenha.
       */}
      <div
        style={{
          position: "absolute",
          top: RAIL.top * k,
          bottom: RAIL.bottom * k,
          left: RAIL.left * k,
          right: RAIL.right * k,
          background: LOGIN_COLORS.panel,
          boxShadow: "0 18px 60px rgba(0,0,0,0.6)",
        }}
      />
      <ChatFrame escala={escala} />
      {/**
       * O recuo do CONTEÚDO é maior que o do véu: o canto entra para dentro do
       * painel (é o que o torna ornamentado), e texto por baixo dele fica
       * ilegível. `132`/`171` são o alto/largo do canto superior-esquerdo
       * (`CHAT_ART_SIZE.cornerTopLeft`).
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
 * O painel do `/char-select` — a moldura "canva" do mesmo pacote, em tamanho
 * fixo.
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
  const escala = 1;
  const t = loginFrame2Trilhos("canva", escala);
  return (
    <div style={{ position: "relative", width, ...style }}>
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
      <LoginFrame2 kind="canva" scale={escala} />
      {/**
       * O recuo de BAIXO precisa da altura CHEIA de `canvaBottom` (140), não
       * de uma fração como o de cima: aquela peça é uma faixa OPACA (a base
       * inteira, esticada), e não tem miolo vazado como o canto de vinha —
       * conteúdo em fluxo que entrasse nela ficaria por BAIXO na pilha (a
       * moldura tem `zIndex: 2`) e sumia atrás da madeira. Foi o que aconteceu
       * com o formulário de criar personagem: ele nasce ABAIXO da grade de
       * slots, e com um recuo fracionário o rótulo "Nome do personagem" caía
       * bem em cima da faixa e ficava ilegível.
       */}
      <div
        style={{
          position: "relative",
          padding: `${LOGIN2_SIZE.canvaTop.h * 0.5}px ${LOGIN2_SIZE.canvaTop.w * 0.55}px ${LOGIN2_SIZE.canvaBottom.h}px`,
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
/**
 * Campo de digitar — a moldura pílula de `ui/CurvedBox` (`input-curva-das-
 * bordas-barra-` + `input-reta-barra` do pacote `login-new`, byte a byte os
 * mesmos `bar-corner`/`bar-edge` que as barras de HP/SP já usam). Antes era
 * `border` de CSS liso; a arte é a mesma moldura curva do resto da UI, só
 * numa cor mais próxima do bronze do campo escuro.
 */
export function LoginCampo({
  icone,
  ...input
}: { icone: "usuario" | "senha" } & React.InputHTMLAttributes<HTMLInputElement>) {
  const palco = useLarguraDoPalco();
  const borda = Math.max(8, palco * 0.009);
  return (
    <CurvedBox
      border={borda}
      background={LOGIN_COLORS.field}
      inner={{
        display: "flex",
        alignItems: "center",
        gap: u(0.9),
        padding: `${u(0.5)} ${u(1)}`,
      }}
    >
      {/**
       * O AUTOFILL do Chrome pinta o `<input>` de branco por dentro — a
       * pseudo-classe `:-webkit-autofill` carrega um `background-color` que
       * vence o `background: transparent` inline por especificidade de user
       * agent, e junto vem o texto preto. Sem isso, todo usuário com senha
       * salva via um campo branco no meio da pílula escura (medido: era
       * exatamente esse o defeito, "campo1" com fundo branco na referência
       * viva). `box-shadow` inset é o único jeito confiável de sobrescrever —
       * `background` sozinho não pega. Mesma regra do `ScrollbarHider`: CSS
       * solta, co-localizada com quem a usa.
       */}
      <style>{`
        .login-input:-webkit-autofill,
        .login-input:-webkit-autofill:hover,
        .login-input:-webkit-autofill:focus,
        .login-input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px #100c07 inset;
          -webkit-text-fill-color: ${LOGIN_COLORS.ink};
          caret-color: ${LOGIN_COLORS.ink};
        }
      `}</style>
      <IconeDeCampo nome={icone} />
      <input
        {...input}
        className="login-input"
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          fontFamily: FRAME_FONT,
          fontSize: u(1.7),
          color: LOGIN_COLORS.ink,
        }}
      />
    </CurvedBox>
  );
}

function IconeDeCampo({ nome }: { nome: "usuario" | "senha" }) {
  const cor = LOGIN_COLORS.gold;
  const comum = { width: u(1.6), height: u(1.6), display: "block", flex: "0 0 auto" } as const;
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
 * "Lembrar de mim" — caixa PRÓPRIA, não o quadrado nu do sistema.
 *
 * `accentColor` (o que havia antes) só pinta o checkbox NATIVO — no Chrome/
 * Windows isso ainda é um quadrado branco de canto reto com um `check` fino,
 * a mesma peça de qualquer formulário do SO. A referência mostra uma casinha
 * ESCURA com borda dourada e check dourado, do mesmo material do resto da UI.
 * `input` continua existindo (foco por teclado, leitor de tela, `Space` para
 * alternar) — só fica visualmente invisível (`opacity:0`, mas ainda por cima
 * e clicável); quem se vê é o `span` ao lado, decorativo (`pointerEvents:
 * none`).
 */
export function LoginCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: u(0.5),
        fontFamily: FRAME_FONT,
        fontSize: u(1.35),
        color: LOGIN_COLORS.inkDim,
        cursor: "pointer",
      }}
    >
      <span style={{ position: "relative", width: u(1.3), height: u(1.3), flex: "0 0 auto" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, opacity: 0, cursor: "pointer" }}
        />
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: LOGIN_COLORS.field,
            border: `1.5px solid ${checked ? LOGIN_COLORS.gold : LOGIN_COLORS.goldFaint}`,
            borderRadius: "15%",
            pointerEvents: "none",
          }}
        >
          {checked && (
            <svg viewBox="0 0 16 16" style={{ width: "78%", height: "78%" }} aria-hidden>
              <path
                d="M3 8.2l3.2 3.2L13 4.6"
                fill="none"
                stroke={LOGIN_COLORS.gold}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </span>
      {children}
    </label>
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
  const baseEscura = tom === "entrar" ? LOGIN_COLORS.entrarBorda : LOGIN_COLORS.criarBorda;
  const palco = useLarguraDoPalco();
  const borda = Math.max(10, palco * 0.011);
  /**
   * `ui/CardFrame` (`bordas-botoes-cards` + extensores) — leia1.txt: "botões
   * de entrar/criar vao usar bordas-botoes-cards". Substitui a cápsula
   * antiga (dois `<img>` de canto fixo + textura em `repeat-x`): a arte nova
   * tem trecho reto de VERDADE nos dois eixos, então vira `border-image` puro
   * e reflui sozinha em qualquer largura — nada de âncora manual.
   */
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
        width: "100%",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <CardFrame
        border={borda}
        background={`linear-gradient(180deg, ${base} 0%, ${baseEscura} 100%)`}
        inner={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: `${u(0.9)} ${u(1.3)}`,
          color: LOGIN_COLORS.ink,
          fontFamily: FRAME_FONT,
          fontSize: u(1.6),
          letterSpacing: u(0.08),
          textTransform: "uppercase",
          textShadow: `0 ${u(0.08)} ${u(0.16)} rgba(0,0,0,0.9)`,
        }}
      >
        {children}
      </CardFrame>
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
