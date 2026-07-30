import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody } from "@react-three/rapier";
import type { GameMap, CollisionType } from "@ragnarok/map-format";

/**
 * Renderiza a colisão de um GameMap como uma DataTexture (1 texel por célula)
 * projetada num único plano — 1 draw call, escala pras centenas de milhares de
 * células dos mapas grandes (skill-r3f-conventions: nada alocado por frame, a
 * textura é memoizada). O relevo vem zerado do cache legado, então o chão é
 * plano; o collider Rapier é um cuboid raso cobrindo a extensão do mapa.
 */

const RGB: Record<CollisionType, [number, number, number]> = {
  walkable: [63, 94, 18],
  wall: [63, 63, 70],
  water: [30, 64, 175],
  cliff: [120, 53, 15],
};

export function MapTerrain({ map }: { map: GameMap }) {
  const { width, height } = map.size;
  const worldW = width * map.cellSize;
  const worldH = height * map.cellSize;

  const texture = useMemo(() => {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const [r, g, b] = RGB[map.collision[i]!];
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }, [map, width, height]);

  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        {/* plano no XZ, centrado; origem do mapa no canto → deslocado meia extensão */}
        <mesh
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
          position={[worldW / 2, 0, worldH / 2]}
        >
          <planeGeometry args={[worldW, worldH]} />
          <meshStandardMaterial map={texture} />
        </mesh>
      </RigidBody>
    </group>
  );
}
