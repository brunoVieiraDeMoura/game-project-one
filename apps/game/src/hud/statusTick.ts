/**
 * Relógio ÚNICO pro contador de duração dos ícones de status — pedido
 * explícito 2026-08-14 ("NÃO criar requestAnimationFrame por debuff"):
 * antes, CADA `StatusEffectIcon` com timer agendava o próprio
 * `requestAnimationFrame`, então N monstros × M debuffs viravam N×M loops
 * independentes. Aqui existe UM só `requestAnimationFrame` rodando (nasce no
 * primeiro inscrito, morre quando o último se desinscreve) que chama todo
 * mundo inscrito a cada quadro — custo não cresce com quantidade de ícones
 * além de percorrer o `Set`.
 */
const ouvintes = new Set<() => void>();
let rafId = 0;

function passo() {
  for (const fn of ouvintes) fn();
  rafId = ouvintes.size > 0 ? requestAnimationFrame(passo) : 0;
}

/** inscreve `fn` pra rodar todo quadro enquanto o timer estiver ativo; a
 * função de limpeza desinscreve. Chamar dentro de `useEffect`. */
export function subscribeStatusTick(fn: () => void): () => void {
  ouvintes.add(fn);
  if (rafId === 0) rafId = requestAnimationFrame(passo);
  return () => ouvintes.delete(fn);
}
