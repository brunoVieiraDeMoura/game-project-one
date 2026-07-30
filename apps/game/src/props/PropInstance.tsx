import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { RigidBody } from "@react-three/rapier";
import type { MapProp } from "@ragnarok/map-format";
import { propUrl } from "./registry";

/**
 * Uma instância de prop do mapa (skill-r3f-conventions: componente = entidade,
 * resolvido por registry). Clona a cena do glTF (várias instâncias do mesmo
 * asset sem compartilhar transform) e aplica position/rotation/scale do
 * GameMap.props. Collider opcional conforme colliderType.
 *
 * ATENÇÃO: quem barra o personagem NÃO é este RigidBody. Player, monstros e
 * NPCs andam pelo MovementController (engine-core), que só consulta
 * TerrainQuery — o bloqueio de verdade é o footprint em
 * hex/hexTerrainQuery.ts. O corpo do Rapier aqui é só pra física de objetos
 * (nada depende dele hoje); mexer no colliderType afeta OS DOIS, porque a
 * query lê o mesmo campo.
 */
export function PropInstance({ prop }: { prop: MapProp }) {
  const url = propUrl(prop.assetId);
  const gltf = url ? useGLTF(url) : null;

  const scene = useMemo(() => {
    if (!gltf) return null;
    const clone = gltf.scene.clone(true);
    clone.traverse((o) => {
      const m = o as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean };
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return clone;
  }, [gltf]);

  if (!scene) return null; // assetId desconhecido — silenciosamente omitido (editor valida)

  const model = (
    <primitive object={scene} position={prop.position} rotation={prop.rotation} scale={prop.scale} />
  );

  const collider = prop.colliderType && prop.colliderType !== "none";
  if (!collider) return model;

  const shape = prop.colliderType === "trimesh" ? "trimesh" : prop.colliderType === "hull" ? "hull" : "cuboid";
  return (
    <RigidBody type="fixed" colliders={shape}>
      {model}
    </RigidBody>
  );
}
