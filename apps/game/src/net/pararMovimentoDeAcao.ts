/**
 * O freio de "cancelei a ação, PARE de andar" — ESC e afins.
 *
 * Cancelar uma ordem (`skillTargetStore.parar()`, `skillWalkStore.parar()`)
 * desarma a INTENÇÃO, mas o `move:to` que a aproximação já mandou continua
 * valendo pro rAthena: ele não persegue por conta própria (`unit.cpp:3259`),
 * mas também não PARA sozinho só porque o cliente mudou de ideia — sem pedir
 * outro destino, ele completa o caminho que já tinha. Era por isso que ESC
 * cancelava a skill e o personagem continuava andando até onde tinha clicado.
 *
 * Clicar no CHÃO já resolve isso de graça: o próprio clique manda um
 * `move:to` novo, que redireciona o que estava em voo (`unit.cpp:894-899`,
 * `change_walk_target`). ESC não tem "para onde", só "para" — e a única forma
 * de parar sem inventar um pacote que o rAthena não tem é pedir o REDIRECT
 * para a própria célula atual: um `move:to` cujo destino já é onde o
 * personagem está. `unit_walktoxy` aceita, marca `change_walk_target` (se já
 * andando) e o próximo tick do timer encontra caminho de comprimento zero —
 * o personagem para exatamente aí, sem um pacote de "stop" que não existe do
 * lado do cliente no protocolo.
 *
 * Só o `NetPlayer` tem o que falta pra isso: a fila de pedidos, o pathfinder
 * e a posição interpolada. Registro em módulo, mesmo padrão do
 * `setPathfinder` (`net/worldStore.ts`) — quem cancela (hotkeys, cliques)
 * não precisa saber NADA de como parar, só que dá pra pedir.
 */

let pararFn: (() => void) | null = null;

export function registrarParadaDeMovimento(fn: (() => void) | null): void {
  pararFn = fn;
}

export function pararMovimentoDeAcao(): void {
  pararFn?.();
}
