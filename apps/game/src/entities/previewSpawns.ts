import type { GameMap } from "@ragnarok/map-format";
import { mobModel } from "./mobModels";
import type { CharacterKey } from "../assets";

/**
 * Spawns de monstro do mapa → bonecos parados, para o PREVIEW do editor.
 *
 * Substitui o antigo `demoMonsters`, que além de posicionar também inventava
 * monstros de demonstração e os registrava no combate simulado. Aqui é só
 * "onde o autor do mapa pôs um spawn, e com que cara" — quem cria monstro de
 * verdade é o rAthena.
 */
export interface PreviewSpawn {
  id: string;
  spawn: { x: number; z: number };
  characterKey: CharacterKey;
}

export function previewSpawns(map: GameMap): PreviewSpawn[] {
  return map.spawns
    .filter((s) => s.kind === "mob")
    .map((s) => ({
      id: s.id,
      spawn: { x: s.position[0], z: s.position[2] },
      // `refId` é o id do mob no catálogo; o mesmo mapa mobId → modelo que o
      // jogo online usa, com o esqueleto padrão para id desconhecido
      characterKey: mobModel(Number(s.refId ?? 0)).character,
    }));
}
