import * as THREE from "three";

/**
 * Registro gid → ponta da arma equipada, escrito por `EquippedWeapons`
 * (o único lugar que já sabe montar a arma no handslot certo) e lido por VFX
 * que precisam nascer "na ponta do cajado/espada" em vez de flutuar solto
 * sobre a entidade.
 *
 * O objeto registrado é um `THREE.Object3D` REAL, filho da própria arma
 * (ver `EquippedWeapons.tsx: tipAnchor`) — herda a matriz mundial pelo grafo
 * de cena normal, então `anchor.getWorldPosition(vetor)` já vem com pose de
 * idle/andar/conjurar embutida, sem duplicar animação nenhuma aqui. Não é
 * reativo (zustand): a posição muda every frame, o mesmo motivo por que o
 * resto do projeto nunca guarda transform por quadro numa store.
 */
const anchors = new Map<number, THREE.Object3D>();

/** chamar do `useLayoutEffect` de `WeaponAttachment` — devolve a função de limpeza */
export function registrarAnchorDeArma(gid: number, anchor: THREE.Object3D): () => void {
  anchors.set(gid, anchor);
  return () => {
    // só remove se for ESTE registro — um remount rápido (StrictMode) pode
    // registrar o próximo antes do cleanup do anterior rodar
    if (anchors.get(gid) === anchor) anchors.delete(gid);
  };
}

export function anchorDeArma(gid: number): THREE.Object3D | undefined {
  return anchors.get(gid);
}
