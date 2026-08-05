import { useState, type CSSProperties, type ReactNode } from "react";
import { CurvedBox } from "./CurvedBox";
import { useLarguraDoPalco } from "./LoginChrome";
import { FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "./charFrame";
import {
  LOGIN_COLORS,
  LOGIN_EPIGRAFE,
  LOGIN_LINKS,
  LOGIN_RATING,
  LOGIN_REGIOES,
  LOGIN_TITULO,
  LOGIN_TITLE_FONT,
  u,
  type LoginRegiao,
} from "./login";

/**
 * A decoração da tela de entrada: título, placas de região, classificação
 * indicativa, atalhos do rodapé e epígrafe.
 *
 * Tudo é DESENHADO por cima da pintura, não faz parte dela — o
 * `background.jpg` é o quadro limpo.
 *
 * ## As duas unidades, e por que são duas
 *
 * Medida HORIZONTAL e tamanho de letra saem de `u()` (centésimos da largura do
 * palco). Âncora VERTICAL sai de `%` da altura. Não é inconsistência: o palco
 * cobre a janela inteira e a pintura é esticada para caber nele, então uma
 * feição que está a 18,6% da ALTURA da imagem está a 18,6% da altura do palco —
 * é assim que as placas continuam sobre o vulcão, as pirâmides, os templos e o
 * gelo em qualquer proporção de janela.
 *
 * Os símbolos são SVG inline. Não há ícone destes no pacote de arte, e um PNG
 * por símbolo seria quatro arquivos novos para desenhos de dez linhas — que
 * ainda por cima precisam herdar o dourado e escalar com o palco.
 */

/**
 * A moldura SIMPLES: a curva das barras de HP/SP (`ui/CurvedBox`).
 *
 * É arte de verdade, não `border` de CSS — as peças
 * `curva-das-bordas-barra-hp-sp` e `reta-barra-hp-sp` do pacote de login são
 * byte a byte (md5 conferido) as que o repo já usa nas barras, no chat e nos
 * slots. A ORNAMENTADA (folhagem nos quatro cantos) fica para o painel de
 * login, que é o assunto da tela; usá-la também nas placas competiria com ele.
 *
 * A espessura vem do PALCO, não de um px fixo: a caixa é montada em JS a partir
 * de um número, e sem escalar junto a moldura engrossaria em tela pequena e
 * viraria fio em tela grande.
 */
function Caixa({
  children,
  style,
  padding,
  ...eventos
}: {
  children: ReactNode;
  style?: CSSProperties;
  padding?: string;
} & Pick<React.HTMLAttributes<HTMLDivElement>, "onMouseEnter" | "onMouseLeave">) {
  const palco = useLarguraDoPalco();
  const borda = Math.max(7, palco * 0.0075);
  return (
    <div {...eventos}>
      <CurvedBox
        border={borda}
        background={LOGIN_COLORS.panel}
        style={style}
        inner={{ padding: padding ?? `${borda * 0.7}px ${borda}px` }}
      >
        {children}
      </CurvedBox>
    </div>
  );
}

/**
 * O REALCE de passar o mouse, no idioma que o jogo já usa.
 *
 * A barra de menu do HUD (`hud/MenuBar`) mexe só em `transform` e `filter` no
 * hover, e pelo motivo certo: mudar largura, altura ou borda empurraria os
 * vizinhos a cada passada de mouse, e aqui os vizinhos são a coluna de placas e
 * a fileira de atalhos. `transform` e `filter` não afetam o layout.
 *
 * O `filter` faz o trabalho pesado sozinho porque estas caixas são ARTE: clarear
 * o elemento inteiro acende a moldura dourada, o texto e o ícone de uma vez, sem
 * precisar de um estado por peça.
 */
function useHover() {
  const [dentro, setDentro] = useState(false);
  return {
    dentro,
    props: {
      onMouseEnter: () => setDentro(true),
      onMouseLeave: () => setDentro(false),
    },
    estilo: {
      transform: dentro ? "translateY(-3px)" : "translateY(0)",
      filter: dentro ? "brightness(1.28) drop-shadow(0 4px 10px rgba(0,0,0,0.6))" : "none",
      transition: "transform 120ms ease-out, filter 120ms ease-out",
    } as CSSProperties,
  };
}

/**
 * O título do jogo.
 *
 * A tipografia é a de TÍTULO (`LOGIN_TITLE_FONT`), não a Georgia do resto: uma
 * serifa de leitura tem contraste baixo e formas arredondadas, boas para
 * parágrafo e péssimas para um nome gravado em pedra.
 *
 * O dourado é um DEGRADÊ no texto (`background-clip: text`), não uma cor
 * chapada: metal reflete, e o que faz a palavra parecer relevo é a luz correndo
 * de cima para baixo — chapado ele lê como texto amarelo.
 *
 * Sem brasão: o desenho por cima do nome disputava a atenção com ele e ainda
 * empurrava o bloco inteiro para baixo. O que fecha o topo agora é o nome.
 */
export function LoginTitulo() {
  const [linha1, linha2] = LOGIN_TITULO.nome;
  return (
    <div
      style={{ textAlign: "center", pointerEvents: "none", flex: "0 0 auto" }}
    >
      {[linha1, linha2].map((palavra, i) => (
        <div
          key={palavra}
          style={{
            fontFamily: LOGIN_TITLE_FONT,
            fontWeight: 700,
            fontSize: u(i === 0 ? 4 : 3.5),
            lineHeight: 1.04,
            // capitular romana pede entreletra larga: é o que separa uma
            // inscrição de uma palavra em caixa alta
            letterSpacing: u(0.32),
            // o recuo compensa a entreletra do ÚLTIMO caractere, que empurraria
            // a palavra para a esquerda do centro
            textIndent: u(0.32),
            textTransform: "uppercase",
            background: "linear-gradient(180deg, #fbf0c4 0%, #e0bb52 38%, #a8801f 72%, #f0d98a 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            // o contorno escuro é o que separa o metal da pintura clara atrás;
            // sem ele o título some sobre as nuvens
            filter: `drop-shadow(0 ${u(0.12)} ${u(0.18)} rgba(0,0,0,0.95))`,
          }}
        >
          {palavra}
        </div>
      ))}
      <Era />
      <div
        style={{
          marginTop: u(0.5),
          fontFamily: FRAME_FONT,
          fontSize: u(0.92),
          letterSpacing: u(0.1),
          color: "#e8d9ae",
          textShadow: `0 ${u(0.1)} ${u(0.2)} rgba(0,0,0,0.95)`,
        }}
      >
        {LOGIN_TITULO.chamada}
      </div>
    </div>
  );
}

/**
 * A linha da era, entre dois filetes — o par de traços da referência.
 *
 * Ela deixou de ser uma DATA ("2500+ AC") e passou a ser o nome da era do jogo,
 * o mesmo que a epígrafe do canto já cita. Como não é mais número, sai da fonte
 * de algarismos e vai na de título: é um nome próprio.
 */
function Era() {
  const traco: CSSProperties = {
    height: 1,
    width: u(5.5),
    background: `linear-gradient(90deg, transparent, ${LOGIN_COLORS.gold})`,
  };
  return (
    <div
      style={{
        marginTop: u(0.5),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: u(0.9),
      }}
    >
      <div style={traco} />
      <span
        style={{
          fontFamily: LOGIN_TITLE_FONT,
          fontSize: u(1),
          letterSpacing: u(0.2),
          textTransform: "uppercase",
          color: "#e8cf8e",
          textShadow: `0 ${u(0.1)} ${u(0.2)} rgba(0,0,0,0.95)`,
        }}
      >
        {LOGIN_TITULO.era}
      </span>
      <div style={{ ...traco, transform: "scaleX(-1)" }} />
    </div>
  );
}

/** as quatro placas de região, ancoradas sobre a pintura */
export function LoginRegioes() {
  return (
    <>
      {LOGIN_REGIOES.map((r) => (
        <PlacaDeRegiao key={r.nome} regiao={r} />
      ))}
    </>
  );
}

function PlacaDeRegiao({ regiao }: { regiao: LoginRegiao }) {
  const direita = regiao.lado === "dir";
  const hover = useHover();
  return (
    <Caixa
      style={{
        position: "absolute",
        top: `${regiao.y}%`,
        [direita ? "right" : "left"]: u(regiao.x),
        // a placa deixou de ser inerte para poder responder ao mouse
        cursor: "default",
        ...hover.estilo,
        // a placa cresce PARA DENTRO da tela, senão o realce a empurraria para
        // fora da borda de onde ela está ancorada
        transformOrigin: direita ? "right center" : "left center",
      }}
      {...hover.props}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: u(0.8),
          // o nome cresce para dentro da tela nos dois lados: ancorada pela
          // borda de fora, a coluna de placas fica alinhada mesmo com nomes de
          // larguras diferentes — é o que a referência mostra
          flexDirection: direita ? "row-reverse" : "row",
          textAlign: direita ? "right" : "left",
        }}
      >
        <SimboloDeRegiao nome={regiao.simbolo} />
        <div>
          <div
            style={{
              fontFamily: LOGIN_TITLE_FONT,
              fontSize: u(1.05),
              letterSpacing: u(0.11),
              textTransform: "uppercase",
              color: "#f0dda6",
              textShadow: `0 ${u(0.08)} ${u(0.16)} rgba(0,0,0,0.9)`,
              lineHeight: 1.15,
            }}
          >
            {regiao.nome}
          </div>
          <div
            style={{
              fontFamily: FRAME_FONT,
              fontSize: u(0.58),
              color: LOGIN_COLORS.inkDim,
              lineHeight: 1.2,
            }}
          >
            {regiao.lenda}
          </div>
        </div>
      </div>
    </Caixa>
  );
}

function SimboloDeRegiao({ nome }: { nome: string }) {
  const comum = { width: u(1.5), height: u(1.5), display: "block", flex: "0 0 auto" } as const;
  const cor = LOGIN_COLORS.gold;
  if (nome === "sol") {
    return (
      <svg viewBox="0 0 24 24" style={comum} aria-hidden>
        <circle cx="12" cy="12" r="4.6" fill={cor} />
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x="11.2" y="1" width="1.6" height="4" fill={cor} transform={`rotate(${i * 45} 12 12)`} />
        ))}
      </svg>
    );
  }
  if (nome === "dragao") {
    return (
      <svg viewBox="0 0 24 24" style={comum} aria-hidden>
        <path
          d="M4 15c0-5 4-8 9-8 3 0 5 1 6 3l-3 1c2 1 3 3 3 5l-3-2c0 3-3 5-6 5-4 0-6-2-6-4zm9-6a1 1 0 100 2 1 1 0 000-2z"
          fill={cor}
        />
      </svg>
    );
  }
  if (nome === "leao") {
    return (
      <svg viewBox="0 0 24 24" style={comum} aria-hidden>
        <path
          d="M12 3c-4 0-7 3-7 7 0 3 2 6 7 11 5-5 7-8 7-11 0-4-3-7-7-7zm0 4a3 3 0 110 6 3 3 0 010-6z"
          fill={cor}
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" style={comum} aria-hidden>
      <g stroke={cor} strokeWidth="1.6" strokeLinecap="round">
        {Array.from({ length: 3 }, (_, i) => (
          <g key={i} transform={`rotate(${i * 60} 12 12)`}>
            <line x1="12" y1="3" x2="12" y2="21" />
            <line x1="12" y1="6" x2="9.5" y2="8" />
            <line x1="12" y1="6" x2="14.5" y2="8" />
            <line x1="12" y1="18" x2="9.5" y2="16" />
            <line x1="12" y1="18" x2="14.5" y2="16" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * Classificação indicativa (ClassInd), canto inferior-esquerdo.
 *
 * O quadrado colorido com a idade é a marca do sistema brasileiro e a cor dele
 * SIGNIFICA a faixa (verde livre, azul 10, amarelo 12, laranja 14, vermelho 16,
 * preto 18) — mudar o tom faria a placa dizer uma faixa diferente da escrita
 * nela. Os descritores vão ao lado, como manda o formato.
 */
export function LoginRating() {
  return (
    <Caixa style={{ position: "absolute", left: u(2.2), bottom: "4.5%", pointerEvents: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: u(0.7) }}>
        <div
          style={{
            width: u(1.9),
            height: u(1.9),
            display: "grid",
            placeItems: "center",
            background: LOGIN_RATING.cor,
            color: "#151008",
            fontFamily: FRAME_NUM_FONT,
            fontVariantNumeric: FRAME_NUM_VARIANT,
            fontWeight: 700,
            fontSize: u(1.2),
            lineHeight: 1,
            flex: "0 0 auto",
          }}
        >
          {LOGIN_RATING.idade}
        </div>
        <div style={{ fontFamily: FRAME_FONT, fontSize: u(0.6), color: LOGIN_COLORS.ink, lineHeight: 1.4 }}>
          {LOGIN_RATING.descritores.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
      </div>
      <div
        style={{
          marginTop: u(0.45),
          padding: `${u(0.18)} ${u(0.4)}`,
          background: "rgba(0,0,0,0.75)",
          fontFamily: FRAME_FONT,
          fontSize: u(0.56),
          letterSpacing: u(0.06),
          textTransform: "uppercase",
          color: LOGIN_COLORS.ink,
          textAlign: "center",
        }}
      >
        {LOGIN_RATING.rodape}
      </div>
    </Caixa>
  );
}

/**
 * Atalhos do rodapé.
 *
 * Quem tem `href` vira `<a>`; quem não tem fica como texto apagado e NÃO
 * clicável. Um link para lugar nenhum promete uma página que ainda não existe —
 * e o jogador só descobre depois de clicar. `LOGIN_LINKS` é onde os endereços
 * entram quando existirem, sem tocar neste componente.
 */
export function LoginLinks() {
  return (
    <Caixa
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "3%",
      }}
      padding="1px"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: u(2.6),
          padding: `${u(0.5)} ${u(2.4)}`,
        }}
      >
        {LOGIN_LINKS.map((l) => (
          <AtalhoDoRodape key={l.chave} link={l} />
        ))}
      </div>
    </Caixa>
  );
}

/**
 * Um atalho do rodapé, com realce ao passar o mouse.
 *
 * O realce vale mesmo para os que ainda NÃO têm destino: ele é retorno de "o
 * mouse está aqui", não promessa de clique. Quem diz se há para onde ir é o
 * cursor ( contra ) e a cor do ícone, que continua apagada
 * enquanto o endereço não existir.
 */
function AtalhoDoRodape({ link }: { link: (typeof LOGIN_LINKS)[number] }) {
  const hover = useHover();
  const conteudo = (
    <>
      <IconeDeLink nome={link.icone} ativo={Boolean(link.href)} />
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontSize: u(0.6),
          letterSpacing: u(0.07),
          textTransform: "uppercase",
          color: link.href ? LOGIN_COLORS.ink : LOGIN_COLORS.inkFaint,
        }}
      >
        {link.rotulo}
      </span>
    </>
  );
  const caixa: CSSProperties = {
    display: "grid",
    justifyItems: "center",
    gap: u(0.3),
    textDecoration: "none",
    cursor: link.href ? "pointer" : "default",
    ...hover.estilo,
  };
  return link.href ? (
    <a href={link.href} target="_blank" rel="noreferrer" style={caixa} {...hover.props}>
      {conteudo}
    </a>
  ) : (
    <div style={caixa} title="em breve" {...hover.props}>
      {conteudo}
    </div>
  );
}

function IconeDeLink({ nome, ativo }: { nome: string; ativo: boolean }) {
  const cor = ativo ? LOGIN_COLORS.gold : LOGIN_COLORS.inkFaint;
  const comum = { width: u(1.5), height: u(1.5), display: "block" } as const;
  if (nome === "globo") {
    return (
      <svg viewBox="0 0 24 24" style={comum} aria-hidden fill="none" stroke={cor} strokeWidth="1.5">
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <line x1="3" y1="12" x2="21" y2="12" />
      </svg>
    );
  }
  if (nome === "discord") {
    return (
      <svg viewBox="0 0 24 24" style={comum} aria-hidden fill={cor}>
        <path d="M19 6.5A15 15 0 0015 5l-.3.6c1.4.4 2.3 1 3 1.5a12 12 0 00-11.4 0c.7-.5 1.7-1.1 3-1.5L9 5a15 15 0 00-4 1.5C3 9.6 2.4 12.6 2.7 15.6A15 15 0 007.3 18l.9-1.3c-.8-.3-1.5-.7-2-1.1l.5-.4a10.7 10.7 0 009 0l.5.4c-.6.4-1.3.8-2.1 1.1l.9 1.3a15 15 0 004.6-2.4c.4-3.5-.6-6.5-2.6-9.1zM9.3 14c-.8 0-1.5-.8-1.5-1.7S8.5 10.6 9.3 10.6s1.5.8 1.5 1.7-.7 1.7-1.5 1.7zm5.4 0c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7z" />
      </svg>
    );
  }
  if (nome === "pergaminho") {
    return (
      <svg viewBox="0 0 24 24" style={comum} aria-hidden fill="none" stroke={cor} strokeWidth="1.5">
        <path d="M6 3h11a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5" />
        <path d="M5 5a2 2 0 002 2h1" />
        <line x1="9" y1="9" x2="16" y2="9" />
        <line x1="9" y1="13" x2="16" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" style={comum} aria-hidden fill="none" stroke={cor} strokeWidth="1.5">
      <path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z" />
      <path d="M9.5 12l1.8 1.8 3.4-3.6" />
    </svg>
  );
}

/** epígrafe do canto inferior-direito */
export function LoginEpigrafe() {
  return (
    <Caixa
      style={{
        position: "absolute",
        right: u(2.2),
        bottom: "4.5%",
        maxWidth: u(18),
        pointerEvents: "none",
      }}
    >
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            fontFamily: FRAME_FONT,
            fontStyle: "italic",
            fontSize: u(0.74),
            lineHeight: 1.5,
            color: "#e8d9ae",
          }}
        >
          “{LOGIN_EPIGRAFE.texto}”
        </div>
        <div style={{ marginTop: u(0.25), fontFamily: FRAME_FONT, fontSize: u(0.64), color: LOGIN_COLORS.inkFaint }}>
          — {LOGIN_EPIGRAFE.fonte}
        </div>
      </div>
    </Caixa>
  );
}
