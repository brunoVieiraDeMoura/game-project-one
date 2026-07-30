import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useCombatStore } from "./combatStore";

/** Drops: cubos coloridos placeholder no chão onde o monstro morreu (o usuário
 * troca o asset depois). Giram levemente; clique recolhe (some). */
export function Drops() {
  const drops = useCombatStore((s) => s.drops);
  return (
    <>
      {drops.map((d) => (
        <DropCube key={d.id} id={d.id} x={d.x} z={d.z} color={d.color} />
      ))}
    </>
  );
}

function DropCube({ id, x, z, color }: { id: string; x: number; z: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const removeDrop = useCombatStore((s) => s.removeDrop);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 1.5;
  });
  return (
    <mesh
      ref={ref}
      position={[x, 1, z]}
      castShadow
      onPointerDown={(e) => {
        e.stopPropagation();
        removeDrop(id);
      }}
    >
      <boxGeometry args={[1.2, 1.2, 1.2]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
    </mesh>
  );
}
