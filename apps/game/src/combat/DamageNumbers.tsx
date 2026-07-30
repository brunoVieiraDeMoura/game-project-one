import { useEffect } from "react";
import { Billboard, Text } from "@react-three/drei";
import { useCombatStore, type DamageNumber } from "./combatStore";

/** Números de dano flutuantes: sobem e somem após ~0.9s. Removidos do store por
 * timeout (não por frame). Vermelho no player, branco/amarelo (crit) no mob. */
export function DamageNumbers() {
  const numbers = useCombatStore((s) => s.damageNumbers);
  return (
    <>
      {numbers.map((n) => (
        <FloatingNumber key={n.id} n={n} />
      ))}
    </>
  );
}

function FloatingNumber({ n }: { n: DamageNumber }) {
  const clear = useCombatStore((s) => s.clearDamageNumber);
  useEffect(() => {
    const t = setTimeout(() => clear(n.id), 900);
    return () => clearTimeout(t);
  }, [n.id, clear]);

  const color = n.toPlayer ? "#ef4444" : n.crit ? "#fde047" : "#ffffff";
  return (
    <Billboard position={[n.x + (n.id % 2 ? 0.6 : -0.6), n.y, n.z]}>
      <Text fontSize={n.crit ? 2.2 : 1.6} color={color} outlineWidth={0.06} outlineColor="#000" anchorX="center">
        {n.crit ? `${n.value}!` : String(n.value)}
      </Text>
    </Billboard>
  );
}
