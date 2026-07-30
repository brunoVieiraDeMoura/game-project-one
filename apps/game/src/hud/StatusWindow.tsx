import { useState } from "react";
import { usePlayerStore } from "../net/playerStore";
import { useCharacterStore } from "../character/characterStore";
import { gateway } from "../net/gateway";
import { useHudStore } from "./hudStore";
import { CharacterPortrait } from "./CharacterPortrait";
import { CHAR_FRAME, FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { JOB_NAMES } from "../character/jobNames";
import { CHAT_ART } from "../ui/chatFrame";
import { CurvedBox } from "../ui/CurvedBox";
import { useNineSlice } from "../ui/nineSlice";
import { SB_ART, SLOT_FRAME } from "../ui/skillBar";
import {
  ST_ART,
  ST_ATTRS,
  ST_COLORS,
  ST_LAYOUT,
  ST_PLATE,
  ST_SLOTS,
  ST_SLOT_D,
  ST_ATTR_MAX,
  STATUS_WIDTH,
  type RaisableStat,
} from "../ui/status";

const escala = STATUS_WIDTH / ST_PLATE.w;
const px = (v: number) => v * escala;
const caixa = (r: { x: number; y: number; w: number; h: number }) => ({
  position: "absolute" as const,
  left: px(r.x),
  top: px(r.y),
  width: px(r.w),
  height: px(r.h),
});

const DICA =
  "Os pontos são fixados ao personagem quando confirmados, portanto tome essa decisão com calma.";

type Pendentes = Record<RaisableStat, number>;
const ZERO: Pendentes = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };

/**
 * Janela de Status (Alt+A / Alt+Q) vestida com a arte de
 * `ui_definitiva/status`: cena com o personagem e os dez slots de equipamento à
 * esquerda, números no meio e os seis atributos à direita.
 *
 * Com sessão, TODO número aqui é do map-server — inclusive ATK/FLEE/ASPD, que o
 * rAthena já manda calculados em ZC.STATUS. Sem sessão cai na ficha derivada
 * localmente pelo engine-core.
 *
 * Os pontos são ESTAGIADOS, como a referência pede ("os pontos são fixados ao
 * personagem assim quando confirmados"): o "+" só soma na tela e o Confirmar é
 * que manda um `stat:raise` por ponto. O rAthena não tem pacote de "subir N de
 * uma vez" — `CZ_STATUS_CHANGE` sobe um por vez —, então o lote vira uma
 * sequência de pedidos.
 */
export function StatusWindow() {
  const online = usePlayerStore((s) => s.known);
  const stats = usePlayerStore((s) => s.stats);
  const charName = usePlayerStore((s) => s.charName);
  const data = useCharacterStore((s) => s.data);
  const fechar = () => useHudStore.getState().setWindow(null);

  const [pend, setPend] = useState<Pendentes>(ZERO);
  const [ajuda, setAjuda] = useState<(typeof ST_ATTRS)[number] | null>(null);

  const base: Record<RaisableStat, number> = online
    ? { str: stats.str, agi: stats.agi, vit: stats.vit, int: stats.int, dex: stats.dex, luk: stats.luk }
    : (data?.attrs ?? { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 });
  const custo: Record<RaisableStat, number> = {
    str: stats.upStr,
    agi: stats.upAgi,
    vit: stats.upVit,
    int: stats.upInt,
    dex: stats.upDex,
    luk: stats.upLuk,
  };

  const gastos = ST_ATTRS.reduce((n, a) => n + pend[a.key] * (custo[a.key] || 1), 0);
  const sobrando = stats.statusPoint - gastos;

  const somar = (k: RaisableStat) => {
    if (!online) return;
    if (sobrando < (custo[k] || 1)) return;
    setPend((p) => ({ ...p, [k]: p[k] + 1 }));
  };

  const confirmar = () => {
    for (const a of ST_ATTRS) {
      for (let i = 0; i < pend[a.key]; i++) gateway().emit("stat:raise", { stat: a.key });
    }
    setPend(ZERO);
  };

  const d = data?.derived;
  // Classe é dado do SERVIDOR: o id vem no `class` do playerStore (semeado da
  // lista de personagens) e o nome sai do enum `e_job` do rAthena. Sem sessão
  // vale a ficha local.
  const classe = online
    ? (JOB_NAMES[stats.class] ?? `classe ${stats.class}`)
    : (data?.jobName ?? "—");

  /** três blocos, separados por divisória — como o change pede */
  const blocos: [string, string, string?][][] = [
    [
      ["Nível", online ? String(stats.baseLevel) : String(data?.level ?? "—")],
      ["Classe", classe],
    ],
    [
      ["HP", `${stats.hp} / ${stats.maxHp}`, ST_COLORS.hp],
      ["SP", `${stats.sp} / ${stats.maxSp}`, ST_COLORS.sp],
    ],
    [
      ["ATK", online ? `${stats.atk} + ${stats.atkBonus}` : `${d?.atk ?? "—"}`],
      ["DEF", online ? `${stats.def} + ${stats.defBonus}` : `${d?.def ?? "—"}`],
      ["MATK", online ? `${stats.matkMin} ~ ${stats.matkMax}` : `${d?.matk ?? "—"}`],
      ["MDEF", online ? `${stats.mdef} + ${stats.mdefBonus}` : `${d?.mdef ?? "—"}`],
      ["Precisão", online ? String(stats.hit) : `${d?.hit ?? "—"}`],
      ["Esquiva", online ? `${stats.flee} + ${stats.fleeBonus}` : `${d?.flee ?? "—"}`],
      ["Crítico", online ? `${stats.critical}` : `${d?.crit ?? "—"}`],
      // ASPD do pacote é o valor interno (amotion); o RO mostra 200 - x/10.
      ["Vel. Ataque", online ? (200 - stats.aspd / 10).toFixed(2) : `${d?.aspd ?? "—"}`],
    ],
  ];

  return (
    <div style={{ position: "relative", width: STATUS_WIDTH, height: (STATUS_WIDTH * ST_PLATE.h) / ST_PLATE.w }}>
      <img
        src={ST_ART.plate}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />

      {/* O personagem vai POR CIMA da placa. Diferente do medalhão da placa do
          personagem, aqui a cena de floresta é OPACA — atrás dela o retrato
          simplesmente não aparecia. Ela é o cenário, ele é o boneco na frente. */}
      {/* `pointerEvents` LIGADO: é aqui que o arrasto gira o personagem */}
      <div style={{ ...caixa(ST_LAYOUT.avatar), overflow: "hidden" }}>
        <CharacterPortrait inteiro fundo={false} giravel />
      </div>

      <div
        style={{
          ...caixa(ST_LAYOUT.title),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(17),
          lineHeight: 1,
          color: ST_COLORS.ink,
          textShadow: `0 1px 2px ${ST_COLORS.shadow}`,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {charName || "Status"}
      </div>

      {ST_SLOTS.map((s) => (
        <SlotEquip key={s.key} art={s.art} label={s.label} cx={s.cx} cy={s.cy} />
      ))}

      {/* Divisória entre as colunas: a MESMA peça reta das barras de HP/SP,
          girada de pé e com opacidade — em vez de uma linha CSS que destoaria
          do resto da arte. */}
      <div
        style={{
          position: "absolute",
          left: px(ST_LAYOUT.divider.x),
          top: px(ST_LAYOUT.divider.y),
          width: px(4),
          height: px(ST_LAYOUT.divider.h),
          pointerEvents: "none",
        }}
      >
        {/* A peça é DEITADA (53×9): o filho nasce com o comprimento na largura
            — que é o eixo em que `backgroundSize: 100% 100%` estica sem
            deformar o traço — e só então gira. Girar a caixa já em pé mapearia
            a espessura no comprimento e o traço sairia esmagado. */}
        <div
          style={{
            width: px(ST_LAYOUT.divider.h),
            height: px(4),
            backgroundImage: `url(${CHAR_FRAME.barEdge})`,
            backgroundSize: "100% 100%",
            transformOrigin: "0 0",
            transform: `rotate(90deg) translateY(-${px(4)}px)`,
            opacity: ST_COLORS.dividerOpacity,
          }}
        />
      </div>

      <div style={{ ...caixa(ST_LAYOUT.stats), pointerEvents: "none" }}>
        <Cabecalho>Status</Cabecalho>
        {blocos.map((bloco, i) => (
          <div key={i}>
            {i > 0 && <Divisoria />}
            {bloco.map(([rot, val, cor]) => (
              <Linha key={rot} rotulo={rot} valor={val} cor={cor} />
            ))}
          </div>
        ))}
      </div>

      <div style={caixa(ST_LAYOUT.attrs)}>
        <Cabecalho>Atributos</Cabecalho>
        {ST_ATTRS.map((a) => {
          const valor = base[a.key] + pend[a.key];
          return (
            <LinhaAtributo
              key={a.key}
              nome={a.nome}
              valor={valor}
              pendente={pend[a.key] > 0}
              podeSubir={online && valor < ST_ATTR_MAX && sobrando >= (custo[a.key] || 1)}
              noMaximo={valor >= ST_ATTR_MAX}
              onMais={() => somar(a.key)}
              onAjuda={() => setAjuda(ajuda?.key === a.key ? null : a)}
            />
          );
        })}
      </div>

      {/* Pontos livres logo DEPOIS da lista e alinhado a direita, como o resto
          dos numeros da coluna — misturado na dica ele passava despercebido,
          que e justamente o dado que decide o clique. */}
      <div
        style={{
          position: "absolute",
          left: px(ST_LAYOUT.attrs.x),
          top: px(ST_LAYOUT.attrs.y + ST_LAYOUT.attrs.h),
          width: px(ST_LAYOUT.attrs.w),
          display: "flex",
          alignItems: "baseline",
          justifyContent: "flex-end",
          gap: px(6),
        }}
      >
        <span
          style={{
            fontFamily: FRAME_FONT,
            fontSize: px(10),
            lineHeight: 1,
            color: ST_COLORS.label,
            textShadow: `0 1px 2px ${ST_COLORS.shadow}`,
            pointerEvents: "none",
          }}
        >
          Pontos livres
        </span>
        <span
          style={{
            fontFamily: FRAME_NUM_FONT,
            fontVariantNumeric: FRAME_NUM_VARIANT,
            fontWeight: 700,
            fontSize: px(15),
            lineHeight: 1,
            color: sobrando > 0 ? "#ffd07a" : ST_COLORS.inkDim,
            textShadow: `0 1px 3px ${ST_COLORS.shadow}`,
          }}
        >
          {sobrando}
        </span>
        <BotaoDica texto={DICA} />
      </div>

      <div style={{ ...caixa(ST_LAYOUT.actions), display: "flex", gap: px(6) }}>
        <Botao onClick={() => setPend(ZERO)} desabilitado={gastos === 0}>
          Cancelar
        </Botao>
        <Botao onClick={confirmar} desabilitado={gastos === 0} destaque>
          Confirmar
        </Botao>
      </div>

      {ajuda && <Ajuda titulo={ajuda.nome} texto={ajuda.texto} onFechar={() => setAjuda(null)} />}

      <BotaoFechar onClick={fechar} />
    </div>
  );
}

/**
 * Círculo de "?" ao lado dos pontos livres: guarda a dica que antes ocupava
 * quatro linhas da coluna. Tirar o texto dali foi o que devolveu espaço aos
 * botões — com ele, a coluna passava do fundo e eles caíam para fora da
 * moldura.
 */
function BotaoDica({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false);
  const d = px(15);
  return (
    <span style={{ position: "relative", flex: "none", lineHeight: 0 }}>
      <button
        onClick={() => setAberto((v) => !v)}
        onPointerEnter={() => setAberto(true)}
        onPointerLeave={() => setAberto(false)}
        title="Sobre os pontos"
        style={{
          width: d,
          height: d,
          borderRadius: "50%",
          border: `1px solid rgba(190,150,90,0.65)`,
          background: "rgba(30,24,14,0.9)",
          color: ST_COLORS.label,
          font: `700 ${px(10)}px ${FRAME_FONT}`,
          lineHeight: 1,
          padding: 0,
          cursor: "help",
        }}
      >
        ?
      </button>
      {aberto && (
        <span
          style={{
            position: "absolute",
            right: 0,
            bottom: `calc(100% + ${px(6)}px)`,
            width: px(150),
            padding: px(8),
            borderRadius: px(6),
            border: `1px solid rgba(190,150,90,0.5)`,
            background: "rgba(24,18,10,0.96)",
            boxShadow: "0 6px 16px rgba(8,5,2,0.5)",
            font: `${px(9)}px ${FRAME_FONT}`,
            lineHeight: 1.45,
            color: ST_COLORS.inkDim,
            textAlign: "left",
            zIndex: 4,
            pointerEvents: "none",
          }}
        >
          {texto}
        </span>
      )}
    </span>
  );
}

/**
 * Divisoria horizontal: a peca reta das barras de HP/SP com opacidade. Usar a
 * arte em vez de um `border` mantem o traco igual ao do resto da janela.
 */
function Divisoria() {
  return (
    <div
      style={{
        height: px(4),
        margin: `${px(7)}px 0`,
        backgroundImage: `url(${CHAR_FRAME.barEdge})`,
        backgroundSize: "100% 100%",
        opacity: ST_COLORS.dividerOpacity,
        pointerEvents: "none",
      }}
    />
  );
}

function Cabecalho({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        textAlign: "center",
        fontFamily: FRAME_FONT,
        fontWeight: 700,
        fontSize: px(14),
        lineHeight: 1,
        color: ST_COLORS.ink,
        textShadow: `0 1px 2px ${ST_COLORS.shadow}`,
        marginBottom: px(9),
      }}
    >
      {children}
    </div>
  );
}

/** linha "rótulo .......... valor" da coluna de números */
function Linha({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", marginBottom: px(4) }}>
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontSize: px(11),
          lineHeight: 1,
          color: cor ?? ST_COLORS.label,
          textShadow: `0 1px 2px ${ST_COLORS.shadow}`,
        }}
      >
        {rotulo}
      </span>
      <span
        style={{
          marginLeft: "auto",
          fontFamily: FRAME_NUM_FONT,
          fontVariantNumeric: FRAME_NUM_VARIANT,
          fontWeight: 700,
          fontSize: px(10),
          lineHeight: 1,
          color: cor ?? ST_COLORS.ink,
          textShadow: `0 1px 2px ${ST_COLORS.shadow}`,
          whiteSpace: "nowrap",
        }}
      >
        {valor}
      </span>
    </div>
  );
}

/** linha de atributo: nome, valor, "+" e a seta que abre a explicação */
function LinhaAtributo({
  nome,
  valor,
  pendente,
  podeSubir,
  noMaximo,
  onMais,
  onAjuda,
}: {
  nome: string;
  valor: number;
  pendente: boolean;
  podeSubir: boolean;
  noMaximo: boolean;
  onMais: () => void;
  onAjuda: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: px(5), marginBottom: px(7) }}>
      {/* nome por extenso ("Forca", nao "FOR"): cabe na coluna e e o mesmo
          titulo que aparece no balao de explicacao */}
      {/* `minWidth: 0` + `ellipsis`: "Inteligencia" e a palavra mais longa e,
          sem isso, ela empurrava o "+" e a seta para fora da coluna */}
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(10.5),
          lineHeight: 1,
          color: ST_COLORS.ink,
          textShadow: `0 1px 2px ${ST_COLORS.shadow}`,
          whiteSpace: "nowrap",
        }}
      >
        {nome}
      </span>
      <span
        style={{
          marginLeft: "auto",
          flex: "none",
          fontFamily: FRAME_NUM_FONT,
          fontVariantNumeric: FRAME_NUM_VARIANT,
          fontWeight: 700,
          fontSize: px(11),
          lineHeight: 1,
          // ponto ainda nao confirmado sai destacado: e o que o Cancelar desfaz.
          // No teto, o numero esmaece junto com o "+".
          color: pendente ? "#ffd07a" : noMaximo ? ST_COLORS.inkDim : ST_COLORS.ink,
          textShadow: `0 1px 2px ${ST_COLORS.shadow}`,
        }}
      >
        {valor}
      </span>
      <BotaoImagem
        art={CHAT_ART.addTab}
        titulo={noMaximo ? `Maximo (${ST_ATTR_MAX})` : "Somar um ponto"}
        onClick={onMais}
        desabilitado={!podeSubir}
        // no teto o botao fica CINZA, nao so apagado: e o sinal de que ali
        // acabou, e nao de que faltam pontos
        cinza={noMaximo}
        d={px(14)}
      />
      <BotaoImagem art={SB_ART.arrow} titulo="O que faz" onClick={onAjuda} d={px(11)} espelhado />
    </div>
  );
}

function BotaoImagem({
  art,
  titulo,
  onClick,
  d,
  desabilitado,
  espelhado,
  cinza,
}: {
  art: string;
  titulo: string;
  onClick: () => void;
  d: number;
  desabilitado?: boolean;
  espelhado?: boolean;
  /** dessatura a peca (usado no teto de atributo) */
  cinza?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={titulo}
      disabled={desabilitado}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        border: "none",
        background: "none",
        padding: 0,
        width: d,
        height: espelhado ? d * (39 / 22) : d,
        lineHeight: 0,
        flex: "none",
        cursor: desabilitado ? "default" : "pointer",
        opacity: desabilitado ? (cinza ? 0.75 : 0.4) : 1,
        filter: cinza ? "grayscale(1) brightness(0.8)" : undefined,
        transform: `${espelhado ? "scaleX(-1)" : ""} ${hover && !desabilitado ? "scale(1.15)" : "scale(1)"}`,
        transition: "transform 110ms ease-out, opacity 110ms ease-out",
      }}
    >
      <img src={art} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block" }} />
    </button>
  );
}

/** slot de equipamento sobre a cena: mesma moldura dos slots de habilidade */
function SlotEquip({ art, label, cx, cy }: { art: string; label: string; cx: number; cy: number }) {
  const frame = useNineSlice(SLOT_FRAME);
  const [hover, setHover] = useState(false);
  const d = px(ST_SLOT_D);
  const borda = Math.max(6, d * 0.24);

  return (
    <div
      title={label}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: px(cx) - d / 2,
        top: px(cy) - d / 2,
        width: d,
        height: d,
        transition: "filter 110ms ease-out",
        filter: hover ? "brightness(1.15)" : undefined,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: borda / 3,
          borderRadius: borda * 0.66,
          background: hover ? ST_COLORS.slotHover : ST_COLORS.slot,
          transition: "background 110ms ease-out",
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
        <img src={art} alt="" draggable={false} style={{ width: "62%", height: "62%", opacity: 0.85 }} />
      </div>
      {frame && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderStyle: "solid",
            borderWidth: borda,
            borderImageSource: `url(${frame})`,
            borderImageSlice: SLOT_FRAME.slice ?? 24,
            borderImageWidth: `${borda}px`,
            borderImageRepeat: "stretch",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

function Botao({
  children,
  onClick,
  desabilitado,
  destaque,
}: {
  children: React.ReactNode;
  onClick: () => void;
  desabilitado?: boolean;
  destaque?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <CurvedBox
      border={px(6)}
      background={destaque ? ST_COLORS.confirm : ST_COLORS.cancel}
      style={{
        flex: 1,
        minWidth: 0,
        height: px(24),
        cursor: desabilitado ? "default" : "pointer",
        opacity: desabilitado ? 0.5 : 1,
        filter: hover && !desabilitado ? "brightness(1.15)" : undefined,
        transition: "filter 110ms ease-out, opacity 110ms ease-out",
      }}
      inner={{ display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
      onPointerDown={desabilitado ? undefined : onClick}
    >
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(9),
          lineHeight: 1,
          color: ST_COLORS.ink,
          textShadow: `0 1px 2px ${ST_COLORS.shadow}`,
          whiteSpace: "nowrap",
        }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        {children}
      </span>
    </CurvedBox>
  );
}

/**
 * Balão de explicação do atributo, à direita da janela (é onde a referência o
 * põe — do lado de fora, para não cobrir os números).
 */
function Ajuda({ titulo, texto, onFechar }: { titulo: string; texto: string; onFechar: () => void }) {
  return (
    <CurvedBox
      border={px(7)}
      background="rgba(30,24,14,0.94)"
      style={{
        position: "absolute",
        left: "100%",
        top: px(60),
        marginLeft: px(10),
        width: px(180),
        zIndex: 3,
        boxShadow: "0 8px 20px rgba(10,6,2,0.5)",
      }}
      inner={{ padding: px(8) }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: px(4) }}>
        <span
          style={{
            flex: 1,
            textAlign: "center",
            fontFamily: FRAME_FONT,
            fontWeight: 700,
            fontSize: px(10),
            color: ST_COLORS.ink,
            textShadow: `0 1px 2px ${ST_COLORS.shadow}`,
          }}
        >
          {titulo}
        </span>
        <BotaoImagem art={CHAT_ART.closeTab} titulo="Fechar" onClick={onFechar} d={px(10)} />
      </div>
      <div
        style={{
          fontFamily: FRAME_FONT,
          fontSize: px(9),
          lineHeight: 1.45,
          color: ST_COLORS.inkDim,
          textShadow: `0 1px 2px ${ST_COLORS.shadow}`,
        }}
      >
        {texto}
      </div>
    </CurvedBox>
  );
}

/** aro com o "x", igual ao do inventário */
function BotaoFechar({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const d = px(ST_LAYOUT.close.d);
  return (
    <button
      onClick={onClick}
      title="Fechar (Alt+A)"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: px(ST_LAYOUT.close.cx) - d / 2,
        top: px(ST_LAYOUT.close.cy) - d / 2,
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
          background: "radial-gradient(circle at 50% 30%, #8f2b20, #4d160f)",
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
        <img
          src={CHAT_ART.closeTab}
          alt="x"
          draggable={false}
          style={{ width: "40%", height: "40%", display: "block" }}
        />
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
