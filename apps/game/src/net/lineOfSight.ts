/**
 * Linha de visão entre dois pontos, contra o RELEVO real do mapa — não a
 * distância, que é a única coisa que `dentroDoAlcance` já garante.
 *
 * Mesmo desenho do `play/cameraCollision.raioLivre`: função pura, marcha ao
 * longo de um segmento amostrando `getHeight` (o `TerrainQuery.getHeight` de
 * verdade, ou um dublê no teste), sem saber nada de cena ou de React. Aqui a
 * marcha é entre OLHO e OLHO (não câmera e chão): se o chão, em algum ponto do
 * meio, ultrapassa a reta entre os dois olhos por mais que `margem`, há
 * montanha no caminho e a linha está bloqueada.
 *
 * `margem` existe para não confundir relevo de verdade com o ruído normal do
 * terreno (uma pedra, uma leve ondulação) — motivo do pedido: alvo em terreno
 * aberto ou atrás de um degrau pequeno não pode ficar "invisível" por acidente.
 */
export function linhaDeVisaoLivre(
  origem: { x: number; y: number; z: number },
  destino: { x: number; y: number; z: number },
  getHeight: (x: number, z: number) => number,
  margem: number,
  passos: number,
): boolean {
  for (let i = 1; i < passos; i++) {
    const t = i / passos;
    const x = origem.x + (destino.x - origem.x) * t;
    const z = origem.z + (destino.z - origem.z) * t;
    const yLinha = origem.y + (destino.y - origem.y) * t;
    if (getHeight(x, z) > yLinha + margem) return false;
  }
  return true;
}
