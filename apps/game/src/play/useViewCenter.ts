import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";

/**
 * Centro de visão "chunkado": lê a posição do player por frame mas só dispara
 * re-render (setState) quando ele cruza pra um novo chunk de `chunk` unidades.
 * Assim o culling do terreno/props recalcula raramente (não a cada frame),
 * mantendo o custo baixo. Retorna as coords snapadas do chunk atual.
 */
export function useViewCenter(posRef: React.MutableRefObject<THREE.Vector3>, chunk = 16) {
  const [center, setCenter] = useState({ x: 0, z: 0 });
  const last = useRef({ x: NaN, z: NaN });
  useFrame(() => {
    const p = posRef.current;
    const cx = Math.round(p.x / chunk) * chunk;
    const cz = Math.round(p.z / chunk) * chunk;
    if (cx !== last.current.x || cz !== last.current.z) {
      last.current = { x: cx, z: cz };
      setCenter({ x: cx, z: cz });
    }
  });
  return center;
}
