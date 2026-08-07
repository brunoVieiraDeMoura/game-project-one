/**
 * Raio LIVRE de relevo para a câmera de terceira pessoa.
 *
 * Sem isto, orbitar do lado de uma montanha punha a câmera por DENTRO dela: o
 * chão é sólido só do lado de fora, então virar a câmera para lá mostrava o
 * miolo do relevo em vez do mundo. `raioLivre` marcha de fora (`r`, o raio
 * pedido pelo zoom) para dentro (`rMin`, o piso do zoom manual) e devolve o
 * PRIMEIRO raio — o mais distante possível — em que o ponto da órbita fica
 * acima do chão amostrado ali.
 *
 * Função pura, separada de `FollowCamera` para poder testar sem canvas: ela só
 * lê `getHeight` (o `TerrainQuery.getHeight` de verdade, ou um dublê no
 * teste).
 */
export function raioLivre(
  centro: { x: number; y: number; z: number },
  azimute: number,
  pitch: number,
  r: number,
  rMin: number,
  margem: number,
  getHeight: (x: number, z: number) => number,
  passos = 8,
): number {
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  for (let i = passos; i >= 0; i--) {
    const rr = rMin + (r - rMin) * (i / passos);
    const cx = centro.x + rr * cosP * Math.sin(azimute);
    const cz = centro.z + rr * cosP * Math.cos(azimute);
    const cy = centro.y + rr * sinP;
    if (cy > getHeight(cx, cz) + margem) return rr;
  }
  return rMin;
}
