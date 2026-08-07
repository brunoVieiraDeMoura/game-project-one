import * as THREE from "three";
import type { TerrainQuery } from "@ragnarok/engine-core";

/**
 * Qual ponto o mouse está mesmo apontando no chão.
 *
 * Tanto o editor quanto o `/play` põem um PLANO invisível em y≈0 sob o mapa para
 * capturar clique em qualquer lugar. Com terreno de altura — parede que sobe,
 * ravina que afunda, relevo pintado à mão — esse plano e o topo da célula são
 * pontos diferentes, e quanto mais inclinada a câmera, maior a distância entre
 * eles.
 *
 * Dois jeitos de errar, os dois já observados:
 *
 *  1. usar `e.point` num handler registrado no GRUPO: sem `stopPropagation`, o
 *     R3F chama o handler UMA VEZ POR OBJETO atingido, do mais próximo ao mais
 *     distante. A última chamada é a do plano de baixo, e é ela que fica — o
 *     cursor "seguia a referência da square de baixo, não a de cima";
 *  2. projetar o raio no plano y=0 por conta própria (o que o arrasto fazia):
 *     ignora a altura por construção.
 *
 * A regra certa é uma linha: vale a interseção MAIS PRÓXIMA da câmera.
 */

/** nome do grupo que embrulha a malha do terreno na cena do editor */
export const TERRAIN_GROUP = "editor-terrain";

/** folga acima do chão pra não brigar com o z-fighting do topo do tile */
export const LIFT = 0.06;

/** subdivisões do marcador de destino por lado: mais que isso é gasto sem ganho */
export const MARKER_SEGS = 6;

/**
 * Sobe do objeto atingido até o filho DIRETO do grupo — a raiz daquele prop,
 * cuja origem é o pé dele no chão.
 *
 * O raycast devolve a malha da folhagem, que pode estar vários nós abaixo (um
 * .gltf traz `Scene` → nós → malhas). Sem subir até a raiz, o alvo do clique
 * seria o ponto onde a copa foi atingida — e mirar a copa de uma árvore escalada
 * 5× mandava o marcador para uma célula longe do tronco.
 */
export function raizDoProp(atingido: THREE.Object3D, grupo: THREE.Object3D | undefined): THREE.Object3D | null {
  if (!grupo) return null;
  let atual: THREE.Object3D | null = atingido;
  while (atual && atual.parent && atual.parent !== grupo) atual = atual.parent;
  return atual && atual.parent === grupo ? atual : null;
}

/**
 * Eixo do prop no chão: o centro HORIZONTAL da caixa que o envolve.
 *
 * Não serve pegar a posição do nó raiz: medido na cena, o filho direto do grupo é
 * um `Object3D` vazio na ORIGEM e a translação mora no nó `Scene` de dentro do
 * .gltf — usar a raiz mandava o alvo para a célula (0,0), a 331 células de
 * distância. O centro em XZ da caixa é o tronco para qualquer estrutura interna,
 * e é estável: props não andam no `/play`, então o valor é memoizado por objeto.
 */
const centroDoProp = new WeakMap<THREE.Object3D, { x: number; z: number }>();
const caixaAux = new THREE.Box3();

export function baseDoProp(
  atingido: THREE.Object3D,
  grupo: THREE.Object3D | undefined,
): { x: number; z: number } | null {
  const raiz = raizDoProp(atingido, grupo);
  if (!raiz) return null;
  const memo = centroDoProp.get(raiz);
  if (memo) return memo;
  caixaAux.setFromObject(raiz);
  if (!Number.isFinite(caixaAux.min.x)) return null; // subárvore sem geometria
  const centro = {
    x: (caixaAux.min.x + caixaAux.max.x) / 2,
    z: (caixaAux.min.z + caixaAux.max.z) / 2,
  };
  centroDoProp.set(raiz, centro);
  return centro;
}

/**
 * Molda uma malha plana (marcador, prévia de skill) na superfície: cada
 * vértice recebe a altura do terreno naquele ponto.
 *
 * Um quad plano só encosta no chão onde a altura bate com a do centro; numa rampa
 * ou no lombo de um morro ele afunda de um lado e espeta do outro — e como o
 * resto da malha continua no plano velho, o quadrado (ou disco) parece sumir pela
 * metade. A geometria é reescrita em coordenada de MUNDO (o mesh fica na
 * origem), o que evita desfazer a transformação do objeto a cada frame.
 *
 * `terrain` é o mesmo `TerrainQuery` que o movimento consulta — a malha não pode
 * discordar do chão em que o personagem pisa.
 */
export function moldarMalhaTerreno(
  geo: THREE.BufferGeometry,
  cx: number,
  cz: number,
  raio: number,
  segs: number,
  altura: number,
  terrain: TerrainQuery,
): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const passo = (raio * 2) / segs;
  let v = 0;
  for (let r = 0; r <= segs; r++) {
    for (let c = 0; c <= segs; c++) {
      const x = cx - raio + c * passo;
      const z = cz - raio + r * passo;
      pos.setXYZ(v++, x, terrain.getHeight(x, z) + altura, z);
    }
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}

/** o marcador de destino, na subdivisão e altura dele (ver `moldarMalhaTerreno`) */
export function moldarMarcador(
  geo: THREE.BufferGeometry,
  cx: number,
  cz: number,
  raio: number,
  terrain: TerrainQuery,
): void {
  moldarMalhaTerreno(geo, cx, cz, raio, MARKER_SEGS, LIFT, terrain);
}

export interface Hit {
  distance: number;
  point: { x: number; y: number; z: number };
}

/** o objeto que o raio acertou (só o que este módulo precisa saber dele) */
export interface HitComObjeto extends Hit {
  object: THREE.Object3D;
}

/**
 * A interseção mais próxima da câmera, ou `null` se a lista está vazia.
 *
 * Não assume que a lista venha ordenada: o three ordena, mas depender disso
 * silenciosamente é o tipo de coisa que quebra quando alguém filtra a lista.
 */
export function nearestHit<T extends Hit>(hits: readonly T[]): T | null {
  let melhor: T | null = null;
  for (const h of hits) {
    if (!Number.isFinite(h.distance)) continue;
    if (!melhor || h.distance < melhor.distance) melhor = h;
  }
  return melhor;
}

/** ponto (x,z) do topo apontado; cai no `fallback` quando não houve interseção */
export function topmostXZ(
  hits: readonly Hit[],
  fallback: { x: number; z: number },
): { x: number; z: number } {
  const h = nearestHit(hits);
  return h ? { x: h.point.x, z: h.point.z } : fallback;
}
