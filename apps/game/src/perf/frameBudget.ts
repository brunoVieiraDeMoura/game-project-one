/**
 * FrameBudget — livro-caixa passivo do orçamento de um quadro, NÃO um
 * gerente. Pedido explícito do usuário (`leia1.txt`, duas rodadas):
 *
 *     ✅ FrameBudget (livro-caixa)          ❌ GlobalManager (centralizado demais)
 *        beginFrame()                          controla terrain
 *        consume(ms) / remaining()             controla VFX
 *        shouldDegrade(priority)                controla entity
 *                                               controla network/gameplay
 *
 * A diferença é quem decide: este módulo NUNCA importa `SquareTerrain`,
 * `vfx/core/manager`, `moveTarget` ou qualquer subsistema — a dependência é
 * sempre SUBSISTEMA → `FrameBudget`, nunca o contrário (travado pelo teste
 * de guarda em `frameBudget.test.ts`, que lê o PRÓPRIO código-fonte deste
 * arquivo). Ele não agenda, não executa, não prioriza, não interrompe e não
 * comanda ninguém — só responde um número e um booleano; a decisão de o QUE
 * fazer com a resposta continua 100% do lado de quem perguntou, exatamente
 * como o terreno hoje decide sozinho parar de construir chunk aos 6 ms
 * (`grid/SquareTerrain.tsx: ORCAMENTO_MS`).
 *
 * ## `consume()` não é `reservar()`
 *
 * `consume(ms)` registra custo JÁ MEDIDO de trabalho JÁ FEITO — nunca uma
 * promessa. Não existe `reservar()`/`Reserva` aqui: os três consumidores
 * previstos (terreno, `moveTarget`, VFX) já trabalham em looping
 * "constrói-a-unidade → mede → decide se continua" (ver `SquareTerrain.tsx:
 * while (... performance.now() - t0 < orcamentoMs)`), então cada um só
 * precisa PERGUNTAR quanto sobrou entre uma unidade e outra — nenhum deles
 * precisa prometer um gasto futuro antes de fazer o trabalho. Regra do
 * pedido: se a reserva não é necessária, ela não nasce — API mínima ganha
 * de API completa. Se um consumidor futuro precisar mesmo de reserva
 * (prometer ms antes de gastar), ela ganha um tipo e um nome PRÓPRIOS,
 * nunca reaproveita `consume()` pra isso.
 *
 * ## Estado explícito, não singleton
 *
 * `FrameBudgetState` é um objeto simples que o CHAMADOR possui e passa
 * adiante — não um módulo com estado escondido. Isso é o que torna
 * "dependência num sentido só" verificável de verdade: se fosse um
 * singleton importado, qualquer subsistema que o importasse já estaria
 * acoplado a UM relógio global compartilhado por referência oculta. Assim,
 * quem cria o estado (o `useFrame` raiz que decide "começou um quadro
 * novo") e quem consulta são explícitos nos dois lados.
 */

export interface FrameBudgetState {
  totalMs: number;
  usedMs: number;
}

/** zera/inicia o orçamento deste quadro — não dispara trabalho de ninguém,
 * só devolve o estado com que os outros três métodos são chamados. */
export function beginFrame(totalMs: number): FrameBudgetState {
  return { totalMs: Math.max(0, totalMs), usedMs: 0 };
}

/** registra custo JÁ MEDIDO de trabalho JÁ FEITO. Nunca uma estimativa,
 * nunca uma intenção — ver docblock do módulo. `ms` negativo é tratado como
 * 0 (nunca DEVOLVE orçamento; um cronômetro não pode medir tempo negativo,
 * e se medir é erro de quem chamou, não deste livro-caixa). */
export function consume(state: FrameBudgetState, ms: number): void {
  state.usedMs += Math.max(0, ms);
}

/** quanto ainda há disponível — nunca negativo (trabalho que já estourou o
 * orçamento não "deve" tempo ao próximo quadro; `beginFrame` zera de novo). */
export function remaining(state: FrameBudgetState): number {
  return Math.max(0, state.totalMs - state.usedMs);
}

/**
 * Prioridade de um consumidor — MESMA convenção de `vfx/core/budget.ts`
 * (`PRIORITY_RANK`): **menor = mais importante**. `0` é reservado pro que
 * nunca pode degradar (equivalente ao "own" do VFX).
 */
export type FrameBudgetPriority = number;

/**
 * *Informa* se o chamador deveria degradar, dado o restante e a prioridade
 * recebida — não degrada nada sozinho, não sabe o que "degradar" significa
 * pra quem perguntou.
 *
 * Regra mínima, deliberadamente sem curva calibrada (mesma disciplina de
 * `vfx/core/lod.ts`: não inventar número sem dado — mas aqui o "número" é
 * mecânico, não visual, então a regra em si pode ser honesta sem
 * benchmark): prioridade `0` NUNCA degrada, mesmo com o orçamento
 * inteiramente gasto — é o equivalente a "own" no VFX. Qualquer prioridade
 * `> 0` degrada quando `remaining() <= 0`. Não há hoje uma faixa
 * intermediária ("degrada um pouco antes de zerar, se a prioridade for
 * baixa o bastante") porque isso exigiria uma curva arbitrária sem dado
 * real por trás — fica para quando um benchmark real pedir mais nuance,
 * assim como os thresholds de LOD.
 */
export function shouldDegrade(state: FrameBudgetState, priority: FrameBudgetPriority): boolean {
  if (priority <= 0) return false;
  return remaining(state) <= 0;
}
