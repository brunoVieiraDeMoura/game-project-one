import { useEffect, useRef, useState } from "react";
import { useHudStore } from "./hudStore";
import { useSkillBar } from "./skillBarStore";
import { usePlayerStore } from "../net/playerStore";
import { useWorldStore } from "../net/worldStore";
import { useAimStore } from "../net/aimStore";
import { useSkillCatalog } from "../net/skillCatalog";
import { useCooldownStore } from "../net/cooldownStore";
import { gateway } from "../net/gateway";
import { isTyping } from "../play/isTyping";
import { IconSquare } from "../ui/rpg";
import { FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { useNineSlice } from "../ui/nineSlice";
import {
  PAGER_ART,
  PAGER_FILL,
  SB_ART,
  SB_COLORS,
  SB_LAYOUT,
  SB_PLATE,
  SB_WIDTH,
  SLOT_FRAME,
  SLOT_GAP,
  XP_BASE_FILL,
  XP_JOB_FILL,
} from "../ui/skillBar";

/** a largura mora em ui/skillBar.ts: a barra de conjuração usa 1/3 dela */
const BAR_WIDTH = SB_WIDTH;
const PAGINAS = 3;
/** véu do cronômetro de recarga */
const SOMBRA_RECARGA = "rgba(8,6,2,0.72)";

const escala = BAR_WIDTH / SB_PLATE.w;
const px = (v: number) => v * escala;
/** retângulo da arte → caixa absoluta em % do painel */
const caixa = (r: { x: number; y: number; w: number; h: number }) => ({
  position: "absolute" as const,
  left: `${(r.x / SB_PLATE.w) * 100}%`,
  top: `${(r.y / SB_PLATE.h) * 100}%`,
  width: `${(r.w / SB_PLATE.w) * 100}%`,
  height: `${(r.h / SB_PLATE.h) * 100}%`,
});

/**
 * Barra de habilidades (baixo-centro), vestida com a arte de
 * `ui_definitiva/skillbar`: 9 slots, paginador 1..3 e as duas barras de XP.
 *
 * Os slots são ARRUMADOS PELO JOGADOR: arrasta da janela de habilidades
 * (Alt+S) e solta aqui. Clicar (ou apertar 1–9) usa a skill no alvo atual; se a
 * skill é de ÁREA, entra em modo de mira e o próximo clique no chão define a
 * célula — que é como o RO funciona.
 *
 * O fundo é UMA imagem e o resto é posicionado em % dela (ui/skillBar.ts), como
 * na placa do personagem: mudar `BAR_WIDTH` reescala tudo num número só.
 */
export function SkillBar() {
  const page = useHudStore((s) => s.skillPage);
  const setPage = useHudStore((s) => s.setSkillPage);
  const slots = useSkillBar((s) => s.slots);
  const skills = usePlayerStore((s) => s.skills);
  const stats = usePlayerStore((s) => s.stats);
  const online = usePlayerStore((s) => s.known);
  const aiming = useAimStore((s) => s.skill);
  const catalog = useSkillCatalog((s) => s.byId);

  // nome legível e tipo de alvo das skills do personagem (catálogo do admin)
  useEffect(() => {
    if (online) useSkillCatalog.getState().ensure(skills.map((s) => s.id));
  }, [online, skills]);

  // recarga vem do servidor (ZC_SKILL_POSTDELAY); o cliente só desenha
  useEffect(() => {
    const socket = gateway();
    const onCooldown = (p: { skillId: number; durationMs: number }) =>
      useCooldownStore.getState().start(p.skillId, p.durationMs);
    socket.on("skill:cooldown", onCooldown);
    return () => {
      socket.off("skill:cooldown", onCooldown);
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.ctrlKey) return;
      const match = e.code.match(/^Digit([1-9])$/);
      if (!match) return;
      trigger(page * 9 + Number(match[1]) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, page, slots, skills]);

  function trigger(slotIndex: number) {
    const skillId = slots[slotIndex] ?? 0;
    const skill = skills.find((s) => s.id === skillId);
    if (!skill) return;

    // Skill de CHÃO espera CZ.USE_SKILL_TOGROUND com uma célula — o cliente
    // precisa perguntar onde antes de mandar. Quem diz se é de chão é o
    // catálogo (`target`, vindo do skill_db), não o alcance: adivinhar por
    // `range === 0` classificava todo auto-buff como skill de área.
    const info = useSkillCatalog.getState().byId[skill.id];
    const label = info?.name ?? skill.name;
    if (info?.target === "ground") {
      useAimStore.getState().aim({ id: skill.id, level: skill.level, name: label, mode: "ground" });
      return;
    }

    // Skill de inimigo SEM alvo escolhido também vira mira, só que de criatura:
    // no RO o cursor pede em quem, e mandar no próprio personagem (o que se
    // fazia antes, por falta de alvo) é pior que não fazer nada.
    const world = useWorldStore.getState();
    if (info?.target === "enemy" && !world.target) {
      useAimStore.getState().aim({ id: skill.id, level: skill.level, name: label, mode: "entity" });
      return;
    }

    gateway().emit("skill:use", {
      skillId: skill.id,
      level: skill.level,
      targetGid: world.target ?? world.selfGid,
    });
  }

  return (
    <div style={{ position: "relative", width: BAR_WIDTH, height: (BAR_WIDTH * SB_PLATE.h) / SB_PLATE.w }}>
      <img
        src={SB_ART.plate}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />

      <div style={{ ...caixa(SB_LAYOUT.slots), display: "flex", gap: px(SLOT_GAP) }}>
        {Array.from({ length: 9 }).map((_, i) => {
          const slotIndex = page * 9 + i;
          const skill = skills.find((s) => s.id === (slots[slotIndex] ?? 0));
          return (
            <SkillSlot
              key={slotIndex}
              numero={i + 1}
              slotIndex={slotIndex}
              skillId={skill?.id}
              nome={skill ? (catalog[skill.id]?.name ?? skill.name) : undefined}
              detalhe={skill ? `Lv ${skill.level} · ${skill.spCost} SP` : undefined}
              mirando={Boolean(skill) && aiming?.id === skill?.id}
              onUse={() => trigger(slotIndex)}
            />
          );
        })}
      </div>

      <Pager page={page} onChange={setPage} />

      <XpBar
        rect={SB_LAYOUT.xpBase}
        rotulo="XP (Status)"
        valor={stats.baseExp}
        alvo={stats.nextBaseExp}
        fill={XP_BASE_FILL}
      />
      <XpBar
        rect={SB_LAYOUT.xpJob}
        rotulo="XP (Skills)"
        valor={stats.jobExp}
        alvo={stats.nextJobExp}
        fill={XP_JOB_FILL}
      />

      {aiming && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "100%",
            marginBottom: 4,
            textAlign: "center",
            font: `600 ${px(18)}px ${FRAME_FONT}`,
            color: "#f0c98a",
            textShadow: `0 1px 3px ${SB_COLORS.shadow}`,
            pointerEvents: "none",
          }}
        >
          {aiming.mode === "ground" ? "Escolha o ponto no chão" : "Escolha o alvo"} para {aiming.name} — ESC cancela
        </div>
      )}
    </div>
  );
}

/**
 * Um slot: moldura 9-slice montada do `square-skill`, número no canto de cima à
 * esquerda, ícone e — quando a skill está recarregando — o cronômetro por cima.
 *
 * A animação mexe só em `transform` e `filter`: mudar tamanho empurraria os
 * vizinhos a cada passada de mouse.
 */
function SkillSlot({
  numero,
  slotIndex,
  skillId,
  nome,
  detalhe,
  mirando,
  onUse,
}: {
  numero: number;
  slotIndex: number;
  skillId?: number;
  nome?: string;
  detalhe?: string;
  mirando: boolean;
  onUse: () => void;
}) {
  const frame = useNineSlice(SLOT_FRAME);
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const borda = px(20);

  return (
    <div
      onClick={onUse}
      onContextMenu={(e) => {
        e.preventDefault();
        useSkillBar.getState().clear(slotIndex);
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const dropped = e.dataTransfer.getData("application/x-ro-skill");
        const from = e.dataTransfer.getData("application/x-ro-slot");
        if (from) useSkillBar.getState().swap(Number(from), slotIndex);
        else if (dropped) useSkillBar.getState().assign(slotIndex, Number(dropped));
      }}
      draggable={Boolean(skillId)}
      onDragStart={(e) => e.dataTransfer.setData("application/x-ro-slot", String(slotIndex))}
      title={nome ? `${nome} ${detalhe} — botão direito tira da barra` : "arraste uma habilidade (Alt+S) para cá"}
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        cursor: skillId ? "pointer" : "default",
        transform: pressed ? "scale(0.94)" : hover && skillId ? "translateY(-3px) scale(1.04)" : "none",
        filter: mirando
          ? "brightness(1.25) drop-shadow(0 0 6px rgba(255,206,120,0.95))"
          : hover && skillId
            ? "brightness(1.12)"
            : undefined,
        transition: "transform 110ms ease-out, filter 110ms ease-out",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: borda / 3,
          borderRadius: borda * 0.66,
          background: hover ? SB_COLORS.slotHover : SB_COLORS.slot,
          transition: "background 110ms ease-out",
        }}
      />
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
        {nome && <IconSquare seed={`sk-${skillId}`} label={nome} size={px(48)} />}
      </div>

      {skillId != null && <Cooldown skillId={skillId} raio={borda * 0.66} />}

      <div
        style={{
          position: "absolute",
          top: px(4),
          left: px(7),
          font: `700 ${px(16)}px ${FRAME_NUM_FONT}`,
          fontVariantNumeric: FRAME_NUM_VARIANT,
          lineHeight: 1,
          color: SB_COLORS.label,
          textShadow: `0 1px 2px ${SB_COLORS.shadow}`,
          pointerEvents: "none",
        }}
      >
        {numero}
      </div>
    </div>
  );
}

/**
 * Cronômetro de recarga: escurece o slot e vai varrendo em sentido horário até
 * liberar, com os segundos que faltam no meio.
 *
 * O quadro a quadro é feito MUTANDO o DOM por ref, não com `setState` — a conta
 * muda 60 vezes por segundo e repintar o HUD nesse ritmo custaria mais que a
 * cena. O componente só re-renderiza quando o servidor manda uma recarga nova.
 */
function Cooldown({ skillId, raio }: { skillId: number; raio: number }) {
  const fim = useCooldownStore((s) => s.ends[skillId]);
  const total = useCooldownStore((s) => s.total[skillId]);
  const sombra = useRef<HTMLDivElement>(null);
  const texto = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fim || !total) return;
    let raf = 0;
    const passo = () => {
      const falta = fim - performance.now();
      if (falta <= 0) {
        useCooldownStore.getState().start(skillId, 0);
        return;
      }
      const frac = falta / total;
      if (sombra.current) {
        // a parte JÁ decorrida fica limpa e a que falta fica escura, então a
        // sombra encolhe no sentido horário até sumir
        const decorrido = (1 - frac) * 360;
        sombra.current.style.background = `conic-gradient(transparent 0deg ${decorrido}deg, ${SOMBRA_RECARGA} ${decorrido}deg 360deg)`;
      }
      if (texto.current) {
        texto.current.textContent = falta >= 1000 ? `${Math.ceil(falta / 1000)}` : (falta / 1000).toFixed(1);
      }
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [skillId, fim, total]);

  if (!fim || !total) return null;
  return (
    <>
      <div
        ref={sombra}
        style={{ position: "absolute", inset: raio / 2, borderRadius: raio, pointerEvents: "none" }}
      />
      <div
        ref={texto}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: `700 ${px(26)}px ${FRAME_NUM_FONT}`,
          fontVariantNumeric: FRAME_NUM_VARIANT,
          color: "#ffe6b0",
          textShadow: `0 1px 3px ${SB_COLORS.shadow}`,
          pointerEvents: "none",
        }}
      />
    </>
  );
}

/**
 * Paginador 1..3.
 *
 * A placa é a peça da arte DUAS vezes — a metade esquerda e ela espelhada —,
 * porque o pack só traz um lado. As setas dão a volta: em 3/3 a da direita
 * volta para 1/3 e em 1/3 a da esquerda vai para 3/3 (o `setSkillPage` do store
 * já faz o módulo).
 */
function Pager({ page, onChange }: { page: number; onChange: (p: number) => void }) {
  const capW = px(PAGER_ART.half.w);
  const railH = px(PAGER_ART.rail.h);
  const peca = (url: string): React.CSSProperties => ({
    position: "absolute",
    backgroundImage: `url(${url})`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
  });
  return (
    <div style={{ ...caixa(SB_LAYOUT.pager) }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {/* preenchimento ATRÁS de tudo: o corpo da metade só vai até x≈37 e o
            miolo da arte é vazado, então sem isto o meio da placa fica um
            buraco com o fundo do painel aparecendo */}
        <div
          style={{
            position: "absolute",
            left: capW / 2,
            right: capW / 2,
            top: px(PAGER_ART.railTopY) + railH * 0.5,
            bottom: px(PAGER_ART.half.h - PAGER_ART.railBottomY - PAGER_ART.rail.h) + railH * 0.5,
            background: PAGER_FILL,
          }}
        />
        <div
          style={{
            ...peca(SB_ART.pagerRailTop),
            left: capW,
            right: capW,
            top: px(PAGER_ART.railTopY),
            height: railH,
          }}
        />
        <div
          style={{
            ...peca(SB_ART.pagerRailBottom),
            left: capW,
            right: capW,
            top: px(PAGER_ART.railBottomY),
            height: railH,
          }}
        />
        <div style={{ ...peca(SB_ART.pagerHalf), left: 0, top: 0, width: capW, height: "100%" }} />
        <div
          style={{
            ...peca(SB_ART.pagerHalf),
            right: 0,
            top: 0,
            width: capW,
            height: "100%",
            transform: "scaleX(-1)",
          }}
        />
      </div>

      {/* Nada aqui é caixa em FLUXO: setas e número são absolutos dentro da
          placa. Em `flex` a margem da seta e a entrelinha do número empurravam
          a linha para cima e a arte parecia torta — e como a placa é um `div`
          absoluto, conteúdo em fluxo ainda ficava por baixo dela. Absoluto com
          `zIndex` resolve as duas coisas e não tem como deslocar a peça. */}
      <Seta onClick={() => onChange(page - 1)} titulo="Página anterior" lado="left" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FRAME_NUM_FONT,
          fontWeight: 700,
          fontSize: px(24),
          // sem o atalho `font:` e com entrelinha 1: o atalho repõe
          // `line-height: normal` e a caixa da linha cresce ~20%
          lineHeight: 1,
          fontVariantNumeric: FRAME_NUM_VARIANT,
          color: SB_COLORS.ink,
          textShadow: `0 1px 2px ${SB_COLORS.shadow}`,
          pointerEvents: "none",
        }}
      >
        {page + 1} / {PAGINAS}
      </div>
      <Seta onClick={() => onChange(page + 1)} titulo="Próxima página" lado="right" />
    </div>
  );
}

function Seta({ onClick, titulo, lado }: { onClick: () => void; titulo: string; lado: "left" | "right" }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const escala = pressed ? "scale(0.88)" : hover ? "scale(1.14)" : "scale(1)";
  return (
    <button
      onClick={onClick}
      title={titulo}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      style={{
        position: "absolute",
        zIndex: 1,
        // centrada na METADE da placa: (52 − 22) / 2 da arte
        [lado]: px((PAGER_ART.half.w - PAGER_ART.arrow.w) / 2),
        top: "50%",
        border: "none",
        background: "none",
        padding: 0,
        margin: 0,
        cursor: "pointer",
        width: px(PAGER_ART.arrow.w),
        height: px(PAGER_ART.arrow.h),
        lineHeight: 0,
        // o `translate` é quem centraliza na altura; o espelho tem que vir
        // DEPOIS dele, senão o deslocamento sai invertido junto
        transform: `translateY(-50%) ${escala} ${lado === "right" ? "scaleX(-1)" : ""}`,
        filter: hover ? "brightness(1.2)" : undefined,
        transition: "transform 110ms ease-out, filter 110ms ease-out",
      }}
    >
      <img
        src={SB_ART.arrow}
        alt=""
        draggable={false}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </button>
  );
}

/**
 * Barra de XP: rótulo à esquerda, preenchimento, o valor logo depois dele e a
 * porcentagem na ponta — como na referência.
 *
 * O valor ANDA junto com o preenchimento, mas com um teto: perto de 100% ele
 * atropelaria a porcentagem, então para em 62% da pista.
 *
 * Ganhar XP dá um brilho curto: a largura já anima sozinha pela `transition`, e
 * o clarão é o que faz o ganho ser NOTADO sem piscar a tela.
 */
function XpBar({
  rect,
  rotulo,
  valor,
  alvo,
  fill,
}: {
  rect: { x: number; y: number; w: number; h: number };
  rotulo: string;
  valor: number;
  alvo: number;
  fill: string;
}) {
  const frac = alvo > 0 ? Math.max(0, Math.min(1, valor / alvo)) : 0;
  const altura = px(rect.h);
  const borda = Math.max(5, Math.round(altura * 0.38));
  const frame = useNineSlice(SLOT_FRAME);
  const fonte = Math.max(9, Math.round(altura * 0.52));
  const larguraRotulo = px(150);

  const [brilho, setBrilho] = useState(false);
  const anterior = useRef(valor);
  useEffect(() => {
    if (valor > anterior.current) {
      setBrilho(true);
      const id = setTimeout(() => setBrilho(false), 450);
      anterior.current = valor;
      return () => clearTimeout(id);
    }
    anterior.current = valor;
  }, [valor]);

  return (
    <div style={{ ...caixa(rect) }}>
      <div
        style={{
          position: "absolute",
          inset: borda / 3,
          borderRadius: borda * 0.66,
          overflow: "hidden",
          background: SB_COLORS.trough,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: larguraRotulo,
            right: 0,
            top: 0,
            bottom: 0,
          }}
        >
          {/* `minWidth` porque no começo de um nível alto a fração é
              microscópica — 6.928 de 99.999.999 dá 0,007% da pista, meio
              centésimo de pixel, e a barra parecia não estar funcionando.
              Com o mínimo, um fio de cor mostra que há progresso. */}
          <div
            style={{
              height: "100%",
              width: `${frac * 100}%`,
              minWidth: valor > 0 ? px(10) : 0,
              background: fill,
              borderRadius: borda * 0.5,
              transition: "width 420ms ease-out",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,240,190,0.55)",
              opacity: brilho ? 1 : 0,
              transition: brilho ? "opacity 90ms ease-out" : "opacity 420ms ease-out",
              pointerEvents: "none",
            }}
          />
        </div>
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

      <div
        style={{
          position: "absolute",
          inset: 0,
          font: `${fonte}px ${FRAME_FONT}`,
          color: SB_COLORS.ink,
          textShadow: `0 1px 2px ${SB_COLORS.shadow}`,
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ position: "absolute", left: px(20), top: "50%", transform: "translateY(-50%)" }}>
          {rotulo}
        </span>
        <span
          style={{
            position: "absolute",
            left: `calc(${larguraRotulo}px + ${Math.min(frac, 0.62) * 100}% - ${larguraRotulo * Math.min(frac, 0.62)}px + ${px(10)}px)`,
            top: "50%",
            transform: "translateY(-50%)",
            fontFamily: FRAME_NUM_FONT,
            fontVariantNumeric: FRAME_NUM_VARIANT,
            transition: "left 420ms ease-out",
          }}
        >
          {valor.toLocaleString("pt-BR")} / {alvo.toLocaleString("pt-BR")}
        </span>
        <span
          style={{
            position: "absolute",
            right: px(20),
            top: "50%",
            transform: "translateY(-50%)",
            fontWeight: 700,
            fontFamily: FRAME_NUM_FONT,
            fontVariantNumeric: FRAME_NUM_VARIANT,
          }}
        >
          {/* uma casa decimal: no fim do jogo a barra anda de centésimo em
              centésimo, e arredondar para inteiro deixava "0%" parado por
              horas de jogo */}
          {(frac * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
        </span>
      </div>
    </div>
  );
}
