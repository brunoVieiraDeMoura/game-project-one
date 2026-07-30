/**
 * "Voltar ao norte" da câmera — dois cliques com o botão direito, como no RO.
 *
 * Mora fora do componente porque é conta pura: a `FollowCamera` importa o store
 * do jogo (que toca `window` no modo DEV) e não carrega em teste de nó.
 */

/**
 * Azimute que deixa o NORTE à frente da tela.
 *
 * A câmera fica em `alvo + r·(sin az, …, cos az)` e olha para o alvo, então com
 * `az = 0` ela está no lado +z olhando para −z. O norte é +z — no rAthena a
 * coordenada y cresce para o norte, e `squareToWorld` manda row para z —, logo
 * olhar para o norte é `az = π`.
 */
export const NORTH_AZIMUTH = Math.PI;

/** janela do duplo-clique (ms) */
export const DOUBLE_CLICK_MS = 400;
/** folga de arrasto (px somados) que ainda conta como clique, não como giro */
export const CLICK_SLOP_PX = 4;

/** fração do caminho percorrida por frame ao voltar ao norte */
export const SNAP_EASE = 0.18;

/**
 * Menor giro que leva de `de` a `para` (em radianos, no intervalo (−π, π]).
 *
 * Girar pela diferença crua daria a volta por trás quando os ângulos estão em
 * lados opostos do círculo — e a câmera passaria atravessando o personagem.
 */
export function shortestTurn(de: number, para: number): number {
  return ((((para - de + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}
