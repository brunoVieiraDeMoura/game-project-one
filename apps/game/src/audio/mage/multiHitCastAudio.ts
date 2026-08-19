import { useSkillCatalog } from "../../net/skillCatalog";
import { playOneShot } from "../oneShotPool";
import { getSfxVolume, useAudioSettings } from "../audioSettingsStore";

/**
 * SFX das skills "N hits com VFX próprio, dano em cascata" (Cold Bolt, Fire
 * Bolt, Thunder Storm, Light Bolt, Soul Strike) — mesmo grupo que
 * `vfx/mage/multiHitRegistry` já generaliza pro lado visual.
 *
 * DOIS estágios, com fontes DIFERENTES de propósito:
 *
 *  1. CAST/LIBERAÇÃO — vem do PACOTE (`skill:casting`/`skill:cast`, rede):
 *     loop de "carregando" enquanto conjura, PARA na liberação (pedido
 *     2026-08-17: cast → hit direto, sem som de "cast-complete" no meio —
 *     `cast-complete.mp3` de Cold Bolt/Fire Bolt/Light Bolt saiu do fluxo,
 *     arquivo continua no disco mas nada mais chama `playOneShot` nele;
 *     Thunder Storm é chão, sem confirmação de liberação própria, ver
 *     `aoConcluirCastDeChao`; Soul Strike não tem arquivo de cast nenhum no
 *     SFX — sem inventar som que não existe).
 *
 *  2. IMPACTO — vem do VFX (`aoImpactoMultiHit`, chamado de CADA `onHit`
 *     real de `ColdBoltImpact`/`FireLanceImpact`/`ThunderStormImpact`/
 *     `LightBoltImpact`/`SoulStrikeImpact`, ligado em `vfx/SkillVfx.tsx`),
 *     NUNCA de um timer que assume que o hit aconteceu. As "N estalactites/
 *     lanças/pulsos/descargas/almas" SEMPRE foram uma cascata client-side
 *     dividindo um dano total que o servidor já mandou pronto (mesmo
 *     documentado desde a Cold Bolt) — o `onHit` é o evento mais real que
 *     existe pra "este hit da sequência aconteceu AGORA", pra QUALQUER uma
 *     das cinco (inclusive Thunder Storm: sua AoE também é UM dano total
 *     repartido em pulsos visuais, não N pacotes de rede separados). Por
 *     isso um único `aoImpactoMultiHit` serve as cinco sem distinguir
 *     alvo×chão — a diferença categoria só importa pro estágio 1.
 *
 * O arquivo de IMPACTO é UM SÓ por skill (pedido 2026-08-19: cada
 * `<skill>_hit.mp3` é o estalo de UM golpe, não uma faixa pré-montada pro
 * nível) — `aoImpactoMultiHit` toca esse arquivo em CADA `onHit` real (nunca
 * dedupado mais — a dedupe "só o 1º onHit conta" saiu de
 * `vfx/SkillVfx.tsx: VfxNode`). `playOneShot` REAPROVEITA o mesmo `<audio>`
 * por `src` e reinicia do zero a cada chamada — pra uma skill de N hits em
 * stagger curto (ex. Cold Bolt nível 10 → 10 hits), isso já dá exatamente o
 * efeito pedido sem nenhum código novo: os N-1 primeiros se cortam uns aos
 * outros (tocam "rápido"), e só o ÚLTIMO chega ao fim sem ser interrompido
 * por um próximo `onHit` — toca inteiro.
 *
 * Nunca por id — o id de uma constante MG_* já divergiu de projeto pra
 * projeto no rAthena; o nome Aegis é o que não muda (mesma razão que cada
 * `AEGIS_*`/lookup espalhado em `vfx/SkillVfx.tsx`/`net/useWorldEvents.ts`/
 * `vfx/mage/multiHitRegistry.ts` já documenta).
 */
interface CastAudio {
  /** ausente = skill sem loop de conjuração no SFX (hoje só Soul Strike —
   * `SFX/classes/mage/combat_skills_cast/soul/` só tem `hit`) */
  cast?: string;
  /** som de UM golpe — arquivo fixo, tocado uma vez por `onHit` real (nunca
   * mais uma faixa por nível) */
  hit: string;
}

const CAST_AUDIO: Record<string, CastAudio> = {
  MG_COLDBOLT: {
    cast: "/assets/audio/combat/mage/skills/cold-bolt/cast.mp3",
    hit: "/assets/audio/combat/mage/skills/cold-bolt/hit.mp3",
  },
  MG_FIREBOLT: {
    cast: "/assets/audio/combat/mage/skills/fire-bolt/cast.mp3",
    hit: "/assets/audio/combat/mage/skills/fire-bolt/hit.mp3",
  },
  MG_THUNDERSTORM: {
    cast: "/assets/audio/combat/mage/skills/thunder-storm/cast.mp3",
    hit: "/assets/audio/combat/mage/skills/thunder-storm/hit.mp3",
  },
  MG_LIGHTNINGBOLT: {
    cast: "/assets/audio/combat/mage/skills/light-bolt/cast.mp3",
    hit: "/assets/audio/combat/mage/skills/light-bolt/hit.mp3",
  },
  // sem `cast`: o SFX real não tem arquivo de conjuração pra esta skill —
  // nunca inventar um loop que não existe.
  MG_SOULSTRIKE: {
    hit: "/assets/audio/combat/mage/skills/soul-strike/hit.mp3",
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
 * chamar do `skill:casting`, com `p.sourceGid === selfGid` — só a PRÓPRIA
 * conjuração, nunca a de outro caster por perto (mesmo portão que
 * `useCastStore.comecar` já usa). Sempre para um loop anterior pendurado
 * primeiro (conjuração interrompida sem `skill:cast`/`skill:ground-cast` —
 * nunca dois `cast` tocando ao mesmo tempo, mesma regra do `footsteps.ts`).
 * Skill sem `cast` no SFX (Soul Strike) ou fora do lookup: só o "parar
 * anterior" acontece, nenhum som novo.
 */
export function aoComecarCastMultiHit(skillId: number): void {
  pararLoopDeCast();
  const audio = audioFor(skillId);
  if (!audio?.cast) return;
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
 * ALVO que têm `cast` (Cold Bolt/Fire Bolt/Light Bolt): a magia SAIU, loop
 * PARA. Nenhum som toca aqui (pedido 2026-08-17: cast → hit direto, sem
 * "cast-complete" no meio — `pararLoopDeCast` já cobre o "parar", só
 * faltava não tocar mais nada em cima). Chamado uma vez por cast (o
 * `skill:cast` do servidor já é um pulso único de liberação pra essas).
 *
 * Skills de CHÃO (Thunder Storm) não usam mais nada aqui — o loop delas já
 * parou em `aoConcluirCastDeChao` (a confirmação de liberação PRÓPRIA de
 * skill de chão, `skill:ground-cast`). Soul Strike não tem `cast` nenhum,
 * então também não tem loop pra parar aqui. O IMPACTO das cinco skills não
 * mora mais nesta função — ver `aoImpactoMultiHit`.
 */
export function aoLiberarCastMultiHit(skillId: number, souEu: boolean): void {
  if (!souEu) return;
  const audio = audioFor(skillId);
  if (!audio?.cast) return;
  pararLoopDeCast();
}

/**
 * chamar do `skill:ground-cast`, com `p.sourceGid === selfGid` — SÓ pras
 * skills de CHÃO (`TargetType: Ground`: Thunder Storm). Este evento SEMPRE
 * dispara (mesmo sem acertar ninguém) e é a única confirmação garantida de
 * "terminou de conjurar" que uma AoE tem — só para o loop, nunca toca som
 * de impacto nenhum aqui (isso é `aoImpactoMultiHit`, no `onHit` real do VFX).
 */
export function aoConcluirCastDeChao(_skillId: number): void {
  pararLoopDeCast();
}

/**
 * O estalo de UM golpe — chamar de CADA `onHit` real de
 * `ColdBoltImpact`/`FireLanceImpact`/`ThunderStormImpact`/
 * `LightBoltImpact`/`SoulStrikeImpact` (`vfx/SkillVfx.tsx`, sem gate/dedupe
 * nenhum — a skill inteira já dispara `onHit` uma vez por estalactite/
 * lança/pulso/descarga/alma de verdade, e cada uma toca o MESMO arquivo).
 * `playOneShot` reinicia o mesmo `<audio>` a cada chamada — golpes em
 * stagger curto se cortam uns aos outros, só o último toca inteiro, ver
 * docblock do topo. Skill fora do lookup: silêncio, sem inventar som.
 */
export function aoImpactoMultiHit(skillId: number): void {
  const audio = audioFor(skillId);
  if (!audio) return;
  playOneShot(audio.hit);
}

/**
 * Cleanup de fim de sessão (`audio/audioLifecycle`): para o loop de `cast`
 * tocando — o único jeito que sobrou deste módulo de deixar som pendurado
 * depois que o `NetPlayer` já sumiu (route trocou pra `/login`), agora que
 * o impacto não usa mais timer nem estado pendente.
 */
export function pararAoDesconectar(): void {
  pararLoopDeCast();
}

/** SÓ PARA TESTE — o app de verdade nunca chama isto. */
export function __resetForTests(): void {
  pararAoDesconectar();
  loopPool.clear();
}
