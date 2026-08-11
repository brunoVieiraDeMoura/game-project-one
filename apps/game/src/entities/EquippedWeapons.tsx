import { useLayoutEffect } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { WEAPON_URLS, type HandSlot, type WeaponKey, type WeaponMount } from "../assets";
import { compartilharTexturas } from "../gltfTexturas";

/**
 * Uma arma presa num handslot.
 *
 * `handslotl`/`handslotr` são nós vazios (não são joint do skin) filhos de
 * `handl`/`handr` em todo personagem do Rig_Medium (ver auditoria em
 * `entities/classModels`; o nome de origem no .glb tem ponto —
 * `handslot.l`/`.r` — mas o `GLTFLoader` do three remove pontuação do nome do
 * nó, ver `assets.HandSlot`) — herdam a matriz mundial do osso da mão pelo
 * grafo de cena normal do three, então o modelo da arma (sem esqueleto
 * próprio, `Object3D.clone()` simples — geometria/material continuam
 * compartilhados com o cache do `useGLTF`) segue a animação só de virar
 * filho do nó certo.
 */
function WeaponAttachment({
  scene,
  weapon,
  slot,
  rotation,
}: {
  scene: THREE.Group;
  weapon: WeaponKey;
  slot: HandSlot;
  rotation?: readonly [number, number, number];
}) {
  const gltf = useGLTF(WEAPON_URLS[weapon]);
  useLayoutEffect(() => {
    const bone = scene.getObjectByName(slot);
    if (!bone) return; // personagem sem este handslot (não deveria acontecer no Rig_Medium)
    compartilharTexturas(gltf as never);
    const clone = gltf.scene.clone(true) as THREE.Group;
    if (rotation) clone.rotation.set(...rotation);
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      // marca TODO descendente — ver `EH_ARMA` (`hud/CharacterPortrait`): o
      // enquadramento "inteiro" ignora estes nós de propósito. O grip da
      // arma não é a origem do mesh (ao contrário de espada/adaga/cajado): o
      // arco (`bow_withString`) tem a origem no CENTRO do limbo, então metade
      // do modelo cai abaixo da mão — incluído no bbox do retrato, aquilo
      // media como "chão" mais baixo que o pé de verdade e a câmera
      // recentrava a cena inteira, tirando o personagem do lugar (visto no
      // char-select: "o arco tá no chão, o personagem voado").
      o.userData.arma = true;
    });
    bone.add(clone);
    return () => {
      bone.remove(clone);
    };
  }, [scene, gltf, slot, rotation]);
  return null;
}

/**
 * Pendura as armas da classe (`entities/classModels`) nos handslots do
 * personagem já montado. Cada arma é um componente próprio com hooks de
 * contagem FIXA — 0/1/2 armas (desarmado / uma mão / dupla, ex.: Thief com
 * adaga em cada mão) muda quantos `WeaponAttachment` montam, não quantos
 * hooks um componente chama, então não fere a regra dos hooks.
 */
export function EquippedWeapons({ scene, weapons }: { scene: THREE.Group; weapons: readonly WeaponMount[] }) {
  return (
    <>
      {weapons.map((w) => (
        <WeaponAttachment key={w.slot} scene={scene} weapon={w.weapon} slot={w.slot} rotation={w.rotation} />
      ))}
    </>
  );
}
