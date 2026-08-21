/**
 * Relógio ÚNICO pra toda animação por-quadro do HUD.
 *
 * Nasceu como `statusTick.ts` (pedido explícito 2026-08-14, "NÃO criar
 * `requestAnimationFrame` por debuff": N monstros × M debuffs viravam N×M
 * loops independentes). T7 (`docs/otimizacao-heuristicas.md`) generalizou
 * pro MESMO problema em outro lugar: `CastBar`, `Cooldown` (um por SLOT de
 * skill em recarga — o pior caso, N cooldowns simultâneos = N loops),
 * `Minimap`, `MapWindow` e o brilho da skill escolhida (`SkillsWindow`)
 * tinham CADA UM o próprio `requestAnimationFrame`. Com várias janelas
 * abertas e skills recarregando, era comum meia dúzia de loops rodando ao
 * mesmo tempo, todos fazendo a mesma pergunta ao navegador.
 *
 * UM só `requestAnimationFrame` (nasce no primeiro inscrito, morre quando o
 * último se desinscreve) varre o `Set` de assinantes a cada quadro do
 * navegador — custo não cresce com quantidade de assinantes além de
 * percorrer o `Set`, mesmo princípio de `statusTick.ts` original.
 *
 * ## Taxa por assinante
 *
 * `Minimap`/`MapWindow` já limitavam a própria redesenho (12fps/20fps —
 * "cada passada refaz `interpolatedCell` de TODA entidade e um `drawImage`
 * da janela inteira; a 12fps nada se perde, um mob anda uma célula a cada
 * ~200ms") com um `now - ultimoDesenho < intervalo` manual dentro do próprio
 * loop. Isso vira só o parâmetro `hz` aqui — o relógio compartilhado faz a
 * conta, e o `loop`/`passo` de cada um perde a própria guarda.
 *
 * `hz` não usa a mesma convenção de `core/importancia.ts` (lá `0` = nunca
 * atualiza, é sobre VISIBILIDADE). Aqui o padrão (`hz` omitido ou `>= 60`)
 * significa "sem throttle, roda todo quadro do navegador" — o
 * comportamento de `requestAnimationFrame` cru, que é o que a maioria dos
 * assinantes quer (CastBar, Cooldown, brilho da skill escolhida, ícone de
 * status). Só quem pede uma taxa EXPLICITAMENTE menor paga o acumulador.
 */

interface Assinante {
  fn: () => void;
  /** `0` = sem throttle, roda toda vez que `passo` roda */
  intervaloMs: number;
  acumuladoMs: number;
}

const assinantes = new Set<Assinante>();
let rafId = 0;
/** `-1` = ainda não rodou nenhum quadro desde o último (re)início — NUNCA
 * `0`: `agoraMs` (o timestamp que o `requestAnimationFrame` passa) pode
 * legitimamente valer `0` logo no início da página, e usar `0` como
 * sentinela confundiria esse quadro real com "primeiro quadro". */
let ultimoMs = -1;

function passo(agoraMs: number) {
  // primeiro quadro depois de (re)começar: sem `dt` de referência ainda —
  // um `dt` gigante aqui (tempo parado desde o último assinante sair)
  // dispararia todo mundo com throttle na hora, de uma vez
  const dt = ultimoMs < 0 ? 0 : agoraMs - ultimoMs;
  ultimoMs = agoraMs;
  for (const a of assinantes) {
    if (a.intervaloMs > 0) {
      a.acumuladoMs += dt;
      if (a.acumuladoMs < a.intervaloMs) continue;
      // reseta pro PRÓXIMO `agoraMs`, não subtrai o intervalo — mesma
      // semântica que `Minimap`/`MapWindow` já tinham (`ultimoDesenho =
      // now`), que não tenta recuperar quadros perdidos depois de uma
      // pausa longa (aba em segundo plano) numa rajada.
      a.acumuladoMs = 0;
    }
    a.fn();
  }
  rafId = assinantes.size > 0 ? requestAnimationFrame(passo) : 0;
}

/**
 * Inscreve `fn` pra rodar no relógio compartilhado do HUD, na taxa `hz`
 * (default/`>= 60` = todo quadro do navegador, sem throttle). A função de
 * limpeza desinscreve. Chamar dentro de `useEffect`.
 */
export function subscribeHudTick(fn: () => void, hz = 60): () => void {
  const a: Assinante = { fn, intervaloMs: hz > 0 && hz < 60 ? 1000 / hz : 0, acumuladoMs: 0 };
  assinantes.add(a);
  if (rafId === 0) {
    ultimoMs = -1;
    rafId = requestAnimationFrame(passo);
  }
  return () => assinantes.delete(a);
}
