import { useRef, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCombatStore } from "../combat/combatStore";
import { useCharacterStore } from "../character/characterStore";
import { usePlayerStore } from "../net/playerStore";
import { useWorldStore } from "../net/worldStore";
import { fatiaDeRender } from "../net/entityRenderSlice";
import { mobModel, NPC_MODEL } from "../entities/mobModels";
import { classModelFor } from "../entities/classModels";
import { useHudStore } from "./hudStore";
import { CurvedBar } from "../ui/CurvedBar";
import { CharacterPortrait } from "./CharacterPortrait";
import { isolado } from "../core/diagnostics/isolamento";
import type { CharacterKey, WeaponMount } from "../assets";
import {
  AVATAR_OVERLAP,
  CHAR_FRAME,
  ENEMY_FILL,
  FRAME_COLORS,
  FRAME_FONT,
  FRAME_NUM_FONT,
  FRAME_NUM_VARIANT,
  HP_FILL,
  PLATE,
  PLATE_LAYOUT,
  RING_HOLE_INSET,
  SP_FILL,
  boxPct,
  circlePct,
  grow,
  scaleOf,
  type PlateCircle,
} from "../ui/charFrame";

/** largura de render da placa do jogador; a arte escala toda a partir daqui */
const PLAYER_WIDTH = 400;
/** o alvo usa a MESMA placa, 20% menor — é o secundário da dupla */
const TARGET_WIDTH = 320;

/**
 * Aro de nível (ring-level.png) com o número dentro.
 *
 * O miolo do PNG é vazado, então quem dá a cor é o disco atrás dele — marrom no
 * nível base, azulado no de classe, como na referência. O disco é de propósito
 * MAIOR que o vazado (`RING_HOLE_INSET`): o buraco não é redondo perfeito e
 * sobrava um fio de céu dentro do anel.
 */
function LevelRing({
  circle,
  value,
  tint,
  onClick,
  title,
  sizePx,
}: {
  circle: PlateCircle;
  /** string para o caso "servidor ainda não disse" (o mob responde depois) */
  value: number | string;
  tint: string;
  onClick?: () => void;
  title?: string;
  /** diâmetro em px de tela — o corpo de letra sai dele */
  sizePx: number;
}) {
  // 3 dígitos (nível 200 de renovação) não cabem no mesmo corpo de 1 dígito
  const digitos = String(value).length;
  const fonte = sizePx * (digitos >= 3 ? 0.35 : digitos === 2 ? 0.42 : 0.46);
  const fonteLvl = Math.max(6, sizePx * 0.18);
  return (
    <div
      title={title}
      onClick={onClick}
      style={{
        ...circlePct(circle),
        cursor: onClick ? "pointer" : "default",
        pointerEvents: onClick ? "auto" : "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: RING_HOLE_INSET,
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 30%, ${tint}, ${FRAME_COLORS.woodDark})`,
        }}
      />
      <img
        src={CHAR_FRAME.ring}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          color: FRAME_COLORS.cream,
          textShadow: `0 1px 2px ${FRAME_COLORS.shadow}`,
          pointerEvents: "none",
        }}
      >
        {/* Nada de atalho `font:` aqui: ele reescreve `line-height` para
            `normal` (~1,2 em), e era essa entrelinha — mais o `margin-top` —
            que abria o buraco entre o número e o "LVL" e empurrava o par para
            fora do vazado. Com `lineHeight: 1` a caixa de cada linha é o corpo
            da letra e o par ocupa ~80% do buraco em qualquer tamanho de placa. */}
        <span
          style={{
            fontFamily: FRAME_NUM_FONT,
            fontWeight: 700,
            fontSize: fonte,
            lineHeight: 1,
            fontVariantNumeric: FRAME_NUM_VARIANT,
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontFamily: FRAME_FONT,
            fontWeight: 700,
            fontSize: fonteLvl,
            lineHeight: 1,
            letterSpacing: sizePx * 0.02,
            color: FRAME_COLORS.creamDim,
            // o espaço que sobra dentro da caixa de 1 em já separa as duas
            // linhas; o negativo só encosta o "LVL" no número, como na arte
            marginTop: -sizePx * 0.015,
          }}
        >
          LVL
        </span>
      </div>
    </div>
  );
}

interface Vital {
  atual: number;
  max: number;
}

/**
 * A placa pintada de `ui_definitiva/character-up-left` — medalhão com retrato
 * 3D, nome, barras curvas e aro(s) de nível. Serve ao JOGADOR e ao ALVO: é a
 * mesma arte, e o alvo só entra menor e com menos coisa dentro (ui-change.txt:
 * "muito similar ao do personagem, tamanho um pouco reduzido").
 *
 * Tudo é posicionado em % da placa (ui/charFrame.ts), então `width` reescala o
 * frame inteiro sem reajustar nada.
 */
function StatPlate({
  width,
  name,
  level,
  hp,
  sp,
  jobLevel,
  portrait,
  onJobClick,
  hpFill = HP_FILL,
}: {
  width: number;
  name: string;
  /** string quando o servidor ainda não respondeu (mob recém-avistado) */
  level: number | string;
  /** `undefined` = o servidor não disse quanto é; a barra fica vazia com "—" */
  hp: Vital | undefined;
  /** ausente = a placa nem desenha SP e o HP vai para o meio */
  sp?: Vital | undefined;
  jobLevel?: number | undefined;
  portrait: ReactNode;
  onJobClick?: () => void;
  hpFill?: string;
}) {
  const s = scaleOf(width);
  const alturaBarra = PLATE_LAYOUT.hp.h * s;
  const anelPx = PLATE_LAYOUT.ringBase.d * s;
  const faixaHp = sp ? PLATE_LAYOUT.hp : PLATE_LAYOUT.hpAlone;

  return (
    <div
      style={{
        position: "relative",
        width,
        height: (width * PLATE.h) / PLATE.w,
        flex: "none",
        // a placa é DECORAÇÃO: sem isto ela engoliria o clique de andar no canto
        // do mapa. Só o aro de classe volta a `auto`.
        pointerEvents: "none",
      }}
    >
      {/* Retrato ATRÁS da placa (o buraco do aro é vazado no PNG), um pouco
          MAIOR que o buraco para a beirada morrer sob a madeira. */}
      <div
        style={{
          ...circlePct(grow(PLATE_LAYOUT.hole, AVATAR_OVERLAP)),
          borderRadius: "50%",
          overflow: "hidden",
        }}
      >
        {portrait}
      </div>

      <img
        src={CHAR_FRAME.plate}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />

      <div
        style={{
          ...boxPct(PLATE_LAYOUT.name),
          display: "flex",
          alignItems: "center",
          font: `700 ${PLATE_LAYOUT.name.h * s * 0.66}px ${FRAME_FONT}`,
          color: FRAME_COLORS.cream,
          textShadow: `0 1px 2px ${FRAME_COLORS.shadow}`,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </div>

      <CurvedBar
        value={hp?.atual ?? 0}
        max={hp?.max ?? 0}
        fill={hpFill}
        height={alturaBarra}
        left="HP"
        right={hp ? `${Math.ceil(hp.atual)} / ${hp.max}` : "—"}
        style={boxPct(faixaHp)}
      />
      {sp && (
        <CurvedBar
          value={sp.atual}
          max={sp.max}
          fill={SP_FILL}
          height={alturaBarra}
          left="SP"
          right={`${Math.ceil(sp.atual)} / ${sp.max}`}
          style={boxPct(PLATE_LAYOUT.sp)}
        />
      )}

      <LevelRing
        circle={PLATE_LAYOUT.ringBase}
        value={level}
        tint={FRAME_COLORS.ringBase}
        title="Nível base"
        sizePx={anelPx}
      />
      {jobLevel != null && (
        <LevelRing
          circle={PLATE_LAYOUT.ringJob}
          value={jobLevel}
          tint={FRAME_COLORS.ringJob}
          onClick={onJobClick}
          title="Nível de classe — abrir habilidades"
          sizePx={anelPx}
        />
      )}
    </div>
  );
}

/** frame do personagem (topo-esquerda): retrato, nome, HP, SP e os dois aros */
export function PlayerFrame() {
  const local = useCombatStore((s) => s.player);
  const localJobLevel = useCharacterStore((s) => s.data?.jobLevel);
  // Com sessão, HP/SP/nível vêm do map-server (playerStore). Sem ela (demo,
  // preview do editor) continua valendo o personagem simulado local.
  const online = usePlayerStore((s) => s.known);
  const stats = usePlayerStore((s) => s.stats);
  const charName = usePlayerStore((s) => s.charName);

  const p = online
    ? {
        name: charName || "—",
        level: stats.baseLevel,
        hp: stats.hp,
        maxHp: stats.maxHp,
        sp: stats.sp,
        maxSp: stats.maxSp,
      }
    : local;

  return (
    <StatPlate
      width={PLAYER_WIDTH}
      name={p.name}
      level={p.level}
      hp={{ atual: p.hp, max: p.maxHp }}
      sp={{ atual: p.sp, max: p.maxSp }}
      jobLevel={online ? stats.jobLevel : localJobLevel}
      onJobClick={() => useHudStore.getState().openWindow("skills")}
      portrait={<CharacterPortrait dono="jogador" />}
    />
  );
}

/**
 * Frame do alvo — a MESMA placa do jogador, 20% menor, ao lado dela.
 *
 * O que muda em relação ao jogador (ui-change.txt):
 *  - só o aro de nível BASE (monstro não tem classe);
 *  - HP sempre desenhado, mesmo sem número, e em vermelho;
 *  - SP só quando existe. Online ele nunca existe: o rAthena não manda SP de
 *    mob para o cliente, então é o preview do editor que enche essa barra.
 *
 * O nível e o HP do mob NÃO vêm do spawn: chegam na resposta ao CZ.REQNAME que
 * o gateway dispara (ver CLAUDE.md, "Plaquinha do mob vem de PERGUNTA"). Até
 * ela voltar, o aro mostra "?" e a barra fica sem número — desenhar uma barra
 * cheia seria inventar HP que ninguém informou.
 */
/**
 * Ficha de mentira, só para o retrato ter algo para desenhar durante o
 * AQUECIMENTO (Fase E1 da auditoria de render).
 *
 * `skeleton_minion` porque é o mesmo modelo que o laudo original flagrou
 * pagando o 3º contexto WebGL no primeiro alvo real
 * (`voo-1786466538706.json`) — aquecer com QUALQUER modelo já criaria o
 * contexto e ligaria os programas base, mas usar o mesmo evita que o
 * primeiro alvo REAL ainda precise linkar um shader diferente por causa de
 * alguma variante de material específica da espécie.
 */
const FICHA_DE_AQUECIMENTO: FichaDeAlvo = {
  name: "",
  level: "",
  modelo: "skeleton_minion",
  weapons: [],
};

export function TargetFrame({ aquecendo = false }: { aquecendo?: boolean } = {}) {
  const online = usePlayerStore((s) => s.known);
  /**
   * Só a fatia de RENDER do alvo — nunca a entidade inteira.
   *
   * Assinando o objeto todo, cada pacote de movimento do mob alvejado
   * re-renderizava esta placa junto com o `CharacterPortrait` dela, que é um
   * `<Canvas>` WebGL próprio com um personagem skinado dentro. Um mob que anda
   * manda ~1 pacote por célula: a placa repintava o tempo todo para mostrar
   * exatamente os mesmos nome, nível e HP. Mesma regra do `net/NetEntity`.
   */
  const netTarget = useWorldStore(
    useShallow((s) => {
      const e = s.target ? s.entities[s.target] : undefined;
      return e ? { gid: e.gid, ...fatiaDeRender(e) } : undefined;
    }),
  );
  const localTarget = useCombatStore((s) => (s.target ? s.monsters[s.target] : undefined));

  /**
   * A ÚLTIMA ficha vista, para a placa nunca precisar DESMONTAR.
   *
   * O retrato é um `<Canvas>` do R3F, e cada montagem cria um
   * `WebGLRenderingContext` PRÓPRIO. Com `return null` sem alvo, selecionar e
   * soltar alvo destruía e recriava um contexto a cada vez — e o `dispose()` do
   * R3F não libera contexto (só `forceContextLoss()` libera, e mesmo assim o
   * objeto fica pendurado até o GC). O Chrome mantém ~16 contextos vivos e, ao
   * estourar, **força a perda do MAIS ANTIGO — que é o canvas do jogo**. Era
   * essa a origem dos `THREE.WebGLRenderer: Context Lost` repetidos, e o
   * engasgo que eles produzem é o gatilho do salto de posição (ver
   * `worldStore.selfMove`).
   *
   * Guardando a última ficha, a placa continua montada e some por CSS — o
   * conteúdo congelado não é visível, está sob `display: none`.
   */
  const ultima = useRef<FichaDeAlvo | null>(null);

  let ficha = ultima.current;
  if (online && netTarget) {
    const temHp = netTarget.hp !== undefined && netTarget.maxHp !== undefined && netTarget.maxHp > 0;
    ficha = {
      name: netTarget.name ?? `#${netTarget.gid}`,
      level: netTarget.level ?? "?",
      hp: temHp ? { atual: netTarget.hp!, max: netTarget.maxHp! } : undefined,
      // aparência do alvo = a mesma tabela que a cena usa para desenhá-lo
      // (mob: mob_db; player: classe real — `net.job` É a classe nesse caso;
      // npc: sem modelo próprio ainda, cai no mesmo placeholder da cena)
      modelo:
        netTarget.kind === "mob"
          ? mobModel(netTarget.job).character
          : netTarget.kind === "player"
            ? classModelFor(netTarget.job).character
            : NPC_MODEL.character,
      weapons: netTarget.kind === "player" ? classModelFor(netTarget.job).weapons : [],
    };
    ultima.current = ficha;
  } else if (!online && localTarget && localTarget.alive) {
    ficha = {
      name: localTarget.name,
      level: localTarget.level,
      hp: { atual: localTarget.hp, max: localTarget.maxHp },
      sp: localTarget.maxSp > 0 ? { atual: localTarget.sp, max: localTarget.maxSp } : undefined,
      modelo: "skeleton_warrior",
      weapons: [],
    };
    ultima.current = ficha;
  }

  /**
   * FASE E1 — o retrato nasce no AQUECIMENTO, não no primeiro alvo real.
   *
   * A causa comprovada do `frameLongo` de 250,3 ms (`voo-1786466538706.json`)
   * era o PRIMEIRO alvo da sessão montando este componente pela primeira
   * vez: `<CharacterPortrait>` é um `<Canvas>` próprio, então isso cria um
   * 3º `WebGLRenderingContext` — device + upload de textura + link de
   * shader, tudo no meio de um quadro de combate. A sessão de controle sem
   * nenhum retrato de alvo nunca passou de 33,6 ms de quadro.
   *
   * A correção: se ainda não houve alvo real (`ultima.current` continua
   * `null`) e a cortina de carregamento ainda está no ar mas já em fase de
   * AQUECIMENTO (`aquecendo`, `play/aquecimento.ts`), grava uma ficha de
   * mentira em `ultima.current` — o MESMO mecanismo que já mantém o retrato
   * montado depois que o jogador solta um alvo de verdade. Dali em diante,
   * `ficha` nunca mais volta a `null` nesta sessão, e o contexto nasce e o
   * shader compila atrás da cortina, não no primeiro `atk:`.
   */
  if (!ficha && aquecendo) {
    ficha = FICHA_DE_AQUECIMENTO;
    ultima.current = ficha;
  }

  const visivel = online ? Boolean(netTarget) : Boolean(localTarget && localTarget.alive);
  /**
   * Enquanto o AQUECIMENTO usa a ficha de mentira (nenhum alvo real ainda),
   * o retrato precisa continuar DESENHANDO de verdade — é isso que paga o
   * contexto e o shader antes da hora que importa. `display:none` num
   * ancestral (ou aqui) tira o elemento da árvore de renderização e arrisca
   * o navegador nem considerar o canvas para composição; `visibility:hidden`
   * mantém a caixa (e o desenho) viva, só sem pintar na tela — por isso ESTA
   * fase usa uma, e o resto da função (alvo solto/nunca existiu) continua
   * usando a outra, sem mudar nada do comportamento já provado.
   */
  const aquecendoSemAlvo = aquecendo && !visivel;
  // isolamento (Fase C, `?iso=semRetratoAlvo`): nenhum contexto WebGL de
  // retrato de alvo nasce nunca — controle para provar/descartar a Classe 1
  if (isolado("semRetratoAlvo")) return null;
  if (!ficha) return null;

  return (
    <div style={aquecendoSemAlvo ? { visibility: "hidden" } : { display: visivel ? undefined : "none" }}>
      <StatPlate
        width={TARGET_WIDTH}
        name={ficha.name}
        level={ficha.level}
        hp={ficha.hp}
        sp={ficha.sp}
        hpFill={ENEMY_FILL}
        portrait={<CharacterPortrait dono="alvo" characterKey={ficha.modelo} weapons={ficha.weapons} />}
      />
    </div>
  );
}

/** o que a placa do alvo precisa saber — guardado para sobreviver ao "sem alvo" */
interface FichaDeAlvo {
  name: string;
  level: number | string;
  hp?: { atual: number; max: number };
  sp?: { atual: number; max: number };
  modelo: CharacterKey;
  weapons: readonly WeaponMount[];
}
