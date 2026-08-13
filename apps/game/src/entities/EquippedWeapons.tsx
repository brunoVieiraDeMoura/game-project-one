import { useLayoutEffect } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { WEAPON_URLS, type HandSlot, type WeaponKey, type WeaponMount } from "../assets";
import { compartilharTexturas } from "../gltfTexturas";
import { registrarAnchorDeArma } from "./weaponAnchors";

/** fallback quando a bounding box da arma vem vazia (geometria ainda não
 * chegou no frame do registro) — melhor um palpite plausível que travar */
const TIP_Y_FALLBACK = 1.0;
/** folga além da ponta MEDIDA — sem isto o anchor cai bem EM CIMA do último
 * vértice da malha, e o raycast de oclusão do VFX (`Html occlude`) que sai
 * da câmera até esse ponto às vezes bate na própria arma antes de chegar
 * (auto-oclusão por ruído numérico), piscando o efeito mesmo desobstruído */
const TIP_EPSILON = 0.04;

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
  gid,
}: {
  scene: THREE.Group;
  weapon: WeaponKey;
  slot: HandSlot;
  rotation?: readonly [number, number, number];
  /** dono da arma — quando presente, registra a PONTA dela em
   * `entities/weaponAnchors` (VFX de skill que precisa nascer "na ponta do
   * cajado", ex. `vfx/mage/cold-bolt/ColdBoltCastFrost`). Ausente nos usos de retrato
   * (`hud/CharacterPortrait`), que não são personagem no mundo — nada de
   * VFX aponta pra lá, e registrar confundiria o mapa gid→arma com um "dono"
   * que não é uma entidade de verdade. */
  gid?: number;
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
    /**
     * Ponta da arma — MEDIDA da geometria real (`Box3.setFromObject`), não
     * chutada. A malha nasce com origem no PUNHO (`classModels.ts`, "origem
     * no punho... servem para virar filho direto do handslot sem offset"),
     * então o topo da bounding box (`box.max.y`) É a ponta — cajado, espada,
     * adaga, arco, qualquer arma do kit. Vira um `Object3D` FILHO do clone
     * (não um número solto): herda toda a cadeia de transform — rotação da
     * arma, animação da mão, giro do personagem — pelo grafo de cena normal,
     * sem duplicar nenhuma dessas contas aqui.
     *
     * MEDIDA ANTES de `bone.add(clone)`, de propósito: `Box3.setFromObject`
     * devolve a caixa em espaço MUNDO, e sem pai o `matrixWorld` do clone é
     * o próprio `matrix` local (rotação do `WeaponMount` já aplicada acima,
     * posição/escala ainda identidade) — mede exatamente o espaço local em
     * que `tip.position` vai ser interpretado. Medindo DEPOIS de pendurado
     * no osso, a caixa sairia em espaço mundo com a pose do personagem
     * misturada — o offset ficaria certo num frame e errado no seguinte.
     */
    let unregister: (() => void) | undefined;
    if (gid !== undefined) {
      const box = new THREE.Box3().setFromObject(clone);
      const tipY = (box.isEmpty() ? TIP_Y_FALLBACK : box.max.y) + TIP_EPSILON;
      const tip = new THREE.Object3D();
      tip.position.set(0, tipY, 0);
      clone.add(tip);
      unregister = registrarAnchorDeArma(gid, tip);
    }

    bone.add(clone);

    return () => {
      bone.remove(clone);
      unregister?.();
    };
  }, [scene, gltf, slot, rotation, gid]);
  return null;
}

/**
 * Pendura as armas da classe (`entities/classModels`) nos handslots do
 * personagem já montado. Cada arma é um componente próprio com hooks de
 * contagem FIXA — 0/1/2 armas (desarmado / uma mão / dupla, ex.: Thief com
 * adaga em cada mão) muda quantos `WeaponAttachment` montam, não quantos
 * hooks um componente chama, então não fere a regra dos hooks.
 */
export function EquippedWeapons({
  scene,
  weapons,
  gid,
}: {
  scene: THREE.Group;
  weapons: readonly WeaponMount[];
  /** dono no mundo (ver `WeaponAttachment`) — omitir em usos de retrato/UI */
  gid?: number;
}) {
  return (
    <>
      {weapons.map((w) => (
        <WeaponAttachment key={w.slot} scene={scene} weapon={w.weapon} slot={w.slot} rotation={w.rotation} gid={gid} />
      ))}
    </>
  );
}
