import { shortestTurn } from "../play/cameraNorth";

/**
 * Um passo de giro suave em direção ao alvo do cast, só no eixo Y.
 *
 * Mesma conta que a câmera já usa para "voltar ao norte" (`shortestTurn`,
 * `play/cameraNorth.ts`): girar pela diferença crua entre ângulos daria a
 * volta por trás quando o alvo está do lado oposto do círculo, e o
 * personagem giraria pelo caminho errado por um instante. Aqui só se troca o
 * alvo do giro (um azimute fixo lá, o rumo até o alvo do cast aqui) e o efeito
 * (ângulo da câmera lá, `model.rotation.y` aqui).
 *
 * `dx`/`dz` são a diferença de posição MUNDO (alvo − eu) no plano XZ; `null`
 * quando o alvo está praticamente em cima do personagem (ângulo indefinido) —
 * quem chama mantém a rotação como estava.
 */
export function passoDeGiroParaAlvo(rotacaoAtual: number, dx: number, dz: number, ease: number): number | null {
  if (dx * dx + dz * dz < 1e-6) return null;
  const alvoAngulo = Math.atan2(dx, dz);
  return rotacaoAtual + shortestTurn(rotacaoAtual, alvoAngulo) * ease;
}
