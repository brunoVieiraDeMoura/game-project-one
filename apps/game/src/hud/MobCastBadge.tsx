import { useEffect, useRef, useState } from "react";
import { IconSquare } from "../ui/rpg";
import { useEntityCastStore } from "../net/entityCastStore";
import { useSkillCatalog } from "../net/skillCatalog";
import { skillIconUrl } from "../net/skillIcons";
import { subscribeHudTick } from "./hudTick";

/**
 * "Está castando X" — mesma composição visual dos slots fixos
 * (`MobInfoSlots`) e dos ícones de buff (`StatusEffectIcons`), pra ler como
 * PARTE da mesma barra. Fonte única: `net/entityCastStore.ts`, alimentado
 * pelos MESMOS `skill:casting`/`skill:cast` que já disparam o VFX de
 * conjuração e a animação 3D — nenhum estado novo inventado, só mais um
 * lugar lendo o que já existe.
 *
 * Reativo em DOIS níveis, mesma técnica de `StatusEffectIcon`:
 *  - `useEntityCastStore` (zustand) decide se o badge existe — muda só
 *    quando um cast COMEÇA/TERMINA, não a cada quadro;
 *  - o anel de progresso muta o DOM direto no relógio COMPARTILHADO
 *    (`hud/hudTick.ts`), nunca `setState`/`requestAnimationFrame` próprio
 *    (pedido explícito do sistema de status: "não criar rAF por ícone").
 */
const MOB_CAST_STYLE_ID = "mob-cast-badge-style";
const MOB_CAST_CSS = `@keyframes mob-cast-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }`;

function useMobCastStyles(): void {
  useEffect(() => {
    if (document.getElementById(MOB_CAST_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = MOB_CAST_STYLE_ID;
    tag.textContent = MOB_CAST_CSS;
    document.head.appendChild(tag);
  }, []);
}

export function MobCastBadge({ gid, size = 32 }: { gid: number; size?: number }) {
  useMobCastStyles();
  const cast = useEntityCastStore((s) => s.byGid[gid]);
  const skillInfo = useSkillCatalog((s) => (cast ? s.byId[cast.skillId] : undefined));
  useEffect(() => {
    if (cast) useSkillCatalog.getState().ensure([cast.skillId]);
  }, [cast]);

  // mesma fórmula de `StatusEffectIcons` pro raio do ícone redondo sem borda
  const raio = Math.max(2, Math.round(size * 0.22 * 0.66));
  const [hover, setHover] = useState(false);
  const anelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cast) return;
    const passo = () => {
      const el = anelRef.current;
      if (!el) return;
      const falta = Math.max(0, cast.fim - performance.now());
      const frac = cast.duracaoMs > 0 ? Math.max(0, Math.min(1, falta / cast.duracaoMs)) : 0;
      const decorrido = (1 - frac) * 360;
      el.style.background = `conic-gradient(transparent 0deg ${decorrido}deg, rgba(10,6,4,0.6) ${decorrido}deg 360deg)`;
    };
    passo();
    return subscribeHudTick(passo);
  }, [cast]);

  if (!cast) return null;

  const nome = skillInfo?.name || `#${cast.skillId}`;
  const imageSrc = skillIconUrl(skillInfo?.icon);

  return (
    <div
      style={{ position: "relative", width: size, height: size, flex: "none" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: raio,
          boxShadow: "inset 0 0 0 2px rgba(255,200,120,0.85)",
          pointerEvents: "none",
          // aro pulsando — distingue de um buff/debuff parado (StatusEffectIcon
          // não pulsa) sem precisar de cor nova
          animation: "mob-cast-pulse 900ms ease-in-out infinite",
        }}
      />
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <IconSquare
          seed={String(cast.skillId)}
          label={nome}
          imageSrc={imageSrc}
          size={size}
          fill
          radius={raio}
          border={false}
          nativeTooltip={false}
        />
      </div>
      <div ref={anelRef} style={{ position: "absolute", inset: 0, borderRadius: raio, pointerEvents: "none" }} />
      {hover && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            top: "100%",
            marginTop: 6,
            minWidth: 120,
            background: "rgba(20,12,8,0.95)",
            color: "#f2e6d6",
            borderRadius: 6,
            padding: "4px 8px",
            font: "12px system-ui",
            whiteSpace: "nowrap",
            zIndex: 20,
            pointerEvents: "none",
          }}
        >
          Conjurando: {nome}
        </div>
      )}
    </div>
  );
}
