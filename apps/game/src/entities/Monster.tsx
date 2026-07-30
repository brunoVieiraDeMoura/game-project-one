import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainQuery } from "@ragnarok/engine-core";
import type { GameplayConfig } from "@ragnarok/game-data";
import { CHARACTER_URLS, useCharacter, type CharacterKey } from "../assets";

/**
 * Monstro do modo LOCAL (preview do editor de mapas).
 *
 * Não tem IA, não persegue e não bate: só marca onde o spawn está, para quem
 * está montando o mapa ver a distribuição. Quem simula monstro é o rAthena —
 * no jogo de verdade quem desenha é `net/NetEntity`, a partir dos pacotes do
 * servidor.
 *
 * Daqui saía combate inteiro (perseguição, auto-ataque, dano, morte, drop).
 * Removido junto com o resto do engine simulado: dois mundos discordando sobre
 * o mesmo monstro é pior que nenhum.
 */
export function Monster({
  terrain,
  spawn,
  characterKey = "skeleton_warrior",
  gameplay,
}: {
  terrain: TerrainQuery;
  spawn: { x: number; z: number };
  characterKey?: CharacterKey;
  gameplay: GameplayConfig;
  /** aceitos e ignorados: o preview não usa (mantidos para não quebrar as
   * chamadas existentes do editor) */
  id?: string;
  cellSize?: number;
  playerPosRef?: React.MutableRefObject<THREE.Vector3>;
}) {
  const group = useRef<THREE.Group>(null);
  const { scene, play } = useCharacter(CHARACTER_URLS[characterKey], gameplay.animationSpeed);
  const placed = useRef(false);

  useFrame(() => {
    const g = group.current;
    if (!g || placed.current) return;
    // uma vez só: no preview o spawn não anda
    g.position.set(spawn.x, terrain.getHeight(spawn.x, spawn.z), spawn.z);
    play("idle");
    placed.current = true;
  });

  return (
    <group ref={group}>
      <group scale={gameplay.charScale}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
