import { ativo, avaliarGatilho, quadro, quadroCorrente, registrarColetorDeMeta, registrarEvento } from "./flightRecorder";

/**
 * SONDA DE VFX — por que a caixa-preta não conseguia atribuir um quadro
 * lento a uma habilidade.
 *
 * O voo já sabia dizer "o quadro #4021 levou 48 ms" e "a cena tinha 190
 * geometrias". O que faltava era a PERGUNTA seguinte: "o que a skill estava
 * fazendo naquele instante?" — porque os VFX de skill não são three.js. São
 * `drei <Html>`, DOM/CSS puro (achado da auditoria estática anterior: 51
 * `<Html>` contra 0 `<mesh>` em `vfx/mage/**`). `drawCalls`/`triangulos`/
 * `geometrias` continuam certos — medem o DEVICE —, mas não atribuem nada a
 * uma skill, porque uma skill de VFX não desenha nada nesses termos.
 *
 * ## O ponto central (leia1.txt, item 7 do pedido)
 *
 * Existem exatamente DOIS lugares por onde TODO VFX de skill passa, sem
 * exceção — achados na auditoria anterior, não descobertos agora:
 *
 *  1. `vfx/vfxStore.ts` — `spawn()`/`prune()`/`removeUnit()`/`reset()` são a
 *     ÚNICA porta de entrada/saída do MODELO de dados de um VFX (skillId,
 *     kind, gid, expiresAt). Toda skill passa por aqui, sem exceção — é
 *     literalmente a mesma chamada que `net/useWorldEvents.ts` faz com
 *     pacote do servidor de verdade.
 *  2. `vfx/SkillVfx.tsx` (`VfxNode`) — o ÚNICO componente React que monta
 *     para cada efeito (`effects.map((effect) => <VfxNode key={effect.id}
 *     .../>)`), independente de qual das 18 famílias de VFX ele delega.
 *
 * Por isso este módulo não tem 18 pontos de instrumentação: tem DOIS
 * (`marcarVfxStart`/`marcarVfxEnd` no primeiro, `marcarMontagemVfx`/
 * `marcarDesmontagemVfx` no segundo). Nenhum componente de skill
 * individual (`ThunderStormImpact.tsx`, `ColdBoltImpact.tsx`, ...) é
 * tocado.
 *
 * ## O que é medido e como (visão geral — cada seção abaixo detalha)
 *
 *  - **Ciclo de vida** (start/end/mount/unmount) — eventos no anel do voo,
 *    categoria `vfx`, um objeto por chamada (raro: um por cast, nunca por
 *    quadro).
 *  - **Snapshot por quadro** — `amostrarVfx()`, chamada pelo `PerfProbe`
 *    logo depois de `amostrarContadores`/`amostrarCena`, escreve nas NOVAS
 *    colunas do `LinhaQuadro` (`vfxAtivos`, `vfxHtmlCount`,
 *    `vfxDomNodeCount`, `vfxLongTaskCount/Ms`, `vfxMutacoes`) — números,
 *    como todo o resto do rascunho.
 *  - **DOM/Html sem scanner pesado** — `target.children.length` (leitura
 *    O(1), sem `querySelectorAll`) todo quadro para o portal de `<Html>`;
 *    `querySelectorAll("*")` só a ~10 Hz (mesma técnica de
 *    `PASSO_DA_VARREDURA` do `cenaProbe`), e só dentro do container do
 *    CANVAS (`gl.domElement.parentNode`), nunca `document.body` — a HUD
 *    vive FORA desse container (`PlayView`: `<Hud>` é irmã do `<Canvas>`,
 *    não filha), então a varredura já exclui janelas/chat/inventário de
 *    graça.
 *  - **Long task correlacionada** — um `PerformanceObserver('longtask')`
 *    PRÓPRIO (não o de `rendererProbe.ts`, que já existe e continua
 *    intacto): só emite quando há VFX ativo, e atribui a TODAS as skills
 *    ativas no instante — nunca 100% a uma só.
 *  - **Gatilho `vfxPerformanceSpike`** — reusa a tabela de gatilhos e o
 *    mecanismo de captura JÁ EXISTENTES (`avaliarGatilho`/
 *    `dispararCaptura`, declarado em `flightRecorder.ts`); este módulo só
 *    AVALIA, nunca duplica a lógica de janela/caso.
 *  - **Relatório final por skill** — registrado como COLETOR DE META
 *    (`registrarColetorDeMeta`, o mesmo mecanismo do `censo`): calculado
 *    NA HORA DO DESPEJO, não incrementalmente, porque médias/percentis
 *    fazem mais sentido computados uma vez sobre a amostra inteira.
 *
 * ## O interruptor próprio (leia1.txt, item 14)
 *
 * `ativo()` do voo já é DEV-only. Este módulo tem um SEGUNDO interruptor,
 * `vfxInstrumentacaoAtiva()`, guardado em `localStorage` como
 * `ragnarok:voo-vfx` — e ele nasce **DESLIGADO**, ao contrário do voo
 * geral (que nasce ligado). A pedido explícito: esta é instrumentação
 * NOVA e não testada em produção de investigação nenhuma ainda, e o custo
 * de rodar o jogo inteiro com `MutationObserver`/varredura de DOM ligados
 * o tempo todo não deveria ser pago por quem só quer o voo de sempre
 * (rollback, quadro longo, contexto perdido). Ligar: `__voo.vfxLigar()`
 * no console, ou `?vfxperf=1` na URL (mesmo padrão do `?voo=`).
 *
 * ## Extensão — leia1.txt "quero adicionar instrumentação de performance
 * dos VFX ao Flight Recorder" (múltiplas skills juntas, combinações)
 *
 * Tudo abaixo REUSA a arquitetura acima — nenhum sistema paralelo:
 *
 *  - **VFX_CANCEL** — terceiro estado do ciclo de vida, ao lado de start/
 *    end. `vfxStore.ts` chama `marcarVfxCancel` (não `marcarVfxEnd`) nos
 *    DOIS lugares em que uma instância é derrubada de FORA em vez de
 *    terminar por conta própria: buff substituído por recast, e `reset()`
 *    de sessão/mapa. A distinção fica no evento (`vfx/cancel` × `vfx/end`)
 *    e no agregado (`s.cancels` × `s.totalActiveMs`) — sem ela, uma skill
 *    recastada toda hora pareceria "durar pouco", quando na verdade foi
 *    INTERROMPIDA, dado de gameplay, não de performance.
 *  - **Combinações** — `porCombinacao`, alimentada nos DOIS pontos que já
 *    sabem "quadro ruim aconteceu" (o gatilho `vfxPerformanceSpike` e o
 *    observer de long task) — nenhum ponto de captura novo, só mais uma
 *    escrita nos que já existiam. Chave = `vfxId`s ativos, ordenados e sem
 *    repetição.
 *  - **`framesAcima33`/`framesAcima50`** — contadores simples, somados no
 *    MESMO laço de `amostrarVfx()` que já visita cada skill ativa por
 *    quadro; não é amostra nova, é mais um incremento no que já roda.
 *  - **Perfil estrutural estático** (`registrarPerfilEstruturalVfx`) —
 *    DOM/animados/filtrados por instância, um FATO do código-fonte, nunca
 *    medido em runtime. Opcional: `perfilEstrutural: null` no relatório
 *    ("unavailable") pra todo `vfxId` que nenhum componente registrou.
 */

// ---------------------------------------------------------------- flag

const CHAVE_VFX = "ragnarok:voo-vfx";
let vfxLigadoPorFlag = false;

function lerFlagVfxGuardada(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URLSearchParams(window.location.search).get("vfxperf");
    if (url === "1" || url === "0") {
      const v = url === "1";
      localStorage.setItem(CHAVE_VFX, v ? "1" : "0");
      return v;
    }
    return localStorage.getItem(CHAVE_VFX) === "1";
  } catch {
    return false;
  }
}

function gravarFlagVfx(v: boolean): void {
  vfxLigadoPorFlag = v;
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAVE_VFX, v ? "1" : "0");
  } catch {
    /* modo privado / cota cheia */
  }
}

/** está a instrumentação de VFX ligada? (voo geral DEV **e** o interruptor próprio) */
export function vfxInstrumentacaoAtiva(): boolean {
  return ativo() && vfxLigadoPorFlag;
}

export function vfxLigar(): void {
  gravarFlagVfx(true);
  conectarLongtaskSeNecessario();
}

export function vfxDesligar(): void {
  gravarFlagVfx(false);
  desconectarLongtask();
  desconectarMutation();
}

/** só para o teste: a flag em memória, sem passar pelo `localStorage` */
export function forcarFlagVfx(v: boolean): void {
  vfxLigadoPorFlag = v;
}

// ---------------------------------------------------------------- amostrador

/**
 * Ring buffer numérico simples — mesma filosofia do `flightRecorder`
 * (`Float64Array` de tamanho fixo, sobrescreve o mais velho, zero alocação
 * por amostra). Cada skill tem o seu (frame time, nós DOM enquanto ativa),
 * e o baseline (fora de VFX) tem o dele.
 */
interface Amostrador {
  buf: Float64Array;
  n: number;
  idx: number;
}
function novoAmostrador(cap: number): Amostrador {
  return { buf: new Float64Array(cap), n: 0, idx: 0 };
}
function empurrar(a: Amostrador, v: number): void {
  if (!Number.isFinite(v)) return;
  a.buf[a.idx] = v;
  a.idx = (a.idx + 1) % a.buf.length;
  a.n++;
}
interface Estatisticas {
  media: number;
  p50: number;
  p95: number;
  max: number;
  n: number;
}
function estatisticas(a: Amostrador): Estatisticas {
  const m = Math.min(a.n, a.buf.length);
  if (m === 0) return { media: 0, p50: 0, p95: 0, max: 0, n: 0 };
  const fatia = a.buf.slice(0, m).sort();
  let soma = 0;
  for (let i = 0; i < m; i++) soma += fatia[i]!;
  const em = (p: number) => fatia[Math.min(m - 1, Math.floor(m * p))]!;
  return { media: soma / m, p50: em(0.5), p95: em(0.95), max: fatia[m - 1]!, n: m };
}

// ---------------------------------------------------------------- ciclo de vida

export interface InfoVfxStart {
  instanceId: number;
  skillId: number;
  /** nome bonito, quando o catálogo já respondeu — sem ele, cai em `skill-<id>` */
  skillName?: string;
  /**
   * Identificador ESTÁVEL do VFX — o nome Aegis (`MG_FIREWALL`), não o
   * nome bonito. `skillName` pode chegar `undefined` na primeira vez que
   * uma skill aparece na sessão (catálogo ainda não respondeu) e mais
   * tarde MUDAR de valor quando o `ensure()` resolve; `vfxId` é o mesmo
   * identificador que `vfx/SkillVfx.tsx` já usa pra DECIDIR qual
   * componente desenhar — sempre disponível no mesmo instante em que o
   * dispatcher decide, e nunca muda depois de resolvido. Sem ele, cai no
   * mesmo fallback `skill-<id>` que `skillName` usa.
   */
  vfxId?: string;
  kind: string;
  /** ms restantes até `expiresAt`, quando finito — `Infinity` (área persistente) vira `null` */
  expectedDurationMs?: number | null;
  casterGid?: number;
  targetGid?: number;
  /** quantas células/instâncias esta skill afetou NUM SÓ pacote, quando
   * quem chama souber (ex.: Fire Wall agrupado — `FireWallGroup` sabe
   * quantas células nasceram juntas); ausente = não medido, nunca 1 chutado */
  cellCount?: number;
}

interface VfxAtivo {
  instanceId: number;
  skillId: number;
  skillName: string;
  vfxId: string;
  kind: string;
  startedAt: number;
  startQuadro: number;
  expectedDurationMs: number | null;
  casterGid?: number;
  targetGid?: number;
  /** heap no instante do start, para o delta no fim — `NaN` fora do Chrome */
  heapMbNoInicio: number;
}

const ativos = new Map<number, VfxAtivo>();

interface AmostraSkill {
  skillName: string;
  vfxId: string;
  casts: number;
  /** hits adicionais numa instância JÁ viva, coalescidos em vez de virar
   * `cast` novo (VFX Core, `vfx/core/manager.ts: pulse()` — item 14 da
   * padronização: "1 raio por mob acertado", nunca N instâncias completas
   * pro mesmo alvo/janela). Só skills migradas pro Core geram isto; o
   * caminho legado (`vfx/SkillVfx.tsx`) nunca chama `marcarVfxPulse`. */
  pulses: number;
  /** instâncias que terminaram por CANCELAMENTO (recast/reset), não por fim natural — ver `marcarVfxCancel` */
  cancels: number;
  totalActiveMs: number;
  frameMs: Amostrador;
  domNodeAmostras: Amostrador;
  htmlAmostras: Amostrador;
  /** soma de `vfxMutacoes` nos quadros em que esta skill esteve ativa — TESTEMUNHO, não
   * atribuição exclusiva (ver docblock do módulo e `relatorioVfx`) */
  mutacoesTestemunhadas: number;
  longTaskCount: number;
  longTaskMs: number;
  heapDeltaSomaMb: number;
  heapDeltaAmostras: number;
  maxConcurrentVfx: number;
  /** contadores de limiar — acumulados quadro a quadro em `amostrarVfx`, nunca reconstruídos do `Amostrador` (que pode descartar amostra velha) */
  framesAcima33: number;
  framesAcima50: number;
}

const CAP_AMOSTRAS_SKILL = 4000;
const porSkill = new Map<string, AmostraSkill>();

function pegarOuCriarSkill(nome: string, vfxId?: string): AmostraSkill {
  let s = porSkill.get(nome);
  if (!s) {
    s = {
      skillName: nome,
      vfxId: vfxId ?? nome,
      casts: 0,
      pulses: 0,
      cancels: 0,
      totalActiveMs: 0,
      frameMs: novoAmostrador(CAP_AMOSTRAS_SKILL),
      domNodeAmostras: novoAmostrador(CAP_AMOSTRAS_SKILL),
      htmlAmostras: novoAmostrador(CAP_AMOSTRAS_SKILL),
      mutacoesTestemunhadas: 0,
      longTaskCount: 0,
      longTaskMs: 0,
      heapDeltaSomaMb: 0,
      heapDeltaAmostras: 0,
      maxConcurrentVfx: 0,
      framesAcima33: 0,
      framesAcima50: 0,
    };
    porSkill.set(nome, s);
  } else if (vfxId && s.vfxId === s.skillName) {
    // o registro nasceu ANTES do catálogo resolver `vfxId` (caiu no
    // fallback = skillName) — atualiza assim que um `marcarVfxStart`
    // posterior trouxer o valor de verdade, sem perder os dados já
    // acumulados sob esta chave
    s.vfxId = vfxId;
  }
  return s;
}

function nomeDaSkill(info: { skillId: number; skillName?: string }): string {
  return info.skillName && info.skillName.length > 0 ? info.skillName : `skill-${info.skillId}`;
}

function vfxIdDe(info: { skillId: number; vfxId?: string }): string {
  return info.vfxId && info.vfxId.length > 0 ? info.vfxId : `skill-${info.skillId}`;
}

function resumoAtivos(): { instanceId: number; skillId: number; skillName: string; vfxId: string }[] {
  const out: { instanceId: number; skillId: number; skillName: string; vfxId: string }[] = [];
  for (const a of ativos.values()) out.push({ instanceId: a.instanceId, skillId: a.skillId, skillName: a.skillName, vfxId: a.vfxId });
  return out;
}

let contadorMedidas = 0;
const MAX_MEDIDAS = 500;

/**
 * VFX_START — chamado de UM lugar só: `vfx/vfxStore.ts: spawn()`.
 *
 * `expectedDurationMs` já vem calculado por quem chama (o `vfxStore` sabe
 * `expiresAt`; este módulo não sabe de relógio de jogo nenhum, só recebe o
 * número pronto — mesmo princípio do `flightRecorder` não conhecer o jogo).
 */
export function marcarVfxStart(info: InfoVfxStart): void {
  if (!vfxInstrumentacaoAtiva()) return;
  const agora = performance.now();
  const skillName = nomeDaSkill(info);
  const vfxId = vfxIdDe(info);
  const registro: VfxAtivo = {
    instanceId: info.instanceId,
    skillId: info.skillId,
    skillName,
    vfxId,
    kind: info.kind,
    startedAt: agora,
    startQuadro: quadroCorrente(),
    expectedDurationMs: info.expectedDurationMs ?? null,
    casterGid: info.casterGid,
    targetGid: info.targetGid,
    heapMbNoInicio: quadro().heapMb,
  };
  ativos.set(info.instanceId, registro);
  pegarOuCriarSkill(skillName, vfxId).casts++;

  registrarEvento(
    "vfx",
    "start",
    {
      instanceId: info.instanceId,
      skillId: info.skillId,
      skillName,
      vfxId,
      kind: info.kind,
      expectedDurationMs: registro.expectedDurationMs,
      casterGid: info.casterGid,
      targetGid: info.targetGid,
      cellCount: info.cellCount,
    },
    agora,
  );

  if (typeof performance.mark === "function") {
    try {
      performance.mark(`vfx-start-${info.instanceId}`);
    } catch {
      /* ambiente sem User Timing completo */
    }
  }
}

/**
 * Fecha os marks/measures do User Timing e devolve o `registro` removido —
 * COMPARTILHADO entre `marcarVfxEnd` (fim natural) e `marcarVfxCancel`
 * (interrompido) porque as duas só diferem em QUAL evento registram e em
 * `s.cancels` vs `s.totalActiveMs` — tudo o resto (heap delta, limpeza de
 * User Timing, tirar do mapa `ativos`) é idêntico.
 */
function finalizarInstancia(instanceId: number): { registro: VfxAtivo; agora: number; duracaoMs: number } | null {
  const registro = ativos.get(instanceId);
  ativos.delete(instanceId);
  if (!registro) return null;
  const agora = performance.now();
  const duracaoMs = agora - registro.startedAt;

  if (typeof performance.mark === "function" && typeof performance.measure === "function") {
    try {
      const inicio = `vfx-start-${instanceId}`;
      const fim = `vfx-end-${instanceId}`;
      performance.mark(fim);
      performance.measure(`vfx-${instanceId}`, inicio, fim);
      performance.clearMarks(inicio);
      performance.clearMarks(fim);
      contadorMedidas++;
      // limpeza PERIÓDICA, não por medida — `clearMeasures()` sem nome
      // apaga tudo; simples e limitado, contra crescimento sem fim
      // (leia1.txt item 8: "não deixar marks/measures crescerem
      // infinitamente"). Não tenta ser cirúrgico: um flush total a cada
      // 500 é barato e nunca vaza.
      if (contadorMedidas >= MAX_MEDIDAS) {
        performance.clearMeasures();
        contadorMedidas = 0;
      }
    } catch {
      /* ambiente sem User Timing completo */
    }
  }
  return { registro, agora, duracaoMs };
}

/**
 * VFX_END — fim NATURAL. Chamado de `vfx/vfxStore.ts` em `prune()` (o
 * `expiresAt` do efeito venceu) e em `removeUnit()` pra efeitos de área
 * (o servidor mandou `skill:ground-gone` — pra área isso É o fim real,
 * ela nunca expira sozinha no cliente).
 */
export function marcarVfxEnd(instanceId: number): void {
  const fechado = finalizarInstancia(instanceId);
  if (!vfxInstrumentacaoAtiva() || !fechado) return;
  const { registro, agora, duracaoMs } = fechado;

  const s = porSkill.get(registro.skillName);
  if (s) {
    s.totalActiveMs += duracaoMs;
    const heapFim = quadro().heapMb;
    if (Number.isFinite(registro.heapMbNoInicio) && Number.isFinite(heapFim)) {
      s.heapDeltaSomaMb += heapFim - registro.heapMbNoInicio;
      s.heapDeltaAmostras++;
    }
  }

  registrarEvento(
    "vfx",
    "end",
    {
      instanceId,
      skillId: registro.skillId,
      skillName: registro.skillName,
      vfxId: registro.vfxId,
      durationMs: Math.round(duracaoMs),
      expectedDurationMs: registro.expectedDurationMs,
    },
    agora,
  );
}

/**
 * VFX_CANCEL — fim INTERROMPIDO, não natural. Chamado de `vfx/vfxStore.ts`
 * em dois casos: `spawn()` substituindo um buff ainda vivo por um recast
 * (a instância antiga nunca chegaria a `expiresAt` sozinha — foi
 * INTERROMPIDA pela nova) e `reset()` (sessão/mapa trocou, tudo que
 * estava de pé foi derrubado de fora, não terminou por conta própria).
 *
 * A distinção importa pro relatório: uma skill com muitos `cancels` e
 * pouco `totalActiveMs` é recastada/interrompida com frequência — dado
 * de GAMEPLAY (jogador re-castando antes do fim), não de PERFORMANCE, e
 * misturar os dois em `totalActiveMs` mentiria a duração real de uso.
 */
export function marcarVfxCancel(instanceId: number, motivo?: string): void {
  const fechado = finalizarInstancia(instanceId);
  if (!vfxInstrumentacaoAtiva() || !fechado) return;
  const { registro, agora, duracaoMs } = fechado;

  const s = porSkill.get(registro.skillName);
  if (s) s.cancels++;

  registrarEvento(
    "vfx",
    "cancel",
    {
      instanceId,
      skillId: registro.skillId,
      skillName: registro.skillName,
      vfxId: registro.vfxId,
      lifetimeMs: Math.round(duracaoMs),
      expectedDurationMs: registro.expectedDurationMs,
      motivo,
    },
    agora,
  );
}

/**
 * VFX_PULSE — hit adicional coalescido numa instância JÁ viva (VFX Core,
 * `vfx/core/manager.ts: pulse()`). Não fecha nem abre marca de User Timing
 * nenhuma (a instância continua viva) — só soma no contador `pulses` da
 * skill e registra o evento, pro relatório poder distinguir "5 casts
 * separados" de "1 cast que recebeu 5 pulsos" (dados de gameplay bem
 * diferentes, ver item 14 da padronização: nunca confundir os dois).
 */
export function marcarVfxPulse(instanceId: number): void {
  if (!vfxInstrumentacaoAtiva()) return;
  const registro = ativos.get(instanceId);
  if (!registro) return;
  const s = porSkill.get(registro.skillName);
  if (s) s.pulses++;
  registrarEvento("vfx", "pulse", {
    instanceId,
    skillId: registro.skillId,
    skillName: registro.skillName,
    vfxId: registro.vfxId,
  });
}

/**
 * VFX_MOUNT/VFX_UNMOUNT — chamado de UM lugar só: `vfx/SkillVfx.tsx`
 * (`VfxNode`). Marca quando o COMPONENTE REACT (não o modelo de dados)
 * entra/sai da árvore — a distinção importa porque o `spawn()` acontece
 * antes do primeiro commit e o `prune()` pode acontecer um quadro depois
 * do unmount de verdade (o React desmonta, o array só encolhe no próximo
 * `set()`).
 */
export function marcarMontagemVfx(instanceId: number, dados?: Record<string, unknown>): void {
  if (!vfxInstrumentacaoAtiva()) return;
  registrarEvento("vfx", "mount", { instanceId, ...dados });
  if (typeof performance.mark === "function") {
    try {
      performance.mark(`vfx-mount-${instanceId}`);
    } catch {
      /* ambiente sem User Timing completo */
    }
  }
}

export function marcarDesmontagemVfx(instanceId: number, dados?: Record<string, unknown>): void {
  if (!vfxInstrumentacaoAtiva()) return;
  registrarEvento("vfx", "unmount", { instanceId, ...dados });
  if (typeof performance.clearMarks === "function") {
    try {
      performance.clearMarks(`vfx-mount-${instanceId}`);
    } catch {
      /* ambiente sem User Timing completo */
    }
  }
}

// ---------------------------------------------------------------- DOM/Html

/**
 * O container onde `<Html>` portal — `gl.domElement.parentNode`.
 *
 * Registrado UMA VEZ pelo `PerfProbe` (mesmo padrão de
 * `rendererProbe.observarRenderer`: quem conhece `gl` é o chamador, este
 * módulo só guarda a referência). A HUD (`hud/Hud.tsx`) é IRMÃ do
 * `<Canvas>` em `PlayView`, não filha — então este container tem só o que
 * o R3F portou para fora da cena: VFX de skill, números de dano, rótulos
 * de entidade. Não é EXCLUSIVO de VFX (ver `nota` em `relatorioVfx`), mas
 * exclui a HUD inteira de graça, que é a maior parte do DOM do jogo.
 */
let containerAlvo: HTMLElement | null = null;

export function registrarContainerVfx(el: HTMLElement | null): void {
  containerAlvo = el;
}

/** de quantos em quantos quadros o container é varrido por inteiro (~10 Hz a 60 FPS) — mesma cadência do `cenaProbe.PASSO_DA_VARREDURA` */
export const PASSO_DA_VARREDURA_DOM = 6;

let baselineHtmlCount = 0;
let baselineDomCount = 0;
let ultimoDomDelta = 0;
let quadrosAmostrados = 0;

// ---------------------------------------------------------------- long task

let longTaskCountAcumulado = 0;
let longTaskMsAcumulado = 0;
let desligarLongtaskVfx: (() => void) | null = null;

/**
 * `PerformanceObserver('longtask')` PRÓPRIO — não reaproveita o de
 * `rendererProbe.observarTarefasLongas` de propósito: aquele emite
 * `renderer/tarefa-longa` para TODA long task da sessão (correto para o
 * caso dele, saber se o device engasgou). Este só emite quando há VFX
 * ativo, e o dado principal é OUTRO (quais skills estavam de pé) — dois
 * observers no mesmo `entryType` não conflitam (é pub/sub do navegador),
 * e separar os dois evita que o filtro "só com VFX" precise vazar para
 * dentro do módulo que não sabe o que é VFX.
 */
function conectarLongtaskSeNecessario(): void {
  if (desligarLongtaskVfx || typeof PerformanceObserver === "undefined") return;
  try {
    const obs = new PerformanceObserver((lista) => {
      if (ativos.size === 0) return;
      const resumo = resumoAtivos();
      // frame CORRENTE no instante em que o navegador ENTREGA a long task
      // (assíncrono — pode ser 1-2 quadros depois da tarefa em si). É a
      // melhor aproximação disponível sem acoplar este módulo a um
      // timestamp de quadro por tarefa; documentado, não inventado.
      const frameMsAgora = quadro().quadroMs;
      for (const e of lista.getEntries()) {
        longTaskCountAcumulado++;
        longTaskMsAcumulado += e.duration;
        for (const a of resumo) {
          const s = pegarOuCriarSkill(a.skillName, a.vfxId);
          s.longTaskCount++;
          s.longTaskMs += e.duration;
        }
        registrarEvento("vfx-performance", "longtask", {
          durationMs: Math.round(e.duration),
          activeVfx: resumo,
        });
      }
      registrarCombinacao(
        resumo.map((a) => a.vfxId),
        Number.isFinite(frameMsAgora) ? frameMsAgora : 0,
        longTaskMsAcumulado,
      );
    });
    obs.observe({ entryTypes: ["longtask"] });
    desligarLongtaskVfx = () => {
      obs.disconnect();
      desligarLongtaskVfx = null;
    };
  } catch {
    /* `longtask` não existe em todo navegador */
  }
}
function desconectarLongtask(): void {
  desligarLongtaskVfx?.();
}

// ---------------------------------------------------------------- mutation

let mutacoesAcumuladas = 0;
let mutationObs: MutationObserver | null = null;

/**
 * Conectado SÓ enquanto `vfxAtivos > 0` — ao contrário do observer de long
 * task (barato o suficiente para ficar ligado a sessão toda), um
 * `MutationObserver` com `subtree:true` tem custo proporcional ao volume
 * de mutação, e a maior parte do jogo não tem VFX nenhum ativo. É a
 * "amostragem" pedida em leia1.txt item 7: instrumentado só quando
 * realmente necessário.
 */
function conectarMutationSeNecessario(): void {
  if (mutationObs || !containerAlvo || typeof MutationObserver === "undefined") return;
  mutationObs = new MutationObserver((records) => {
    for (const r of records) mutacoesAcumuladas += r.addedNodes.length + r.removedNodes.length;
  });
  mutationObs.observe(containerAlvo, { childList: true, subtree: true });
}
function desconectarMutation(): void {
  mutationObs?.disconnect();
  mutationObs = null;
}

/** limiares clássicos de orçamento de quadro — meio quadro a 60 FPS e um quadro inteiro perdido */
const LIMIAR_FRAME_33 = 33;
const LIMIAR_FRAME_50 = 50;

// ---------------------------------------------------------------- combinações

/**
 * Quais VFX estavam juntos quando um quadro ficou ruim — leia1.txt item 6:
 * "alguns VFX podem ser baratos isoladamente, mas caros quando
 * combinados". A CHAVE é a lista de `vfxId` ativos, ORDENADA e SEM
 * repetição (duas instâncias da MESMA skill contam como "Fire Wall", não
 * "Fire Wall + Fire Wall") — junta em UMA linha da tabela toda vez que
 * aquele CONJUNTO de skills se repete, independente da ordem em que
 * entraram.
 */
interface AmostraCombinacao {
  vfxIds: string[];
  occurrences: number;
  maxFrameMs: number;
  longTaskMsTotal: number;
}
const CAP_COMBINACOES = 200;
const porCombinacao = new Map<string, AmostraCombinacao>();

function chaveCombinacao(vfxIds: string[]): string {
  return [...new Set(vfxIds)].sort().join(" + ");
}

/** chamado nos DOIS pontos que já sabem "um quadro ficou ruim": o gatilho
 * `vfxPerformanceSpike` e o observer de long task deste módulo. */
function registrarCombinacao(vfxIds: string[], frameMs: number, longTaskMs: number): void {
  if (vfxIds.length === 0) return;
  const chave = chaveCombinacao(vfxIds);
  let c = porCombinacao.get(chave);
  if (!c) {
    // teto simples: combinação nova quando já no limite não entra — a
    // sessão continua registrando OCORRÊNCIAS das combinações já
    // conhecidas (o caso comum), só não abre entrada infinita nova
    if (porCombinacao.size >= CAP_COMBINACOES) return;
    c = { vfxIds: [...new Set(vfxIds)].sort(), occurrences: 0, maxFrameMs: 0, longTaskMsTotal: 0 };
    porCombinacao.set(chave, c);
  }
  c.occurrences++;
  c.maxFrameMs = Math.max(c.maxFrameMs, frameMs);
  c.longTaskMsTotal += longTaskMs;
}

// ---------------------------------------------------------------- amostra por quadro

const baselineFrameMs = novoAmostrador(900);

const instantaneo = {
  ativos: 0,
  htmlCount: 0,
  domNodeCount: 0,
  ligado: false,
};
export function instantaneoVfx(): Readonly<typeof instantaneo> {
  return instantaneo;
}

/**
 * Uma amostra por quadro — chamada pelo `PerfProbe`, DEPOIS de
 * `amostrarContadores`/`amostrarCena` (precisa que `quadroMs`/`heapMb`
 * já estejam escritos na linha corrente).
 */
export function amostrarVfx(agora = performance.now()): void {
  instantaneo.ligado = vfxInstrumentacaoAtiva();
  if (!instantaneo.ligado) return;

  const contagem = ativos.size;
  instantaneo.ativos = contagem;

  if (contagem === 0) desconectarMutation();
  else conectarMutationSeNecessario();

  quadrosAmostrados++;
  if (containerAlvo) {
    // O(1) — `children.length` não varre nada, cabe TODO quadro
    const htmlAgora = containerAlvo.children.length;
    if (contagem === 0) baselineHtmlCount = htmlAgora;
    instantaneo.htmlCount = Math.max(0, htmlAgora - baselineHtmlCount);

    // varredura de verdade (`querySelectorAll`) só a ~10 Hz, e só dentro do
    // container do canvas — nunca `document.body`
    if (quadrosAmostrados % PASSO_DA_VARREDURA_DOM === 0) {
      const totalAgora = containerAlvo.querySelectorAll("*").length;
      if (contagem === 0) {
        baselineDomCount = totalAgora;
        ultimoDomDelta = 0;
      } else {
        ultimoDomDelta = Math.max(0, totalAgora - baselineDomCount);
      }
    }
  }
  instantaneo.domNodeCount = ultimoDomDelta;

  const q = quadro();
  const quadroMsValido = Number.isFinite(q.quadroMs) && q.quadroMs > 0;

  if (contagem === 0) {
    if (quadroMsValido) empurrar(baselineFrameMs, q.quadroMs);
  } else {
    for (const info of ativos.values()) {
      const s = pegarOuCriarSkill(info.skillName, info.vfxId);
      if (quadroMsValido) {
        empurrar(s.frameMs, q.quadroMs);
        if (q.quadroMs > LIMIAR_FRAME_33) s.framesAcima33++;
        if (q.quadroMs > LIMIAR_FRAME_50) s.framesAcima50++;
      }
      empurrar(s.domNodeAmostras, ultimoDomDelta);
      empurrar(s.htmlAmostras, instantaneo.htmlCount);
      s.maxConcurrentVfx = Math.max(s.maxConcurrentVfx, contagem);
    }
  }

  if (ativo()) {
    q.vfxAtivos = contagem;
    q.vfxHtmlCount = instantaneo.htmlCount;
    q.vfxDomNodeCount = ultimoDomDelta;
    q.vfxLongTaskCount = longTaskCountAcumulado;
    q.vfxLongTaskMs = longTaskMsAcumulado;
    q.vfxMutacoes = mutacoesAcumuladas;
  }
  if (contagem > 0) {
    for (const info of ativos.values()) {
      const s = porSkill.get(info.skillName);
      if (s) s.mutacoesTestemunhadas += mutacoesAcumuladas;
    }
  }
  // combinação — registrada ANTES de zerar os acumuladores deste quadro,
  // no MESMO limiar que o gatilho usa (frame > 33ms com VFX ativo). É a
  // MESMA condição, só que aqui alimenta a tabela de combinações em vez
  // de (só) armar uma captura.
  if (contagem > 0 && quadroMsValido && q.quadroMs > LIMIAR_FRAME_33) {
    registrarCombinacao(
      resumoAtivos().map((a) => a.vfxId),
      q.quadroMs,
      longTaskMsAcumulado,
    );
  }

  longTaskCountAcumulado = 0;
  longTaskMsAcumulado = 0;
  mutacoesAcumuladas = 0;

  // o gatilho específico de VFX — reusa `avaliarGatilho`/`dispararCaptura`
  // do flightRecorder por inteiro; este módulo só decide QUANDO avaliar
  // (com VFX ativo) e QUAIS dados anexar (quais skills)
  if (contagem > 0 && quadroMsValido) {
    avaliarGatilho("vfxPerformanceSpike", q.quadroMs, { ativos: resumoAtivos() });
  }
}

// ---------------------------------------------------------------- perfil estrutural (estático, opcional)

/**
 * Contagem estrutural POR INSTÂNCIA — nós DOM, elementos animados,
 * elementos com `filter` — de um `vfxId`. NÃO é medido em runtime (leia1.txt
 * item 7: "não fazer `querySelectorAll` a cada frame"). É um FATO sobre o
 * CÓDIGO-FONTE daquele VFX, do mesmo jeito que a auditoria estática do Fire
 * Wall já produziu esses números lendo `FireWallCell.tsx` — este registro só
 * dá um lugar pra guardar esse conhecimento e ele aparecer no relatório
 * automaticamente, em vez de precisar lembrar/repetir a auditoria toda vez.
 *
 * Registrado UMA VEZ, no module-load do próprio componente (efeito
 * colateral estático, como o `registrarColetorDeMeta` do `censo`) — nunca
 * por instância, nunca por quadro. `htmlPortalsPerGroup` existe separado de
 * `domNodesPerInstance` porque arquiteturas AGREGADAS (Fire Wall: 19
 * instâncias, 1 `<Html>` só) têm portal compartilhado entre instâncias —
 * "quantos portais por instância" seria uma fração sem sentido.
 */
export interface PerfilEstruturalVfx {
  domNodesPerInstance: number;
  animatedNodesPerInstance: number;
  filteredNodesPerInstance: number;
  /** `<Html>` do GRUPO inteiro (1 se agregado, = nº de instâncias se cada uma tem a própria) */
  htmlPortalsPerGroup: number;
  /** breve nota de onde o número veio — auditoria manual, não fórmula */
  fonte: string;
}

const perfisEstruturais = new Map<string, PerfilEstruturalVfx>();

export function registrarPerfilEstruturalVfx(vfxId: string, perfil: PerfilEstruturalVfx): void {
  perfisEstruturais.set(vfxId, perfil);
}

export function perfilEstruturalDe(vfxId: string): PerfilEstruturalVfx | null {
  return perfisEstruturais.get(vfxId) ?? null;
}

// ---------------------------------------------------------------- relatório

export interface DiagnosticoVfx {
  mainThreadHeavy: boolean;
  domHeavy: boolean;
  /** PROXY (não medido diretamente — ver nota do relatório): mainThreadHeavy + domHeavy juntos */
  animationHeavy: boolean;
  creationDestructionHeavy: boolean;
  memoryHeavy: boolean;
  /** sempre `false` aqui — VFX de skill não usa three.js/GPU (achado da auditoria estática); fica explícito em vez de omitido */
  gpuHeavy: boolean;
  mixed: boolean;
  noSignificantImpact: boolean;
  /** 0..1 — cresce com o número de casts e de amostras de quadro; poucos casts = confiança baixa mesmo com sinal forte */
  confidence: number;
}

export interface RelatorioSkill {
  skillName: string;
  vfxId: string;
  casts: number;
  /** hits coalescidos numa instância viva — ver `marcarVfxPulse` */
  pulses: number;
  /** instâncias que terminaram por CANCELAMENTO (recast/reset) em vez de fim natural — ver `marcarVfxCancel` */
  cancels: number;
  totalActiveMs: number;
  avgFrameMsWhileActive: number;
  p95FrameMsWhileActive: number;
  maxFrameMsWhileActive: number;
  baselineFrameMs: number;
  deltaFrameMs: number;
  framesAcima33: number;
  framesAcima50: number;
  longTasks: number;
  longTaskMs: number;
  avgDomNodes: number;
  maxDomNodes: number;
  avgHtmlNodes: number;
  maxConcurrentVfx: number;
  heapDeltaMbAvg: number | null;
  amostrasDeQuadro: number;
  diagnosis: DiagnosticoVfx;
  /** `null` = "unavailable" — nenhum componente registrou o perfil deste `vfxId` ainda (ver `registrarPerfilEstruturalVfx`) */
  perfilEstrutural: PerfilEstruturalVfx | null;
}

/** limiares do diagnóstico — nomeados, não mágicos soltos no meio da função */
const LIMIAR_MAIN_THREAD_MS = 4;
/** delta no P95, não só na média — ver comentário abaixo */
const LIMIAR_MAIN_THREAD_P95_MS = 12;
/** ms de long task por cast — 1 long task de ~30ms a cada lançamento já é sentido */
const LIMIAR_LONGTASK_MS_POR_CAST = 30;
const LIMIAR_DOM_NOS = 150;
const LIMIAR_MUTACOES_POR_CAST = 200;
const LIMIAR_HEAP_MB_POR_CAST = 1;

function diagnosticar(s: AmostraSkill, baselineMedia: number, baselineP95: number): DiagnosticoVfx {
  const frame = estatisticas(s.frameMs);
  const dom = estatisticas(s.domNodeAmostras);
  const deltaFrame = frame.n > 0 ? frame.media - baselineMedia : 0;
  const deltaFrameP95 = frame.n > 0 ? frame.p95 - baselineP95 : 0;
  const longTaskMsPorCast = s.casts > 0 ? s.longTaskMs / s.casts : 0;

  /**
   * A MÉDIA sozinha esconde justamente o caso que mais importa: 3 casts
   * numa sessão de 5 minutos, cada um com um pico real, mas afogados em
   * centenas de quadros baratos ao redor — a média fica quase igual à
   * baseline enquanto o P95 (que só olha a cauda) e o total de long task
   * denunciam o pico. Medido de verdade (`/vfx-bench`, Thunder Storm × 3
   * simultâneas): delta médio 1,8 ms (não dispararia sozinho), mas 3 long
   * tasks somando 360 ms e quadro máximo de 132 ms — inequivocamente
   * pesado, e a média mentia isso.
   */
  const mainThreadHeavy =
    deltaFrame > LIMIAR_MAIN_THREAD_MS || deltaFrameP95 > LIMIAR_MAIN_THREAD_P95_MS || longTaskMsPorCast > LIMIAR_LONGTASK_MS_POR_CAST;
  const domHeavy = dom.media > LIMIAR_DOM_NOS;
  const mutacoesPorCast = s.casts > 0 ? s.mutacoesTestemunhadas / s.casts : 0;
  const creationDestructionHeavy = mutacoesPorCast > LIMIAR_MUTACOES_POR_CAST;
  const heapMedioPorCast = s.heapDeltaAmostras > 0 ? s.heapDeltaSomaMb / s.heapDeltaAmostras : 0;
  const memoryHeavy = s.heapDeltaAmostras > 0 && heapMedioPorCast > LIMIAR_HEAP_MB_POR_CAST;
  // NÃO medido diretamente — nenhuma leitura de `getComputedStyle`/contagem de
  // `animation`/`transition` ativa (custaria uma varredura por elemento, o
  // "scanner pesado" que o pedido explicitamente NÃO quer). Proxy: DOM
  // pesado + main-thread pesado juntos são o padrão que uma cascata de
  // `@keyframes` produziria; sinalizado como proxy no relatório, não como
  // medição.
  const animationHeavy = mainThreadHeavy && domHeavy;
  const gpuHeavy = false;

  const sinais = [mainThreadHeavy, domHeavy, creationDestructionHeavy, memoryHeavy, gpuHeavy].filter(Boolean).length;
  const confiancaPorCasts = Math.min(1, s.casts / 5);
  const confiancaPorAmostras = Math.min(1, frame.n / 30);
  const confidence = Math.round(confiancaPorCasts * confiancaPorAmostras * 100) / 100;

  return {
    mainThreadHeavy,
    domHeavy,
    animationHeavy,
    creationDestructionHeavy,
    memoryHeavy,
    gpuHeavy,
    mixed: sinais >= 2,
    noSignificantImpact: sinais === 0,
    confidence,
  };
}

/**
 * Ranking por MÚLTIPLOS sinais (leia1.txt item 10: "não apenas um único
 * frame") — score normalizado 0..1 por eixo contra o MÁXIMO observado
 * naquela sessão, combinado com pesos declarados (não um número mágico
 * escondido). `deltaFrameMs` pesa mais porque é o sinal mais direto de
 * "o jogo ficou mais lento"; o resto é contexto de ONDE o custo mora.
 */
const PESOS_RANKING = { deltaFrame: 0.4, longTaskMs: 0.25, dom: 0.15, mutacoes: 0.12, heap: 0.08 } as const;

export interface RelatorioCombinacao {
  vfxIds: string[];
  occurrences: number;
  maxFrameMs: number;
  longTaskMsTotal: number;
}

export interface RelatorioVfx {
  ligado: boolean;
  baseline: { media: number; p50: number; p95: number; max: number; amostras: number };
  porSkill: RelatorioSkill[];
  ranking: string[];
  /** combinações de VFX simultâneos vistas em quadro ruim (>33ms) ou long task — ordenadas pelas PIORES primeiro */
  combinacoes: RelatorioCombinacao[];
  nota: string;
}

export function relatorioVfx(): RelatorioVfx {
  const baseline = estatisticas(baselineFrameMs);
  const porSkillArr: RelatorioSkill[] = [];

  for (const s of porSkill.values()) {
    const frame = estatisticas(s.frameMs);
    const dom = estatisticas(s.domNodeAmostras);
    const html = estatisticas(s.htmlAmostras);
    porSkillArr.push({
      skillName: s.skillName,
      vfxId: s.vfxId,
      casts: s.casts,
      pulses: s.pulses,
      cancels: s.cancels,
      totalActiveMs: Math.round(s.totalActiveMs),
      avgFrameMsWhileActive: arred(frame.media),
      p95FrameMsWhileActive: arred(frame.p95),
      maxFrameMsWhileActive: arred(frame.max),
      baselineFrameMs: arred(baseline.media),
      deltaFrameMs: arred(frame.n > 0 ? frame.media - baseline.media : 0),
      framesAcima33: s.framesAcima33,
      framesAcima50: s.framesAcima50,
      longTasks: s.longTaskCount,
      longTaskMs: Math.round(s.longTaskMs),
      avgDomNodes: arred(dom.media),
      maxDomNodes: Math.round(dom.max),
      avgHtmlNodes: arred(html.media),
      maxConcurrentVfx: s.maxConcurrentVfx,
      heapDeltaMbAvg: s.heapDeltaAmostras > 0 ? arred(s.heapDeltaSomaMb / s.heapDeltaAmostras) : null,
      amostrasDeQuadro: frame.n,
      diagnosis: diagnosticar(s, baseline.media, baseline.p95),
      perfilEstrutural: perfilEstruturalDe(s.vfxId),
    });
  }

  // normalização por eixo contra o máximo da SESSÃO — sem isto, ms e nós
  // DOM não são comparáveis, e a soma pesaria sempre pela unidade maior
  const maxDelta = Math.max(1e-6, ...porSkillArr.map((r) => Math.max(0, r.deltaFrameMs)));
  const maxLongTask = Math.max(1e-6, ...porSkillArr.map((r) => r.longTaskMs));
  const maxDom = Math.max(1e-6, ...porSkillArr.map((r) => r.avgDomNodes));
  const maxHeap = Math.max(1e-6, ...porSkillArr.map((r) => Math.abs(r.heapDeltaMbAvg ?? 0)));
  const maxMutacoesPorCast = Math.max(
    1e-6,
    ...[...porSkill.values()].map((s) => (s.casts > 0 ? s.mutacoesTestemunhadas / s.casts : 0)),
  );

  const score = (r: RelatorioSkill): number => {
    const s = porSkill.get(r.skillName)!;
    const mutacoesPorCast = s.casts > 0 ? s.mutacoesTestemunhadas / s.casts : 0;
    return (
      PESOS_RANKING.deltaFrame * (Math.max(0, r.deltaFrameMs) / maxDelta) +
      PESOS_RANKING.longTaskMs * (r.longTaskMs / maxLongTask) +
      PESOS_RANKING.dom * (r.avgDomNodes / maxDom) +
      PESOS_RANKING.mutacoes * (mutacoesPorCast / maxMutacoesPorCast) +
      PESOS_RANKING.heap * (Math.abs(r.heapDeltaMbAvg ?? 0) / maxHeap)
    );
  };

  const ranking = [...porSkillArr].sort((a, b) => score(b) - score(a)).map((r) => r.skillName);
  porSkillArr.sort((a, b) => score(b) - score(a));

  return {
    ligado: vfxInstrumentacaoAtiva(),
    baseline: {
      media: arred(baseline.media),
      p50: arred(baseline.p50),
      p95: arred(baseline.p95),
      max: arred(baseline.max),
      amostras: baseline.n,
    },
    porSkill: porSkillArr,
    ranking,
    combinacoes: [...porCombinacao.values()]
      .sort((a, b) => b.longTaskMsTotal - a.longTaskMsTotal || b.maxFrameMs - a.maxFrameMs)
      .map((c) => ({ ...c })),
    nota:
      "domNodes/htmlNodes são do CONTAINER inteiro sob o canvas (gl.domElement.parentNode), " +
      "não exclusivos da skill — quando várias skills estão ativas juntas, todas recebem a MESMA " +
      "amostra (correlação, não atribuição exclusiva; ver docblock de vfxProbe.ts). animationHeavy " +
      "é um PROXY (mainThreadHeavy && domHeavy), não uma contagem real de animações CSS — medir " +
      "isso exigiria varrer estilo computado por elemento, o custo que este módulo existe para " +
      "evitar. gpuHeavy é sempre false: VFX de skill não usa three.js/GPU (auditoria estática " +
      "anterior — 51 <Html> contra 0 <mesh> em vfx/mage/**). perfilEstrutural é null quando " +
      "nenhum componente registrou (`registrarPerfilEstruturalVfx`) — 'unavailable', não um chute. " +
      "combinacoes só entram quadros com >33ms E ≥1 VFX ativo — a MESMA condição do gatilho " +
      "vfxPerformanceSpike; vfxIds duplicados (2 instâncias da mesma skill) contam como 1 na chave.",
  };
}

function arred(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

// ---------------------------------------------------------------- reset/teste

export function zerarVfx(): void {
  ativos.clear();
  porSkill.clear();
  porCombinacao.clear();
  baselineFrameMs.n = 0;
  baselineFrameMs.idx = 0;
  baselineHtmlCount = 0;
  baselineDomCount = 0;
  ultimoDomDelta = 0;
  quadrosAmostrados = 0;
  longTaskCountAcumulado = 0;
  longTaskMsAcumulado = 0;
  mutacoesAcumuladas = 0;
  contadorMedidas = 0;
  instantaneo.ativos = 0;
  instantaneo.htmlCount = 0;
  instantaneo.domNodeCount = 0;
}

// ---------------------------------------------------------------- boot

// registra o relatório como coletor de meta — calculado NA HORA DO DESPEJO
// (mesmo mecanismo do `censo`), nunca incrementalmente
registrarColetorDeMeta("vfxRelatorio", relatorioVfx);

// `typeof window` porque este módulo é importado por teste (ambiente node)
if (import.meta.env.DEV && typeof window !== "undefined") {
  vfxLigadoPorFlag = lerFlagVfxGuardada();
  if (vfxLigadoPorFlag) conectarLongtaskSeNecessario();
  // estende o `window.__voo` que `flightRecorder.ts` já criou — este módulo
  // importa aquele, então a ordem de avaliação de módulo garante que
  // `__voo` já existe quando este bloco roda
  const voo = (window as unknown as { __voo?: Record<string, unknown> }).__voo;
  if (voo) {
    voo.vfxLigar = vfxLigar;
    voo.vfxDesligar = vfxDesligar;
    voo.vfxRelatorio = relatorioVfx;
    voo.vfxAtivos = resumoAtivos;
    /**
     * `__voo.limpar()` NÃO zera isto — por desenho: ele só reseta o anel de
     * quadros/eventos do flightRecorder, e as sondas (`cenaProbe.zerarCena`
     * tem a mesma separação) guardam contadores de SESSÃO inteira de
     * propósito (ex.: "quantas suspensões desde o boot"). Pra comparar
     * ANTES/DEPOIS de uma mudança, chame ISTO entre uma medida e outra —
     * sem ele, `porSkill` acumula pra sempre e uma segunda rodada "limpa"
     * na verdade soma em cima da primeira, calado.
     */
    voo.vfxZerar = zerarVfx;
  }
}
