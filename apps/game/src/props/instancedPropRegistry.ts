import type * as THREE from "three";
import type { MapProp } from "@ragnarok/map-format";

/**
 * PONTE entre `InstancedMesh` e `MapProp` — o que o raycast de
 * `play/GroundInteract.tsx` precisa pra saber QUAL prop foi clicado.
 *
 * Um `THREE.Mesh` normal carrega sua própria posição no `Object3D` — o clique
 * (`play/pickGround.ts: baseDoProp`) sobe até a raiz e tira `Box3.setFromObject`.
 * Um `InstancedMesh` não tem isso: `intersectObject` devolve a malha INTEIRA (uma
 * só, pra todas as instâncias) mais um `instanceId` (índice do slot atingido). Sem
 * este registro não haveria como voltar do slot pro `MapProp` de verdade — o
 * clique acertaria a espécie certa, mas não a árvore certa.
 *
 * `VegetationInstancer` escreve este mapa toda vez que reescreve as matrizes de
 * instância (na mesma cadência de `center`, nunca por quadro) — o array fica na
 * MESMA ORDEM dos slots 0..count que `setMatrixAt` usou, então `instanceId` indexa
 * direto nele.
 */
const propsPorInstancedMesh = new WeakMap<THREE.InstancedMesh, readonly MapProp[]>();

export function registrarInstancias(mesh: THREE.InstancedMesh, props: readonly MapProp[]): void {
  propsPorInstancedMesh.set(mesh, props);
}

/** o `MapProp` por trás do slot `instanceId` desta malha — `undefined` se a malha não é gerenciada aqui ou o índice está fora do intervalo escrito */
export function propDaInstancia(mesh: THREE.InstancedMesh, instanceId: number): MapProp | undefined {
  return propsPorInstancedMesh.get(mesh)?.[instanceId];
}

/** true só quando o objeto É um `InstancedMesh` conhecido por este registro (guarda de tipo pro chamador) */
export function ehInstancedMeshGerenciado(obj: unknown): obj is THREE.InstancedMesh {
  return !!obj && typeof obj === "object" && (obj as { isInstancedMesh?: boolean }).isInstancedMesh === true;
}
