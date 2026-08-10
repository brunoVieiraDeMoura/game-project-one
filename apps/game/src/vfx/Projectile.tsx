import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { cellToWorld, type LegacyMapping } from "../net/legacyCells";
import { useProjectileStore, type ProjectileInstance } from "./projectileStore";

/**
 * Projétil de ataque à distância — a "retinha retangular colorida" pedida
 * para validar o pipeline visual antes de existir arte de flecha de verdade.
 *
 * Mesmo padrão do `SkillVfx`: um grupo nomeado (pro flight recorder contar
 * por categoria), um nó por efeito, posição resolvida em CÉLULA e convertida
 * pra mundo a cada quadro só enquanto precisa (aqui NUNCA muda de fórmula —
 * origem e destino são fixos desde o golpe, só o `t` de 0..1 anda).
 */
export function Projectile({ map, mapping, cellSize }: { map: GameMap; mapping: LegacyMapping; cellSize: number }) {
  const effects = useProjectileStore((s) => s.effects);

  useFrame(() => {
    useProjectileStore.getState().prune(performance.now());
  });

  return (
    <group name="projectile-vfx">
      {effects.map((effect) => (
        <ProjectileNode key={effect.id} effect={effect} map={map} mapping={mapping} cellSize={cellSize} />
      ))}
    </group>
  );
}

/** altura acima do chão, em fração de célula — torso do personagem, mesma referência do `BuffRing`/`ImpactFlash` */
const ALTURA_VOO = 0.6;

function ProjectileNode({
  effect,
  map,
  mapping,
  cellSize,
}: {
  effect: ProjectileInstance;
  map: GameMap;
  mapping: LegacyMapping;
  cellSize: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);

  // Origem e destino são fixos pela vida inteira do efeito (nasceram do golpe
  // já resolvido) — resolver uma vez em vez de a cada quadro é a MESMA razão
  // de `AreaCell`/`AreaDisc` moldarem uma vez só.
  const { from, to, comprimento, angulo } = useMemo(() => {
    const a = cellToWorld(map, mapping, effect.fromCell.x, effect.fromCell.y);
    const b = cellToWorld(map, mapping, effect.toCell.x, effect.toCell.y);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return {
      from: { x: a.x, y: a.y + ALTURA_VOO * cellSize, z: a.z },
      to: { x: b.x, y: b.y + ALTURA_VOO * cellSize, z: b.z },
      comprimento: Math.max(0.001, Math.hypot(dx, dz)),
      // ângulo no plano XZ: aponta do atacante para o alvo
      angulo: Math.atan2(dx, dz),
    };
  }, [effect.fromCell.x, effect.fromCell.y, effect.toCell.x, effect.toCell.y, map, mapping, cellSize]);

  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#ffd166", transparent: true, opacity: 0.95, depthWrite: false }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  const comprimentoTraço = Math.min(comprimento * 0.5, cellSize * 0.9);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = Math.min(1, (performance.now() - effect.startedAt) / effect.durationMs);
    m.position.set(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t);
  });

  return (
    <mesh ref={mesh} rotation={[0, angulo, 0]} position={[from.x, from.y, from.z]}>
      <boxGeometry args={[cellSize * 0.08, cellSize * 0.08, comprimentoTraço]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
