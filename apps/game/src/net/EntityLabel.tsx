import { Billboard, Text } from "@react-three/drei";
import { BOOK } from "../ui/travelbook";

/**
 * Plaquinha em cima da entidade: nome (e HP, quando o servidor manda).
 *
 * O nome vem do próprio rAthena (`ACK_REQNAME`), e com `show_mob_info` ligado
 * ele já chega no formato do RO — "Poring" vira algo como
 * `Poring 55/55 Lv 1`. A barra abaixo do nome só aparece quando existe HP:
 * inventar uma barra cheia para um mob cujo HP o servidor não mandou seria
 * mentira.
 */
export function EntityLabel({
  name,
  level,
  hp,
  maxHp,
  height,
  cellSize,
  targeted,
}: {
  name: string;
  level?: number | undefined;
  hp?: number | undefined;
  maxHp?: number | undefined;
  /** altura do modelo em unidades de mundo (a plaquinha fica logo acima) */
  height: number;
  /** largura de uma célula — a plaquinha é medida nela, como o resto da cena */
  cellSize: number;
  targeted?: boolean;
}) {
  const hasHp = hp !== undefined && maxHp !== undefined && maxHp > 0;
  const frac = hasHp ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const width = cellSize * 0.55;
  const barHeight = cellSize * 0.05;

  return (
    <Billboard position={[0, height + cellSize * 0.35, 0]}>
      <Text
        // ~1/10 de célula: no RO o nome cabe embaixo do sprite sem virar placa.
        // Em 0,15 ele ficava mais largo que três células e tapava o mob.
        fontSize={cellSize * 0.1}
        color={targeted ? "#ffd166" : "#ffffff"}
        outlineWidth={cellSize * 0.009}
        outlineColor="#000000"
        anchorX="center"
        anchorY="bottom"
      >
        {level ? `${name}  Lv ${level}` : name}
      </Text>

      {hasHp && (
        <group position={[0, -barHeight * 1.8, 0]}>
          {/* trilho */}
          <mesh>
            <planeGeometry args={[width, barHeight]} />
            <meshBasicMaterial color={BOOK.wood} transparent opacity={0.85} depthWrite={false} />
          </mesh>
          {/* preenchimento: encolhe pela esquerda, como no RO */}
          <mesh position={[-(width * (1 - frac)) / 2, 0, 0.001]}>
            <planeGeometry args={[width * frac, barHeight * 0.72]} />
            <meshBasicMaterial color="#c0392b" depthWrite={false} />
          </mesh>
        </group>
      )}
    </Billboard>
  );
}
