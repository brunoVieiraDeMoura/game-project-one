import { useEffect, useState } from "react";
import { ELEMENT_LABELS, RACE_LABELS, SIZE_LABELS, type Element, type Race, type Size } from "@ragnarok/game-data";
import { IconSquare } from "../ui/rpg";
import { useMonsterCatalog } from "../net/monsterCatalog";
import { elementIconSrc, raceIconSrc, sizeIconSrc } from "../ui/monsterIcons";

/**
 * Os 3 slots FIXOS da barra de buff do monstro (`TargetFrame`,
 * "auditoria skills/monstros" 2026-08-14): Elemento, Raça, Tamanho — sempre
 * nesta ordem, sempre presentes pra um alvo mob, e sempre ANTES dos
 * buffs/debuffs reais (`StatusEffectIcons`, que entra DEPOIS deste
 * componente na `TargetFrame` — nunca dentro dele, pra um buff/debuff
 * temporário jamais empurrar ou substituir um destes três).
 *
 * Dado vem de `net/monsterCatalog.ts` (mob_db real via API — a MESMA fonte
 * que o admin edita), nunca inventado nem recalculado: isto é só exibição,
 * combate continua 100% decidido pelo rAthena.
 *
 * Sem moldura, ícone redondo — mesmo tratamento de `hud/StatusEffectIcons.tsx`
 * (`bordered={false}`, pedido explícito 2026-08-17) pra ler como PARTE da
 * mesma barra.
 */
const SIZE_ABBR: Record<Size, string> = { small: "P", medium: "M", large: "G" };
const RACE_ABBR: Record<Race, string> = {
  formless: "Am",
  undead: "Mv",
  brute: "Br",
  plant: "Pl",
  insect: "In",
  fish: "Pe",
  demon: "De",
  demihuman: "Sh",
  angel: "An",
  dragon: "Dr",
  player_human: "Hu",
  player_doram: "Do",
};
const ELEMENT_ABBR: Record<Element, string> = {
  neutral: "Ne",
  water: "Ág",
  earth: "Te",
  fire: "Fo",
  wind: "Ve",
  poison: "Vn",
  holy: "Sa",
  shadow: "Sb",
  ghost: "Fa",
  undead: "Md",
};

export function MobInfoSlots({ monsterId, size = 32 }: { monsterId: number; size?: number }) {
  const info = useMonsterCatalog((s) => s.byId[monsterId]);
  useEffect(() => {
    useMonsterCatalog.getState().ensure([monsterId]);
  }, [monsterId]);
  const gap = Math.max(3, Math.round(size * 0.18));
  // mesma fórmula de `StatusEffectIcons` pro raio do ícone redondo sem borda
  const raio = Math.max(2, Math.round(size * 0.22 * 0.66));

  const element = info?.element as Element | undefined;
  const race = info?.race as Race | undefined;
  const sizeCat = info?.size as Size | undefined;

  const slots: { key: string; code: string; label: string; value: string; extra?: string; imageSrc?: string }[] = [
    {
      key: "element",
      code: element ? (ELEMENT_ABBR[element] ?? "?") : "?",
      label: "Elemento",
      value: element ? ELEMENT_LABELS[element] : "?",
      extra: element ? `[${info?.elementLevel ?? 1}]` : undefined,
      imageSrc: elementIconSrc(element),
    },
    {
      key: "race",
      code: race ? (RACE_ABBR[race] ?? "?") : "?",
      label: "Raça",
      value: race ? RACE_LABELS[race] : "?",
      imageSrc: raceIconSrc(race),
    },
    {
      key: "size",
      code: sizeCat ? (SIZE_ABBR[sizeCat] ?? "?") : "?",
      label: "Tamanho",
      value: sizeCat ? SIZE_LABELS[sizeCat] : "?",
      imageSrc: sizeIconSrc(sizeCat),
    },
  ];

  return (
    <div style={{ display: "flex", gap, flex: "none" }}>
      {slots.map((s) => (
        <MobInfoSlot key={s.key} slot={s} size={size} raio={raio} />
      ))}
    </div>
  );
}

function MobInfoSlot({
  slot,
  size,
  raio,
}: {
  slot: { key: string; code: string; label: string; value: string; extra?: string; imageSrc?: string };
  size: number;
  raio: number;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ position: "relative", width: size, height: size, flex: "none" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <IconSquare
        seed={`${slot.key}:${slot.code}`}
        label={slot.code}
        imageSrc={slot.imageSrc}
        size={size}
        fill
        radius={raio}
        border={false}
        nativeTooltip={false}
      />
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
          <div style={{ fontWeight: 700 }}>{slot.label}</div>
          <div>
            {slot.value}
            {slot.extra && <> <b>{slot.extra}</b></>}
          </div>
        </div>
      )}
    </div>
  );
}
