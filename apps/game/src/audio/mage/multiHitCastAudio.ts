import { useSkillCatalog } from "../../net/skillCatalog";
import { playOneShot } from "../oneShotPool";
import { getSfxVolume, useAudioSettings } from "../audioSettingsStore";

/**
 * SFX de conjuração das skills "N hits com VFX próprio, dano em cascata"
 * (Cold Bolt, Fire Lance/`MG_FIREBOLT`, Thunder Storm) — mesmo grupo que
 * `vfx/mage/multiHitRegistry` já generaliza pro lado visual, mesma razão:
 * existia só pra Cold Bolt (`audio/coldBoltCast`, um `isColdBolt` cravado),
 * generalizado aqui pra virar um LOOKUP por nome Aegis em vez de um módulo
 * quase-idêntico por skill nova.
 *
 * DUAS cadências diferentes, escolhidas pelo TIPO de alvo da skill (skill_db
 * `TargetType`), não por um boolean por skill:
 *
 *  • Alvo (`Attack` — Cold Bolt, Fire Bolt): SEMPRE há um alvo real, o
 *    servidor SEMPRE confirma via `skill:cast`. `cast` toca em LOOP desde o
 *    início até a liberação (`aoComecarCastMultiHit`/`aoLiberarCastMultiHit`)
 *    — loop PARA, `cast-complete` toca, e 500ms depois `hit` toca. Sempre os
 *    3 estágios, incondicional.
 *
 *  • Chão (`Ground` — Thunder Storm): pode ser lançada em célula VAZIA, sem
 *    acertar ninguém — não há "sempre um alvo" pra garantir confirmação por
 *    dano. `skill:ground-cast` (ZC.NOTIFY_GROUNDSKILL, 0x117) é o único sinal
 *    garantido de "terminou de conjurar", mas NÃO diz se acertou. Por pedido
 *    explícito (leia1.txt), esse grupo não tem `cast-complete`: o loop PARA
 *    (`aoConcluirCastDeChao`) e só toca `hit` SE `skill:ground-hit`
 *    (ZC.NOTIFY_SKILL_POSITION, 0x115 — chega DEPOIS do 0x117, nunca antes,
 *    ver `net/session.ts`) chegar dentro de uma janela curta
 *    (`aoRegistrarAcertoDeChao`). Sem acerto, sem som — silêncio honesto é
 *    melhor que um "hit" que não aconteceu (mesmo espírito de
 *    `audio/itemSfx.aoAparecerItemNoChao`).
 *
 * Nunca por id — o id de uma constante MG_* já divergiu de projeto pra
 * projeto no rAthena; o nome Aegis é o que não muda (mesma razão que cada
 * `AEGIS_*`/lookup espalhado em `vfx/SkillVfx.tsx`/`net/useWorldEvents.ts`/
 * `vfx/mage/multiHitRegistry.ts` já documenta).
 */
interface CastAudio {
  cast: string;
  /** ausente = skill sem estágio de "liberação com som próprio" — hoje só as
   * de ALVO (Cold Bolt/Fire Bolt) têm; Thunder Storm (chão) vai direto pro
   * silêncio-ou-hit, sem inventar um som que o pedido tirou. */
  castComplete?: string;
  hit: string;
}

/** ms entre o fim do cast (liberação) e o som de impacto — só pras skills de
 * ALVO (sempre confirmadas por dano); Thunder Storm (chão) não usa isto —
 * o `hit` dela é disparado pela CONFIRMAÇÃO real do servidor, não por tempo. */
const HIT_DELAY_MS = 500;

/** ms de espera, depois do `skill:ground-cast` (0x117), por um possível
 * `skill:ground-hit` (0x115) antes de desistir e ficar em silêncio — os dois
 * saem do MESMO tick do servidor (`skill_castend_pos2`), então isto é folga
 * contra jitter de rede, não um atraso estético como o `HIT_DELAY_MS` acima. */
const GROUND_HIT_WINDOW_MS = 300;

const CAST_AUDIO: Record<string, CastAudio> = {
  MG_COLDBOLT: {
    cast: "/assets/audio/combat/mage/skills/cold-bolt/cast.mp3",
    castComplete: "/assets/audio/combat/mage/skills/cold-bolt/cast-complete.mp3",
    hit: "/assets/audio/combat/mage/skills/cold-bolt/hit.mp3",
  },
  MG_FIREBOLT: {
    cast: "/assets/audio/combat/mage/skills/fire-bolt/cast.mp3",
    castComplete: "/assets/audio/combat/mage/skills/fire-bolt/cast-complete.mp3",
    hit: "/assets/audio/combat/mage/skills/fire-bolt/hit.mp3",
  },
  // sem `castComplete` de propósito — ver comentário do topo do arquivo.
  MG_THUNDERSTORM: {
    cast: "/assets/audio/combat/mage/skills/thunder-storm/cast.mp3",
    hit: "/assets/audio/combat/mage/skills/thunder-storm/hit.mp3",
  },
};

function aegisFor(skillId: number): string | undefined {
  return useSkillCatalog.getState().byId[skillId]?.aegisName;
}

function audioFor(skillId: number): CastAudio | undefined {
  const aegis = aegisFor(skillId);
  return aegis !== undefined ? CAST_AUDIO[aegis] : undefined;
}

/**
 * Canal SEPARADO do `oneShotPool` (que nunca loopa) — um `<audio>` por
 * `src` de `cast`, `el.loop = true`, reaproveitado pra sempre. Mesmo desenho
 * de `footsteps.ts`: só o próprio módulo decide tocar/parar, nunca `useFrame`
 * nem `useEffect` de render.
 */
const loopPool = new Map<string, HTMLAudioElement>();

function loopElementFor(src: string): HTMLAudioElement {
  let el = loopPool.get(src);
  if (!el) {
    el = new Audio(src);
    el.loop = true;
    loopPool.set(src, el);
  }
  return el;
}

/** `src` do loop de `cast` TOCANDO agora, ou `null` — módulo-singleton (como
 * `footsteps.ts`): sobrevive a remontagens do `NetPlayer` sem duplicar `<audio>`. */
let castLoopTocando: string | null = null;

useAudioSettings.subscribe(() => {
  if (castLoopTocando === null) return;
  const el = loopPool.get(castLoopTocando);
  if (el) el.volume = getSfxVolume();
});

/** para o loop de `cast`, se houver — pausa E rebobina (nunca deixa mudo
 * tocando de fundo), igual `footsteps.ts: pararFootstep`. */
function pararLoopDeCast(): void {
  if (castLoopTocando === null) return;
  const el = loopPool.get(castLoopTocando);
  if (el) {
    el.pause();
    el.currentTime = 0;
  }
  castLoopTocando = null;
}

/**
 * Liberação de skill de CHÃO ainda esperando um `skill:ground-hit` — só uma
 * por vez (o cliente só pode estar conjurando uma coisa). `consumido` trava
 * em UM `hit` por conjuração mesmo que Thunder Storm mande vários
 * `skill:ground-hit` (até 10, um por hit/alvo no `HitCount` do skill_db).
 */
interface LiberacaoDeChaoPendente {
  aegis: string;
  consumido: boolean;
  expiraEm: number;
}
let liberacaoDeChaoPendente: LiberacaoDeChaoPendente | null = null;

function limparLiberacaoExpirada(): void {
  if (liberacaoDeChaoPendente && performance.now() > liberacaoDeChaoPendente.expiraEm) {
    liberacaoDeChaoPendente = null;
  }
}

/**
 * chamar do `skill:casting`, com `p.sourceGid === selfGid` — só a PRÓPRIA
 * conjuração, nunca a de outro caster por perto (mesmo portão que
 * `useCastStore.comecar` já usa). Skill fora do lookup: não toca nada, mas
 * ainda assim PARA um loop anterior pendurado (conjuração interrompida sem
 * `skill:cast`/`skill:ground-cast` — ver comentário de `net/castStore:
 * estaCastando` — nunca dois `cast` tocando ao mesmo tempo, mesma regra do
 * `footsteps.ts`) e descarta qualquer liberação de chão ainda pendente da
 * conjuração anterior.
 */
export function aoComecarCastMultiHit(skillId: number): void {
  pararLoopDeCast();
  liberacaoDeChaoPendente = null;
  const audio = audioFor(skillId);
  if (!audio) return;
  const el = loopElementFor(audio.cast);
  el.currentTime = 0;
  el.volume = getSfxVolume();
  el.play().catch(() => {
    /* mesma rede de segurança de sempre — conjuração só ocorre depois de já
       ter havido interação, autoplay não deveria bloquear aqui */
  });
  castLoopTocando = audio.cast;
}

/**
 * chamar do `skill:cast`, com `p.sourceGid === selfGid` — SÓ pras skills de
 * ALVO (`TargetType: Attack`, sempre confirmadas por dano: Cold Bolt/Fire
 * Bolt). A magia SAIU: o loop de `cast` PARA primeiro (nunca sobrepõe com
 * `cast-complete`), depois `cast-complete` toca uma vez, e o impacto vem
 * sozinho 500ms depois, sem esperar confirmação de dano nenhuma (o pedido é
 * sobre TEMPO de conjuração, não sobre acerto).
 *
 * Chamado UMA VEZ por cast (o evento `skill:cast` do servidor já é um pulso
 * único de liberação).
 */
export function aoLiberarCastMultiHit(skillId: number): void {
  pararLoopDeCast();
  const audio = audioFor(skillId);
  if (!audio) return;
  if (audio.castComplete) playOneShot(audio.castComplete);
  setTimeout(() => playOneShot(audio.hit), HIT_DELAY_MS);
}

/**
 * chamar do `skill:ground-cast`, com `p.sourceGid === selfGid` — SÓ pras
 * skills de CHÃO (`TargetType: Ground`: Thunder Storm). Este evento SEMPRE
 * dispara (mesmo sem acertar ninguém), então só para o loop e abre uma
 * janela curta esperando um `skill:ground-hit` real — NUNCA toca `hit` aqui
 * direto (seria inventar um acerto que talvez não tenha acontecido).
 */
export function aoConcluirCastDeChao(skillId: number): void {
  pararLoopDeCast();
  const aegis = aegisFor(skillId);
  if (!aegis || !CAST_AUDIO[aegis]) {
    liberacaoDeChaoPendente = null;
    return;
  }
  liberacaoDeChaoPendente = { aegis, consumido: false, expiraEm: performance.now() + GROUND_HIT_WINDOW_MS };
}

/**
 * chamar do `skill:ground-hit`, com `p.sourceGid === selfGid` — toca `hit`
 * UMA vez por conjuração, mesmo que o servidor mande vários (Thunder Storm
 * acertando vários hits/alvos): só o PRIMEIRO dentro da janela conta, os
 * seguintes caem no `consumido` e são ignorados.
 */
export function aoRegistrarAcertoDeChao(skillId: number): void {
  limparLiberacaoExpirada();
  const aegis = aegisFor(skillId);
  if (!aegis || !liberacaoDeChaoPendente || liberacaoDeChaoPendente.aegis !== aegis || liberacaoDeChaoPendente.consumido) {
    return;
  }
  const audio = CAST_AUDIO[aegis];
  if (!audio) return;
  liberacaoDeChaoPendente.consumido = true;
  playOneShot(audio.hit);
}

/** SÓ PARA TESTE — o app de verdade nunca chama isto. */
export function __resetForTests(): void {
  pararLoopDeCast();
  loopPool.clear();
  liberacaoDeChaoPendente = null;
}
