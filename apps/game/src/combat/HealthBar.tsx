import { Billboard } from "@react-three/drei";

/** Barra de vida flutuante (billboard, sempre encara a câmera). Fundo vermelho
 * + preenchimento verde proporcional ao HP. Leve (planes), sem Html. */
export function HealthBar({ hp, maxHp, y, width = 3 }: { hp: number; maxHp: number; y: number; width?: number }) {
  const frac = Math.max(0, Math.min(1, hp / maxHp));
  return (
    <Billboard position={[0, y, 0]}>
      <mesh>
        <planeGeometry args={[width + 0.15, 0.55]} />
        <meshBasicMaterial color="#111" />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[width, 0.4]} />
        <meshBasicMaterial color="#7f1d1d" />
      </mesh>
      <mesh position={[-(width * (1 - frac)) / 2, 0, 0.02]}>
        <planeGeometry args={[width * frac, 0.4]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>
    </Billboard>
  );
}
