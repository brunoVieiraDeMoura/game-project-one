import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * O que fazer com um personagem do KayKit ANTES de clonar, e ao descartá-lo.
 *
 * Os dois problemas daqui saem do mesmo fato, medido nos .glb: cada personagem
 * do kit é **nove malhas skinadas** (braços, pernas, corpo, capa, cabeça, elmo,
 * viseira) sobre **uma única skin**.
 *
 *  • `SkeletonUtils.clone` cria um `THREE.Skeleton` NOVO por SkinnedMesh
 *    (`clonedMesh.skeleton = sourceMesh.skeleton.clone()`), e cada `Skeleton`
 *    aloca um `boneTexture` na primeira vez que é desenhado. Nove por mob que
 *    nasce — e nada os liberava, porque só `Skeleton.dispose()` o faz. Era o
 *    vazamento medido no F9: 4.042 texturas vivas contra 5 referenciadas pela
 *    cena, subindo ~1,8/s com `area_size: 60`;
 *  • nove malhas são nove draw calls e nove uploads de bone texture POR MOB,
 *    POR QUADRO. Com ~25 mobs à vista, ~225 de cada.
 *
 * Como todas compartilham a skin, o mesmo `bindMatrix` e o mesmo conjunto de
 * atributos, elas podem virar UMA malha por material — o `Knight` tem um
 * material só, o `Skeleton_Warrior` tem dois (o corpo e o `Glow` dos olhos).
 */

/** cenas já fundidas — o `useGLTF` cacheia por url e a fusão é uma vez só */
const jaFundidas = new WeakSet<THREE.Object3D>();

/**
 * Funde as malhas skinadas de um personagem, agrupadas por material.
 *
 * **Muta a cena do cache do `useGLTF` de propósito**, e antes de qualquer clone:
 * fundir depois, em cada clone, pagaria a fusão por entidade que nasce, que é o
 * oposto do que se quer. É idempotente (o `WeakSet` acima), então o StrictMode
 * chamando duas vezes não faz diferença.
 *
 * Só funde o que é seguro fundir. Se qualquer premissa falhar — esqueleto
 * diferente, `bindMatrix` diferente, transformação de mundo diferente, morph
 * target, conjunto de atributos diferente — aquele grupo fica como está. Uma
 * malha a mais custa um draw call; uma fusão errada deforma o personagem.
 */
export function fundirSkinned(raiz: THREE.Object3D): void {
  if (jaFundidas.has(raiz)) return;
  jaFundidas.add(raiz);

  const malhas: THREE.SkinnedMesh[] = [];
  raiz.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) malhas.push(o as THREE.SkinnedMesh);
  });
  if (malhas.length < 2) return;

  // agrupa por material; material em ARRAY (multi-material) fica de fora, porque
  // aí a malha já usa grupos de geometria e fundir exigiria remapeá-los
  const porMaterial = new Map<string, THREE.SkinnedMesh[]>();
  for (const m of malhas) {
    if (Array.isArray(m.material)) continue;
    const grupo = porMaterial.get(m.material.uuid);
    if (grupo) grupo.push(m);
    else porMaterial.set(m.material.uuid, [m]);
  }

  for (const grupo of porMaterial.values()) {
    if (grupo.length < 2) continue;
    const primeira = grupo[0]!;
    if (!podemFundir(grupo)) continue;

    const geometrias = grupo.map((m) => m.geometry);
    const fundida = mergeGeometries(geometrias, false);
    // `mergeGeometries` devolve null quando os atributos não batem — a checagem
    // acima já cobre isso, mas o retorno é a palavra final
    if (!fundida) continue;

    const nova = new THREE.SkinnedMesh(fundida, primeira.material as THREE.Material);
    nova.name = primeira.name;
    nova.castShadow = primeira.castShadow;
    nova.receiveShadow = primeira.receiveShadow;
    nova.frustumCulled = primeira.frustumCulled;
    nova.matrixAutoUpdate = primeira.matrixAutoUpdate;
    nova.position.copy(primeira.position);
    nova.quaternion.copy(primeira.quaternion);
    nova.scale.copy(primeira.scale);
    // MESMO esqueleto e MESMO bindMatrix das originais: é isso que faz a pose
    // continuar idêntica. O `SkeletonUtils.clone` cuida de reapontar para os
    // ossos do clone depois.
    nova.bind(primeira.skeleton, primeira.bindMatrix);

    primeira.parent?.add(nova);
    for (const m of grupo) {
      m.removeFromParent();
      // as geometrias originais só existiam aqui: nada mais as referencia depois
      // da fusão, e mantê-las seria segurar memória de GPU à toa. O MATERIAL
      // fica — a malha nova usa exatamente ele.
      m.geometry.dispose();
    }
  }
}

/** todas as premissas que a fusão exige, conferidas em vez de assumidas */
function podemFundir(grupo: THREE.SkinnedMesh[]): boolean {
  const primeira = grupo[0]!;
  const chaveAttrs = (g: THREE.BufferGeometry) => Object.keys(g.attributes).sort().join(",");
  const attrs = chaveAttrs(primeira.geometry);
  for (const m of grupo) {
    if (m.skeleton !== primeira.skeleton) return false;
    if (!m.bindMatrix.equals(primeira.bindMatrix)) return false;
    if (!m.matrix.equals(primeira.matrix)) return false;
    if (m.morphTargetInfluences?.length) return false;
    if (chaveAttrs(m.geometry) !== attrs) return false;
  }
  return true;
}

/**
 * Devolve o que um clone de personagem alocou.
 *
 * O que se descarta aqui é APENAS o que é do clone: os `Skeleton` que o
 * `SkeletonUtils.clone` criou, um por SkinnedMesh, cada um com um `boneTexture`
 * pendurado. Geometria e material NÃO entram — eles vêm do cache do `useGLTF` e
 * são compartilhados com todas as outras entidades; descartá-los apagaria os
 * outros mobs da tela.
 *
 * Devolve quantos esqueletos foram liberados, que é o que o teste de orçamento
 * afirma (a invariante de contagem é o que pega a causa; o vazamento em si só
 * aparece no F9, com WebGL vivo).
 */
export function descartarPersonagem(raiz: THREE.Object3D): number {
  let liberados = 0;
  raiz.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.skeleton) return;
    m.skeleton.dispose();
    liberados++;
  });
  return liberados;
}
