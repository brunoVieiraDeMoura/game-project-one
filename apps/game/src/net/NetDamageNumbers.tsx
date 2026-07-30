import { useEffect } from "react";
import { Billboard, Text } from "@react-three/drei";
import type { GameMap } from "@ragnarok/map-format";
import { cellToWorld, type LegacyMapping } from "./legacyCells";
import { useDamageFeed, type NetDamage } from "./damageFeed";
import { interpolatedCell, useWorldStore } from "./worldStore";

/**
 * Números de dano do servidor, desenhados em cima de quem apanhou.
 *
 * A posição é lida uma vez, no momento em que o número nasce: ele fica parado
 * no ar enquanto sobe, como no RO — seguir o alvo faria o número correr junto
 * com o mob.
 */
export function NetDamageNumbers({ map, mapping }: { map: GameMap; mapping: LegacyMapping }) {
  const numbers = useDamageFeed((s) => s.numbers);
  return (
    <>
      {numbers.map((n) => (
        <FloatingNumber key={n.id} n={n} map={map} mapping={mapping} />
      ))}
    </>
  );
}

function FloatingNumber({ n, map, mapping }: { n: NetDamage; map: GameMap; mapping: LegacyMapping }) {
  const clear = useDamageFeed((s) => s.clear);

  useEffect(() => {
    const t = setTimeout(() => clear(n.id), 900);
    return () => clearTimeout(t);
  }, [n.id, clear]);

  const world = useWorldStore.getState();
  const source = n.onSelf ? world.self : world.entities[n.gid];
  if (!source) return null;

  const cell = interpolatedCell(source, performance.now());
  const pos = cellToWorld(map, mapping, cell.x, cell.y);
  const color = n.onSelf ? "#ef4444" : n.crit ? "#fde047" : "#ffffff";
  const label = n.miss ? "Miss" : n.crit ? `${n.value}!` : String(n.value);

  return (
    <Billboard position={[pos.x + (n.id % 2 ? 0.3 : -0.3), pos.y + 1.6, pos.z]}>
      <Text fontSize={n.crit ? 1.1 : 0.8} color={color} outlineWidth={0.04} outlineColor="#000" anchorX="center">
        {label}
      </Text>
    </Billboard>
  );
}
