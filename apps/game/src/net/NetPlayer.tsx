import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import type { TerrainQuery } from "@ragnarok/engine-core";
import { fogDistances, type GameplayConfig } from "@ragnarok/game-data";
import { CHARACTER_URLS, useCharacter, type CharacterKey } from "../assets";
import { classModelFor } from "../entities/classModels";
import { EquippedWeapons } from "../entities/EquippedWeapons";
import { usePlayStore } from "../play/playStore";
import { gateway } from "./gateway";
import { cellToWorld, worldToCell, type LegacyMapping } from "./legacyCells";
import {
  interpolatedCell,
  previstosPendentes,
  serverPath,
  temPathfinder,
  tetoDeTrechoPara,
  useWorldStore,
} from "./worldStore";
import { destinoAlcancavel, limitarAlcance } from "./moveTarget";
import { criarFilaDePedidos } from "./filaDePedidos";
import { deveEmendar, respostaDoServidor } from "./emenda";
import { movPedido, movPredito, movRecuada, movSemResposta } from "./movDebug";
import {
  avaliarGatilho,
  codigoDaCausa,
  confirmarQuadro,
  novaCaminhada,
  novoTrecho,
  quadro,
  registrarEvento,
  registrarMeta,
} from "../core/diagnostics/flightRecorder";
import { desvioDoRelogio } from "./relogioDoServidor";
import { celulaParaEncostar, useAttackStore } from "./attackStore";
import { registrarParadaDeMovimento } from "./pararMovimentoDeAcao";
import { pegandoItem, usePickupStore } from "./pickupStore";
import { useGroundItems } from "./GroundItems";
import { usePlayerStore } from "./playerStore";
import { useAimStore } from "./aimStore";
import { estaCastando } from "./castStore";
import { useAtaqueBasico } from "./ataqueBasico";
import { alcanceEfetivoDaSkill } from "./skillCatalog";
import { celulaNoAlcance, dentroDoAlcance, useSkillWalkStore } from "./skillWalkStore";
import { useSkillTargetStore } from "./skillTargetStore";
import { pulsoDe } from "./combatAnim";
import { SelfBars } from "./SelfBars";
import { footstepFrame } from "../audio/footsteps";
import { registrarPedidoDeColeta } from "../audio/itemSfx";
import { SQUARE_SIZE } from "../grid/squareGrid";
import { linhaDeVisaoLivre } from "./lineOfSight";
import { registrarChecagemDeVisao } from "./visao";
import { registrarOlharParaAlvo } from "./olharParaAlvo";

/**
 * O roBrowser limita a 200 ms entre pedidos de caminhada, e é o que o cliente
 * oficial faz. Acima disso o rAthena passa a AGENDAR pedido em timer (ver
 * `net/filaDePedidos`), e destino velho volta a acontecer.
 */
const REQUEST_INTERVAL_MS = 200;

/**
 * Quanto se espera por um `self:move` antes de dar o pedido por perdido.
 *
 * O `unit_walktoxy` recusa EM SILÊNCIO (devolve 0, não responde) quando o
 * caminho passa do teto — e o teto é medido a partir da célula em que o SERVIDOR
 * acha que o personagem está, não da que o cliente desenha. Sem este prazo o
 * `destinoFinal` ficava valendo para sempre e o mesmo trecho era reemitido a
 * cada 200 ms, indefinidamente.
 *
 * 600 ms cobre com folga a ida e volta numa rede local mais o tempo que o
 * servidor leva para aplicar um redirecionamento (ele só recalcula no PRÓXIMO
 * centro de célula, `change_walk_target`, unit.cpp:895).
 */
const RESPOSTA_TIMEOUT_MS = 600;

/**
 * Por quanto tempo se persegue um alvo antes de desistir.
 *
 * Sem teto, um monstro do outro lado de um rio (andável para o A* mas longe
 * demais para chegar antes de ele andar de novo) deixaria o personagem
 * correndo atrás para sempre.
 */
const PERSEGUICAO_MAX_MS = 12_000;

/**
 * A que distância já dá para pegar o item, em células.
 *
 * O rAthena confere com `check_distance` em `pc_takeitem` e o padrão é 1 — a
 * célula do item ou uma vizinha. Pedir de mais longe é o pacote que ele
 * descarta calado.
 */
const PEGAR_ALCANCE = 1;

/**
 * Intervalo mínimo entre dois `action:attack` da MESMA ordem de ataque.
 *
 * Cada pedido passa por `unit_stop_attack` no servidor (clif.cpp:11708), então
 * repetir depressa demais zera o cronômetro do golpe e o personagem fica
 * levantando a arma sem nunca baixar. 250 ms dá tempo de andar pelo menos uma
 * célula entre uma recusa e a próxima tentativa.
 */
const REENVIO_ATAQUE_MS = 250;

/**
 * Por quanto tempo a posição que veio na recusa ainda vale.
 *
 * Ela é um instantâneo: o personagem continua andando depois de o pacote sair.
 * Passado esse tempo, a interpolada é o palpite menos ruim — e a recusa
 * seguinte traz uma posição nova.
 */
const POSICAO_SERVIDOR_VALIDA_MS = 400;

/**
 * Por quanto tempo, sem ver um golpe, ainda se considera que o ataque está de pé.
 *
 * Tem de cobrir o golpe mais LENTO do jogo (ASPD baixa passa de um segundo
 * entre golpes), senão o cliente concluiria que o ataque morreu no meio de um
 * combate normal e repetiria o pedido — o que zera o tempo do golpe e trava o
 * personagem levantando a arma sem baixar. 1,5 s dá folga sobre o pior caso.
 */
const ATAQUE_VIVO_MS = 1500;

/**
 * Altura do OLHO, fração da altura do modelo (`views/PlayView.CHAR_MODEL_HEIGHT`,
 * 1.8 — duplicado aqui de propósito, mesma dupla-fonte do `MAX_WALK_PATH_DEFAULT`:
 * mudar um lado sem o outro não quebra nada visualmente, só desalinha a mira da
 * linha de visão com o corpo do personagem).
 *
 * Perto do topo (não da cintura): o RO original mira do busto pra cima, e mirar
 * baixo faria qualquer pedra baixa contar como "montanha bloqueando".
 */
const ALTURA_MODELO = 1.8;
const OLHO_FRACAO = 0.8;

/**
 * Quanto o chão pode passar da reta OLHO-a-OLHO sem contar como bloqueio.
 *
 * Um degrau de menos de um nível (`SQUARE_LEVEL_HEIGHT = 1`, ver `grid/squareGrid`)
 * é ondulação normal de terreno, não relevo de verdade — sem a folga, qualquer
 * pedra ou rampa suave apagaria o alvo do outro lado.
 */
const LOS_MARGEM = 0.75;

/**
 * Abaixo disto não é recuada, é ruído de ponto flutuante.
 *
 * A posição vem de `hypot` sobre floats; um centésimo de célula é menos de um
 * pixel na tela e nunca foi visto por ninguém. O que se persegue é o solavanco.
 */
const RECUADA_MINIMA = 0.01;

/**
 * O personagem do jogador com o SERVIDOR mandando.
 *
 * A diferença para o Player local (play/Player.tsx) é de autoridade: aqui o
 * cliente não move ninguém, ele PEDE (CZ.REQUEST_MOVE via gateway) e desenha o
 * caminho que o map-server confirmou. Se o servidor discordar, o próximo
 * ZC.NOTIFY_PLAYERMOVE reposiciona — é o rubber-band clássico do RO.
 *
 * UMA forma de pedir: clique no chão (o modo tile do RO) → a célula clicada.
 * O WASD existiu aqui e foi REMOVIDO — era um segundo caminho com regras
 * próprias (pulava o `pedirMovimento`, e portanto o alcance, a alcançabilidade e
 * a quebra por `max_walk_path`) disputando a mesma janela de 200 ms do clique.
 */
export function NetPlayer({
  map,
  mapping,
  gameplay,
  positionRef,
  // sem override, o personagem/arma/animação vêm da classe real do servidor
  // (`character/characterStore`, ver `entities/classModels`) — passar
  // `characterKey` força um modelo específico (demo/teste) e cai de volta na
  // família de clip genérica (histórico "Mago") por não saber a arma certa.
  characterKey,
  cellSize,
  terrain,
}: {
  map: GameMap;
  mapping: LegacyMapping;
  gameplay: GameplayConfig;
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  characterKey?: CharacterKey;
  /** largura da célula em unidades de mundo (barras e marcador) */
  cellSize: number;
  /**
   * Relevo do mapa — usado só para a linha de visão (`net/visao`): sem ele
   * (preview do editor, sem sessão) a checagem cai aberta, como sempre que um
   * dado opcional falta aqui (ver `temPathfinder()`).
   */
  terrain?: TerrainQuery;
}) {
  const group = useRef<THREE.Group>(null);
  /** só o boneco gira; o que fica no grupo raiz não acompanha a virada */
  const model = useRef<THREE.Group>(null);
  /**
   * `stats.class` (`net/playerStore`), NÃO `character/characterStore` — este
   * só serve o modo local/demo (doc do próprio arquivo) e nunca é preenchido
   * numa sessão de verdade, então `data?.jobId` ficava sempre `undefined` e
   * todo mundo caía no fallback Barbarian, sessão real ou não (bug relatado:
   * "caçador tá vindo Barbarian"). `stats.class` é semeado no `char:select`
   * (`seedFromChar`, ver `playerStore.ts`) — é o campo que o char-select E a
   * ficha do próprio jogador já usam pra classe.
   */
  const jobId = usePlayerStore((s) => s.stats.class);
  const classModel = classModelFor(jobId);
  // gid do PRÓPRIO personagem — ver `entities/weaponAnchors`, é o que
  // `EquippedWeapons` usa pra registrar a ponta da arma sob a chave certa
  const selfGid = useWorldStore((s) => s.selfGid);
  const resolvedCharacterKey = characterKey ?? classModel.character;
  const { scene, play, playOnce } = useCharacter(
    CHARACTER_URLS[resolvedCharacterKey],
    gameplay.animationSpeed,
    undefined,
    characterKey ? "mage" : classModel.family,
  );
  /**
   * Ataque e conjuração são pulsos de OUTRO módulo (`net/combatAnim`), não do
   * `self` deste store — o mesmo golpe que faz a barra de dano piscar é a
   * deixa da animação. `ocupadoAte` é até quando a animação de combate É DONA
   * do loco (nem idle nem walk/run interrompem enquanto ela toca).
   */
  const ultimoPulsoVisto = useRef(0);
  const ocupadoAte = useRef(0);
  const emCombateAntes = useRef(false);
  const moveTarget = usePlayStore((s) => s.moveTarget);
  const setMoveTarget = usePlayStore((s) => s.setMoveTarget);
  const wasMoving = useRef(false);
  /**
   * UMA janela de pedido para o clique e a emenda (ver `net/filaDePedidos`).
   *
   * Antes só a emenda respeitava o intervalo; o CLIQUE mandava direto.
   * Spammar clique enchia o rAthena de pedidos, e os que chegavam enquanto o
   * personagem não podia mover viravam TIMER agendado com aquele destino
   * (unit.cpp:876) — disparavam depois e levavam o personagem para uma célula
   * clicada segundos antes. Era o "rollback" que se via ao alternar diagonais.
   */
  const fila = useRef(criarFilaDePedidos<{ x: number; y: number }>(REQUEST_INTERVAL_MS));
  /** destino final quando ele está além do alcance de um pedido só (ver abaixo) */
  const destinoFinal = useRef<{ x: number; y: number } | null>(null);
  /** pedido emitido esperando resposta do servidor (ver `emitir`) */
  const aguardando = useRef<{ alvo: { x: number; y: number }; desde: number } | null>(null);
  /** último `movedAt` visto — é como se sabe que um pacote de movimento chegou */
  const ultimoMovedAt = useRef(0);
  /** último destino pedido pela APROXIMAÇÃO de ataque (dedupe, ver `perseguirAlvo`) */
  const destinoDoAtaque = useRef<{ x: number; y: number } | null>(null);
  /**
   * O mesmo dedupe, para a ida até o alcance da skill.
   *
   * Aqui ele é ainda mais simples que o do ataque, porque o ponto NÃO anda: a
   * caminhada é pedida uma vez e só muda se a ordem mudar. Sem ele, cada volta
   * da fila (200 ms) reemitiria o mesmo destino, e cada `move:to` é um
   * redirecionamento — o mesmo acúmulo de deriva que fazia o solavanco antes do
   * golpe.
   */
  const destinoDaSkill = useRef<{ x: number; y: number } | null>(null);
  /** o mesmo dedupe, para a ida até o alcance de uma skill de ALVO (ver `perseguirParaCastar`) */
  const destinoDoCast = useRef<{ x: number; y: number } | null>(null);
  /** posição desenhada no quadro anterior — só para o detector de recuada (DEV) */
  // `geracao`: de QUAL mundo é esta posição — ver o bloco dos detectores
  const ultimoDesenho = useRef<{ x: number; y: number; movedAt: number; t: number; geracao: number } | null>(null);
  /**
   * De qual trecho a emenda já saiu (dedupe — ver o bloco da emenda).
   *
   * Guarda o `movedAt` do trecho, não o destino: o destino final é o MESMO em
   * toda a caminhada, e é justamente por isso que compará-lo não filtraria nada.
   * O que muda a cada resposta do servidor é o trecho.
   */
  const emendadoDe = useRef<number | null>(null);
  /**
   * Qual ORDEM está de pé, para o flight recorder abrir uma caminhada quando ela
   * muda (DEV).
   *
   * O clique abre a caminhada no próprio handler, mas as três ordens de vários
   * quadros (ataque, coleta, skill) pedem caminhada sozinhas, quadro a quadro —
   * sem isto, perseguir um mob por meio mapa apareceria como uma caminhada só,
   * ou como uma por pedido. A chave é a IDENTIDADE da ordem (alvo, item,
   * célula), então ela sobrevive aos vários `move:to` da mesma perseguição e
   * troca quando o jogador manda outra coisa.
   *
   * Só escrita: nenhuma decisão de movimento lê este ref.
   */
  const ordemCorrente = useRef<string | null>(null);

  /**
   * Até onde um clique manda andar, em células — a borda da NÉVOA.
   *
   * Sai do mesmo número que fecha a vista (a névoa, que é fração do raio de
   * render — admin
   * /game-editor) dividido pelo tamanho da célula, então mexer na névoa mexe no
   * alcance do clique junto: o jogador anda até onde enxerga, nem menos (era o
   * relato de "range de clique curto") nem para dentro do nada.
   */
  const alcanceDeCliqueCelulas = Math.max(8, Math.round(fogDistances(gameplay).far / Math.max(0.5, cellSize)));

  /**
   * A quantas células do fim do trecho já se pede o próximo.
   *
   * Três células a ~0,2 s cada dão folga de sobra para a ida e volta do pacote
   * numa rede local, e é o bastante para o personagem nunca parar entre trechos.
   * Mais que isso e o pedido novo sairia cedo demais, com o servidor ainda
   * calculando a partir de uma célula distante da que se vê.
   */
  const EMENDA_CELULAS = 3;

  /**
   * Dá para VER o alvo — não só alcançar.
   *
   * `dentroDoAlcance` é a MESMA conta do servidor (`battle_check_range`) e
   * continua necessária, mas não é suficiente: o rAthena não sabe de relevo 3D
   * nenhum, então ele aceitaria um cast atravessando uma montanha que o cliente
   * desenhou por cima do `map_cache` dele. Marcha (`net/lineOfSight`) entre os
   * dois OLHOS (posição interpolada de cada lado, elevada por `OLHO_FRACAO`) e
   * amostra o relevo de verdade (`terrain.getHeight`, o mesmo que a malha
   * desenha) — sem `terrain` (preview/editor) cai aberta, como o resto dos
   * dados opcionais deste componente.
   */
  const alvoVisivel = (gid: number): boolean => {
    if (!terrain) return true;
    const alvo = useWorldStore.getState().entities[gid];
    if (!alvo) return true;
    const now = performance.now();
    const celEu = interpolatedCell(useWorldStore.getState().self, now);
    const celAlvo = interpolatedCell(alvo, now);
    const mundoEu = cellToWorld(map, mapping, celEu.x, celEu.y);
    const mundoAlvo = cellToWorld(map, mapping, celAlvo.x, celAlvo.y);
    const olho = ALTURA_MODELO * gameplay.charScale * OLHO_FRACAO;
    const dist = Math.hypot(mundoAlvo.x - mundoEu.x, mundoAlvo.z - mundoEu.z);
    const passos = Math.max(4, Math.ceil(dist / SQUARE_SIZE));
    return linhaDeVisaoLivre(
      { x: mundoEu.x, y: terrain.getHeight(mundoEu.x, mundoEu.z) + olho, z: mundoEu.z },
      { x: mundoAlvo.x, y: terrain.getHeight(mundoAlvo.x, mundoAlvo.z) + olho, z: mundoAlvo.z },
      (x, z) => terrain.getHeight(x, z),
      LOS_MARGEM,
      passos,
    );
  };
  // registrado no RENDER e de novo no efeito abaixo — mesmo motivo do freio de
  // movimento (StrictMode desmonta e remonta em dev)
  registrarChecagemDeVisao(alvoVisivel);
  useEffect(() => {
    registrarChecagemDeVisao(alvoVisivel);
    return () => registrarChecagemDeVisao(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapping, terrain]);

  /**
   * Vira o MODELO para encarar o alvo — a orientação que todo cast de alvo
   * pede, não uma skill de cada vez (ver `net/olharParaAlvo` e
   * `acoes.castarEmAlvo`, o funil por onde toda skill de ALVO passa).
   *
   * Só XZ: gira em torno do eixo Y, como a rotação de movimento logo abaixo —
   * as duas escrevem o MESMO `model.current.rotation.y`, nunca ao mesmo tempo
   * (uma é side-effect de clique/cast, a outra roda todo quadro enquanto anda).
   */
  const olharPara = (gid: number) => {
    const alvo = useWorldStore.getState().entities[gid];
    if (!alvo || !model.current) return;
    const now = performance.now();
    const celEu = interpolatedCell(useWorldStore.getState().self, now);
    const celAlvo = interpolatedCell(alvo, now);
    const mundoEu = cellToWorld(map, mapping, celEu.x, celEu.y);
    const mundoAlvo = cellToWorld(map, mapping, celAlvo.x, celAlvo.y);
    const dx = mundoAlvo.x - mundoEu.x;
    const dz = mundoAlvo.z - mundoEu.z;
    if (dx * dx + dz * dz > 1e-6) model.current.rotation.y = Math.atan2(dx, dz);
  };
  registrarOlharParaAlvo(olharPara);
  useEffect(() => {
    registrarOlharParaAlvo(olharPara);
    return () => registrarOlharParaAlvo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapping]);

  /**
   * Pede para andar até a célula, quebrando o pedido quando for longe demais.
   *
   * O rAthena recusa em SILÊNCIO qualquer caminho acima de
   * `battle_config.max_walk_path` (17 por padrão, unit.cpp:860) — clicar longe
   * simplesmente não fazia nada, e era isso que limitava o alcance do clique.
   * Aqui o cliente calcula o mesmo caminho que o servidor calcularia, manda o
   * trecho que cabe e guarda o resto para pedir quando chegar.
   *
   * A margem de uma célula existe porque quem refaz a conta é o SERVIDOR, a
   * partir da célula onde ELE acha que o personagem está — que pode estar uma à
   * frente da que o cliente desenha.
   */
  const pedirMovimento = (pedido: { x: number; y: number }) => {
    /**
     * CONJURANDO NÃO ANDA — e a regra é do servidor, não nossa.
     *
     * `unit_can_move` (unit.cpp:1813) devolve `false` enquanto `ud->skilltimer`
     * está ativo. Sem esta guarda o cliente PREVIA a caminhada e o personagem
     * saía andando no meio da conjuração, contra o que o servidor ia fazer.
     *
     * Pior que a divergência visual: `unit_walktoxy` NÃO descarta o pedido de um
     * cliente que não pode mover — ele AGENDA (unit.cpp:876,
     * `add_timer(ud->canmove_tick+1, unit_delay_walktoxy_timer, …)`). O clique
     * dado durante a conjuração ressuscitava ao fim dela e levava o personagem
     * para um destino de segundos atrás. É a mesma armadilha que o
     * `filaDePedidos` já documenta para o spam de clique, por outra porta.
     *
     * O pedido é DESCARTADO, não guardado: quem clicou durante a conjuração
     * quer andar a partir de onde vai estar quando ela acabar, e o mundo pode
     * ter mudado. Guardar seria reproduzir de propósito o timer do rAthena.
     *
     * Guarda ÚNICA, no funil: clique, emenda, perseguição de ataque, coleta e
     * ida-até-o-alcance passam todos por aqui.
     */
    if (estaCastando(performance.now())) return;

    const de = interpolatedCell(useWorldStore.getState().self, performance.now());
    const origem = { x: Math.round(de.x), y: Math.round(de.y) };
    /**
     * O clique vale até onde a vista alcança.
     *
     * O plano de clique cobre o mapa INTEIRO, então mirar perto do horizonte
     * podia pedir uma célula a 75+ de distância — o A* varria meio mapa e, se
     * aquele ponto estivesse cercado, devolvia `null` e o clique não fazia nada.
     * Encurtar na mesma direção até a borda da névoa dá o comportamento que se
     * espera: anda para lá até onde dá para ver, e o encadeamento continua a
     * partir dali.
     */
    const destino = limitarAlcance(origem, pedido, alcanceDeCliqueCelulas);

    /**
     * Nunca pedir um caminho que o cliente sabe não existir.
     *
     * Era daqui que saía o "dash": com o `map_cache` do servidor mais velho que
     * o mapa editado, pedir para andar até dentro da montanha fazia o rAthena
     * ACEITAR (para ele aquilo é chão) e responder o movimento; o cliente, sem
     * caminho, caía no passo de rei do `interpolatedCell` e desenhava uma reta
     * por cima do obstáculo. Agora o pedido é redirecionado para a célula
     * alcançável mais próxima — o pé da montanha —, e some se não houver
     * nenhuma.
     *
     * Só vale com colisão registrada: sem pathfinder (preview do editor, ou o
     * instante entre montar e registrar) o pedido segue direto, como antes.
     */
    const resolvido = temPathfinder()
      ? destinoAlcancavel(origem, destino, serverPath)
      : { destino, caminho: [] };
    if (!resolvido) {
      destinoFinal.current = null;
      return;
    }
    const alvo = resolvido.destino;

    // o caminho já veio da resolução acima — sem pathfinder ele é vazio, e aí
    // não há trecho para quebrar (é o preview do editor, terreno livre)
    const caminho = resolvido.caminho;
    /**
     * O teto NÃO é constante.
     *
     * O rAthena aceita `max_walk_path` (30) células por pedido, mas com
     * `OFFICIAL_WALKPATH` ligado — e ele está (`rathena/src/config/core.hpp:26`)
     * — cai para **14** sempre que a linha reta entre as pontas cruzar bloqueio
     * (unit.cpp:865). As duas recusas são SILENCIOSAS: o servidor devolve 0 e
     * não responde nada, e o clique simplesmente não faz efeito.
     */
    const trechoMax = tetoDeTrechoPara(origem, alvo);
    if (caminho.length > trechoMax) {
      const trecho = caminho[trechoMax - 1]!;
      // Só encadeia se o trecho APROXIMA. Sem isso, um destino que o A* nunca
      // alcança (célula de árvore, ilha cercada de parede) fazia o cliente pedir
      // 16 células a cada chegada, para sempre e mudando de rota — o personagem
      // saía vagando sozinho pelo mapa.
      const antes = Math.max(Math.abs(alvo.x - origem.x), Math.abs(alvo.y - origem.y));
      const depois = Math.max(Math.abs(alvo.x - trecho.x), Math.abs(alvo.y - trecho.y));
      destinoFinal.current = depois < antes ? alvo : null;
      emitir(trecho, origem, caminho.length);
      return;
    }
    destinoFinal.current = null;
    emitir(alvo, origem, caminho.length);
  };

  /**
   * PARA de andar — o freio que ESC precisa e que nenhum clique fornece
   * sozinho (ver `net/pararMovimentoDeAcao.ts` para o porquê do truque).
   *
   * Pede `move:to` para a PRÓPRIA célula atual: é o mesmo `move:to` de
   * sempre, só que com destino = origem, o que faz `unit_walktoxy`
   * (unit.cpp:894-899) redirecionar o que já estava em voo para um caminho de
   * comprimento zero. Limpa os três destinos de ordem (ataque, skill de
   * célula, skill de alvo) — sem isso a ordem cancelada voltaria a pedir
   * caminhada no quadro seguinte, porque só o `pendente` dela foi desarmado,
   * não o destino que ela já tinha em voo.
   */
  const pararNoLugar = () => {
    const de = interpolatedCell(useWorldStore.getState().self, performance.now());
    const aqui = { x: Math.round(de.x), y: Math.round(de.y) };
    destinoFinal.current = null;
    destinoDaSkill.current = null;
    destinoDoCast.current = null;
    pedirMovimento(aqui);
  };
  // registrado no RENDER (idem `setPathfinder`) e de novo no efeito abaixo —
  // sem os dois, o StrictMode desliga o freio a sessão inteira.
  registrarParadaDeMovimento(pararNoLugar);
  useEffect(() => {
    registrarParadaDeMovimento(pararNoLugar);
    return () => registrarParadaDeMovimento(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Manda o pedido e ABRE UMA JANELA DE RESPOSTA.
   *
   * Quando o servidor recusa (caminho longo demais para a célula em que ELE
   * acha que o personagem está), ele não responde nada — e o `destinoFinal`
   * continuava valendo. Como `quaseLa` é verdadeiro em TODO quadro enquanto o
   * personagem está parado, o mesmo trecho era reemitido a cada 200 ms, para
   * sempre, cada vez rodando um A* — o personagem plantado e o cliente
   * martelando o servidor. Era a "travada" do relato.
   */
  const emitir = (
    alvo: { x: number; y: number },
    origem: { x: number; y: number },
    passos: number,
  ) => {
    movPedido(origem, alvo, passos);
    aguardando.current = { alvo, desde: performance.now() };
    // um trecho a mais DENTRO da caminhada corrente (o clique abriu a
    // caminhada; a emenda e o redirecionamento só somam trechos a ela)
    novoTrecho();
    gateway().emit("move:to", alvo);
    /**
     * CLIENT-SIDE PREDICTION: sai andando agora, sem esperar a resposta.
     *
     * O `move:to` acabou de sair e a resposta vai demorar um RTT. Antes disto o
     * personagem ficava CRAVADO nesse intervalo — com 100 ms de ping, mais os
     * até 200 ms da janela do `filaDePedidos`, passava de 300 ms entre clicar e
     * o primeiro pixel de movimento.
     *
     * Prever é seguro aqui porque este pedido já passou por `destinoAlcancavel`
     * (o mesmo A* do servidor) e pelo teto de `max_walk_path` — as mesmas duas
     * regras que o rAthena aplica antes de aceitar. E como a janela de 200 ms
     * fica ANTES daqui, a predição também a torna invisível: o pedido pode
     * esperar na fila, mas o boneco não.
     *
     * As duas guardas: sem pathfinder (preview do editor) não há colisão para
     * conferir, e sem caminho (`passos === 0`) o `buildMotion` cai no passo de
     * REI — a reta que atravessa parede, exatamente o "dash" que
     * `net/moveTarget` existe para impedir. Nos dois casos, pedir e esperar.
     */
    if (temPathfinder() && passos > 0) {
      useWorldStore.getState().preverMovimento(origem, alvo);
      movPredito(alvo, passos);
    }
  };

  /**
   * Anda até o alvo e bate — o "auto-attack" do RO.
   *
   * ## Quem decide que dá para bater é o SERVIDOR, não o cliente
   *
   * A primeira versão daqui esperava CHEGAR (distância de Chebyshev sobre a
   * posição interpolada) para só então mandar `action:attack`. Era o "ele chega
   * do lado do mob e não ataca": a posição desenhada corre à frente da que o
   * servidor tem, então o cliente se dava por chegado uma célula antes, mandava
   * o ataque, o servidor respondia "longe demais" — e como a ordem era encerrada
   * ali, o personagem parava de andar. O ciclo se repetia sem nunca encostar.
   *
   * O jeito certo está no próprio `unit_attack` (unit.cpp:2959):
   *
   * ```c
   * // Remember the attack request from the client while walking to the next cell
   * if(src->type == BL_PC && ud->walktimer != INVALID_TIMER && !battle_check_range(...)) {
   *     ud->stepaction = true;
   *     ud->target_to = ud->target;
   *     // Attacking will be handled by unit_walktoxy_timer in this case
   *     return USW_NONE;
   * }
   * ```
   *
   * Pedido de ataque que chega **enquanto o personagem anda** não é recusado: o
   * servidor o guarda e ATACA SOZINHO ao chegar. Então o cliente não tem que
   * medir alcance nenhum — tem que andar na direção do alvo e repetir o pedido
   * enquanto anda.
   *
   * ## Por que o reenvio não vira spam
   *
   * Cada `action:attack` passa por `unit_stop_attack` (clif.cpp:11708), então
   * repetir sem parar zeraria o cronômetro do golpe e o personagem nunca
   * atacaria. O reenvio é DIRIGIDO PELO SERVIDOR: só sai quando um
   * `ZC_ATTACK_FAILURE_FOR_DISTANCE` novo chegou (`pendente`), e cada recusa
   * arma exatamente um pedido. Aceitou? O silêncio encerra o assunto e o ataque
   * contínuo passa a ser dele.
   */
  const perseguirAlvo = (now: number, self: { x: number; y: number }) => {
    void self;
    const alvo = useAttackStore.getState().alvo;
    if (!alvo) {
      // sem ordem, o dedupe não pode guardar o destino da ordem passada: a
      // próxima começaria achando que já pediu aquela célula
      destinoDoAtaque.current = null;
      return;
    }

    const inimigo = useWorldStore.getState().entities[alvo.gid];
    if (!inimigo) {
      useAttackStore.getState().parar();
      return;
    }

    // desiste depois de um tempo: sem isto, um alvo inalcançável (do outro lado
    // de um rio) faria o personagem tentar para sempre
    if (now - alvo.desde > PERSEGUICAO_MAX_MS) {
      useAttackStore.getState().parar();
      return;
    }

    // O alvo ANDA: mira a posição ATUAL dele, não a que veio no pacote — senão o
    // personagem corre para onde o mob estava.
    const cel = interpolatedCell(inimigo, now);
    const dele = { x: Math.round(cel.x), y: Math.round(cel.y) };

    /**
     * Onde o personagem está, para decidir se JÁ CHEGOU.
     *
     * Prefere a posição que o servidor mandou na recusa (`euX/euY`), que é a
     * única sem a deriva do desenho. Fora da validade dela vale a interpolada —
     * é o caso do primeiro clique, em que ainda não houve recusa nenhuma.
     */
    const eu =
      now - alvo.euEm < POSICAO_SERVIDOR_VALIDA_MS
        ? { x: alvo.euX, y: alvo.euY }
        : (() => {
            const m = interpolatedCell(useWorldStore.getState().self, now);
            return { x: Math.round(m.x), y: Math.round(m.y) };
          })();

    /**
     * Chegar é ficar do LADO dele, não em cima dele.
     *
     * Pedir para andar até a célula do próprio monstro fazia o personagem
     * SEGUIR o alvo: ele nunca "chega", porque o destino é onde o mob está, e o
     * pedido era refeito a cada volta da fila. Aqui a caminhada mira a célula a
     * `alcance` do mob na direção de quem persegue, e para de ser pedida assim
     * que a distância já é essa.
     */
    /**
     * Só pede caminhada quando o DESTINO muda.
     *
     * Sem isto a aproximação reemitia o mesmo destino a cada volta da fila
     * (200 ms), e cada `move:to` é um redirecionamento: o servidor refaz o
     * caminho a partir da célula dele e o cliente redesenha a partir da posição
     * visual, que corre à frente. Com um redirecionamento a cada 200 ms os
     * trechos ficam curtos demais para a correção por tempo dissolver a
     * diferença, e ela se acumula — até o `clif_fixpos` do ataque
     * (unit.cpp:2975) cobrar tudo de uma vez, que é o solavanco antes do golpe.
     *
     * Com o dedupe, um mob parado custa UM pedido; um mob andando custa um por
     * célula que ele anda.
     */
    const encostar = celulaParaEncostar(eu, dele, alvo.range);
    const anterior = destinoDoAtaque.current;
    if (!encostar) {
      destinoDoAtaque.current = null;
    } else if (!anterior || anterior.x !== encostar.x || anterior.y !== encostar.y) {
      destinoDoAtaque.current = encostar;
      fila.current.pedir(encostar, now, pedirMovimento);
    }

    /**
     * Quando repetir o `action:attack`.
     *
     * Este pedido não tem resposta de sucesso, e o servidor pode dar três
     * destinos a ele: bater (e mandar `ZC_NOTIFY_ACT`), recusar por distância
     * (`ZC_ATTACK_FAILURE_FOR_DISTANCE`), ou GUARDAR para executar ao chegar na
     * próxima célula (`stepaction`, unit.cpp:2959). O terceiro é o que fazia o
     * personagem chegar do lado do mob e ficar parado: o `stepaction` só é
     * executado DENTRO do `unit_walktoxy_timer` (unit.cpp:724), ou seja, enquanto
     * ele anda — e cada `move:to` novo que a aproximação manda cancela a ação
     * guardada (`unit_stop_stepaction`, unit.cpp:2956). Chegando e parando,
     * ninguém mais dispara nada, e era por isso que só clicar de novo resolvia.
     *
     * Então há duas razões para repetir, e as duas são observadas, não supostas:
     *  • o servidor RECUSOU (`pendente`) — o pedido morreu, manda outro;
     *  • o personagem deveria estar batendo e NÃO está (`entity:action` do
     *    próprio gid não chega há um tempo). É o clique que o jogador estava
     *    dando na mão.
     *
     * E é o golpe acontecendo que faz a repetição parar: com o servidor batendo,
     * `entity:action` chega a cada golpe e a segunda condição nunca é verdadeira
     * — importante, porque cada pedido passa por `unit_stop_attack`
     * (clif.cpp:11708) e repetir durante o combate zeraria o tempo do golpe.
     */
    const atacando = now - useAttackStore.getState().atacandoEm < ATAQUE_VIVO_MS;
    const precisaInsistir = !encostar && !atacando;
    /**
     * Alcance não é visibilidade (`net/visao`): o rAthena aceitaria o golpe
     * mesmo com uma montanha entre os dois (ele não conhece o relevo 3D), então
     * quem barra isso é o cliente, aqui, ANTES do pacote sair — nunca só a UI.
     * Sem LOS o pedido some (nem entra na fila de reenvio); volta a sair sozinho
     * assim que o alvo (ou o personagem) sair de trás do obstáculo.
     */
    if ((alvo.pendente || precisaInsistir) && now - alvo.pedidoEm >= REENVIO_ATAQUE_MS && alvoVisivel(alvo.gid)) {
      useAttackStore.getState().marcarPedido(now);
      gateway().emit("action:attack", { gid: alvo.gid, continuous: true });
    }
  };

  /**
   * Anda até o item e pega — o mesmo desenho da perseguição de ataque.
   *
   * `CZ.ITEM_PICKUP` só vale coladinho: o rAthena confere a distância em
   * `pc_takeitem` e recusa em silêncio de longe. O item NÃO anda, então basta a
   * célula onde ele caiu.
   */
  const buscarItem = (now: number) => {
    const alvo = usePickupStore.getState().alvo;
    if (!alvo) return;

    // alguém pegou antes, ou o servidor mandou sumir
    if (!useGroundItems.getState().items[alvo.gid]) {
      usePickupStore.getState().parar();
      return;
    }
    if (now - alvo.desde > PERSEGUICAO_MAX_MS) {
      usePickupStore.getState().parar();
      return;
    }

    const meu = interpolatedCell(useWorldStore.getState().self, now);
    const eu = { x: Math.round(meu.x), y: Math.round(meu.y) };
    const dist = Math.max(Math.abs(alvo.x - eu.x), Math.abs(alvo.y - eu.y));
    if (dist <= PEGAR_ALCANCE) {
      usePickupStore.getState().parar();
      destinoFinal.current = null;
      usePickupStore.getState().marcarPedido(now);
      // marca o pedido REAL de coleta (não o clique) — `audio/itemSfx` casa
      // com o `inv:add` que confirma, e só aí toca o som
      registrarPedidoDeColeta();
      gateway().emit("item:pickup", { gid: alvo.gid });
      return;
    }

    fila.current.pedir({ x: alvo.x, y: alvo.y }, now, pedirMovimento);
  };

  /**
   * Anda até a borda do alcance e SOLTA A MAGIA — a terceira ordem de vários
   * quadros, ao lado de `perseguirAlvo` e `buscarItem`.
   *
   * O ponto NÃO se move (é uma célula, não um monstro), então a caminhada é
   * pedida UMA vez: enquanto o destino não muda, o dedupe segura. Quem decide
   * "chegou" é a mesma conta do servidor (`dentroDoAlcance`), e não a chegada ao
   * destino — se o caminho passar dentro do alcance antes do fim, lança dali.
   */
  const lancarSkillPendente = (now: number) => {
    const p = useSkillWalkStore.getState().pendente;
    if (!p) {
      // sem ordem, o dedupe não pode guardar o destino da anterior
      destinoDaSkill.current = null;
      return;
    }

    /**
     * Desiste depois de um tempo.
     *
     * Mesmo teto da perseguição de ataque, e pelo mesmo motivo: um ponto do
     * outro lado de um rio faria o personagem tentar para sempre. Aqui é ainda
     * mais importante — o alvo é uma célula escolhida no mapa, e nada garante
     * que exista rota até perto dela.
     */
    if (now - p.desde > PERSEGUICAO_MAX_MS) {
      useSkillWalkStore.getState().parar();
      return;
    }

    const meu = interpolatedCell(useWorldStore.getState().self, now);
    const eu = { x: Math.round(meu.x), y: Math.round(meu.y) };

    if (dentroDoAlcance(eu, p, p.raio)) {
      // a ordem morre ANTES do emit: `skill:use-ground` não tem resposta de
      // sucesso, e deixá-la de pé faria o quadro seguinte lançar de novo
      useSkillWalkStore.getState().parar();
      destinoDaSkill.current = null;
      destinoFinal.current = null;
      gateway().emit("skill:use-ground", { skillId: p.skillId, level: p.level, x: p.x, y: p.y });
      return;
    }

    const destino = celulaNoAlcance(eu, p, p.raio);
    if (!destino) return;
    const anterior = destinoDaSkill.current;
    if (anterior && anterior.x === destino.x && anterior.y === destino.y) return;
    destinoDaSkill.current = destino;
    fila.current.pedir(destino, now, pedirMovimento);
  };

  /**
   * Anda até o alcance e LANÇA A MAGIA NELE — a quarta ordem de vários
   * quadros, irmã de `perseguirAlvo` (bater) e `lancarSkillPendente` (célula).
   *
   * Diferente do ataque, não há golpe contínuo: chegando ao alcance, sai UM
   * `skill:use` e a ordem termina — `CZ.USE_SKILL` não tem `stepaction` como o
   * ataque (unit.cpp:2690 só guarda o pedido enquanto o personagem JÁ anda), então
   * reenviar não ajudaria um alvo parado fora de alcance a virar alcançável.
   */
  const perseguirParaCastar = (now: number) => {
    const p = useSkillTargetStore.getState().pendente;
    if (!p) {
      destinoDoCast.current = null;
      return;
    }

    const alvo = useWorldStore.getState().entities[p.gid];
    if (!alvo) {
      useSkillTargetStore.getState().parar();
      return;
    }

    if (now - p.desde > PERSEGUICAO_MAX_MS) {
      useSkillTargetStore.getState().parar();
      return;
    }

    // o alvo anda: mira a posição ATUAL dele, como `perseguirAlvo` já faz
    const cel = interpolatedCell(alvo, now);
    const dele = { x: Math.round(cel.x), y: Math.round(cel.y) };
    const meu = interpolatedCell(useWorldStore.getState().self, now);
    const eu = { x: Math.round(meu.x), y: Math.round(meu.y) };

    /**
     * Alcance não é visibilidade: mesma guarda de `perseguirAlvo`, ver
     * `net/visao`. Sem LOS o pedido não sai — como já está "em alcance",
     * `celulaNoAlcance` abaixo não tem para onde andar (devolve `null`), então
     * a ordem fica parada esperando (o alvo se mover, ou o próprio personagem)
     * até o teto de `PERSEGUICAO_MAX_MS` desistir sozinho.
     */
    if (dentroDoAlcance(eu, dele, p.raio) && alvoVisivel(p.gid)) {
      // a ordem morre ANTES do emit: `skill:use` não tem resposta de sucesso
      // aqui, e deixá-la de pé faria o quadro seguinte lançar de novo
      useSkillTargetStore.getState().parar();
      destinoDoCast.current = null;
      destinoFinal.current = null;
      olharPara(p.gid);
      gateway().emit("skill:use", { skillId: p.skillId, level: p.level, targetGid: p.gid });
      return;
    }

    const destino = celulaNoAlcance(eu, dele, p.raio);
    if (!destino) return;
    const anterior = destinoDoCast.current;
    if (anterior && anterior.x === destino.x && anterior.y === destino.y) return;
    destinoDoCast.current = destino;
    fila.current.pedir(destino, now, pedirMovimento);
  };

  // Contexto da sessão no export: um JSON que não diz em que mapa foi colhido
  // não se lê semanas depois (DEV; em produção o corpo some com o `ativo()`).
  useEffect(() => {
    registrarMeta({ mapa: map.id, nome: map.name, celulas: `${map.size.width}x${map.size.height}` });
  }, [map]);

  // Clique no chão: o GroundInteract já converteu para posição de mundo; aqui
  // vira célula do servidor e vai como pedido.
  useEffect(() => {
    if (!moveTarget) return;
    const cell = worldToCell(map, mapping, moveTarget.x, moveTarget.z);

    // Mirando uma skill de área? O clique aponta a magia em vez de andar — é o
    // segundo passo do fluxo do RO (escolhe a skill, depois o lugar).
    const aiming = useAimStore.getState().skill;
    if (aiming && aiming.mode === "ground") {
      /**
       * Longe demais? ANDA ATÉ O ALCANCE e lança de lá.
       *
       * O rAthena não se aproxima por você: `unit_skilluse_pos2` (unit.cpp:2690)
       * só GUARDA o pedido (`stepaction`) quando o personagem JÁ está andando —
       * parado e fora de alcance, ele devolve 0 e não responde nada. Era por isso
       * que o clique com o disco vermelho simplesmente morria.
       *
       * O jogador disse onde quer a magia; ir até onde dá para soltá-la é
       * execução, não outra decisão. Mesma natureza da ida até o mob para bater
       * (`attackStore`) e até o item para pegar (`pickupStore`).
       */
      const raio = alcanceEfetivoDaSkill(aiming.id);
      const meu = interpolatedCell(useWorldStore.getState().self, performance.now());
      const eu = { x: Math.round(meu.x), y: Math.round(meu.y) };
      if (dentroDoAlcance(eu, cell, raio)) {
        gateway().emit("skill:use-ground", {
          skillId: aiming.id,
          level: aiming.level,
          x: cell.x,
          y: cell.y,
        });
      } else {
        // uma ordem de vários quadros substitui as outras: quem vai lançar magia
        // não está mais indo bater nem pegar item
        useAttackStore.getState().parar();
        usePickupStore.getState().parar();
        useSkillWalkStore.getState().irLancar({
          skillId: aiming.id,
          level: aiming.level,
          name: aiming.name,
          x: cell.x,
          y: cell.y,
          raio,
        });
      }
      useAimStore.getState().cancel();
    } else {
      /**
       * Clicar no chão CANCELA a ida até o alvo — mas não solta o alvo.
       *
       * "Vou até lá bater" é uma ordem em andamento, e mandar andar para outro
       * lugar é dizer que ela não vale mais; sem isto o personagem voltava
       * sozinho para cima do monstro logo depois do clique. O ALVO em si fica
       * selecionado (a placa dele continua na tela), porque cancelar a caminhada
       * não é desistir de olhar para ele — foi o pedido explícito.
       *
       * Vale igual para a coleta: mandar andar para outro lugar cancela o "ir
       * pegar o item".
       */
      useAttackStore.getState().parar();
      usePickupStore.getState().parar();
      useSkillWalkStore.getState().parar();
      useSkillTargetStore.getState().parar();
      /**
       * Clicar FORA do alvo desliga o Ataque Básico.
       *
       * É uma das três saídas do modo (as outras são o alvo morrer e o jogador
       * desligar a skill). Mandar andar para outro lugar é dizer que a briga
       * acabou — sem isto o modo continuaria de pé e o personagem voltaria a
       * perseguir o mob no primeiro alvo novo, sem ninguém ter pedido.
       */
      useAtaqueBasico.getState().desligar();

      // ordem nova = caminhada nova. É este id que liga o clique aos trechos,
      // aos pacotes e aos quadros dele — sem ele, um rollback na costura do
      // quinto trecho não teria como ser ligado ao clique que o originou.
      novaCaminhada();
      registrarEvento("prediction", "clique", { alvo: `${cell.x},${cell.y}` });

      // fila, não emit direto: o clique mais novo substitui o pendente, então
      // nenhum destino velho sobrevive para o servidor agendar
      fila.current.pedir(cell, performance.now(), pedirMovimento);
    }

    setMoveTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveTarget, map, mapping, setMoveTarget]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;

    const self = useWorldStore.getState().self;
    const now = performance.now();

    // a regra mora em `net/emenda` — pura e travada em teste, porque foi ela
    // que a predição quebrou sem que nada denunciasse
    if (respostaDoServidor(self.movedAt, ultimoMovedAt.current, self.predito === true)) {
      /**
       * A ida e volta MEDIDA — daqui, não do socket.
       *
       * É este intervalo que o jogador sente: do pedido sair até o servidor
       * responder algo que o cliente aceita como resposta. Medir no `onAny` do
       * gateway daria um número menor e enganoso, porque o atraso simulado mora
       * no handler, depois dele.
       */
      if (aguardando.current) quadro().rttMedido = now - aguardando.current.desde;
      ultimoMovedAt.current = self.movedAt;
      aguardando.current = null;
    }
    const esperando = aguardando.current;
    if (esperando && now - esperando.desde > RESPOSTA_TIMEOUT_MS) {
      // recusado em silêncio: desiste do destino em vez de repetir para sempre
      aguardando.current = null;
      destinoFinal.current = null;
      movSemResposta(esperando.alvo);
    }

    // solta o pedido que ficou pendente enquanto a janela estava fechada — é o
    // último clique do spam, e é ele que o jogador quer
    fila.current.tick(now, pedirMovimento);

    /**
     * Abre uma caminhada quando a ORDEM muda (DEV, só escrita).
     *
     * Calculado aqui, e não dentro de cada ordem, porque assim o `null` também
     * conta: uma ordem que termina limpa a chave, e reatacar o MESMO monstro
     * depois abre uma caminhada nova — que é o que se quer ler no laudo.
     */
    if (import.meta.env.DEV) {
      // cedo: o gatilho de rollback dispara no meio deste quadro e ancora a
      // captura neste `t`
      quadro().t = now;
      const atk = useAttackStore.getState().alvo;
      const get = usePickupStore.getState().alvo;
      const sk = useSkillWalkStore.getState().pendente;
      const skAlvo = useSkillTargetStore.getState().pendente;
      const ordem = atk
        ? `atk:${atk.gid}`
        : get
          ? `get:${get.gid}`
          : sk
            ? `sk:${sk.x},${sk.y}`
            : skAlvo
              ? `skAlvo:${skAlvo.gid}`
              : null;
      if (ordem !== ordemCorrente.current) {
        ordemCorrente.current = ordem;
        if (ordem) {
          novaCaminhada();
          registrarEvento("prediction", "ordem", { ordem });
        }
      }
    }

    perseguirAlvo(now, self);
    buscarItem(now);
    lancarSkillPendente(now);
    perseguirParaCastar(now);
    const cell = interpolatedCell(self, now);

    // loop de passo: `cell.moving` já É o "andando/parado" que a animação
    // (mais abaixo) usa — o mesmo estado, não um segundo relógio. A célula
    // arredondada só serve pra saber QUAL superfície tocar; cruzá-la não é
    // mais o gatilho (ver `audio/footsteps.footstepFrame`).
    footstepFrame(cell.moving, map, mapping, Math.round(cell.x), Math.round(cell.y));

    /**
     * DETECTOR DE RECUADA (DEV) — o desenho andou para o lado de onde veio?
     *
     * "Ainda tem algo fazendo retroceder" não é diagnóstico: quatro ações
     * escrevem a posição do personagem (predição, pacote do servidor, fixpos e
     * snap) e cada uma recua por um motivo diferente. Aqui se mede o SINTOMA no
     * instante em que ele acontece e se anota o `causa` do trecho — é o que
     * transforma o relato num lugar do código (`__mov().recuadas.porCausa`).
     *
     * Compara-se com o quadro anterior, e só quando o trecho é o MESMO: entre
     * dois trechos o personagem legitimamente muda de direção (o jogador clicou
     * noutro lugar), e contar isso encheria o contador de falso positivo.
     */
    if (import.meta.env.DEV) {
      const geracao = useWorldStore.getState().geracao;
      /**
       * TROCAR DE MAPA NÃO É RECUAR.
       *
       * A posição do quadro anterior descreve o mundo ANTERIOR. Ao entrar num
       * portal o `world:enter` chama `limparEntidades`, o `self` volta para
       * `0,0`, e os dois detectores abaixo passavam a medir a distância da
       * última célula do mapa velho até essa origem: no
       * `voo-1785938553239.json` isso saiu como "rollback de 424 células" (e
       * outro de 101), com `para: "0.00,0.00"` no próprio evento denunciando
       * que não era posição de ninguém. Os dois falsos positivos queimaram
       * metade dos slots de captura do dump.
       *
       * Descartar a referência é o certo, não filtrar por distância: o portal
       * pode levar para uma célula PRÓXIMA (`@jump` curto, warp interno) e ali
       * um limiar de distância não separaria nada.
       */
      const ant = ultimoDesenho.current?.geracao === geracao ? ultimoDesenho.current : null;
      /**
       * SALTO ENTRE TRECHOS — o caso que o detector abaixo não enxerga.
       *
       * O de baixo só compara quadros do MESMO trecho (`ant.movedAt ===
       * self.movedAt`), e com razão: entre dois trechos o jogador legitimamente
       * muda de direção. Só que o solavanco que este projeto persegue acontece
       * EXATAMENTE na troca — o `fixpos` escreve um trecho novo e move o
       * personagem no mesmo quadro. O laudo (`voo-*.json`, caso 1) mostra 7
       * células em 10,5 ms passando batido por aqui, e foi por isso que as três
       * capturas daquele dump tiveram de ser manuais.
       *
       * O critério não precisa saber de trecho nenhum: o personagem anda uma
       * célula a cada `speed` ms (150 no padrão), ou seja, ~0,11 célula por
       * quadro a 60 FPS. Mais de UMA célula num quadro não é caminhada, é
       * descontinuidade — venha ela de fixpos, snap, warp ou pacote.
       *
       * Com uma ressalva que o próprio gravador pegou: a interpolação é por
       * RELÓGIO, então um quadro longo avança muito de uma vez sem que nada
       * esteja errado (400 ms de engasgo = 2,6 células legítimas). Por isso o
       * salto também tem de passar do que o TEMPO decorrido permitia — com
       * folga de 50% para o custo do próprio quadro. Sem essa segunda condição
       * o gatilho passaria a capturar engasgo de GPU achando que é rollback.
       */
      if (ant) {
        const salto = Math.hypot(cell.x - ant.x, cell.y - ant.y);
        const permitido = ((now - ant.t) / Math.max(1, self.speed)) * 1.5;
        if (salto > 1 && salto > permitido) {
          avaliarGatilho("rollback", salto, {
            tipo: "salto",
            causa: self.causa ?? "?",
            de: `${ant.x.toFixed(2)},${ant.y.toFixed(2)}`,
            para: `${cell.x.toFixed(2)},${cell.y.toFixed(2)}`,
            mesmoTrecho: ant.movedAt === self.movedAt,
          });
        }
      }
      if (ant && ant.movedAt === self.movedAt) {
        const dxAnt = ant.x - self.x;
        const dyAnt = ant.y - self.y;
        const dx = cell.x - self.x;
        const dy = cell.y - self.y;
        // distância percorrida desde a origem do trecho: só pode crescer
        const andouAntes = Math.hypot(dxAnt, dyAnt);
        const andouAgora = Math.hypot(dx, dy);
        const recuo = andouAntes - andouAgora;
        if (recuo > RECUADA_MINIMA) {
          movRecuada(recuo, self.causa ?? "?", {
            de: { x: +ant.x.toFixed(2), y: +ant.y.toFixed(2) },
            para: { x: +cell.x.toFixed(2), y: +cell.y.toFixed(2) },
            predito: self.predito === true,
          });
          /**
           * O GATILHO da caixa-preta.
           *
           * O limiar é do gravador (1 célula), não daqui: este detector conta
           * até o ruído de ponto flutuante para o `__mov()`, e capturar 420
           * quadros por causa de um centésimo de célula não serviria a ninguém.
           */
          avaliarGatilho("rollback", recuo, {
            causa: self.causa ?? "?",
            de: `${ant.x.toFixed(2)},${ant.y.toFixed(2)}`,
            para: `${cell.x.toFixed(2)},${cell.y.toFixed(2)}`,
            predito: self.predito === true,
          });
        }
      }
      ultimoDesenho.current = { x: cell.x, y: cell.y, movedAt: self.movedAt, t: now, geracao };
    }

    const world = cellToWorld(map, mapping, cell.x, cell.y);

    // A rotação vai no grupo do MODELO, nunca no grupo raiz: as barras de HP/SP
    // penduradas aqui girariam junto com o boneco (o Billboard do drei compensa
    // o pai com a matriz do frame anterior, então a barra cambaleava a cada
    // curva). Raiz posiciona, filho olha para onde anda.
    const dx = world.x - g.position.x;
    const dz = world.z - g.position.z;
    if (cell.moving && dx * dx + dz * dz > 1e-6 && model.current) {
      model.current.rotation.y = Math.atan2(dx, dz);
    }

    g.position.set(world.x, world.y, world.z);
    positionRef?.current.set(world.x, world.y, world.z);

    /**
     * ANIMAÇÃO DE COMBATE — lida ANTES da de locomoção, porque ela pode tomar
     * o loco por cima dela (ver `ocupadoAte`).
     *
     * O pulso é o mesmo dado que já faz o dano piscar (`entity:action`,
     * `skill:casting`, `skill:cast`) — aqui só se decide QUAL clip tocar.
     * `attack`/`castRelease` são ONE-SHOT (`playOnce`, que devolve a duração
     * real do clip); `castStart` é LOOP (`play`, como idle/walk/run) e dura o
     * que a barra de conjuração do servidor durar — `skill:cast` (ou o fim do
     * prazo) troca para a liberação.
     */
    const selfGid = useWorldStore.getState().selfGid;
    const pulso = pulsoDe(selfGid);
    if (pulso && pulso.em > ultimoPulsoVisto.current) {
      ultimoPulsoVisto.current = pulso.em;
      /**
       * Pegar item ENGOLE o pulso de combate, não só o toca por cima.
       *
       * `pegar()` (`net/acoes`) desliga Ataque Básico e o `attackStore` ANTES
       * de mandar buscar o item, mas um `action:attack` já em voo no servidor
       * (`stepaction`, unit.cpp:2959 — comentário de `perseguirAlvo` acima)
       * pode resolver DEPOIS: o `entity:action` chega, `marcarAtaque` registra
       * o pulso, e o personagem brandia a arma no meio do caminho até o item
       * (relatado: "anima ao pegar item"). Contra-intuitivo pro jogador, que
       * clicou pra PEGAR, não pra bater — pegar item ganha a prioridade
       * visual: o pulso ainda é consumido (`ultimoPulsoVisto` avança, então
       * não some numa animação atrasada assim que o item for pego), só não
       * vira animação.
       *
       * NÃO basta checar só `pickupStore.alvo` — `buscarItem` já limpa o
       * alvo NO INSTANTE em que manda `item:pickup`, antes da resposta do
       * servidor, e é exatamente NESSA janela que o pulso atrasado chega.
       * `pickupStore.ultimoPedidoEm` cobre essa lacuna (ver
       * `PICKUP_ENGOLE_PULSO_MS`, agora no store para o mesmo guard valer
       * também pro som/voz de ataque em `useWorldEvents.onAction`).
       */
      if (pegandoItem(now)) {
        // pulso engolido — ver comentário acima
      } else if (pulso.tipo === "attack") {
        ocupadoAte.current = now + playOnce("attack") * 1000;
      } else if (pulso.tipo === "castStart") {
        play("cast");
        ocupadoAte.current = now + Math.max(150, pulso.duracaoMs ?? 0);
      } else {
        ocupadoAte.current = now + playOnce("castRelease") * 1000;
      }
    }
    const emCombate = now < ocupadoAte.current;
    const saiuDoCombate = emCombateAntes.current && !emCombate;
    emCombateAntes.current = emCombate;
    if (!emCombate && (cell.moving !== wasMoving.current || saiuDoCombate)) {
      wasMoving.current = cell.moving;
      play(cell.moving ? "run" : "idle");
    }

    /**
     * Ainda falta caminho? Pede o próximo trecho ANTES de chegar.
     *
     * O servidor só aceita 17 células por pedido (`max_walk_path`), então uma
     * caminhada longa vai em trechos de 16. Pedir o seguinte só depois de PARAR
     * (`!cell.moving`) fazia o personagem estacar a cada 16 células e esperar a
     * ida e volta do pacote — com os 200 ms de intervalo mínimo, é uma parada
     * visível a cada três passos. Era isso o "range de clique curto": o clique
     * chegava lá, mas andando aos trancos.
     *
     * Emendando a `EMENDA_CELULAS` do fim do trecho, o pedido novo chega
     * enquanto ele ainda anda e a caminhada não tem costura. O rAthena aceita
     * redirecionar no meio do caminho — é o mesmo pacote de sempre, recalculado
     * a partir da célula em que ELE acha que o personagem está.
     */
    const alvoFinal = destinoFinal.current;
    if (alvoFinal) {
      if (Math.round(cell.x) === alvoFinal.x && Math.round(cell.y) === alvoFinal.y) {
        destinoFinal.current = null;
        emendadoDe.current = null;
      } else {
        const falta = Math.max(Math.abs((self.toX ?? cell.x) - cell.x), Math.abs((self.toY ?? cell.y) - cell.y));
        const quaseLa = !cell.moving || falta <= EMENDA_CELULAS;
        // as três condições e o porquê de cada uma: `net/emenda`
        if (
          deveEmendar({
            quaseLa,
            temPedidoNoAr: aguardando.current !== null,
            movedAt: self.movedAt,
            emendadoDe: emendadoDe.current,
          })
        ) {
          emendadoDe.current = self.movedAt;
          fila.current.pedir(alvoFinal, now, pedirMovimento);
        }
      }
    }

    /**
     * FECHA A LINHA DO QUADRO (DEV).
     *
     * Por último de propósito: os outros escritores (`PerfProbe` com o tempo do
     * quadro, `SquareTerrain` com os chunks, o gateway com o pacote) já puseram
     * o que sabem no mesmo rascunho, e é aqui que ele vira uma linha do anel.
     *
     * Um `if` e ~15 escritas em campos numéricos — sem alocar nada, que é a
     * regra do gravador: um objeto por quadro alimentaria justamente a pressão
     * de GC que ele existe para acusar.
     */
    if (import.meta.env.DEV) {
      const q = quadro();
      q.tickServidor = desvioDoRelogio() ?? NaN;
      q.renderX = world.x;
      q.renderZ = world.z;
      q.logicoX = cell.x;
      q.logicoY = cell.y;
      q.movendo = cell.moving ? 1 : 0;
      q.destinoX = self.toX;
      q.destinoY = self.toY;
      q.predito = self.predito ? 1 : 0;
      q.causa = codigoDaCausa(self.causa);
      q.filaPredicao = previstosPendentes();
      q.pedidoNoAr = aguardando.current ? 1 : 0;
      q.temDestinoFinal = destinoFinal.current ? 1 : 0;
      confirmarQuadro();
    }
  });

  return (
    <group ref={group}>
      <group ref={model} scale={gameplay.charScale * classModel.scale}>
        <primitive object={scene} />
        {!characterKey && <EquippedWeapons scene={scene} weapons={classModel.weapons} gid={selfGid} />}
      </group>
      {/* barras de HP/SP embaixo do personagem, como no RO — FORA do grupo que
          gira, senão viram junto com o boneco a cada mudança de direção */}
      <SelfBars cellSize={cellSize} />
    </group>
  );
}
