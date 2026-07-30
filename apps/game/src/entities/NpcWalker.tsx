import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  createMovementController,
  DEFAULT_MOVEMENT_CONFIG,
  type MovementState,
  type TerrainQuery,
} from "@ragnarok/engine-core";
import type { GameplayConfig } from "@ragnarok/game-data";
import type { MapSpawn } from "@ragnarok/map-format";
import { CHARACTER_URLS, useCharacter, type CharacterKey } from "../assets";

/**
 * NPC de patrulha: caminha pelos waypoints da rota (`spawn.path`) autorada no
 * editor. Modos: loop (fecha o ciclo), pingpong (vai-e-volta), once (para no
 * fim). Sem combate — só locomoção. Reusa o pipeline de personagem + o mesmo
 * TerrainQuery/MovementController livre dos monstros.
 */
export function NpcWalker({
  spawn,
  terrain,
  cellSize,
  gameplay,
}: {
  spawn: MapSpawn;
  terrain: TerrainQuery;
  cellSize: number;
  gameplay: GameplayConfig;
}) {
  const group = useRef<THREE.Group>(null);
  const key = ((spawn.refId as CharacterKey) in CHARACTER_URLS ? spawn.refId : "knight") as CharacterKey;
  const { scene, play } = useCharacter(CHARACTER_URLS[key], gameplay.animationSpeed);

  const pts = spawn.path?.points ?? [];
  const mode = spawn.path?.mode ?? "loop";
  const speed = spawn.path?.speed ?? 3;

  const config = useMemo(
    () => ({ ...DEFAULT_MOVEMENT_CONFIG, cellSize, freeUnitsPerSecond: speed }),
    [cellSize, speed],
  );
  const controller = useMemo(() => createMovementController("free", terrain, config), [terrain, config]);

  const state = useRef<MovementState>({
    position: { x: spawn.position[0], y: spawn.position[1], z: spawn.position[2] },
    heading: 0,
    moving: false,
  });
  const idx = useRef(0); // waypoint alvo atual
  const dir = useRef(1); // sentido (pingpong)
  const done = useRef(false); // mode "once" terminou

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const g = group.current;
    if (pts.length === 0 || done.current) {
      if (g) play("idle");
      return;
    }
    const pos = state.current.position;
    const wp = pts[idx.current]!;
    const tgt = { x: wp[0], z: wp[2] };
    const next = controller.update(state.current, { x: 0, z: 0, target: tgt }, dt);
    state.current = next;

    // chegou no waypoint → avança conforme o modo
    const reached = Math.hypot(next.position.x - tgt.x, next.position.z - tgt.z) < cellSize * 0.4;
    if (reached && !next.moving) {
      if (mode === "pingpong") {
        if (idx.current + dir.current >= pts.length || idx.current + dir.current < 0) dir.current *= -1;
        idx.current += dir.current;
      } else if (mode === "once") {
        if (idx.current >= pts.length - 1) done.current = true;
        else idx.current += 1;
      } else {
        idx.current = (idx.current + 1) % pts.length; // loop
      }
    }

    if (g) {
      g.position.set(next.position.x, next.position.y, next.position.z);
      g.rotation.y = next.heading;
    }
    play(next.moving ? "walk" : "idle");
  });

  return (
    <group ref={group}>
      <group scale={gameplay.charScale}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
