import { create } from "zustand";
import type { EntityKind } from "./gateway";
import type { Cell } from "./pathfind";
import { movConfirmado, movDivergente, movRecebido, movWarp } from "./movDebug";
import { desvioDoRelogio, paraRelogioLocal } from "./relogioDoServidor";
import { quadro, registrarEvento } from "../core/diagnostics/flightRecorder";

/**
 * Quanto o mundo dos OUTROS é desenhado no passado, em ms.
 *
 * É a folga que a interpolação de snapshots compra: um pacote pode chegar até
 * `ATRASO − latência` tarde e ainda ser desenhado no lugar certo, em vez de
 * fazer a entidade congelar e depois saltar.
 *
 * 100 ms cobre o jitter de uma conexão doméstica comum sem que o deslocamento
 * seja sentido no combate. Ele NÃO se aplica ao jogador local — atrasar o
 * próprio personagem seria desfazer a predição —, mas desloca o alvo do clique
 * num mob em movimento nesses 100 ms, e é a única coisa deste bloco que o
 * jogador pode perceber. Subir ajuda em rede ruim e piora a mira.
 */
export const ATRASO_DE_INTERPOLACAO = 100;

/**
 * OS PEDIDOS PREVISTOS QUE O SERVIDOR AINDA NÃO RECONHECEU.
 *
 * É a "pending inputs queue" da reconciliação clássica (Gambetta, *Client-Side
 * Prediction and Server Reconciliation*), e sem ela a predição QUEBRA no
 * zigzag — que foi exatamente o relato.
 *
 * ## O defeito que ela conserta
 *
 * Clicar três vezes durante um RTT põe três pedidos no ar. A primeira resposta
 * do servidor descreve o clique #1, mas o cliente já previu o #3. Comparando a
 * resposta com a predição CORRENTE, #1 parece divergência — e o cliente
 * "corrigia" a trajetória de volta para o destino do #1, virando o personagem
 * no meio do caminho. Quanto mais rápido o zigzag, mais recuadas.
 *
 * O algoritmo canônico resolve com número de sequência: o servidor devolve o
 * último input processado, o cliente DESCARTA os reconhecidos e REAPLICA os
 * pendentes por cima do estado autoritativo.
 *
 * ## A adaptação ao rAthena
 *
 * `CZ_REQUEST_MOVE` não tem número de sequência — o protocolo é de 2002 e não
 * foi feito para isto. Mas `ZC_NOTIFY_PLAYERMOVE` traz o DESTINO, e destino
 * identifica o pedido igualmente bem: casa-se a resposta com a entrada da fila
 * que tem aquele `to`.
 *
 * E "reaplicar os pendentes" aqui é trivial: como cada pedido substitui o
 * anterior (não são inputs incrementais, são destinos absolutos), reaplicar
 * todos equivale a MANTER a predição mais nova. Ou seja: ack antigo com fila
 * não vazia = não mexer na trajetória.
 */
interface PedidoPrevisto {
  to: { x: number; y: number };
  em: number;
}
let previstos: PedidoPrevisto[] = [];

/**
 * Teto de idade de um pedido na fila.
 *
 * O rAthena recusa EM SILÊNCIO (unit.cpp:860) — um pedido descartado nunca
 * recebe resposta, e sem prazo ele ficaria na fila para sempre, fazendo todo
 * ack seguinte parecer "antigo" e congelando a reconciliação.
 */
const PREVISTO_VALIDO_MS = 2000;

/** a fila morre com a sessão, o warp e o snap — o mundo de antes não vale mais */
function esquecerPrevistos(): void {
  previstos = [];
}

/** quantos pedidos previstos ainda não foram reconhecidos (depuração e teste) */
export function previstosPendentes(): number {
  return previstos.length;
}

/**
 * O mundo como o SERVIDOR o descreve: entidades e o caminho que cada uma está
 * percorrendo, em célula do rAthena. Nada aqui é decidido pelo cliente — a cena
 * só interpola entre o que chegou.
 *
 * Posição interpolada NÃO mora no store: ela muda todo frame e passar por
 * setState mataria o render. O store guarda o segmento (de onde, para onde,
 * quando começou) e a cena calcula a posição no useFrame.
 */

export interface NetEntity {
  gid: number;
  kind: EntityKind;
  /** mobId para monstro; classe para jogador */
  job: number;
  name?: string;
  /** célula atual (origem do segmento em andamento) */
  x: number;
  y: number;
  /** destino do segmento; igual a x/y quando parado */
  toX: number;
  toY: number;
  /** ms (performance.now) em que o segmento começou */
  movedAt: number;
  /** duração estimada do segmento, em ms */
  durationMs: number;
  dir: number;
  /** velocidade do rAthena: ms para andar UMA célula (menor = mais rápido) */
  speed: number;
  hp?: number;
  maxHp?: number;
  /** nível do mob — vem junto do nome quando `show_mob_info` está ligado */
  level?: number;
  /** caminho célula a célula (ver `Motion.path`) */
  path?: Cell[];
  stepEnds?: number[];
  /**
   * O trecho SEGUINTE, já recebido mas ainda sem hora de começar.
   *
   * É o buffer da interpolação de snapshots, e ele tem exatamente uma posição.
   * Como as entidades remotas são desenhadas `ATRASO_DE_INTERPOLACAO` no
   * passado, o pacote do próximo trecho chega ANTES de o anterior terminar na
   * tela — essa antecipação é justamente a folga que se comprou. Sobrescrever o
   * trecho em andamento com ele jogaria a folga fora e faria a entidade SALTAR
   * para a frente; guardá-lo é o que transforma a folga em suavidade.
   *
   * Uma posição basta porque o rAthena manda um pacote por TRECHO (não por
   * tick), e um trecho dura bem mais que o atraso. Chegando um terceiro, o
   * pendente é promovido antes — ver `move`.
   */
  proximo?: Segmento;
}

/** um trecho de caminhada: de onde, para onde, quando começa e quanto dura */
export interface Segmento {
  x: number;
  y: number;
  toX: number;
  toY: number;
  movedAt: number;
  durationMs: number;
  path?: Cell[];
  stepEnds?: number[];
}

/**
 * Segmento de caminhada do próprio personagem (mesma ideia do NetEntity).
 *
 * `path` é o caminho que o SERVIDOR percorreu entre origem e destino, calculado
 * no cliente pelo mesmo A* dele (net/pathfind). O pacote de movimento traz só as
 * duas pontas; sem refazer o caminho, o cliente cortava em diagonal por cima das
 * paredes. `stepEnds` guarda o instante (ms desde `movedAt`) em que cada passo
 * termina — a diagonal demora 40% a mais que o passo reto, então não dá para
 * dividir a duração igualmente.
 */
export interface SelfMotion {
  x: number;
  y: number;
  toX: number;
  toY: number;
  movedAt: number;
  durationMs: number;
  speed: number;
  path?: Cell[];
  stepEnds?: number[];
  /**
   * Este trecho foi PREVISTO pelo cliente e ainda não foi confirmado.
   *
   * Predição do lado do cliente: o personagem sai andando no instante do
   * clique, sem esperar o `ZC_NOTIFY_PLAYERMOVE`. Com 100 ms de ping isso é a
   * diferença entre um jogo que responde e um que parece travado — e o cliente
   * pode prever com segurança porque recalcula o MESMO A* do servidor
   * (`net/pathfind`, portado de `path.cpp`) com as mesmas regras de alcance.
   *
   * Vira `false` quando o pacote do servidor chega, confirmando ou corrigindo
   * (ver `selfMove`). Serve para SABER se o pacote seguinte é novidade ou
   * confirmação — e é isso que separa "reconciliar" de "reagir".
   */
  predito?: boolean;
  /** quando a predição foi feita, para o timeout de resposta */
  pedidoEm?: number;
  /**
   * QUEM escreveu este trecho. Só para depuração.
   *
   * O detector de recuada (`net/NetPlayer`) precisa NOMEAR o culpado: "o
   * personagem andou de ré" sem dizer qual ação o mandou é um relato, não um
   * diagnóstico. Com isto, `__mov()` aponta o dedo.
   */
  causa?: "predicao" | "servidor" | "fixpos" | "snap";
  /**
   * Rumo do último passo, normalizado — a memória de "para onde eu ia".
   *
   * Existe só para o `aplicarFixpos` saber o que é PARA TRÁS. O rAthena manda
   * `clif_fixpos` com a célula INTEIRA dele (`unit.cpp:1734` zera a sub-célula
   * com um comentário que diz "Stop on cell center"), e com predição o cliente
   * está quase sempre à frente — sem este vetor, cada correção viraria um passo
   * de ré.
   *
   * Precisa SOBREVIVER ao fixpos: depois de um, o personagem está parado e não
   * há passo em andamento de onde derivar rumo nenhum.
   */
  rumoX?: number;
  rumoY?: number;
}

/**
 * Como o cliente descobre o caminho entre duas células.
 *
 * A cena registra isto quando o mapa carrega (`setPathfinder`), porque é ela
 * que tem a colisão. Sem pathfinder registrado — preview do editor, mapa ainda
 * carregando — o movimento cai no passo de rei de antes, que é o certo em
 * terreno livre.
 */
type Pathfinder = (from: Cell, to: Cell) => Cell[] | null;
let pathfinder: Pathfinder | null = null;

export function setPathfinder(fn: Pathfinder | null): void {
  pathfinder = fn;
}

/**
 * Qual o maior trecho que se pode pedir entre duas células DO SERVIDOR.
 *
 * Registrado pela cena junto com o pathfinder, pelo mesmo motivo: é ela que tem
 * a colisão e a conversão para a grade local. O número não é constante — o
 * rAthena aceita 30 células com a reta livre e só 14 quando há bloqueio no meio
 * (`OFFICIAL_WALKPATH`), e recusa em SILÊNCIO acima disso.
 */
type TetoDeTrecho = (from: Cell, to: Cell) => number;
let tetoDeTrechoFn: TetoDeTrecho | null = null;

export function setTetoDeTrecho(fn: TetoDeTrecho | null): void {
  tetoDeTrechoFn = fn;
}

/** teto para este pedido; sem cena registrada vale o conservador (o de obstáculo) */
export function tetoDeTrechoPara(from: Cell, to: Cell): number {
  return tetoDeTrechoFn?.(from, to) ?? 11;
}

/**
 * Caminho entre duas células DO SERVIDOR, pelo mesmo A* que o rAthena usa.
 *
 * Passa pelo pathfinder registrado pela cena (que sabe converter para a grade
 * local e conhece a colisão). Devolve `null` quando não há rota — ou quando
 * ninguém registrou nada, caso do preview do editor.
 */
export function serverPath(from: Cell, to: Cell): Cell[] | null {
  return pathfinder?.(from, to) ?? null;
}

/**
 * Já há colisão registrada?
 *
 * `serverPath` devolve `null` tanto para "não há rota" quanto para "ninguém
 * registrou pathfinder", e as duas exigem o oposto de quem pede movimento: sem
 * rota, NÃO pedir; sem pathfinder (preview do editor, ou o intervalo entre o
 * NetPlayer montar e o PlayView registrar), pedir do mesmo jeito — senão o
 * personagem fica preso sem que nada esteja errado.
 */
export function temPathfinder(): boolean {
  return pathfinder !== null;
}

/**
 * Monta o segmento (caminho + tempos) a partir das duas pontas do pacote.
 *
 * `from` é a célula INTEIRA de onde o A* sai; `desenhoDe` é o ponto de onde o
 * personagem começa a ser desenhado, que pode ser fracionário (quem redireciona
 * no meio do caminho parte de onde ele está na tela, não de um centro de
 * célula). Quando os dois divergem, o PRIMEIRO passo é mais curto ou mais longo
 * que uma célula — e cobrar dele o tempo de uma célula inteira era meia célula
 * de distância grátis (ou perdida) a cada redirecionamento, sempre no mesmo
 * sentido. Repetido a cada clique e a cada emenda de trecho, é o que fazia o
 * desenho ganhar 2-3 células do servidor.
 */
function buildMotion(
  from: Cell,
  to: Cell,
  speed: number,
  desenhoDe?: { x: number; y: number },
  /** células que o servidor vai andar A MAIS que este caminho (ver `selfMove`) */
  celulasExtras = 0,
): { path?: Cell[]; stepEnds?: number[]; durationMs: number } {
  const path = pathfinder?.(from, to) ?? null;
  if (!path || path.length === 0) {
    /**
     * Sem caminho conhecido: passo de rei — E ZERAR O CAMINHO ANTERIOR.
     *
     * O `path`/`stepEnds` explícitos como `undefined` não são decoração: quem
     * chama faz `{ ...entidade, ...buildMotion(...) }`, e um retorno só com
     * `durationMs` deixava passar o caminho da jogada ANTERIOR. O
     * `interpolatedCell` então seguia a rota velha com origem e destino novos —
     * o personagem andava para onde tinha sido mandado antes, "escorregando"
     * até o tempo acabar. É metade do "spammei clique e ele deu glitch".
     */
    return { path: undefined, stepEnds: undefined, durationMs: cellDistance(from, to) * speed };
  }
  const stepEnds: number[] = [];
  let acc = 0;
  let anterior = from;
  for (let i = 0; i < path.length; i++) {
    const c = path[i]!;
    const diagonal = c.x !== anterior.x && c.y !== anterior.y;
    const custoCheio = diagonal ? (speed * 14) / 10 : speed;
    if (i === 0 && desenhoDe) {
      // o primeiro passo sai do ponto DESENHADO, que raramente é o centro de
      // célula que o A* usou: cobra o tempo proporcional à distância real
      const comprimentoCheio = diagonal ? Math.SQRT2 : 1;
      const percorrido = Math.hypot(c.x - desenhoDe.x, c.y - desenhoDe.y);
      // teto de 1,5 para um pacote fora de ordem não gerar um passo eterno
      acc += custoCheio * Math.min(1.5, percorrido / comprimentoCheio);
    } else {
      acc += custoCheio;
    }
    stepEnds.push(acc);
    anterior = c;
  }

  /**
   * Estica (ou encolhe) o trecho para durar o que ele vai durar PARA O SERVIDOR.
   *
   * É assim que a deriva se corrige sem o personagem andar de ré: se o cliente
   * está uma célula à frente, o servidor tem uma célula a mais para percorrer, e
   * é ele quem decide quando o trecho acaba. Igualando o TEMPO, o desenho anda
   * um pouco mais devagar e a diferença se dissolve ao longo do trecho, em vez
   * de virar um salto no fim dele.
   */
  if (celulasExtras !== 0 && acc > 0) {
    const bruto = (acc + celulasExtras * speed) / acc;
    const fator = Math.min(FATOR_DERIVA_MAX, Math.max(FATOR_DERIVA_MIN, bruto));
    for (let i = 0; i < stepEnds.length; i++) stepEnds[i] = stepEnds[i]! * fator;
    acc *= fator;
  }

  // a duração é a soma dos passos ACIMA, não a do caminho teórico: com origem
  // fracionária as duas divergem, e é a diferença que virava deriva
  return { path, stepEnds, durationMs: acc };
}

interface WorldState {
  /** gid do próprio personagem */
  selfGid: number;
  /**
   * O personagem do jogador NÃO chega por pacote de spawn (o servidor não
   * anuncia você para você mesmo): a posição inicial vem do ZC.ACCEPT_ENTER e
   * cada passo do ZC.NOTIFY_PLAYERMOVE. Por isso mora num campo próprio.
   */
  self: SelfMotion;
  entities: Record<number, NetEntity>;
  /**
   * Os gids do `entities`, como ARRAY estável — só muda em spawn/vanish/clear.
   *
   * Existe por causa de como o zustand notifica: ele roda o seletor de TODO
   * assinante a cada `set`. Quem desenha a lista assinava
   * `Object.keys(s.entities).join(",")`, então cada pacote de movimento — e com
   * `area_size: 60` são dezenas por segundo — pagava uma varredura O(n) mais uma
   * string nova, só para descobrir que o conjunto de entidades não tinha mudado.
   * Com a lista pronta no estado, o seletor é uma leitura de referência e a
   * comparação do zustand é `===`.
   */
  gids: number[];
  /** gid do alvo selecionado (clique/TAB); null = sem alvo */
  target: number | null;

  setSelfGid: (gid: number) => void;
  setTarget: (gid: number | null) => void;
  setSelfCell: (x: number, y: number) => void;
  /** ZC_STOPMOVE / fixpos: correção quando é perto, teleporte quando é longe */
  aplicarFixpos: (x: number, y: number) => void;
  selfMove: (from: { x: number; y: number }, to: { x: number; y: number }) => void;
  /**
   * Começa a andar SEM esperar o servidor (client-side prediction).
   *
   * `origemCel` é a célula de onde o A* sai (a visual arredondada, a mesma que
   * o pedido usou); `alvo` é a célula pedida.
   */
  preverMovimento: (origemCel: { x: number; y: number }, alvo: { x: number; y: number }) => void;
  setSelfSpeed: (speed: number) => void;
  spawn: (e: Omit<NetEntity, "toX" | "toY" | "movedAt" | "durationMs">) => void;
  /**
   * `startTime` é o `gettick()` do map-server em que o trecho começou. Usado só
   * quando a entidade estava PARADA — ver o corpo da ação.
   */
  move: (
    gid: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
    speed?: number,
    startTime?: number,
  ) => void;
  stop: (gid: number, x: number, y: number) => void;
  vanish: (gid: number) => void;
  rename: (gid: number, name: string) => void;
  setLevel: (gid: number, level: number) => void;
  setHp: (gid: number, hp: number, maxHp: number) => void;
  /**
   * Esquece TUDO que estava em volta, preservando o próprio personagem.
   *
   * É o que o cliente oficial faz ao receber `ZC_NPCACK_MAPMOVE`. O rAthena NÃO
   * manda um `NOTIFY_VANISH` por entidade quando o jogador é teleportado —
   * `pc_setpos` só emite `clif_clearunit_area(*sd, CLR_TELEPORT)`, que avisa os
   * OUTROS de que este jogador sumiu, e depois manda o MAPMOVE para ele. Quem
   * recebe MAPMOVE tem de limpar por conta própria.
   *
   * Diferente do `clear()`: aquele é do FIM DA SESSÃO e zera o `self` junto.
   * Aqui o `self` sobrevive de propósito — num warp de mesmo mapa quem
   * reposiciona o personagem é o `self:warp` (`aplicarFixpos`) que vem logo
   * atrás, e zerar a posição no meio o jogaria para a célula 0,0 por um quadro.
   */
  limparEntidades: () => void;
  clear: () => void;
  /**
   * Quantas vezes o mundo foi ESQUECIDO (portal, troca de mapa, fim de sessão).
   *
   * Existe porque a posição desenhada no quadro anterior descreve o mundo
   * ANTERIOR, e compará-la com a do mundo novo não significa nada. Sem isto o
   * detector de rollback media a distância da última célula do mapa velho até o
   * `0,0` em que o `self` é reposto — no `voo-1785938553239.json` isso virou
   * "rollback de 424 células" e QUEIMOU 2 dos 4 slots de captura em dois
   * portais. Quem compara posições entre quadros tem de conferir este número
   * antes.
   */
  geracao: number;
}

/** Distância em células de um passo do rAthena (diagonal conta como 1). */
function cellDistance(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
}

/** 150 ms/célula é o walk speed padrão do rAthena (mmo.hpp DEFAULT_WALK_SPEED). */
const DEFAULT_WALK_SPEED = 150;

/**
 * Quanto a correção de deriva pode esticar ou encolher a duração de um trecho.
 *
 * A deriva NÃO é corrigida movendo o personagem — corrigi-la por posição é
 * exatamente o recuo que se quer eliminar, só que disfarçado de "sincronização".
 * Ela é corrigida pelo TEMPO: o desenho continua saindo de onde o personagem
 * está (nunca anda de ré), mas o trecho passa a durar o que ele vai durar PARA O
 * SERVIDOR. Adiantado, o cliente anda um pouco mais devagar e a diferença some
 * sozinha; atrasado, anda um pouco mais rápido.
 *
 * O teto existe para um pacote fora de ordem não congelar nem teletransportar o
 * personagem: no pior caso ele fica 2× mais lento ou 2× mais rápido por um
 * trecho, e o trecho seguinte corrige o resto.
 */
const FATOR_DERIVA_MIN = 0.5;
const FATOR_DERIVA_MAX = 2;

/**
 * Desvio que ainda vale a pena absorver sem mexer no personagem PARADO.
 *
 * Quando o trecho acaba, o cliente fica no destino e o pacote seguinte costuma
 * chegar com o servidor uma célula atrás — ele ainda está andando. Recomeçar o
 * desenho na célula dele é um salto para trás, e é o caso que sobrava depois de
 * a correção por tempo entrar. Até este limite o desenho fica onde está e a
 * diferença é paga no tempo do trecho novo, como no caso em movimento.
 *
 * Acima daqui não é deriva, é desencontro de verdade (pacote perdido, mapa
 * trocado) — aí o servidor manda mesmo, porque insistir na posição do cliente
 * deixaria o personagem errado para sempre.
 */
const DESVIO_PARADO_MAX = 2;

/**
 * Acima disto, um `fixpos` é teleporte de verdade; abaixo, é correção.
 *
 * `clif_fixpos` (ZC_STOPMOVE) é o pacote de CANCELAMENTO DE CAMINHADA do
 * rAthena, não de teleporte: ele sai toda vez que `unit_stop_walking` roda com
 * `USW_FIXPOS` — usar skill (unit.cpp:2477 e :2750), atacar (:3295), ser
 * empurrado. Tratá-lo sempre como teleporte era o que fazia o personagem
 * "voltar 2 ou 3 células ao castar uma skill": o cliente cravava a célula do
 * servidor e parava seco.
 *
 * Os casos que SÃO teleporte (`@jump`, warp de NPC, Asa de Borboleta) movem
 * muito mais que isto, então o corte separa os dois sem precisar de pacote novo.
 */
const FIXPOS_TELEPORTE = 3;

/**
 * Acima disto é teleporte de VERDADE — e só acima disto se crava a posição.
 *
 * `FIXPOS_TELEPORTE` responde "o servidor está perto o bastante para eu
 * SEGURAR?"; este responde "ele está longe o bastante para eu SALTAR?". Eram o
 * mesmo número, e a faixa entre os dois não existia: qualquer correção acima de
 * 3 células virava salto seco.
 *
 * O laudo (`voo-*.json`, caso 1, quadro 50) mostra o preço disso: um `fixpos` a
 * 7 células com `paraTras: true` — ou seja, o próprio pacote dizia que o ponto
 * já tinha sido percorrido — foi classificado como teleporte, e o personagem
 * voltou 7 células em 10,5 ms. É o "volta algumas células" do relato, medido.
 *
 * Na faixa entre os dois, a correção deixa de ser salto e volta a passar pelas
 * regras que já existiam: PARA TRÁS o personagem SEGURA (o servidor está
 * atrasado e alcança sozinho, e a diferença é paga em tempo no `extras` do
 * pacote seguinte — o desenho nunca anda de ré); PARA FRENTE ele DESLIZA em
 * `FIXPOS_SUAVIZACAO_MS`. Não é tolerância: a célula do servidor continua sendo
 * obedecida sempre, o que muda é que ela é alcançada andando.
 *
 * 8 é folgado sobre a deriva legítima (medida: 3,2 células no pior caso, com
 * ping simulado de 260 ms e o pathfinder ativo) e continua muito abaixo de um
 * `@jump`, de um warp de NPC ou de uma Asa de Borboleta, que movem dezenas de
 * células e seguem cravando.
 */
const FIXPOS_DERIVA_MAX = 8;

/** quanto tempo a correção curta leva para encostar na célula do servidor */
const FIXPOS_SUAVIZACAO_MS = 120;

/**
 * Abaixo disto a correção é aplicada sem animação — e só abaixo disto.
 *
 * Era **0,35 CÉLULA**, e isso era o mini-teleporte relatado: a célula mede
 * `SQUARE_SIZE = 2` unidades e o personagem ocupa uma célula, então 0,35 é 35%
 * da largura dele, aplicada em UM quadro. O comentário que justificava o valor
 * ("gap desprezível não merece animação") vale para ruído de ponto flutuante,
 * que é a ordem de grandeza deste número agora.
 *
 * Com `preservandoSubCelula` ele quase nunca é alcançado: no caso comum (mesma
 * célula) o alvo é IGUAL à posição e a distância é exatamente 0. Ele fica para o
 * resíduo de ponto flutuante, que é o que sempre deveria ter sido.
 */
const FIXPOS_EPSILON = 0.05;

/**
 * O SERVIDOR manda a CÉLULA; o deslocamento dentro dela é NOSSO.
 *
 * É esta a divisão entre a posição lógica (grid, do servidor) e a física
 * (desenho, do cliente), e é ela que acaba com o snap para o centro do tile.
 *
 * ## Por que o snap existia
 *
 * `ZC_STOPMOVE` é o pacote de "a caminhada acabou", e o rAthena o dispara ao
 * castar (unit.cpp:2477), ao atacar (:2975) e ao parar. O que ele carrega é só
 * `x`/`y` INTEIROS — e não por acaso: `unit_stop_walking` com `USW_FIXPOS`
 * (unit.cpp:1732) faz literalmente
 *
 * ```c
 * // Stop on cell center
 * ud->sx = 8;
 * ud->sy = 8;
 * ```
 *
 * ou seja, o servidor TEM sub-célula (`sx`/`sy`, 0–15, 8 = centro) e a força
 * para o centro ao interromper a caminhada. Obedecendo ao pacote ao pé da letra,
 * o cliente ia parar no centro do tile — mesmo quando cliente e servidor
 * concordavam PERFEITAMENTE sobre a célula. Era o "mini-teleporte ao castar", e
 * ele acontecia sem divergência nenhuma para corrigir.
 *
 * Recuperar a sub-célula do pacote também não é opção: `clif_walkok`
 * (ZC_NOTIFY_PLAYERMOVE, clif.cpp:2056) manda `8, 8` CRAVADO para o dono do
 * personagem — a sub-célula real só viaja para as OUTRAS unidades
 * (clif_set_unit_walking, clif.cpp:1414).
 *
 * ## A regra
 *
 * A célula é do servidor, sem tolerância nenhuma. O offset é do cliente, e
 * mudança de estado não tem o direito de tocá-lo. Daí o caso "não mover" sair de
 * graça: mesma célula ⇒ o alvo É a posição atual, e nada se move.
 *
 * Não é "ignorar diferenças menores que uma célula" — isso deixaria os dois
 * permanentemente divergentes. A célula continua sendo reconciliada SEMPRE, e é
 * ela que alimenta A*, alcance e colisão (todos leem `Math.round` da posição
 * física). O que se preserva é só onde, DENTRO dela, o personagem é desenhado.
 */
function preservandoSubCelula(
  atual: { x: number; y: number },
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: x + (atual.x - Math.round(atual.x)), y: y + (atual.y - Math.round(atual.y)) };
}

/**
 * Para onde o personagem está indo AGORA, normalizado — ou `null` se parado.
 *
 * Serve a uma pergunta só: a correção que o servidor mandou puxa para FRENTE ou
 * para TRÁS? Produto escalar com este vetor responde, e responde certo mesmo
 * quando a rota faz cotovelo — o rumo é o do PASSO em andamento, não o da reta
 * origem→destino.
 *
 * A alternativa anterior (comparar distâncias euclidianas até a origem do
 * trecho) tinha dois furos: numa rota em "L" um ponto já percorrido pode estar
 * MAIS LONGE da origem que a posição atual, e — pior — depois de um fixpos a
 * origem passa a ser a própria posição desenhada, o que tornava a comparação
 * sempre falsa e todo fixpos seguinte um snap.
 */
function rumoDoPasso(e: SelfMotion, now: number): { x: number; y: number } | null {
  if (e.durationMs <= 0) return null;
  const decorrido = now - e.movedAt;
  let de = { x: e.x, y: e.y };
  let para = { x: e.toX, y: e.toY };
  if (e.path && e.path.length > 0 && e.stepEnds && e.stepEnds.length === e.path.length) {
    let i = 0;
    while (i < e.stepEnds.length && decorrido > e.stepEnds[i]!) i++;
    if (i >= e.path.length) i = e.path.length - 1;
    de = i === 0 ? { x: e.x, y: e.y } : e.path[i - 1]!;
    para = e.path[i]!;
  }
  const dx = para.x - de.x;
  const dy = para.y - de.y;
  const n = Math.hypot(dx, dy);
  return n > 1e-6 ? { x: dx / n, y: dy / n } : null;
}

const IDLE_SELF: SelfMotion = {
  x: 0,
  y: 0,
  toX: 0,
  toY: 0,
  movedAt: 0,
  durationMs: 0,
  speed: DEFAULT_WALK_SPEED,
};

export const useWorldStore = create<WorldState>((set) => ({
  selfGid: 0,
  self: IDLE_SELF,
  entities: {},
  gids: [],
  target: null,
  geracao: 0,

  setSelfGid: (selfGid) => set({ selfGid }),
  setTarget: (target) => set({ target }),

  setSelfCell: (x, y) =>
    set((s) => {
      // o servidor cravou a posição: todo pedido no ar descreve um mundo que
      // não existe mais
      esquecerPrevistos();
      // Célula inválida joga o personagem para (0,0) — o canto do mapa —, e de
      // lá nada mais funciona. Melhor ignorar o pacote estranho que reposicionar
      // no vazio.
      if (!Number.isFinite(x) || !Number.isFinite(y)) return s;
      return {
        self: {
          ...s.self,
          x,
          y,
          toX: x,
          toY: y,
          movedAt: performance.now(),
          durationMs: 0,
          causa: "snap",
          // este trecho é do SERVIDOR, não palpite — e quem lê `predito` é a
          // janela de resposta do `NetPlayer`. Sem zerar, um snap chegando com
          // predição viva deixaria a janela aberta até o timeout matar o destino
          // de uma caminhada que estava perfeitamente boa.
          predito: false,
          // teleporte descarta a rota antiga; sem isto o `{ ...self }` de quem
          // chama preservaria o caminho de antes do salto
          path: undefined,
          stepEnds: undefined,
        },
      };
    }),

  /**
   * `clif_fixpos` — "a posição de verdade é esta".
   *
   * Perto (≤ `FIXPOS_TELEPORTE`) é o servidor cancelando a caminhada e dizendo
   * onde ela parou: o personagem PARA, mas encosta na célula certa em
   * `FIXPOS_SUAVIZACAO_MS` em vez de saltar. Era o salto que aparecia como
   * "voltei 2 ou 3 células" ao usar skill andando.
   *
   * Longe é teleporte de verdade e continua sendo o snap seco de antes — é o
   * mesmo pacote que chega num `@jump`, num warp de NPC ou numa Asa de
   * Borboleta, e ali qualquer suavização desenharia o personagem atravessando o
   * mapa a pé.
   */
  aplicarFixpos: (x, y) =>
    set((s) => {
      // idem: teleporte/empurrão invalida qualquer predição pendente
      esquecerPrevistos();
      if (!Number.isFinite(x) || !Number.isFinite(y)) return s;
      const now = performance.now();
      const atual = interpolatedCell(s.self, now);
      const gap = Math.hypot(atual.x - x, atual.y - y);
      const teleporte = gap > FIXPOS_DERIVA_MAX;
      movWarp(gap, teleporte);
      /**
       * O SERVIDOR ESTÁ ATRÁS DE NÓS? Então PARA — não volta.
       *
       * Esta é a recuada que sobrou depois da fila de pendentes, e a predição a
       * tornou sistemática. O rAthena manda `clif_fixpos` sempre que interrompe
       * a caminhada — `unit_stop_walking` com `USW_FIXPOS`, o que acontece ao
       * ATACAR (unit.cpp:2975, antes do golpe), ao usar skill e ao parar. Com
       * predição o cliente anda ~meio RTT à frente por construção, então esse
       * pacote quase sempre aponta uma célula ATRÁS de onde o personagem está
       * desenhado, e deslizar até lá em 120 ms é literalmente andar de ré.
       *
       * A distinção é geométrica e barata: o ponto do fixpos está mais PERTO da
       * origem do trecho do que o personagem está? Então ele é um ponto que já
       * foi percorrido — o servidor não chegou lá ainda, e a verdade dele é
       * velha. O certo é parar onde se está e deixar o servidor alcançar; o
       * pacote de movimento seguinte reconcilia pelo tempo, como sempre.
       *
       * Isso NÃO vale para teleporte (o gap grande vence tudo) nem para
       * empurrão, que joga o personagem para um lado — ali o ponto não está
       * atrás na rota e o fixpos é aplicado como antes.
       */
      /**
       * A correção puxa para FRENTE ou para TRÁS?
       *
       * Produto escalar entre "o que o servidor pediu" e o RUMO do passo em
       * andamento. Para trás, segura-se: o servidor está atrasado (a predição
       * põe o cliente na frente), e o pacote de movimento seguinte reconcilia
       * pelo tempo, como sempre. Para frente, desliza.
       *
       * O rumo é MEMORIZADO (`rumoX/rumoY`) porque ele precisa sobreviver ao
       * próprio fixpos: depois de um, o personagem está parado e `rumoDoPasso`
       * devolve `null` — sem a memória, um segundo fixpos não teria como saber
       * o que é "para trás" e voltaria a puxar o personagem.
       */
      const rumo =
        rumoDoPasso(s.self, now) ??
        (s.self.rumoX !== undefined && s.self.rumoY !== undefined
          ? { x: s.self.rumoX, y: s.self.rumoY }
          : null);
      const paraTras = rumo !== null && (x - atual.x) * rumo.x + (y - atual.y) * rumo.y < 0;
      const servidorAtras = !teleporte && paraTras;
      /**
       * O destino da correção: a CÉLULA do servidor com o NOSSO offset.
       *
       * Teleporte é a única exceção — ali o personagem é posto noutro lugar do
       * mapa e não há offset anterior que signifique coisa alguma, então o
       * centro da célula é a resposta certa.
       *
       * Em tudo o mais, `preservandoSubCelula` faz o caso comum desaparecer
       * sozinho: parar, castar e atacar chegam com a célula em que o personagem
       * JÁ está, o alvo sai igual à posição atual e nada se move. Sem limiar,
       * sem exceção escrita à mão.
       */
      const alvo = teleporte ? { x, y } : preservandoSubCelula(atual, x, y);
      // "não há para onde ir" cobre os dois casos que não movem: segurar por
      // estar à frente do servidor, e o alvo já ser a posição atual
      const parado = servidorAtras || Math.hypot(alvo.x - atual.x, alvo.y - atual.y) < FIXPOS_EPSILON;
      /**
       * `clif_fixpos` já foi a causa de recuada duas vezes neste projeto (o snap
       * para o centro do tile e o deslize para uma célula já percorrida), e as
       * duas correções moram em `servidorAtras`/`parado`. Registrar QUAL ramo
       * correu é o que permite dizer, com evidência, se ele voltou a ser o
       * culpado ou se desta vez é inocente.
       */
      registrarEvento(
        "reconciliation",
        teleporte ? "fixpos-teleporte" : servidorAtras ? "fixpos-segurou" : parado ? "fixpos-nulo" : "fixpos-deslizou",
        {
          alvo: `${x},${y}`,
          desenho: `${atual.x.toFixed(2)},${atual.y.toFixed(2)}`,
          gap,
          paraTras,
        },
        now,
      );
      return {
        self: {
          ...s.self,
          x: teleporte ? alvo.x : atual.x,
          y: teleporte ? alvo.y : atual.y,
          // atrás de nós: o destino passa a ser onde o personagem JÁ está
          toX: servidorAtras ? atual.x : alvo.x,
          toY: servidorAtras ? atual.y : alvo.y,
          movedAt: now,
          causa: "fixpos",
          // idem `setSelfCell`: o fixpos é palavra do servidor, e é ele que
          // fecha a janela de resposta do `NetPlayer`
          predito: false,
          // instantâneo SÓ em teleporte, ao segurar e quando não há nada a
          // percorrer. Toda correção PERCEPTÍVEL desliza — e o que era
          // perceptível no caso comum deixou de existir, porque o alvo passou a
          // ser a própria posição em vez do centro do tile.
          durationMs: teleporte || parado ? 0 : FIXPOS_SUAVIZACAO_MS,
          // o rumo sobrevive ao fixpos: é ele que diz o que é "para trás" no
          // próximo, quando o personagem já estiver parado
          rumoX: rumo?.x ?? s.self.rumoX,
          rumoY: rumo?.y ?? s.self.rumoY,
          // a rota velha morre nos dois casos — o servidor acabou de dizer que
          // aquela caminhada não existe mais
          path: undefined,
          stepEnds: undefined,
        },
      };
    }),

  /**
   * CLIENT-SIDE PREDICTION: começa a andar sem esperar o servidor.
   *
   * O pedido acabou de sair (`move:to`); em vez de ficar cravado até a resposta
   * voltar, o personagem já anda o caminho que o cliente calculou. É seguro
   * porque esse caminho é o MESMO que o servidor vai calcular: o A* de
   * `net/pathfind` é portado de `path.cpp`, e o pedido só chega aqui depois de
   * passar por `destinoAlcancavel` e pelo teto de `max_walk_path` — as mesmas
   * regras que o rAthena aplica antes de aceitar.
   *
   * Reusa a MESMA `buildMotion` do `selfMove`: previsto e confirmado têm
   * exatamente a mesma forma, então `interpolatedCell` não sabe a diferença e
   * nada no desenho precisa mudar.
   *
   * A origem é sempre a posição DESENHADA — a mesma regra de sempre, e é ela
   * que garante que prever nunca faça o personagem andar de ré.
   */
  preverMovimento: (origemCel, alvo) =>
    set((s) => {
      const now = performance.now();
      const atual = interpolatedCell(s.self, now);
      const origem = { x: atual.x, y: atual.y };
      // entra na fila de não reconhecidos; o que apodreceu sai junto (o rAthena
      // recusa em silêncio, e pedido sem resposta ficaria aqui para sempre)
      previstos = previstos.filter((p) => now - p.em < PREVISTO_VALIDO_MS);
      previstos.push({ to: { x: alvo.x, y: alvo.y }, em: now });
      registrarEvento(
        "prediction",
        "previu",
        {
          de: `${origemCel.x},${origemCel.y}`,
          para: `${alvo.x},${alvo.y}`,
          desenhoEm: `${origem.x.toFixed(2)},${origem.y.toFixed(2)}`,
          fila: previstos.length,
        },
        now,
      );
      return {
        self: {
          ...s.self,
          x: origem.x,
          y: origem.y,
          toX: alvo.x,
          toY: alvo.y,
          movedAt: now,
          predito: true,
          pedidoEm: now,
          causa: "predicao",
          ...buildMotion(origemCel, alvo, s.self.speed, origem),
        },
      };
    }),

  selfMove: (from, to) =>
    set((s) => {
      const now = performance.now();
      /**
       * A DERIVA é medida aqui e corrigida pelo TEMPO — nunca pela posição.
       *
       * De onde COMEÇAR a desenhar continua sendo o ponto exato onde o
       * personagem está na tela, não a célula do pacote: o servidor manda a
       * célula que ELE considera, que fica atrás, e recomeçar dali é o solavanco
       * de "travadinha" ao redirecionar. **O desenho nunca anda de ré.**
       *
       * Mas ignorar o `from` COMPLETAMENTE era o outro extremo, e é a causa do
       * relato: o erro entre cliente e servidor nunca era lido de volta, cada
       * redirecionamento partia da posição já adiantada e o desvio só crescia —
       * até uma skill forçar um `clif_fixpos` (unit.cpp:2477) e cobrar as 2-3
       * células acumuladas de uma vez.
       *
       * `desvio` é quanto o servidor ainda tem para andar ALÉM do que o cliente
       * já desenhou. Ele entra no `buildMotion` como TEMPO A MAIS: o trecho
       * passa a durar o que vai durar para o servidor, o desenho fica um pouco
       * mais lento e os dois se reencontram no fim do trecho, sem salto.
       */
      const atual = interpolatedCell(s.self, now);
      const desvio = cellDistance({ x: atual.x, y: atual.y }, from);
      const celDesenhada = { x: Math.round(atual.x), y: Math.round(atual.y) };
      /**
       * O SERVIDOR ESTÁ ATRÁS DE NÓS? Então o desenho NÃO recua — nunca.
       *
       * Mede-se por quem está mais longe do destino: se o `from` do pacote tem
       * mais caminho pela frente que a célula desenhada, ele descreve um ponto
       * que o personagem JÁ passou. É o caso NORMAL com predição — o cliente
       * anda ~meio RTT à frente por construção.
       *
       * Sem isto, bastava o trecho do cliente FECHAR antes do trecho do servidor
       * (`interpolatedCell` devolve `moving: false` no fim) e o desvio passar de
       * `DESVIO_PARADO_MAX` para `origem = from` valer — um salto seco para a
       * célula do servidor, atrás. Era o "volta algumas células". E fechar antes
       * é fácil: qualquer engasgo de ~450 ms (três células) durante a caminhada
       * faz isso, e a perda de contexto do WebGL entrega engasgos desses.
       *
       * Não há risco de o cliente se perder: o trecho construído abaixo TERMINA
       * em `to`, a célula do servidor. Manter a origem desenhada muda o formato
       * do caminho, não o ponto de encontro — e a diferença de comprimento é
       * paga em TEMPO (`extras`), que é o mecanismo que já existia.
       *
       * A porta continua aberta para a divergência de verdade: se o `from` NÃO
       * está atrás (o servidor nos pôs de lado, ou à frente), o desvio grande
       * com o personagem parado ainda manda, como antes.
       */
      const servidorAtras = cellDistance(from, to) >= cellDistance(celDesenhada, to);
      // parado e perto: também não anda de ré — a diferença é paga no tempo
      const manterDesenho = atual.moving || desvio <= DESVIO_PARADO_MAX || servidorAtras;
      movRecebido(desvio, { from, to, movendo: atual.moving, manterDesenho, servidorAtras });
      /**
       * A célula que o SERVIDOR acha que é a nossa, na linha do quadro.
       *
       * Ela é a metade autoritativa do par cuja distância É a deriva — a outra
       * metade (`logicoX/Y`) o `NetPlayer` escreve todo quadro. Com as duas em
       * colunas vizinhas, "o erro cresceu ao longo da caminhada" deixa de ser
       * impressão e vira uma subtração.
       */
      quadro().servidorX = from.x;
      quadro().servidorY = from.y;

      /**
       * SERVER RECONCILIATION — e a boa notícia é que ela JÁ ESTAVA AQUI.
       *
       * Com predição, este pacote quase nunca é novidade: ele descreve o
       * movimento que o cliente já começou. A pergunta é se o servidor
       * concordou, e a resposta é o destino.
       *
       * O que vem depois deste bloco não precisou mudar, e é o ponto principal:
       * o mecanismo que o projeto já usava para a deriva — manter a posição
       * DESENHADA como origem e pagar a diferença em TEMPO (`extras`) — é
       * exatamente uma reconciliação. Confirmada, ele reancora o trecho sem
       * mover um pixel e ainda corrige o adiantamento da predição (o cliente
       * saiu andando ~meio RTT antes do servidor, então `extras` sai positivo e
       * o trecho estica, desacelerando até os dois se reencontrarem).
       * Divergente, ele reconstrói para o destino novo a partir de onde o
       * personagem está — sem salto, como sempre foi.
       *
       * Aqui só se MEDE e se limpa a marca. `taxaDeErro` alta em `__mov()` quer
       * dizer que alguma cópia da regra do servidor (A*, alcance, teto de
       * trecho) saiu de sincronia — e aí o defeito é a cópia, não a predição.
       */
      /**
       * RECONCILIAÇÃO com a fila de pendentes (ver `previstos`).
       *
       * O pacote responde a UM dos pedidos no ar, e o cliente pode já ter
       * pedido outros depois. Casa-se pelo DESTINO, que é o que o rAthena
       * devolve — o protocolo não tem número de sequência.
       */
      const iAck = previstos.findIndex((p) => p.to.x === to.x && p.to.y === to.y);
      /**
       * O DESTINO que vale — e por que o ack antigo não pode mais sair daqui
       * sem fazer nada.
       *
       * Antes, ack antigo com fila não vazia fazia `return s`: o pacote inteiro
       * era descartado. Preservar a TRAJETÓRIA está certo (é o passo de reaplicar
       * os pendentes do algoritmo clássico, e como cada pedido é um destino
       * ABSOLUTO, reaplicar todos = manter o mais novo). Descartar o PACOTE não
       * está: junto com ele iam embora a reancoragem do trecho e o `extras`, que
       * é o único lugar onde a deriva entre cliente e servidor é lida de volta.
       *
       * O resultado era a reconciliação DESLIGADA justamente quando ela mais
       * importa — durante a emenda, que é quando há vários pedidos no ar. A
       * deriva crescia calada até um `clif_fixpos` cobrar tudo de uma vez.
       *
       * Agora as duas coisas são separadas, que é o que sempre deveriam ter
       * sido: o destino vem da predição mais nova, e o TEMPO vem deste pacote.
       */
      const ackAntigo = iAck >= 0 && previstos.length - (iAck + 1) > 0;
      const alvo = ackAntigo ? { x: s.self.toX, y: s.self.toY } : to;
      if (iAck >= 0) {
        // tudo até ele foi reconhecido (ou superado): sai da fila
        previstos = previstos.slice(iAck + 1);
        if (previstos.length > 0) {
          /**
           * ACK ANTIGO — e é AQUI que o zigzag era estragado.
           *
           * O servidor confirmou um clique que o jogador já substituiu. O estado
           * autoritativo é velho: reaplicar os pendentes por cima dele é o passo
           * final do algoritmo clássico, e como cada pedido é um destino
           * ABSOLUTO (não um input incremental), reaplicar todos equivale a
           * manter a predição mais nova.
           *
           * Então não se toca na trajetória. Reconstruir para o destino deste
           * pacote era o que virava o personagem no meio do caminho — quanto
           * mais rápido o zigzag, mais recuadas.
           */
          movConfirmado();
        } else if (s.self.predito) {
          // a fila esvaziou: este pacote responde à predição CORRENTE
          movConfirmado();
        }
      } else if (s.self.predito) {
        /**
         * Não responde a pedido nosso nenhum: o servidor decidiu por conta
         * (recusa, empurrão, redirecionamento). Aí ele manda, e a trajetória é
         * reconstruída abaixo — a partir de onde o personagem está desenhado,
         * como sempre, então nem aqui há salto para trás.
         */
        movDivergente(desvio, { previsto: { x: s.self.toX, y: s.self.toY }, veio: to });
        esquecerPrevistos();
      }
      const origem = manterDesenho ? { x: atual.x, y: atual.y } : from;
      /**
       * O CAMINHO tem de sair da mesma origem que o desenho.
       *
       * Aqui estava o "spammei clique e ele trava / se arrasta / fica parado e
       * depois anda": a posição recomeçava na célula VISUAL (certo), mas o A*
       * era refeito a partir de `from`, a célula do SERVIDOR — que fica atrás.
       * O `interpolatedCell` usa `x,y` como início do primeiro passo e
       * `path[0]` como fim dele, então o primeiro passo ia da posição visual
       * para uma célula ATRÁS dela: o personagem andava de ré e só então
       * seguia. E a duração, medida sobre o caminho inteiro do servidor, era
       * maior que o trecho que sobrou — daí o "arrastar".
       *
       * Redirecionar no meio do caminho é o caso COMUM (clique novo, e agora
       * também a emenda automática de trecho a cada 16 células), então isso
       * aparecia o tempo todo.
       */
      const origemCel = manterDesenho ? { x: Math.round(atual.x), y: Math.round(atual.y) } : from;
      /**
       * Quantas células o SERVIDOR vai andar a mais que o caminho desenhado.
       *
       * Medida entre `from` e `origemCel` — as duas pontas de CAMINHO, não a
       * posição fracionária: é essa a diferença de comprimento entre a rota que
       * o servidor vai percorrer e a que o cliente vai desenhar.
       *
       * Sem isso o trecho do cliente acabava ANTES do trecho do servidor, o
       * personagem estacionava no destino, e o pacote seguinte — que chega com o
       * servidor ainda atrás — encontrava `moving: false` e recomeçava o desenho
       * na célula dele. Era esse o salto para trás.
       */
      const extras = cellDistance(origemCel, from);
      /**
       * O retrato da reconciliação — os ramos que ela já tinha, agora legíveis.
       *
       * Cada campo aqui é uma decisão que o código toma em silêncio e que muda
       * o que o jogador vê: manter o desenho ou saltar para a célula do
       * servidor, tratar o ack como corrente ou antigo, esticar o trecho em N
       * células. Quando o rollback acontecer, é esta linha, no quadro certo, que
       * diz qual ramo correu.
       */
      registrarEvento(
        "reconciliation",
        iAck < 0 ? (s.self.predito ? "divergente" : "sem-pedido") : ackAntigo ? "ack-antigo" : "ack-corrente",
        {
          de: `${from.x},${from.y}`,
          para: `${to.x},${to.y}`,
          desenho: `${atual.x.toFixed(2)},${atual.y.toFixed(2)}`,
          desvio,
          extras,
          manterDesenho,
          servidorAtras,
          movendo: atual.moving,
          fila: previstos.length,
          alvoMantido: alvo.x !== to.x || alvo.y !== to.y,
        },
        now,
      );
      return {
        self: {
          ...s.self,
          x: origem.x,
          y: origem.y,
          // o DESTINO é o da predição mais nova quando o ack é antigo (ver
          // `alvo`); o TEMPO é sempre deste pacote
          toX: alvo.x,
          toY: alvo.y,
          movedAt: now,
          // o servidor falou: este trecho não é mais palpite
          predito: false,
          causa: "servidor",
          ...buildMotion(origemCel, alvo, s.self.speed, origem, extras),
        },
      };
    }),

  setSelfSpeed: (speed) => set((s) => ({ self: { ...s.self, speed: speed > 0 ? speed : s.self.speed } })),

  spawn: (e) =>
    set((s) => ({
      // re-spawn (o replay do gateway ao entrar na cena) não pode duplicar o gid
      gids: s.entities[e.gid] ? s.gids : [...s.gids, e.gid],
      entities: {
        ...s.entities,
        [e.gid]: {
          ...e,
          // spawn pode chegar com a entidade já andando; sem o pacote de
          // movimento junto, tratamos como parada até o próximo NOTIFY_MOVE.
          toX: e.x,
          toY: e.y,
          movedAt: performance.now(),
          durationMs: 0,
          // nome/HP/nível só sobrescrevem se vieram: os pacotes de spawn antigos
          // não trazem e o ACK_REQNAME chega depois. Um re-spawn (o replay do
          // gateway ao entrar na cena) não pode apagar o que já se sabe.
          name: e.name ?? s.entities[e.gid]?.name,
          // HP negativo = "não sei" no protocolo do rAthena; não pode apagar o
          // valor que a plaquinha já tinha.
          hp: e.hp !== undefined && e.hp >= 0 ? e.hp : s.entities[e.gid]?.hp,
          maxHp: e.maxHp !== undefined && e.maxHp > 0 ? e.maxHp : s.entities[e.gid]?.maxHp,
          level: e.level ?? s.entities[e.gid]?.level,
        },
      },
    })),

  move: (gid, from, to, speed, startTime) =>
    set((s) => {
      const bruto = s.entities[gid];
      if (!bruto) return s;
      const now = performance.now();
      /**
       * Promove o pendente ANTES de qualquer coisa.
       *
       * A fila tem uma posição só. Se um terceiro pacote chegar com um ainda
       * guardado, o guardado tem de virar o trecho corrente primeiro — senão ele
       * seria descartado e o mob pularia o pedaço do caminho que ele descrevia.
       */
      const prev: NetEntity =
        bruto.proximo && now >= bruto.proximo.movedAt
          ? { ...bruto, ...bruto.proximo, proximo: undefined }
          : bruto;
      const stepSpeed = speed && speed > 0 ? speed : prev.speed;
      // mesma continuidade do próprio personagem: mob que muda de rumo no meio
      // do caminho continua de onde está desenhado
      const atual = interpolatedCell(prev, now);
      /**
       * INTERPOLAÇÃO DE SNAPSHOTS — desenhar o mundo dos outros um pouco no
       * PASSADO, para o pacote atrasado ainda chegar a tempo.
       *
       * Sem isto, cada `entity:move` era ancorado na hora de CHEGADA e o trecho
       * começava ali. Sob ping com jitter dá o sintoma clássico: o trecho
       * termina, `interpolatedCell` devolve `moving: false`, o mob CONGELA e
       * entra em `idle` — e o pacote atrasado o faz SALTAR. É o "anda aos
       * trancos".
       *
       * O jeito clássico é renderizar em `now − atraso`. Aqui a conta é a mesma
       * feita do outro lado: em vez de atrasar o relógio de leitura, atrasa-se a
       * ÂNCORA do trecho. É matematicamente idêntico e sai muito mais barato —
       * nenhuma fila de snapshots por entidade, nenhuma busca por quadro, e o
       * `interpolatedCell` não muda (nem para o minimapa, que o usa também).
       *
       * Com a âncora atrasada, o trecho ANTERIOR termina exatamente quando este
       * começa: `S_k = S_{k-1} + D_{k-1}` para quem anda sem parar, e os dois
       * levam o mesmo `+ATRASO`. Não há buraco, e há `ATRASO − latência` de
       * folga para o pacote que se atrasar.
       *
       * Isso EXIGE o tick do servidor. Sem ele (pacote antigo, estimativa ainda
       * não formada) cai no comportamento de antes, que nunca dependeu disso.
       *
       * Nada aqui toca o jogador local: `selfMove` é outra ação, e atrasar o
       * personagem seria desfazer a predição.
       */
      const inicioServidor = paraRelogioLocal(startTime ?? 0, now);
      const temTick = (startTime ?? 0) > 0 && desvioDoRelogio() !== null;
      const inicio = temTick ? inicioServidor + ATRASO_DE_INTERPOLACAO : now;
      /**
       * A hora dele ainda não chegou, e o trecho de agora ainda está rolando?
       * Então ele ESPERA na fila.
       *
       * Aplicar já seria jogar a folga fora: o trecho corrente seria cortado no
       * meio e a entidade saltaria para a origem do novo, que está à frente de
       * onde ela é desenhada. Foi exatamente o que o teste "posição só avança"
       * pegou.
       */
      const correndoAinda = now < prev.movedAt + prev.durationMs;
      if (temTick && inicio > now && correndoAinda) {
        const proximo: Segmento = {
          x: from.x,
          y: from.y,
          toX: to.x,
          toY: to.y,
          movedAt: inicio,
          ...buildMotion(from, to, stepSpeed),
        };
        return { entities: { ...s.entities, [gid]: { ...prev, speed: stepSpeed, proximo } } };
      }

      /**
       * Aplicação imediata: sem tick, ou o trecho anterior já acabou.
       *
       * Aqui vale a continuidade visual de sempre — partir de onde a entidade
       * está DESENHADA, nunca da célula do pacote, que fica atrás. É a mesma
       * regra do `selfMove`, e é ela que impede o andar de ré.
       */
      const seguindo = atual.moving;
      const origem = seguindo ? { x: atual.x, y: atual.y } : from;
      const origemCel = seguindo ? { x: Math.round(atual.x), y: Math.round(atual.y) } : from;
      return {
        entities: {
          ...s.entities,
          [gid]: {
            ...prev,
            x: origem.x,
            y: origem.y,
            toX: to.x,
            toY: to.y,
            /**
             * A âncora atrasada vale AQUI TAMBÉM, inclusive quando ela cai no
             * futuro (entidade parada recebendo um trecho novo).
             *
             * Prender em `now` parecia cautela e era o contrário: fazia o mob
             * parado sair andando na hora enquanto o que já andava saía
             * atrasado — dois relógios diferentes para o mesmo mundo. Quem
             * segura a entidade até a hora chegar é o `decorrido < 0` do
             * `interpolatedCell`, que existe exatamente para isto.
             */
            movedAt: temTick ? inicio : now,
            // mesma correção do próprio personagem: o primeiro passo cobra o
            // tempo da distância REAL, não o de uma célula inteira
            speed: stepSpeed,
            proximo: undefined,
            ...buildMotion(origemCel, to, stepSpeed, origem),
          },
        },
      };
    }),

  /**
   * `ZC_STOPMOVE` das OUTRAS entidades — a mesma regra do `aplicarFixpos`.
   *
   * O mob também parava no CENTRO do tile: este pacote chega toda vez que ele
   * interrompe a caminhada (ao atacar, ao ser atingido, ao terminar a rota) e
   * carrega só a célula inteira, porque `unit_stop_walking` força `sx = sy = 8`
   * antes de mandá-lo. Com `durationMs: 0` cravado no inteiro, um monstro que
   * estava a meio passo dava um pulinho a cada golpe — e há dezenas deles na
   * tela.
   *
   * A célula continua sendo do servidor, sem tolerância; o que se preserva é o
   * deslocamento DENTRO dela. Sub-célula de monstro não entra aqui — a IA e o
   * movimento do mob continuam em células inteiras, como no rAthena. Isto é só
   * remoção de snap artificial.
   */
  stop: (gid, x, y) =>
    set((s) => {
      const prev = s.entities[gid];
      if (!prev) return s;
      const now = performance.now();
      const atual = interpolatedCell(prev, now);
      const gap = Math.hypot(atual.x - x, atual.y - y);
      // longe demais para ter sido uma parada: é warp/knockback, e ali o centro
      // da célula é a resposta certa (não há offset anterior que signifique nada)
      const teleporte = gap > FIXPOS_TELEPORTE;
      const alvo = teleporte ? { x, y } : preservandoSubCelula(atual, x, y);
      const parado = Math.hypot(alvo.x - atual.x, alvo.y - atual.y) < FIXPOS_EPSILON;
      return {
        entities: {
          ...s.entities,
          [gid]: {
            ...prev,
            x: teleporte ? alvo.x : atual.x,
            y: teleporte ? alvo.y : atual.y,
            toX: alvo.x,
            toY: alvo.y,
            movedAt: now,
            durationMs: teleporte || parado ? 0 : FIXPOS_SUAVIZACAO_MS,
            // o servidor disse que a caminhada acabou: o trecho que estava na
            // fila descreve um futuro que não vai acontecer
            proximo: undefined,
            // e a rota também morre — sem isto o `interpolatedCell` seguiria os
            // `stepEnds` do caminho velho durante a correção
            path: undefined,
            stepEnds: undefined,
          },
        },
      };
    }),

  vanish: (gid) =>
    set((s) => {
      if (!s.entities[gid]) return s;
      const next = { ...s.entities };
      delete next[gid];
      // morreu/sumiu de vista: o alvo tem que cair junto, senão o HUD segura a
      // barra de vida de um mob que não existe mais.
      return {
        entities: next,
        gids: s.gids.filter((g) => g !== gid),
        target: s.target === gid ? null : s.target,
      };
    }),

  rename: (gid, name) =>
    set((s) => (s.entities[gid] ? { entities: { ...s.entities, [gid]: { ...s.entities[gid]!, name } } } : s)),

  setLevel: (gid, level) =>
    set((s) => (s.entities[gid] ? { entities: { ...s.entities, [gid]: { ...s.entities[gid]!, level } } } : s)),

  setHp: (gid, hp, maxHp) =>
    set((s) => (s.entities[gid] ? { entities: { ...s.entities, [gid]: { ...s.entities[gid]!, hp, maxHp } } } : s)),

  limparEntidades: () => set((s) => ({ entities: {}, gids: [], target: null, geracao: s.geracao + 1 })),

  clear: () => {
    esquecerPrevistos();
    set((s) => ({ entities: {}, gids: [], self: IDLE_SELF, target: null, geracao: s.geracao + 1 }));
  },
}));

// Espelho do estado do mundo no console, no mesmo espírito do __playStats do
// PlayView: sem isso, depurar "o servidor mandou o mob?" vira adivinhação.
// `typeof window` porque este módulo é importado por TESTE (ambiente node, sem
// window) — o auxiliar de console não pode derrubar a suíte
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __world?: () => unknown }).__world = () => {
    const s = useWorldStore.getState();
    return {
      selfGid: s.selfGid,
      self: s.self,
      alvo: s.target,
      entidades: Object.values(s.entities).map((e) => ({
        gid: e.gid,
        tipo: e.kind,
        job: e.job,
        nome: e.name,
        nivel: e.level,
        hp: e.hp !== undefined ? `${e.hp}/${e.maxHp}` : undefined,
        celula: [e.x, e.y],
        destino: [e.toX, e.toY],
      })),
    };
  };
}

/**
 * Célula interpolada no instante `now` (fracionária — a cena converte para
 * posição de mundo).
 *
 * O caminho NÃO é uma reta entre origem e destino: o Ragnarok anda de célula em
 * célula, oito direções, uma por vez. Interpolar em linha reta fazia o
 * personagem cortar diagonal por cima de tudo e chegar "deslizando"; aqui ele
 * percorre os mesmos passos que o servidor percorreu, cada um durando
 * `speed` ms — que é exatamente o que o rAthena quer dizer com velocidade
 * (ms por célula, menor = mais rápido).
 */
export function interpolatedCell(
  e: NetEntity | SelfMotion,
  now: number,
): { x: number; y: number; moving: boolean } {
  /**
   * O trecho pendente assume quando chega a hora dele.
   *
   * É aqui que o buffer de snapshots vira desenho, e é de propósito que seja
   * numa função PURA: nada precisa promover nada por quadro, nem mutar o store,
   * e todo mundo que já lê a posição (a cena, o minimapa, os testes de
   * orçamento) ganha o comportamento de graça. O custo é uma comparação.
   */
  const proximo = (e as NetEntity).proximo;
  if (proximo && now >= proximo.movedAt) e = proximo as typeof e;

  if (e.durationMs <= 0) {
    return { x: e.toX, y: e.toY, moving: false };
  }
  const decorrido = now - e.movedAt;
  /**
   * Trecho que ainda NÃO COMEÇOU: segura na origem.
   *
   * Acontece por construção desde a interpolação de snapshots — a âncora de uma
   * entidade remota é atrasada em `ATRASO_DE_INTERPOLACAO`, então todo trecho
   * novo começa um pouco no futuro. Sem esta guarda, `decorrido` negativo faria
   * a fração do primeiro passo sair NEGATIVA e a entidade seria desenhada ANTES
   * da origem, ou seja, andando de ré.
   *
   * `moving: false` é o certo: ela está parada mesmo, esperando a hora de sair.
   * Na prática ninguém vê essa parada — o trecho anterior termina exatamente
   * quando este começa (ver `move`).
   *
   * Estritamente MENOR que zero: `decorrido === 0` é o trecho começando AGORA,
   * e tratá-lo como futuro faria todo movimento que nasce no mesmo
   * milissegundo da leitura (predição, e todo teste de relógio falso) nascer
   * parado.
   */
  if (decorrido < 0) {
    return { x: e.x, y: e.y, moving: false };
  }
  const t = decorrido / e.durationMs;
  if (t >= 1) {
    return { x: e.toX, y: e.toY, moving: false };
  }

  // CAMINHO conhecido (o mesmo A* do servidor): segue passo a passo, cada um
  // com a sua duração — a diagonal leva 40% a mais. É isto que impede o
  // personagem de cortar reto por cima de uma parede.
  if (e.path && e.path.length > 0 && e.stepEnds && e.stepEnds.length === e.path.length) {
    let i = 0;
    while (i < e.stepEnds.length && decorrido > e.stepEnds[i]!) i++;
    if (i >= e.path.length) return { x: e.toX, y: e.toY, moving: false };
    const inicioPasso = i === 0 ? 0 : e.stepEnds[i - 1]!;
    const duracaoPasso = e.stepEnds[i]! - inicioPasso;
    const frac = duracaoPasso > 0 ? (decorrido - inicioPasso) / duracaoPasso : 1;
    const de = i === 0 ? { x: e.x, y: e.y } : e.path[i - 1]!;
    const para = e.path[i]!;
    return {
      x: de.x + (para.x - de.x) * frac,
      y: de.y + (para.y - de.y) * frac,
      moving: true,
    };
  }

  const steps = cellDistance({ x: e.x, y: e.y }, { x: e.toX, y: e.toY });
  if (steps <= 1) {
    return { x: e.x + (e.toX - e.x) * t, y: e.y + (e.toY - e.y) * t, moving: true };
  }

  // Passo "de rei": anda na diagonal enquanto os dois eixos têm distância, e
  // reto no que sobrar — é o caminho que o rAthena traça em terreno livre.
  const progress = t * steps;
  const done = Math.floor(progress);
  const frac = progress - done;

  const from = stepTowards({ x: e.x, y: e.y }, { x: e.toX, y: e.toY }, done);
  const next = stepTowards({ x: e.x, y: e.y }, { x: e.toX, y: e.toY }, done + 1);

  return {
    x: from.x + (next.x - from.x) * frac,
    y: from.y + (next.y - from.y) * frac,
    moving: true,
  };
}

/** posição depois de `steps` passos de rei de `from` em direção a `to` */
function stepTowards(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
): { x: number; y: number } {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const n = Math.min(steps, cellDistance(from, to));
  return {
    x: from.x + dx * Math.min(n, Math.abs(to.x - from.x)),
    y: from.y + dy * Math.min(n, Math.abs(to.y - from.y)),
  };
}
