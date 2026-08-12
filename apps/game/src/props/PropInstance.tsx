import { useLayoutEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type * as THREE from "three";
import type { MapProp } from "@ragnarok/map-format";
import { propUrl, propCategory } from "./registry";
import { compartilharTexturas } from "../gltfTexturas";
import { windCategoryFor, windMaterialFor } from "./wind";
import { isolado } from "../core/diagnostics/isolamento";

/**
 * Uma instância de prop do mapa (skill-r3f-conventions: componente = entidade,
 * resolvido por registry). Clona a cena do glTF (várias instâncias do mesmo
 * asset sem compartilhar transform) e aplica position/rotation/scale do
 * GameMap.props. Collider opcional conforme colliderType.
 *
 * ATENÇÃO: quem barra o personagem NUNCA foi um corpo de física. Player,
 * monstros e NPCs andam pelo MovementController (engine-core), que só consulta
 * TerrainQuery — o bloqueio de verdade é o footprint em `hex/hexTerrainQuery`
 * (e, online, o servidor). `colliderType` continua existindo e continua sendo
 * lido pela query e pelo exportador de `map_cache`; o que saiu daqui foi o
 * `RigidBody` do Rapier, que era corpo de física para uma física que ninguém
 * simula.
 *
 * Ele custava caro no lugar errado: montar um collider `hull` acontece no
 * instante em que o prop ENTRA no culling, ou seja, exatamente enquanto o
 * jogador anda — cada árvore nova era um pico de CPU no meio do movimento.
 */
export function PropInstance({ prop }: { prop: MapProp }) {
  const url = propUrl(prop.assetId);
  const gltf = url ? useGLTF(url) : null;
  // vento (seção 1 do pedido): só grama/arbusto/árvore, e só se não isolado
  // por `?iso=semVento` — ver `props/wind.ts`
  const windCat = windCategoryFor(propCategory(prop.assetId));

  const scene = useMemo(() => {
    if (!gltf) return null;
    /**
     * ANTES do clone, e na cena do CACHE — ver `gltfTexturas`.
     *
     * Cada `.gltf` do pacote Forest traz sua própria entrada para
     * `forest_texture.png`, então o `GLTFLoader` cria um `THREE.Texture` por
     * arquivo: o censo do `prt_fild08` mediu **225 MB de textura para 5,33 MB de
     * conteúdo**, ~42 cópias da mesma imagem de 48 KB. Deduplicar aqui, uma vez
     * por url, faz todas as espécies passarem a apontar para a mesma.
     */
    // o GLTF INTEIRO, não só a cena: a identidade da imagem vem do
    // `parser.associations`, porque `image.src` não existe num `ImageBitmap`
    compartilharTexturas(gltf as never);
    const clone = gltf.scene.clone(true);
    const vento = windCat && !isolado("semVento") ? windCat : null;
    clone.traverse((o) => {
      const m = o as THREE.Mesh & { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean };
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        // troca o material pela versão com vento (cacheada por espécie —
        // ver `windMaterialFor`); resto (pedra, construção…) passa intacto
        if (vento) {
          m.material = Array.isArray(m.material)
            ? m.material.map((mm) => windMaterialFor(mm, m.geometry, prop.assetId, vento))
            : windMaterialFor(m.material, m.geometry, prop.assetId, vento);
        }
      }
      /**
       * PROP NÃO SE MOVE — os filhos param de recompor matriz por quadro.
       *
       * `matrixAutoUpdate` é `true` por padrão no three, e com ele todo nó
       * chama `updateMatrix()` (ou seja, `compose()`) a CADA quadro. As
       * transformações internas de um `.gltf` de árvore são constantes desde o
       * arquivo: compor uma vez basta.
       *
       * Medido no perfil de produção: `updateMatrixWorld` custa **1,11 ms por
       * quadro** (186,9 ms em ~168 quadros), e os props são a maior população
       * de nós da cena — 278 dentro do culling, com várias malhas cada.
       *
       * **Isto corta METADE do custo, não ele todo, e vale saber por quê.** O
       * `updateMatrixWorld` do three faz duas coisas por nó: `updateMatrix()`
       * (o `compose` local, que é o que se elimina aqui) e a multiplicação pela
       * matriz do pai. A segunda continua acontecendo porque a RAIZ da cena tem
       * `matrixAutoUpdate` ligado: ela recompõe a própria matriz todo quadro,
       * marca `matrixWorldNeedsUpdate` e isso vira `force = true` para a árvore
       * inteira. No perfil, `compose` + `updateMatrix` somam ~94 ms dos 187, e é
       * essa parte que sai. Desligar o automático na raiz levaria a outra
       * metade, mas é uma mudança global — fica para depois de medir esta.
       *
       * A raiz fica de FORA deste laço: quem escreve a transform dela é o R3F,
       * depois do commit, e desligar aqui congelaria o prop na origem. Ela é
       * tratada no efeito abaixo.
       */
      if (o !== clone) {
        o.updateMatrix();
        o.matrixAutoUpdate = false;
      }
    });
    return clone;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `prop.assetId`/`vento` decidem o material, mas isolamento e espécie não
    // trocam vivos num prop já montado (mesma convenção do resto do arquivo)
  }, [gltf]);

  /**
   * A RAIZ, depois de o R3F ter aplicado `position`/`rotation`/`scale`.
   *
   * `useLayoutEffect` e não `useEffect`: o efeito de layout roda no mesmo
   * commit, antes do primeiro quadro pintado — num efeito comum o prop
   * apareceria na origem por um quadro.
   *
   * A ordem importa: `updateMatrix()` PRIMEIRO (compõe com a transform já
   * escrita) e só então desligar o automático. Invertido, a matriz nunca seria
   * composta e o prop ficaria em 0,0,0 para sempre.
   */
  useLayoutEffect(() => {
    const o = scene;
    if (!o) return;
    o.matrixAutoUpdate = true;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    // a matriz de MUNDO ainda precisa ser recomposta uma vez a partir do pai
    o.matrixWorldNeedsUpdate = true;
  }, [scene, prop.position, prop.rotation, prop.scale]);

  if (!scene) return null; // assetId desconhecido — silenciosamente omitido (editor valida)

  return <primitive object={scene} position={prop.position} rotation={prop.rotation} scale={prop.scale} />;
}
