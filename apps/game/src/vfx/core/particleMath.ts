/**
 * Higiene arquitetural (Fase 5, item 2 do pedido do usuário — "não é a
 * principal otimização de performance do projeto, é consolidação") — a
 * MESMA fórmula de RNG determinístico (LCG simples) estava duplicada
 * textualmente em 17 lugares (12 arquivos: 11 skills + `ParticleRenderer.ts`,
 * confirmado por grep na auditoria da Fase 5). Consolidar aqui não muda
 * NENHUM resultado visual — mesmo `seed` produz exatamente a MESMA
 * sequência de números que cada cópia produzia antes.
 *
 * Puro, sem dependência de renderer nenhum — pode ser chamado tanto por
 * arte DOM quanto por um `VfxRenderer` GPU futuro, é só matemática.
 */
export function createSeededRng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}
