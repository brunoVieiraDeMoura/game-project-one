import { useSkillCatalog } from "../../net/skillCatalog";
import { playOneShot } from "../oneShotPool";
import { getSfxVolume, useAudioSettings } from "../audioSettingsStore";

/**
 * SFX das skills do Mago que NÃO são "N hits em cascata" (isso é
 * `audio/mage/multiHitCastAudio.ts`) — auditoria de SFX faltando
 * (2026-08-17): arquivos já existiam em `SFX/classes/mage/combat_skills_cast/`
 * mas nenhuma linha de código chamava `playOneShot`/tocava áudio nenhum pra
 * estas seis. Três grupos, cada um com o SEU sinal de rede real (nunca um
 * timer chutando "deve ter acabado"):
 *
 *  1. PROJÉTIL DE UM HIT SÓ (Fire Ball/MG_FIREBALL, Frost Diver/MG_FROSTDIVER)
 *     — `hits:1` no skill_db, sem faixa de nível (só existe 1 arquivo de
 *     `hit` cada, nunca `_lvl_1_2` etc.). Loop de `cast` chamado de
 *     `skill:casting` (mesmo mecanismo/gate de
 *     `multiHitCastAudio.aoComecarCastMultiHit`, cópia própria do
 *     loop-pool — mesmo desenho de `footsteps.ts`, cada módulo com o seu).
 *     `hit` toca ATRASADO: estas 2 são projéteis com voo visível
 *     (`vfx/mage/{fire-ball,frost-diver}/*VfxDef*.tsx`,
 *     `anchor:"caster-to-target"`) e o pacote `skill:cast` chega no INSTANTE
 *     do disparo, não do impacto — tocar `hit` na hora dessincronizaria do
 *     VFX (mesmo motivo que Cold Bolt/Fire Bolt tocam o impacto no `onHit`
 *     real do VFX, não na liberação). O VFX Core não expõe um callback de
 *     "impacto aconteceu agora" (`vfx/core/types.ts: VfxDefinition` é
 *     puramente declarativo, sem hook imperativo) — o atraso replica o MESMO
 *     número que o próprio VFX usa pra disparar a explosão/flash, então som
 *     e visual chegam juntos sem inventar um valor novo:
 *       - Fire Ball: `FIREBALL_FLIGHT_MS(480) * IMPACT_FRACTION(0.93)` ≈ 446ms
 *         (`vfx/mage/fire-ball/fireBallVfxDef.tsx: IMPACT_AT_MS`)
 *       - Frost Diver: `TRAIL_MS(520) + 60` = 580ms
 *         (`vfx/mage/frost-diver/{FrostDiverImpact.tsx,frostDiverVfxDefGpu.tsx}`)
 *     Chamado de FORA do `if (souEu)` em `net/useWorldEvents.ts` — o impacto
 *     é ouvido por qualquer caster, mesma regra de
 *     `multiHitCastAudio.aoImpactoMultiHit`. Stone Curse SAIU deste grupo
 *     (pedido 2026-08-19) — ver grupo 4 abaixo, o motivo é que petrificar é
 *     CONDICIONAL (save do alvo), então "hit sempre toca" estava errado pra
 *     ela especificamente (Fire Ball/Frost Diver acertam incondicionalmente,
 *     só petrificar tem chance de falhar).
 *
 *  2. ÁREA DO SERVIDOR COM DURAÇÃO (Fire Wall/MG_FIREWALL): `cast` (whoosh
 *     de ignição) toca UMA VEZ no instante em que o muro aparece de verdade
 *     no mundo (`skill:ground`, não `skill:ground-cast` — este é só a
 *     confirmação de liberação, sem posição/entidade ainda; ver docblock de
 *     `onSkillGroundCast` em `useWorldEvents.ts`), e não é self-gated (o
 *     muro é visível/audível pra qualquer um por perto, mesma regra do VFX).
 *     `duration` entra em loop no MESMO instante e para no sinal real do
 *     servidor de que a área sumiu (`skill:ground-gone`/`ZC.SKILL_DISAPPEAR`
 *     → `onSkillGroundGone`), nunca um timer client-side chutando a duração
 *     — mesma filosofia de "nunca inventar duração" do resto do projeto.
 *     Simplificação conhecida: o loop é UM elemento `<audio>` por skill (não
 *     por instância/`unitGid`) — dois Fire Walls simultâneos compartilham o
 *     mesmo loop e o primeiro a sumir para o som pros dois. Caso raro
 *     (Fire Wall é single-target de área pequena); documentado aqui em vez
 *     de resolvido, mesmo padrão de simplificação que `loopElementFor` de
 *     `multiHitCastAudio.ts` já assume pro loop de `cast` (1 conjuração
 *     própria de cada vez).
 *
 *  3. BUFF PRÓPRIO COM DURAÇÃO (Oráculo/Sight, MG_SIGHT): só tem arquivo de
 *     `duration` (sem cast, sem hit — é instantâneo). Entra em loop na MESMA
 *     confirmação que já liga o VFX próprio dele
 *     (`net/useWorldEvents.ts: isCustomBuffVfx`, aegis em
 *     `vfx/mage/vfxDurationOverrides.ts: BUFF_VFX_AEGIS`) — reaproveita
 *     `buffDurationMs` já calculado ali (`SkillInfo.durationMs`, dado real
 *     do rAthena), nunca um número novo. Self-gated (`souEu`): é o próprio
 *     status do jogador, mesma regra de `aoComecarCastMultiHit`. Para com
 *     `setTimeout(durationMs)` — sem sinal de expiração de status disponível
 *     pro cliente (mesma razão documentada em `useWorldEvents.ts` pro VFX:
 *     "só o instante-fim é calculado no cliente, porque não existe outro
 *     jeito de saber").
 *
 * Ghost Dome (Safety Wall visual, MG_SAFETYWALL) só tem UM arquivo
 * (`cupula_fantasma_cast.mp3`, sem `duration`) — toca uma vez em
 * `skill:ground`, mesmo grupo 2 acima, sem loop (não existe arquivo pra
 * loopar, e o VFX real do escudo já é silencioso enquanto ativo).
 *
 *  4. PETRIFICAR/STONE CURSE — pedido 2026-08-19: `stoned_cast` toca em loop
 *     ENQUANTO conjura (mesmo mecanismo de `cast` do grupo 1, reaproveitado
 *     — `aoComecarCastProjetil`/`aoLiberarCastProjetil`), mas o resultado
 *     NÃO é "sempre toca depois de um atraso" como Fire Ball/Frost Diver:
 *     petrificar é CONDICIONAL, o alvo pode salvar contra o status
 *     (`net/worldStore.ts: NetEntity.opt1` já documentava isto — "nunca
 *     assumir petrificação só porque um ataque acertou"). `stoned_confirm`
 *     só toca quando o alvo de VERDADE entra em stonewait
 *     (`net/entityOption.ts: OPT1_STONEWAIT`, `ZC_STATE_CHANGE` real —
 *     `aoConfirmarPetrificar`, chamada de `net/useWorldEvents.ts: onOption`
 *     na TRANSIÇÃO pra esse valor, nunca em reenvio do mesmo opt1). Se o
 *     save do alvo funcionar (petrificação falha), nenhum som extra toca —
 *     só o loop de `stoned_cast` que já rodou e parou é ouvido, exatamente
 *     como pedido.
 */

const BASE = "/assets/audio/combat/mage/skills";

function aegisFor(skillId: number): string | undefined {
  return useSkillCatalog.getState().byId[skillId]?.aegisName;
}

// ------------------------------------------------------------- grupo 1

interface ProjectileAudio {
  cast: string;
  /** ausente = skill deste grupo sem resultado incondicional (hoje só Stone
   * Curse — ver grupo 4, `aoConfirmarPetrificar`) — `aoImpactoProjetilAtrasado`
   * vira no-op pra ela, nunca inventa um "hit sempre toca". */
  hitDelayMs?: number;
  hit?: string;
}

const PROJECTILE_AUDIO: Record<string, ProjectileAudio> = {
  MG_FIREBALL: { cast: `${BASE}/fire-ball/cast.mp3`, hitDelayMs: 446, hit: `${BASE}/fire-ball/hit.mp3` },
  MG_FROSTDIVER: { cast: `${BASE}/frost-diver/cast.mp3`, hitDelayMs: 580, hit: `${BASE}/frost-diver/hit.mp3` },
  // sem `hit`/`hitDelayMs` de propósito: petrificar é CONDICIONAL, o som de
  // resultado mora no grupo 4 (`aoConfirmarPetrificar`), gatilhado pelo
  // status real do alvo, não por um atraso fixo depois do cast.
  MG_STONECURSE: { cast: `${BASE}/stone-curse/cast.mp3` },
};

/** loop de `cast` — cópia própria do mesmo desenho de
 * `multiHitCastAudio.ts`/`footsteps.ts` (um `<audio>` por `src`, `loop=true`,
 * reaproveitado). Só UM cast próprio por vez, mesma garantia. */
const castLoopPool = new Map<string, HTMLAudioElement>();
let castLoopTocando: string | null = null;
/** trava de segurança (pedido 2026-08-19, Stone Curse "loop travado") —
 * Stone Curse é `no_damage` no skill_db (`ZC.USE_SKILL`, não `NOTIFY_SKILL`)
 * e o `result` desse pacote pra ela é literalmente o retorno de
 * `sc_start()` no rAthena: 0 = alvo RESISTIU ao petrificar. O gateway
 * descarta o pacote inteiro quando `result===0` (`session.ts`, comentário
 * "0 = falhou") — comportamento certo pra buff que falhou de verdade
 * (nenhum efeito, nenhum som), mas pra Stone Curse esse mesmo `result`
 * também cobre "o cast TERMINOU, só que o save funcionou", e aí nenhum
 * `skill:cast` chega NUNCA: sem este timer, `aoLiberarCastProjetil` nunca é
 * chamada e o loop de `stoned_cast` toca pra sempre. Teto = a duração REAL
 * do cast (`skill:casting.durationMs`, `USESKILL_ACK.delayTime` — nunca
 * chutada) + folga de rede, pra nunca cortar o loop ANTES da liberação de
 * verdade no caminho feliz (petrificação bem-sucedida, `skill:cast` chega
 * normalmente e já para o loop antes do timer disparar). */
const CAST_LOOP_SAFETY_BUFFER_MS = 250;
let castLoopTimer: ReturnType<typeof setTimeout> | undefined;

function castLoopElementFor(src: string): HTMLAudioElement {
  let el = castLoopPool.get(src);
  if (!el) {
    el = new Audio(src);
    el.loop = true;
    castLoopPool.set(src, el);
  }
  return el;
}

function pararLoopDeCastUnico(): void {
  clearTimeout(castLoopTimer);
  castLoopTimer = undefined;
  if (castLoopTocando === null) return;
  const el = castLoopPool.get(castLoopTocando);
  if (el) {
    el.pause();
    el.currentTime = 0;
  }
  castLoopTocando = null;
}

/** chamar de `skill:casting`, `p.sourceGid === selfGid` — mesmo gate/local
 * de `multiHitCastAudio.aoComecarCastMultiHit`, skill fora do grupo 1: só
 * para um loop anterior pendurado, nenhum som novo. `durationMs` (o cast
 * time REAL do pacote, `p.durationMs` de `skill:casting`) arma o teto de
 * segurança acima — ausente/0 = sem teto (skill sem duração conhecida). */
export function aoComecarCastProjetil(skillId: number, durationMs = 0): void {
  pararLoopDeCastUnico();
  const audio = PROJECTILE_AUDIO[aegisFor(skillId) ?? ""];
  if (!audio) return;
  const el = castLoopElementFor(audio.cast);
  el.currentTime = 0;
  el.volume = getSfxVolume();
  el.play().catch(() => {
    /* mesma rede de segurança de sempre */
  });
  castLoopTocando = audio.cast;
  if (durationMs > 0) {
    castLoopTimer = setTimeout(pararLoopDeCastUnico, durationMs + CAST_LOOP_SAFETY_BUFFER_MS);
  }
}

/** chamar de `skill:cast`, `souEu` decide só se PARA o loop (o loop é
 * sempre próprio) — o `hit` atrasado toca pra QUALQUER caster, ver docblock
 * do topo. */
export function aoLiberarCastProjetil(skillId: number, souEu: boolean): void {
  if (souEu) pararLoopDeCastUnico();
}

/** timers de `hit` pendentes (disparo agendado, ainda não tocou) — precisa
 * ser cancelável em `pararAoDesconectar`, mesmo risco que o docblock de
 * `audio/audioLifecycle.ts` já descreve pro Cold Bolt: sem isto, um projétil
 * disparado bem antes do disconnect tocava o impacto atrasado por cima da
 * música de `/login`. */
const impactoTimersPendentes = new Set<ReturnType<typeof setTimeout>>();

/** agenda o som de impacto no MESMO atraso que o VFX Core usa pra disparar
 * a explosão (`hitDelayMs`) — nunca toca na hora, ver docblock do topo pra
 * cada número. Skill fora do grupo 1 OU sem `hit`/`hitDelayMs` (Stone
 * Curse, condicional — ver grupo 4): silêncio, sem inventar som. */
export function aoImpactoProjetilAtrasado(skillId: number): void {
  const audio = PROJECTILE_AUDIO[aegisFor(skillId) ?? ""];
  if (!audio?.hit || audio.hitDelayMs === undefined) return;
  const hit = audio.hit;
  const timer = setTimeout(() => {
    impactoTimersPendentes.delete(timer);
    playOneShot(hit);
  }, audio.hitDelayMs);
  impactoTimersPendentes.add(timer);
}

// ------------------------------------------------------------- grupo 2

interface GroundAreaAudio {
  cast: string;
  duration?: string;
}

const GROUND_AREA_AUDIO: Record<string, GroundAreaAudio> = {
  MG_FIREWALL: { cast: `${BASE}/fire-wall/cast.mp3`, duration: `${BASE}/fire-wall/duration.mp3` },
  MG_SAFETYWALL: { cast: `${BASE}/ghost-dome/cast.mp3` },
};

/** loop de `duration` — cópia própria, mesmo desenho do loop de `cast`
 * acima (simplificação documentada no topo: 1 elemento por SKILL, não por
 * instância). */
const durationLoopPool = new Map<string, HTMLAudioElement>();
const durationLoopPorAegis = new Map<string, string>();
/** trava de segurança (pedido 2026-08-19, Fire Wall) — timer só ATIVO
 * quando a skill tem `durationMs` REAL no skill_db (`Duration1`, nunca
 * chutado). Fire Wall é VÁRIAS células (`skill:ground` chega uma vez por
 * célula do muro); `skill:ground-gone` também chega por célula, e a
 * simplificação "1 elemento por SKILL" acima já documenta que a primeira
 * célula a sumir para o som de TODAS — sem este timer, se a ordem de
 * chegada dos `ground-gone` deixar a ÚLTIMA célula do muro sumir bem depois
 * da primeira, o loop reinicia a cada `skill:ground` novo mas só é
 * garantido parar no evento — este timer é o teto duro: nunca deixa o som
 * passar da duração de VERDADE da habilidade no terreno, não importa quantos
 * `ground`/`ground-gone` fora de ordem cheguem. */
const durationLoopTimerPorAegis = new Map<string, ReturnType<typeof setTimeout>>();

function durationLoopElementFor(src: string): HTMLAudioElement {
  let el = durationLoopPool.get(src);
  if (!el) {
    el = new Audio(src);
    el.loop = true;
    durationLoopPool.set(src, el);
  }
  return el;
}

/** para o loop de `duration` de UM aegis — usado tanto por
 * `aoPararAreaDeChao` (sinal real do servidor) quanto pelo próprio timer de
 * segurança acima (teto da duração real). Idempotente: chamar duas vezes
 * (servidor E timer, ordem qualquer) nunca quebra nem duplica parada. */
function pararLoopDeAreaPorAegis(aegis: string): void {
  const timer = durationLoopTimerPorAegis.get(aegis);
  if (timer !== undefined) clearTimeout(timer);
  durationLoopTimerPorAegis.delete(aegis);
  const src = durationLoopPorAegis.get(aegis);
  if (src === undefined) return;
  const el = durationLoopPool.get(src);
  if (el) {
    el.pause();
    el.currentTime = 0;
  }
  durationLoopPorAegis.delete(aegis);
}

/** chamar de `skill:ground` (área nasceu de verdade no mundo) — toca o
 * whoosh de ignição uma vez (nunca self-gated, ver docblock) e, se a skill
 * tiver `duration`, entra em loop até `aoPararAreaDeChao` OU o teto de
 * `durationMs` real (o que vier primeiro). Skill fora do grupo 2: silêncio. */
export function aoAparecerAreaDeChao(skillId: number): void {
  const aegis = aegisFor(skillId);
  const audio = aegis !== undefined ? GROUND_AREA_AUDIO[aegis] : undefined;
  if (!audio) return;
  playOneShot(audio.cast);
  if (audio.duration === undefined) return;
  const el = durationLoopElementFor(audio.duration);
  el.currentTime = 0;
  el.volume = getSfxVolume();
  el.play().catch(() => {
    /* mesma rede de segurança de sempre */
  });
  durationLoopPorAegis.set(aegis!, audio.duration);
  const timerAnterior = durationLoopTimerPorAegis.get(aegis!);
  if (timerAnterior !== undefined) clearTimeout(timerAnterior);
  durationLoopTimerPorAegis.delete(aegis!);
  const durationMs = useSkillCatalog.getState().byId[skillId]?.durationMs ?? 0;
  if (durationMs > 0) {
    durationLoopTimerPorAegis.set(
      aegis!,
      setTimeout(() => pararLoopDeAreaPorAegis(aegis!), durationMs),
    );
  }
}

/** chamar de `skill:ground-gone` — para o loop de `duration` desta skill,
 * se houver (Ghost Dome não tem `duration`, vira no-op). Skill fora do
 * grupo 2: silêncio, não quebra. */
export function aoPararAreaDeChao(skillId: number): void {
  const aegis = aegisFor(skillId);
  if (aegis === undefined) return;
  pararLoopDeAreaPorAegis(aegis);
}

// ------------------------------------------------------------- grupo 3

const BUFF_DURATION_AUDIO: Record<string, string> = {
  MG_SIGHT: `${BASE}/oracle/duration.mp3`,
};

const buffLoopPool = new Map<string, HTMLAudioElement>();
let buffLoopTocando: string | null = null;
let buffLoopTimer: ReturnType<typeof setTimeout> | undefined;

function buffLoopElementFor(src: string): HTMLAudioElement {
  let el = buffLoopPool.get(src);
  if (!el) {
    el = new Audio(src);
    el.loop = true;
    buffLoopPool.set(src, el);
  }
  return el;
}

function pararLoopDeBuff(): void {
  clearTimeout(buffLoopTimer);
  buffLoopTimer = undefined;
  if (buffLoopTocando === null) return;
  const el = buffLoopPool.get(buffLoopTocando);
  if (el) {
    el.pause();
    el.currentTime = 0;
  }
  buffLoopTocando = null;
}

/** chamar da confirmação de buff PRÓPRIO com VFX custom
 * (`net/useWorldEvents.ts: isCustomBuffVfx`, `souEu`) com o MESMO
 * `durationMs` já calculado ali — nunca um número novo. Skill fora do
 * grupo 3: silêncio. */
export function aoIniciarBuffComDuracao(skillId: number, durationMs: number): void {
  pararLoopDeBuff();
  const aegis = aegisFor(skillId);
  const src = aegis !== undefined ? BUFF_DURATION_AUDIO[aegis] : undefined;
  if (src === undefined || durationMs <= 0) return;
  const el = buffLoopElementFor(src);
  el.currentTime = 0;
  el.volume = getSfxVolume();
  el.play().catch(() => {
    /* mesma rede de segurança de sempre */
  });
  buffLoopTocando = src;
  buffLoopTimer = setTimeout(pararLoopDeBuff, durationMs);
}

// ------------------------------------------------------------- grupo 4

const STONE_CURSE_CONFIRM = `${BASE}/stone-curse/confirm.mp3`;

/**
 * O som de "virou pedra de verdade" — chamar de `net/useWorldEvents.ts:
 * onOption`, só na TRANSIÇÃO de qualquer alvo pra `OPT1_STONEWAIT`, nunca
 * num reenvio do mesmo `opt1`. Sem lookup de skillId (o pacote real,
 * `ZC_STATE_CHANGE`, não carrega qual skill causou a mudança de estado, só o
 * resultado) e sem gate de `souEu`/aegis — QUALQUER petrificação real, de
 * qualquer caster, mesma regra "ouvido por quem estiver perto" do resto do
 * arquivo. Se o alvo salvar contra o status, esta função nunca é chamada —
 * nenhum som extra toca, exatamente o pedido ("caso contrário não dê play
 * em mais nada").
 */
export function aoConfirmarPetrificar(): void {
  playOneShot(STONE_CURSE_CONFIRM);
}

// ------------------------------------------------------------- comum

useAudioSettings.subscribe(() => {
  const vol = getSfxVolume();
  if (castLoopTocando !== null) {
    const el = castLoopPool.get(castLoopTocando);
    if (el) el.volume = vol;
  }
  for (const src of durationLoopPorAegis.values()) {
    const el = durationLoopPool.get(src);
    if (el) el.volume = vol;
  }
  if (buffLoopTocando !== null) {
    const el = buffLoopPool.get(buffLoopTocando);
    if (el) el.volume = vol;
  }
});

/** cleanup de fim de sessão (`audio/audioLifecycle`) — mesmo motivo de
 * `multiHitCastAudio.pararAoDesconectar`: sem isto, um loop desta família
 * tocando na hora do disconnect sobrevive até `/login`. */
export function pararAoDesconectar(): void {
  pararLoopDeCastUnico();
  for (const el of durationLoopPool.values()) {
    el.pause();
    el.currentTime = 0;
  }
  durationLoopPorAegis.clear();
  for (const timer of durationLoopTimerPorAegis.values()) clearTimeout(timer);
  durationLoopTimerPorAegis.clear();
  pararLoopDeBuff();
  for (const timer of impactoTimersPendentes) clearTimeout(timer);
  impactoTimersPendentes.clear();
}

/** SÓ PARA TESTE — o app de verdade nunca chama isto. */
export function __resetForTests(): void {
  pararAoDesconectar();
  castLoopPool.clear();
  durationLoopPool.clear();
  buffLoopPool.clear();
}
