import { useEffect, useMemo, useRef, useState } from "react";
import { gateway } from "../net/gateway";
import { ATAQUE_BASICO, ATAQUE_BASICO_ID } from "../net/ataqueBasico";
import { usePlayerStore } from "../net/playerStore";
import { getSkillDisplayName, useSkillCatalog, type SkillInfo } from "../net/skillCatalog";
import { useHudStore } from "./hudStore";
import { IconSquare, LoadingRing } from "../ui/rpg";
import { CHAR_FRAME, FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { CHAT_ART } from "../ui/chatFrame";
import { CurvedBox } from "../ui/CurvedBox";
import { useNineSlice } from "../ui/nineSlice";
import { SB_ART, SLOT_FRAME } from "../ui/skillBar";
import { CHROME, TYPE } from "../ui/windowChrome";
import {
  SK_ART,
  SK_BOOK,
  SK_CLOSE,
  SK_COLORS,
  SK_ELEMENT_NAMES,
  SK_FACT_LABEL_W,
  SK_FLIP_MS,
  SK_GRID,
  SK_LAYOUT_ART,
  SK_MARKS,
  SK_MARK_ART,
  SK_MARK_TIP,
  SK_FLIP_BOX,
  SK_FLIP_FRAMES,
  SK_PAGE_ANIM,
  SK_PLATE,
  SK_TYPE_NAMES,
  SK_WIDTH,
  caixaDoLivro,
  classeDaSkill,
  pilhaDeMarcas,
  noLivro,
} from "../ui/skills";

const escala = SK_WIDTH / SK_PLATE.w;
const px = (v: number) => v * escala;
const caixa = (r: { x: number; y: number; w: number; h: number }) => ({
  position: "absolute" as const,
  left: px(r.x),
  top: px(r.y),
  width: px(r.w),
  height: px(r.h),
});
/**
 * Caixa medida na arte do LIVRO.
 *
 * Todo conteúdo das duas páginas é posicionado assim, e não em px de placa:
 * assim crescer o livro (`SK_BOOK_K`) leva o conteúdo junto, num número só.
 */
const noPergaminho = (r: { x: number; y: number; w: number; h: number }) => caixa(caixaDoLivro(r));
/** px da arte do livro → px de tela */
const pxLivro = (v: number) => px(noLivro(v));

/** uma habilidade da lista do servidor, já com o que o catálogo souber dela */
interface Linha {
  id: number;
  /** constante do rAthena — é dela que sai a classe */
  aegis: string;
  /** `undefined` = catálogo ainda não respondeu pra esta skill (ver `getSkillDisplayName`) */
  nome?: string;
  nivel: number;
  maxNivel: number;
  upgradable: boolean;
  info?: SkillInfo;
}

const POR_PAGINA = SK_GRID.cols * SK_GRID.rows;

/**
 * Janela de Habilidades vestida com a arte de `ui_definitiva/skills`.
 *
 * Como o inventário, o status e os amigos, ela sai do `Panel` genérico de
 * `Windows.tsx` — traz a própria moldura (o livro), o próprio botão de fechar e
 * a própria fileira de abas.
 *
 * As ABAS são as classes que aparecem nas habilidades que o personagem
 * REALMENTE tem: o ZC.SKILLINFO_LIST manda a constante do rAthena
 * ("MG_FIREBOLT") e o prefixo dela é o código da classe, então "Noviço | Mago |
 * Bruxo" sai dos dados, não de uma árvore de classes que o cliente não tem.
 *
 * Tudo o que a página esquerda mostra vem do skill_db pela API
 * (`net/skillCatalog`): nível máximo, tipo, elemento, custo, alcance e recarga.
 * O ZC.SKILLINFO_LIST manda só id, nível, SP, alcance e "dá para subir" — sem o
 * catálogo não haveria nem o "x/10" da referência.
 */
export function SkillsWindow() {
  const online = usePlayerStore((s) => s.known);
  const netSkills = usePlayerStore((s) => s.skills);
  const skillPoint = usePlayerStore((s) => s.stats.skillPoint);
  const catalog = useSkillCatalog((s) => s.byId);
  const fechar = () => useHudStore.getState().closeWindow("skills");

  const [aba, setAba] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const [escolhida, setEscolhida] = useState<number | null>(null);
  /** virada em curso: índice na sequência de quadros e sentido. `null` = parada. */
  const [virando, setVirando] = useState<{ i: number; delta: number } | null>(null);

  // O catálogo resolve os campos POR NÍVEL, então precisa saber em que nível o
  // personagem tem cada skill — senão o custo de SP mostrado seria o do nível 1.
  useEffect(() => {
    if (!online) return;
    const niveis: Record<number, number> = {};
    for (const sk of netSkills) niveis[sk.id] = sk.level;
    useSkillCatalog.getState().ensure(netSkills.map((sk) => sk.id), niveis);
  }, [online, netSkills]);

  const linhas = useMemo<Linha[]>(() => {
    const doServidor = netSkills.map((sk) => {
      const info = catalog[sk.id];
      return {
        id: sk.id,
        // `sk.name` (o pacote do servidor) É a constante Aegis — só serve
        // pra achar a CLASSE pelo prefixo (`classeDaSkill`, abaixo), nunca
        // pra mostrar como nome. O nome visual vem só de `getSkillDisplayName`.
        aegis: info?.aegisName || sk.name,
        nome: getSkillDisplayName(info),
        nivel: sk.level,
        maxNivel: info?.maxLevel ?? 0,
        upgradable: sk.upgradable,
        info,
      };
    });
    // Ataque Básico não vem do servidor (id -1, `net/ataqueBasico`), então
    // entra à mão — sem `info` de catálogo, a `Detalhe` trata o caso à parte.
    const basica: Linha = {
      id: ATAQUE_BASICO_ID,
      aegis: "BASIC",
      nome: ATAQUE_BASICO.name,
      nivel: 1,
      maxNivel: 1,
      upgradable: false,
    };
    return [basica, ...doServidor];
  }, [netSkills, catalog]);

  /** classes presentes, na ordem de progressão da tabela */
  const abas = useMemo(() => {
    const mapa = new Map<string, { key: string; label: string; ordem: number; total: number }>();
    for (const l of linhas) {
      const c = classeDaSkill(l.aegis);
      const atual = mapa.get(c.key);
      if (atual) atual.total += 1;
      else mapa.set(c.key, { ...c, total: 1 });
    }
    return [...mapa.values()].sort((a, b) => a.ordem - b.ordem);
  }, [linhas]);

  // A aba escolhida some quando o personagem troca de classe (ou na primeira
  // abertura); cair na primeira disponível evita a página em branco.
  const abaAtiva = aba && abas.some((a) => a.key === aba) ? aba : (abas[0]?.key ?? null);
  useEffect(() => {
    setPagina(0);
    setEscolhida(null);
  }, [abaAtiva]);

  const daAba = useMemo(
    () => linhas.filter((l) => classeDaSkill(l.aegis).key === abaAtiva),
    [linhas, abaAtiva],
  );
  const paginas = Math.max(1, Math.ceil(daAba.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, paginas - 1);
  const naPagina = daAba.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA);

  const detalhe = daAba.find((l) => l.id === escolhida) ?? naPagina[0];
  // altura/vão das fitas dependem de QUANTAS classes o personagem tem
  const pilha = pilhaDeMarcas(abas.length);

  // A virada é uma SEQUÊNCIA de dois desenhos (a arte traz dois quadros), não
  // uma interpolação: quadro 1, quadro 2, conteúdo novo.
  /**
   * A virada percorre os quatro quadros de `SK_FLIP_FRAMES` e só então troca o
   * conteúdo. Voltar percorre a MESMA lista ao contrário — a folha sobe do lado
   * esquerdo e cai no direito.
   */
  const virar = (delta: number) => {
    if (paginas <= 1 || virando) return;
    const passos = SK_FLIP_FRAMES.length;
    for (let i = 0; i < passos; i++) {
      setTimeout(() => setVirando({ i, delta }), SK_FLIP_MS * i);
    }
    setTimeout(() => {
      setVirando(null);
      setPagina((p) => (p + delta + paginas) % paginas);
      setEscolhida(null);
    }, SK_FLIP_MS * passos);
  };

  return (
    <div style={{ position: "relative", width: SK_WIDTH, height: (SK_WIDTH * SK_PLATE.h) / SK_PLATE.w }}>
      <img
        src={SK_ART.book}
        alt=""
        draggable={false}
        style={{ ...caixa(SK_BOOK), pointerEvents: "none" }}
      />
      {/*
        Fitas de classe, EMPILHADAS na lateral esquerda
        (`referencia-da-mark.png`): ponta em V apontando para fora e o corpo
        entrando por baixo da borda do livro. Cada uma tem a largura do PRÓPRIO
        nome, crescendo para a ESQUERDA — a borda direita é comum a todas, presa
        ao livro, e é isso que dá o alinhamento da referência.

        A pilha é ancorada pela DIREITA (`right`), não pela esquerda: é a ponta
        de dentro do livro que tem posição fixa; a de fora anda conforme o nome.

        E ela vem DEPOIS do livro no DOM: sem `z-index`, a ordem no DOM é a ordem
        de pintura, então a fita fica POR CIMA da madeira — que é o pedido
        ("acima do livro"). Desenhada antes, ela sumia sob a capa.
      */}
      <div
        style={{
          position: "absolute",
          right: px(SK_PLATE.w - SK_BOOK.x - noLivro(SK_MARKS.overlap)),
          top: px(SK_BOOK.y + noLivro(SK_MARKS.top)),
          maxWidth: px(SK_BOOK.x + noLivro(SK_MARKS.overlap)),
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: pxLivro(pilha.gap),
        }}
      >
        {abas.map((a, i) => (
          <Fita
            key={a.key}
            label={a.label}
            total={a.total}
            cor={i % SK_MARK_ART.length}
            altura={pxLivro(pilha.h)}
            ativa={a.key === abaAtiva}
            onClick={() => setAba(a.key)}
          />
        ))}
      </div>


      {/* ---- página esquerda: a habilidade escolhida ---- */}
      {detalhe ? <Detalhe linha={detalhe} /> : <PaginaVazia online={online} />}

      {/* ---- página direita: a grade ---- */}
      <div
        style={{
          ...noPergaminho(SK_LAYOUT_ART.grid),
          display: "grid",
          gridTemplateColumns: `repeat(${SK_GRID.cols}, 1fr)`,
          gridTemplateRows: `repeat(${SK_GRID.rows}, 1fr)`,
          gap: pxLivro(SK_GRID.gap),
        }}
      >
        {naPagina.map((l) => (
          <Icone
            key={l.id}
            linha={l}
            escolhida={detalhe?.id === l.id}
            pontos={skillPoint}
            onClick={() => setEscolhida(l.id)}
          />
        ))}
      </div>

      <div
        style={{
          ...noPergaminho(SK_LAYOUT_ART.points),
          display: "flex",
          alignItems: "center",
          font: `${px(TYPE.label)}px ${FRAME_FONT}`,
          color: SK_COLORS.ink,
          whiteSpace: "nowrap",
        }}
      >
        Pontos:{" "}
        <b style={{ fontFamily: FRAME_NUM_FONT, fontVariantNumeric: FRAME_NUM_VARIANT, marginLeft: px(4) }}>
          {skillPoint}
        </b>
      </div>

      <Paginador pagina={paginaAtual + 1} total={paginas} onVirar={virar} />

      {/*
        Folha virando.
        Os dois quadros foram desenhados contra este livro e na MESMA escala
        dele, e encaixam no CENTRO — a folha se levanta na lombada. Daí usarem
        `SK_BOOK_K` e serem centrados: o livro cresce e a folha acompanha, sem
        número separado. A largura cai de 130 para 65 entre um quadro e outro,
        que é a folha girando.

        Voltar (a seta "<") é a MESMA animação espelhada em X: a folha sai da
        esquerda em vez da direita, e é o único jeito de reusar os dois desenhos
        nos dois sentidos.
      */}
      {virando && <FolhaVirando indice={virando.i} delta={virando.delta} />}

      <BotaoFechar onClick={fechar} />
    </div>
  );
}

/**
 * A folha virando.
 *
 * Ela é PRESA NO VINCO: a borda costurada fica na costura do livro e a folha se
 * abre para um lado só — página real gira em torno da costura, não flutua
 * centrada nela. Para o lado esquerdo o mesmo desenho vai espelhado em X, com a
 * âncora passando para a borda direita.
 */
function FolhaVirando({ indice, delta }: { indice: number; delta: number }) {
  // voltar percorre a sequência ao contrário
  const passo = SK_FLIP_FRAMES[delta < 0 ? SK_FLIP_FRAMES.length - 1 - indice : indice];
  if (!passo) return null;
  const nativo = SK_PAGE_ANIM[passo.arte - 1] ?? SK_PAGE_ANIM[0];
  // tamanho NATIVO do desenho, na mesma escala do livro — os dois crescem juntos
  const w = pxLivro(nativo.w);
  const h = pxLivro(nativo.h);
  const vinco = px(SK_BOOK.x) + pxLivro(SK_FLIP_BOX.creaseX);
  const paraDireita = passo.lado > 0;

  return (
    <img
      src={passo.arte === 1 ? SK_ART.page1 : SK_ART.page2}
      alt=""
      draggable={false}
      style={{
        position: "absolute",
        // a costura é o ponto fixo: à direita a folha começa nela, à esquerda
        // ela TERMINA nela (e o desenho vai espelhado)
        left: paraDireita ? vinco : vinco - w,
        top: px(SK_BOOK.y) + pxLivro(SK_FLIP_BOX.top),
        width: w,
        height: h,
        transform: paraDireita ? undefined : "scaleX(-1)",
        pointerEvents: "none",
        filter: "drop-shadow(0 3px 8px rgba(40,26,10,0.4))",
      }}
    />
  );
}

/** página esquerda quando não há nada para mostrar */
function PaginaVazia({ online }: { online: boolean }) {
  return (
    <div
      style={{
        ...noPergaminho(SK_LAYOUT_ART.desc),
        display: "flex",
        alignItems: "center",
        textAlign: "center",
        font: `${px(TYPE.label)}px ${FRAME_FONT}`,
        lineHeight: 1.45,
        color: SK_COLORS.inkDim,
      }}
    >
      {online
        ? "Este personagem ainda não aprendeu nenhuma habilidade."
        : "Sem sessão: a árvore de habilidades é do personagem logado no rAthena."}
    </div>
  );
}

/**
 * Ficha da habilidade, na página esquerda.
 *
 * A descrição é COMPOSTA a partir do skill_db, não é texto de sabor: o
 * skill_db.yml do rAthena não tem campo de descrição, e escrever uma à mão para
 * 1.200 skills seria inventar. Cada oração aqui sai de um campo — natureza do
 * dano, elemento, alvo e raio de área.
 */
function Detalhe({ linha }: { linha: Linha }) {
  const moldura = useNineSlice(SLOT_FRAME);
  const bordaIcone = pxLivro(9);
  const basica = linha.id === ATAQUE_BASICO_ID;
  const info = linha.info;
  const tipo = basica ? "Ativa" : info ? (SK_TYPE_NAMES[info.type] ?? info.type) : "—";
  const elemento = basica ? "—" : info ? (SK_ELEMENT_NAMES[info.element] ?? info.element) : "—";

  const fatos: [string, string][] = basica
    ? [
        ["Tipo", tipo],
        ["Custo", "— (nenhum)"],
        ["Alcance", "o da arma equipada"],
        ["Recarga", "—"],
      ]
    : [
        ["Tipo", tipo],
        ["Elemento", elemento],
        ["Custo", info ? `${info.spCost} SP` : "—"],
        // Alcance NEGATIVO é a convenção do rAthena para "o alcance de ataque da
        // arma", não uma distância: mostrar "-1 células" seria mentira. E zero
        // numa skill usada no próprio personagem também não é distância — é a
        // ausência dela.
        ["Alcance", info ? alcance(info) : "—"],
        ["Recarga", info ? (info.cooldownMs > 0 ? `${(info.cooldownMs / 1000).toFixed(1)} s` : "—") : "—"],
      ];

  return (
    <>
      <div
        style={{
          ...noPergaminho(SK_LAYOUT_ART.header),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: `${px(TYPE.label)}px ${FRAME_FONT}`,
          color: SK_COLORS.inkDim,
          whiteSpace: "nowrap",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        Habilidades de {classeDaSkill(linha.aegis).label}
      </div>

      <div style={{ ...noPergaminho(SK_LAYOUT_ART.icon), pointerEvents: "none" }}>
        {moldura && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderStyle: "solid",
              borderWidth: bordaIcone,
              borderImageSource: `url(${moldura})`,
              borderImageSlice: SLOT_FRAME.slice ?? 24,
              borderImageWidth: `${bordaIcone}px`,
              borderImageRepeat: "stretch",
              pointerEvents: "none",
            }}
          />
        )}
        <div style={{ position: "absolute", inset: bordaIcone / 3, overflow: "hidden" }}>
          <IconSquare
            seed={`sk-${linha.id}`}
            size={pxLivro(SK_LAYOUT_ART.icon.w)}
            fill
            radius={bordaIcone * 0.66}
            label={linha.nome}
            loading={linha.nome === undefined}
            imageSrc={linha.info?.icon ? `/assets/skills/${linha.info.icon}` : undefined}
          />
        </div>
      </div>

      <div
        style={{
          ...noPergaminho(SK_LAYOUT_ART.nameBlock),
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: px(3),
          overflow: "hidden",
        }}
      >
        <span
          style={{
            font: `700 ${px(TYPE.section)}px ${FRAME_FONT}`,
            lineHeight: 1.08,
            color: SK_COLORS.inkStrong,
            // Até duas linhas: nome do skill_db passa de vinte caracteres
            // ("Increase SP Recovery") e uma linha só cortava a palavra.
            display: linha.nome === undefined ? "flex" : "-webkit-box",
            alignItems: linha.nome === undefined ? "center" : undefined,
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
          }}
        >
          {linha.nome ?? <LoadingRing size={px(TYPE.section)} />}
        </span>
        <span style={{ font: `${px(TYPE.label)}px ${FRAME_FONT}`, lineHeight: 1, color: SK_COLORS.inkDim }}>
          {tipo}
        </span>
      </div>

      <div
        style={{
          ...noPergaminho(SK_LAYOUT_ART.desc),
          font: `${px(TYPE.small)}px ${FRAME_FONT}`,
          lineHeight: 1.45,
          color: SK_COLORS.ink,
          overflow: "hidden",
        }}
      >
        {descrever(linha)}
      </div>

      {/* filete: a peça reta das barras com opacidade, como no status */}
      <div
        style={{
          ...noPergaminho(SK_LAYOUT_ART.divider),
          height: 1,
          background: SK_COLORS.rule,
          pointerEvents: "none",
        }}
      />

      <div style={{ ...noPergaminho(SK_LAYOUT_ART.facts), display: "flex", flexDirection: "column", gap: px(2) }}>
        {fatos.map(([rotulo, valor]) => (
          <div key={rotulo} style={{ display: "flex", font: `${px(TYPE.small)}px ${FRAME_FONT}`, lineHeight: 1.25 }}>
            <span style={{ width: `${SK_FACT_LABEL_W * 100}%`, color: SK_COLORS.inkDim, flex: "none" }}>
              {rotulo}:
            </span>
            <span
              style={{
                color: SK_COLORS.ink,
                fontFamily: FRAME_NUM_FONT,
                fontVariantNumeric: FRAME_NUM_VARIANT,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {valor}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** texto do alcance, respeitando as duas convenções do rAthena */
function alcance(info: SkillInfo): string {
  if (info.range < 0) return "corpo a corpo";
  if (info.range === 0) return info.target === "self" ? "pessoal" : "—";
  return `${info.range} células`;
}

/**
 * Frase montada a partir dos campos do skill_db.
 *
 * Nada aqui é inventado: natureza do dano, elemento, alvo e raio são campos, e
 * a frase só os costura. Sem catálogo (API fora do ar) a janela diz isso em vez
 * de descrever no escuro.
 */
function descrever(linha: Linha): string {
  if (linha.id === ATAQUE_BASICO_ID) {
    return (
      "Liga o ataque contínuo: o personagem vai até o alvo selecionado e bate " +
      "nele até ele morrer, você trocar de alvo ou desligar a habilidade. Vale " +
      "para arma corpo a corpo e à distância — quem decide alcance e dano é o " +
      "servidor."
    );
  }
  const info = linha.info;
  if (!info) return "Detalhes desta habilidade não chegaram do catálogo.";

  const alvo =
    info.target === "ground" ? "num ponto do chão" : info.target === "self" ? "no próprio personagem" : "num alvo";
  const elemento = SK_ELEMENT_NAMES[info.element] ?? info.element;
  const area = info.areaRadius > 0 ? `, atingindo ${info.areaRadius} células ao redor` : "";

  if (info.type === "passive") return "Habilidade passiva: age sozinha, sem precisar ser usada.";
  if (info.type === "self_buff") return `Fortalecimento usado ${alvo}${area}.`;
  if (info.type === "support") return `Habilidade de suporte, usada ${alvo}${area}.`;
  return `Ataque de elemento ${elemento.toLowerCase()}, usado ${alvo}${area}.`;
}

/**
 * Ícone da grade, com o balão de nível e o "+".
 *
 * O "+" só aparece quando o SERVIDOR disse que dá para subir (`upgradable` do
 * ZC.SKILLINFO_LIST) e ainda há ponto: quem decide pré-requisito de árvore é
 * ele, e uma recusa volta calada.
 */
function Icone({
  linha,
  escolhida,
  pontos,
  onClick,
}: {
  linha: Linha;
  escolhida: boolean;
  pontos: number;
  onClick: () => void;
}) {
  const moldura = useNineSlice(SLOT_FRAME);
  const [hover, setHover] = useState(false);
  const bordaGrade = pxLivro(9);
  const podeSubir = linha.upgradable && pontos > 0;
  const noMaximo = linha.maxNivel > 0 && linha.nivel >= linha.maxNivel;

  return (
    <div
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      // arrastar para a barra de habilidades, como já era no Panel antigo
      draggable
      onDragStart={(e) => e.dataTransfer.setData("application/x-ro-skill", String(linha.id))}
      title={linha.nome ? `${linha.nome} — arraste para a barra de habilidades` : "carregando…"}
      style={{
        position: "relative",
        cursor: "pointer",
        transform: hover ? "translateY(-2px)" : "none",
        transition: "transform 110ms ease-out",
      }}
    >
      {moldura && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderStyle: "solid",
            borderWidth: bordaGrade,
            borderImageSource: `url(${moldura})`,
            borderImageSlice: SLOT_FRAME.slice ?? 24,
            borderImageWidth: `${bordaGrade}px`,
            borderImageRepeat: "stretch",
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ position: "absolute", inset: bordaGrade / 3, overflow: "hidden" }}>
        <IconSquare
          seed={`sk-${linha.id}`}
          size={64}
          fill
          radius={bordaGrade * 0.66}
          label={linha.nome}
          loading={linha.nome === undefined}
          imageSrc={linha.info?.icon ? `/assets/skills/${linha.info.icon}` : undefined}
        />
      </div>
      {/* respiro dourado — só a que está aberta na descrição à esquerda.
          Pulso em vez de contorno fixo: contorno fixo virava uma SEGUNDA
          borda por cima da moldura (o "não fazer 2 bordas" do pedido) — o
          brilho variando no tempo já chama o olho sozinho, sem desenhar
          outra linha. */}
      {escolhida && <PulsoDaEscolhida raio={px(10)} />}

      {/* balão "1/10", no canto de baixo à esquerda, como na referência */}
      <span
        style={{
          position: "absolute",
          left: px(-2),
          bottom: px(-6),
          padding: `${px(2)}px ${px(4)}px`,
          borderRadius: px(2),
          background: SK_COLORS.levelBadge,
          fontFamily: FRAME_NUM_FONT,
          fontVariantNumeric: FRAME_NUM_VARIANT,
          fontWeight: 700,
          fontSize: px(TYPE.small),
          lineHeight: 1,
          color: noMaximo ? SK_COLORS.levelMaxInk : SK_COLORS.levelInk,
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        {/* o teto vem do catálogo; sem ele mostra só o nível atual, nunca um
            máximo chutado */}
        {linha.maxNivel > 0 ? `${linha.nivel}/${linha.maxNivel}` : String(linha.nivel)}
      </span>

      {podeSubir && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            gateway().emit("skill:raise", { skillId: linha.id });
          }}
          title={linha.nome ? `gastar 1 ponto em ${linha.nome}` : "gastar 1 ponto"}
          style={{
            position: "absolute",
            right: px(-6),
            bottom: px(-6),
            width: px(16),
            height: px(16),
            border: "none",
            background: "none",
            padding: 0,
            cursor: "pointer",
            lineHeight: 0,
          }}
        >
          <img src={CHAT_ART.addTab} alt="+" draggable={false} style={{ width: "100%", height: "100%" }} />
        </button>
      )}
    </div>
  );
}

/**
 * Brilho dourado respirando em volta do ícone da escolhida — mesma receita do
 * `LoadingRing` (`ui/rpg.tsx`): mexe em `boxShadow` por ref a cada quadro, sem
 * `@keyframes` (o projeto é estilo inline, sem folha própria pra declarar
 * animação). Onda de seno em vez de opacidade linear: um pulso que acelera e
 * desacelera nas pontas lê como "vivo", linear lê como pisca-pisca de aviso.
 */
function PulsoDaEscolhida({ raio }: { raio: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const passo = (t: number) => {
      if (ref.current) {
        const alpha = 0.35 + (Math.sin(t / 450) * 0.5 + 0.5) * 0.4; // respira ~0.35..0.75
        ref.current.style.boxShadow = `0 0 ${raio}px rgba(232,187,84,${alpha})`;
      }
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />;
}

/**
 * Fita de classe.
 *
 * Duas peças: a PONTA (`mark-N`, o bico em V) desenhada na proporção nativa e o
 * CORPO (`mark-N-extend`) esticado atrás do texto. A largura sai do nome, não de
 * um `flex: 1` — é o "extende para caber o nome" da referência, e é o que
 * impede "Cavaleiro Rúnico" de ficar espremido ao lado de "Mago".
 *
 * O corpo é esticado e não repetido: a peça é um degradê chapado na horizontal,
 * então esticar não mostra emenda; repetir mostraria, porque a largura útil
 * quase nunca é múltiplo de 46.
 */
function Fita({
  label,
  total,
  cor,
  altura,
  ativa,
  onClick,
}: {
  label: string;
  total: number;
  /** índice da cor (0..3); as quatro fitas do pacote ciclam */
  cor: number;
  /** altura de render, em px de tela — comum a todas as fitas da pilha */
  altura: number;
  ativa: boolean;
  onClick: () => void;
}) {
  const arte = SK_MARK_ART[cor % SK_MARK_ART.length] ?? SK_MARK_ART[0]!;
  const nativo = SK_MARK_TIP[cor % SK_MARK_TIP.length] ?? SK_MARK_TIP[0];
  const h = altura;
  // a ponta guarda a proporção dela: esticada, o bico em V deforma
  const larguraPonta = (h * nativo.w) / nativo.h;

  return (
    <button
      onClick={onClick}
      title={`${label} · ${total} habilidade${total === 1 ? "" : "s"}`}
      style={{
        display: "flex",
        alignItems: "stretch",
        height: h,
        border: "none",
        background: "none",
        padding: 0,
        cursor: "pointer",
        minWidth: 0,
        opacity: ativa ? 1 : 0.66,
        filter: ativa ? "brightness(1.1)" : "saturate(0.72)",
        // a escolhida SAI um pouco para fora do livro; as outras recuam
        transform: ativa ? "none" : `translateX(${px(5)}px)`,
        transition: "opacity 120ms ease-out, filter 120ms ease-out, transform 120ms ease-out",
      }}
    >
      <img
        src={arte.tip}
        alt=""
        draggable={false}
        style={{ width: larguraPonta, height: "100%", display: "block", flex: "none" }}
      />
      <span
        style={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          padding: `0 ${px(SK_MARKS.padX)}px 0 0`,
          backgroundImage: `url(${arte.body})`,
          backgroundSize: "100% 100%",
        }}
      >
        {/*
          O texto vai num elemento PRÓPRIO, e não direto no corpo da fita:
          `text-overflow` não age em filho de flex container, e sem esta camada o
          nome era cortado seco no meio da letra quando a fileira encostava no
          teto de largura. Aqui ele vira "Cavaleiro R…", e o `title` do botão
          guarda o nome inteiro.
        */}
        <span
          style={{
            font: `700 ${px(TYPE.tab)}px ${FRAME_FONT}`,
            lineHeight: 1,
            color: SK_COLORS.tabInk,
            textShadow: `0 1px 2px ${SK_COLORS.shadow}`,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {label}
        </span>
      </span>
    </button>
  );
}

/**
 * "1 / 2" com as setas.
 *
 * A seta da arte aponta para a ESQUERDA (`button-arrow-left`); a de avançar é
 * ela espelhada, como já se faz no paginador da barra de habilidades.
 */
function Paginador({
  pagina,
  total,
  onVirar,
}: {
  pagina: number;
  total: number;
  onVirar: (delta: number) => void;
}) {
  const seta = (delta: number) => (
    <button
      onClick={() => onVirar(delta)}
      disabled={total <= 1}
      title={delta < 0 ? "página anterior" : "próxima página"}
      style={{
        border: "none",
        background: "none",
        padding: 0,
        cursor: total > 1 ? "pointer" : "default",
        opacity: total > 1 ? 1 : 0.35,
        height: px(18),
        lineHeight: 0,
        flex: "none",
      }}
    >
      <img
        src={SB_ART.arrow}
        alt=""
        draggable={false}
        style={{ height: "100%", width: "auto", display: "block", transform: delta > 0 ? "scaleX(-1)" : undefined }}
      />
    </button>
  );

  return (
    <div
      style={{
        ...noPergaminho(SK_LAYOUT_ART.pager),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: px(6),
      }}
    >
      {seta(-1)}
      <span
        style={{
          fontFamily: FRAME_NUM_FONT,
          fontVariantNumeric: FRAME_NUM_VARIANT,
          fontWeight: 700,
          fontSize: px(TYPE.label),
          lineHeight: 1,
          color: SK_COLORS.ink,
          whiteSpace: "nowrap",
        }}
      >
        {pagina} / {total}
      </span>
      {seta(1)}
    </div>
  );
}

/** aro com o "x": o mesmo `ring-level` das outras janelas */
function BotaoFechar({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const d = px(SK_CLOSE.d);
  return (
    <button
      onClick={onClick}
      title="Fechar (Alt+S)"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: px(SK_CLOSE.cx) - d / 2,
        top: px(SK_CLOSE.cy) - d / 2,
        width: d,
        height: d,
        border: "none",
        background: "none",
        padding: 0,
        cursor: "pointer",
        transform: hover ? "scale(1.08)" : "none",
        transition: "transform 120ms ease-out",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "8%",
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 30%, ${SK_COLORS.closeTint}, #4d160f)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <img src={CHAT_ART.closeTab} alt="x" draggable={false} style={{ width: "40%", height: "40%", display: "block" }} />
      </div>
      <img
        src={CHAR_FRAME.ring}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
    </button>
  );
}
