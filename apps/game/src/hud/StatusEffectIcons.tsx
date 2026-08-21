import { useEffect, useRef, useState } from "react";
import { IconSquare } from "../ui/rpg";
import { useNineSlice } from "../ui/nineSlice";
import { SLOT_FRAME } from "../ui/skillBar";
import {
  useStatusStore,
  opt1FromBodyStateEfstId,
  BODY_STATE_LABEL,
  BODY_STATE_ICON,
  opt2BitFromHealthStateEfstId,
  HEALTH_STATE_LABEL,
  HEALTH_STATE_ICON,
  EFST_ICON_BY_ID,
  type ActiveStatus,
} from "../net/statusStore";
import { useStatusCatalog } from "../net/statusCatalog";
import { useSkillCatalog } from "../net/skillCatalog";
import { skillIconUrl } from "../net/skillIcons";
import { subscribeHudTick } from "./hudTick";

/**
 * Ícones de buff/debuff/skill-com-duração — "auditoria buffs/debuffs"
 * 2026-08-14. UM componente serve os três lugares pedidos (linha compacta
 * abaixo da HP do personagem/alvo, linha compacta abaixo da HP do monstro no
 * mundo, painel grande de 6 colunas ao lado do minimapa); só tamanho/layout
 * mudam via `size`/`columns`.
 *
 * `columns` presente = grade fixa (painel grande — `repeat(columns, 1fr)`,
 * NUNCA `auto-fill`, pedido explícito). Ausente = linha compacta que quebra
 * sozinha (`flexWrap`).
 *
 * A moldura é literalmente a MESMA da barra de skills — `SLOT_FRAME`
 * (`ui/skillBar.ts`, 9-slice de `square-skill.png`) — pedido explícito
 * (2026-08-14, "quero literalmente essa borda... com a skill dentro"), não
 * uma borda CSS inventada.
 *
 * Lê `net/statusStore` (fonte única — populada pelo servidor via gateway
 * PARA a maioria dos efeitos, e por `net/useWorldEvents.ts` só pros poucos
 * self-buffs sem sinal nenhum do servidor, `SELF_TRACKED_BUFF_SKILLS`) e
 * pede nome/ícone só dos ids que aparecerem: `efstId >= 0` no
 * `net/statusCatalog` (catálogo de status), `efstId < 0` (= `-skillId`) no
 * `net/skillCatalog` (catálogo de skills) — nunca cria efeito nenhum por
 * conta própria, só resolve o nome de um que a store já tem.
 */
export function StatusEffectIcons({
  gid,
  size = 22,
  columns,
  bordered = true,
  tooltipBelow = false,
  maxWidthPx,
}: {
  gid: number;
  /** lado do ícone em px — na grade (`columns` presente) vira só a dica de
   * tamanho do `LoadingRing`; quem decide o tamanho real da célula é o grid */
  size?: number;
  columns?: number;
  /** `false` = sem a moldura de skill, só o ícone arredondado (pedido
   * explícito 2026-08-14 pras fileiras pequenas abaixo da UI do personagem —
   * o painel grande ao lado do minimapa continua com a moldura real). */
  bordered?: boolean;
  /** `true` = tooltip abre PRA BAIXO do ícone em vez de pra cima (pedido
   * explícito 2026-08-14 pro painel ao lado do minimapa — ele já fica no
   * topo da tela, um tooltip abrindo pra cima corta na borda do navegador). */
  tooltipBelow?: boolean;
  /** largura máxima da fileira compacta (`columns` ausente) antes de quebrar
   * linha — sem isso um monstro com muitos debuffs simultâneos (auditoria
   * opt2/bitmask 2026-08-14: vários de uma vez são esperados agora) esticava
   * a fileira pra fora da largura da barra de HP em vez de quebrar. Ignorado
   * no modo `columns` (grade já tem largura própria). */
  maxWidthPx?: number;
}) {
  const effects = useStatusStore((s) => s.byGid[gid]);

  useEffect(() => {
    if (!effects || effects.length === 0) return;
    const statusIds = effects.filter((e) => e.efstId >= 0).map((e) => e.efstId);
    // body-state/health-state (`opt1FromBodyStateEfstId`/`opt2BitFromHealthStateEfstId`
    // !== undefined) têm rótulo FIXO (`BODY_STATE_LABEL`/`HEALTH_STATE_LABEL`)
    // — nunca busca catálogo nenhum pra esses ids.
    const skillIds = effects
      .filter(
        (e) => e.efstId < 0 && opt1FromBodyStateEfstId(e.efstId) === undefined && opt2BitFromHealthStateEfstId(e.efstId) === undefined,
      )
      .map((e) => -e.efstId);
    if (statusIds.length > 0) useStatusCatalog.getState().ensure(statusIds);
    if (skillIds.length > 0) useSkillCatalog.getState().ensure(skillIds);
  }, [effects, gid]);

  if (!effects || effects.length === 0) return null;

  // Vão proporcional ao tamanho do ícone (antes fixo em 3px — ficava
  // apertado quando o ícone cresceu, `EntityLabel.tsx` 2026-08-14).
  const gapCompacto = Math.max(3, Math.round(size * 0.18));

  return (
    <div
      style={
        columns
          ? {
              display: "grid",
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gridAutoRows: size,
              gap: 4,
            }
          : {
              display: "flex",
              flexWrap: "wrap",
              gap: gapCompacto,
              // `center` só faz sentido com `maxWidthPx` (container fica mais
              // largo que o conteúdo pra caber quebra de linha, ex.:
              // `EntityLabel.tsx`) — sem isso o padrão `flex-start` (esquerda)
              // é o que o `TargetFrame` sempre precisou (alinhado com a
              // barra de HP, pedido explícito 2026-08-14).
              justifyContent: maxWidthPx ? "center" : "flex-start",
              ...(maxWidthPx ? { maxWidth: maxWidthPx } : null),
            }
      }
    >
      {effects.map((e) => (
        <StatusEffectIcon
          key={e.efstId}
          gid={gid}
          effect={e}
          size={size}
          fill={!!columns}
          bordered={bordered}
          tooltipBelow={tooltipBelow}
        />
      ))}
    </div>
  );
}

const ANEL_SOMBRA = "rgba(10,6,4,0.6)";

function StatusEffectIcon({
  gid,
  effect,
  size,
  fill,
  bordered,
  tooltipBelow,
}: {
  gid: number;
  effect: ActiveStatus;
  size: number;
  fill: boolean;
  bordered: boolean;
  tooltipBelow: boolean;
}) {
  /** quatro baldes por sinal/faixa de `effect.efstId` — ver doc de
   * `ActiveStatus` em `net/statusStore.ts`: >=0 é EFST real, uma faixa
   * reservada é `opt1` (petrificado/congelado/…), outra é `opt2`/healthState
   * (envenenado/amaldiçoado/…, bitmask — várias entradas simultâneas
   * possíveis pro MESMO gid, cada bit com seu próprio `efstId` pseudo),
   * qualquer outro negativo é self-buff sintetizado (`-skillId`). */
  const bodyOpt1 = opt1FromBodyStateEfstId(effect.efstId);
  const isBodyState = bodyOpt1 !== undefined;
  const healthOpt2Bit = opt2BitFromHealthStateEfstId(effect.efstId);
  const isHealthState = !isBodyState && healthOpt2Bit !== undefined;
  const isSkillSourced = !isBodyState && !isHealthState && effect.efstId < 0;
  const statusInfo = useStatusCatalog((s) =>
    isSkillSourced || isBodyState || isHealthState ? undefined : s.byEfstId[effect.efstId],
  );
  const skillInfo = useSkillCatalog((s) => (isSkillSourced ? s.byId[-effect.efstId] : undefined));
  const frame = useNineSlice(SLOT_FRAME);
  const borda = bordered ? Math.max(3, Math.round(size * 0.22)) : 0;
  /** sem moldura, o ícone vira redondo — mesma proporção que o resto do HUD
   * usa pro ícone DENTRO de um slot com borda (`borda * 0.66`, `SkillSlot`/
   * `SkillsWindow`/`StatusWindow`), só que aqui é a única borda que existe. */
  const raioSemBorda = Math.max(2, Math.round(size * 0.22 * 0.66));
  const inset = bordered ? borda / 3 : 0;
  const [hover, setHover] = useState(false);
  const anelRef = useRef<HTMLDivElement>(null);
  const tempoRef = useRef<HTMLDivElement>(null);
  const tooltipTempoRef = useRef<HTMLDivElement>(null);

  const temTimer = effect.totalMs > 0 && effect.endsAt > 0;

  // Contagem regressiva no relógio COMPARTILHADO (`hud/hudTick.ts`) — muta
  // o DOM direto (anel + texto) em vez de `setState` 60×/s, e não agenda o
  // próprio `requestAnimationFrame` (1 loop pro HUD inteiro, não 1 por
  // ícone — pedido explícito 2026-08-14, generalizado em T7).
  useEffect(() => {
    if (!temTimer) return;
    const passo = () => {
      const falta = Math.max(0, effect.endsAt - performance.now());
      // segundos INTEIROS (pedido explícito 2026-08-14, "remover
      // completamente os decimais") — `ceil` pra não mostrar "0" enquanto
      // ainda falta tempo de verdade (10000ms→10, 9001ms→10, 9000ms→9).
      const segundos = Math.ceil(falta / 1000);
      const texto = segundos > 0 ? String(segundos) : "";
      if (tempoRef.current) tempoRef.current.textContent = texto;
      if (tooltipTempoRef.current) tooltipTempoRef.current.textContent = `Tempo restante: ${texto}s`;
      if (anelRef.current) {
        const frac = Math.max(0, Math.min(1, falta / effect.totalMs));
        const decorrido = (1 - frac) * 360;
        anelRef.current.style.background = `conic-gradient(transparent 0deg ${decorrido}deg, ${ANEL_SOMBRA} ${decorrido}deg 360deg)`;
      }
      // Só os sintetizados se auto-apagam (ver doc de `ActiveStatus.
      // selfExpire` em `net/statusStore.ts`) — um efeito real do servidor
      // fica visualmente em "0" até um `status:end` de verdade chegar.
      if (falta <= 0 && effect.selfExpire) {
        useStatusStore.getState().end(gid, effect.efstId);
      }
    };
    passo();
    return subscribeHudTick(passo);
  }, [effect.endsAt, effect.totalMs, effect.selfExpire, effect.efstId, gid, temTimer]);

  const nome = isBodyState
    ? (BODY_STATE_LABEL[bodyOpt1] ?? "Estado")
    : isHealthState
      ? (HEALTH_STATE_LABEL[healthOpt2Bit] ?? "Estado")
      : (isSkillSourced ? skillInfo?.name : statusInfo?.name) || `#${effect.efstId}`;
  const descricao = isBodyState || isHealthState || isSkillSourced ? undefined : statusInfo?.description;
  /** quatro fontes possíveis, mesma ordem dos baldes acima — sem imagem
   * (ex.: EFST real sem entrada em `EFST_ICON_BY_ID`) cai sozinho no
   * placeholder por seed do `IconSquare`, nunca ícone errado. */
  const debuffIconFile = isBodyState
    ? BODY_STATE_ICON[bodyOpt1]
    : isHealthState
      ? HEALTH_STATE_ICON[healthOpt2Bit]
      : !isSkillSourced && statusInfo
        ? EFST_ICON_BY_ID[statusInfo.id]
        : undefined;
  const imageSrc =
    isSkillSourced && skillInfo?.icon
      ? skillIconUrl(skillInfo.icon)
      : debuffIconFile
        ? `/assets/debuffs/${debuffIconFile}`
        : undefined;

  return (
    <div
      style={{ position: "relative", width: fill ? "100%" : size, height: fill ? "100%" : size, flex: fill ? undefined : "none" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {bordered && frame && (
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
      {/* Com moldura: `borda/3`, não `borda` — a mesma proporção de
          `hud/SkillBar.tsx: SkillSlot`: o `square-skill.png` tem muita
          margem transparente dentro da faixa nominal do border-image, e
          insetar pela largura CHEIA deixava um vão entre o ícone e o traço
          pintado. Sem moldura: `inset:0`, ícone arredondado ocupa o slot
          inteiro. */}
      <div style={{ position: "absolute", inset, overflow: "hidden" }}>
        <IconSquare
          seed={String(effect.efstId)}
          label={nome}
          imageSrc={imageSrc}
          size={size}
          fill
          radius={raioSemBorda}
          border={false}
          nativeTooltip={false}
        />
      </div>
      {temTimer && (
        <>
          <div ref={anelRef} style={{ position: "absolute", inset, borderRadius: bordered ? 0 : raioSemBorda, pointerEvents: "none" }} />
          {/* Centralizado SOBRE o ícone (pedido explícito 2026-08-14, era
              canto inferior-direito) — `position:absolute, inset:0` +
              flex-center: overlay puro, não reserva espaço nenhum no fluxo
              (a largura/altura do ícone continua vindo só da div de fora,
              `width/height: size`), então vizinhos nunca deslocam. Fonte em
              fração de `size`, não px fixo — acompanha o ícone em qualquer
              zoom/cellSize, igual ao resto do componente. */}
          <div
            ref={tempoRef}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: `800 ${Math.max(9, Math.round(size * 0.4))}px system-ui`,
              color: "#ffe6b0",
              textShadow: "0 1px 3px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.7)",
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {hover && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            ...(tooltipBelow ? { top: "100%", marginTop: 6 } : { bottom: "100%", marginBottom: 6 }),
            minWidth: 140,
            maxWidth: 220,
            background: "rgba(20,12,8,0.95)",
            color: "#f2e6d6",
            borderRadius: 6,
            padding: "6px 8px",
            font: "12px system-ui",
            lineHeight: 1.35,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            zIndex: 20,
            pointerEvents: "none",
            whiteSpace: "normal",
          }}
        >
          <div style={{ fontWeight: 700 }}>{nome}</div>
          {descricao && <div style={{ opacity: 0.85, marginTop: 2 }}>{descricao}</div>}
          {temTimer && <div ref={tooltipTempoRef} style={{ opacity: 0.85, marginTop: 2 }} />}
        </div>
      )}
    </div>
  );
}
