import { getSfxVolume, useAudioSettings } from "./audioSettingsStore";

/**
 * Toca STINGERS curtos do canal SFX — voz de combate, efeito de arma, buff,
 * skill. Diferente de `footsteps.ts` (que toca UM loop por vez, exclusivo),
 * aqui vários sons DIFERENTES podem tocar juntos de propósito (voz do golpe +
 * efeito da espada no mesmo instante) — só o MESMO som é que nunca duplica:
 * um `<audio>` por `src`, reaproveitado pra sempre, nunca `new Audio()` de
 * novo pro mesmo arquivo.
 *
 * Volume/canal são os MESMOS de sempre (`audio/audioSettingsStore`,
 * `sfxVolume`) — nenhum `AudioContext` novo, nenhuma configuração paralela.
 */
const pool = new Map<string, HTMLAudioElement>();

function elementFor(src: string): HTMLAudioElement {
  let el = pool.get(src);
  if (!el) {
    el = new Audio(src);
    pool.set(src, el);
  }
  return el;
}

/** troca de volume nas Configurações aplica em TODO stinger do pool, tocando
 * ou não — mesmo espírito do `footsteps.ts`, só que aqui pode haver mais de
 * um elemento "vivo" ao mesmo tempo */
useAudioSettings.subscribe(() => {
  for (const el of pool.values()) el.volume = getSfxVolume();
});

/**
 * Toca `src` do início. Reaproveita o `<audio>` daquele som especificamente —
 * chamar de novo antes de terminar REINICIA o mesmo elemento (não empilha uma
 * segunda instância tocando por cima), que é a garantia contra duplicação do
 * MESMO evento (re-render, snapshot, reconciliação): quem chama de novo com o
 * mesmo `src` nunca produz dois sons simultâneos daquele stinger.
 */
export function playOneShot(src: string): void {
  const el = elementFor(src);
  el.volume = getSfxVolume();
  el.currentTime = 0;
  el.play().catch(() => {
    /* stinger de combate só dispara em resposta a um evento de jogo que já
       exigiu interação prévia (personagem já andando/lutando) — o catch é
       rede de segurança, não caminho esperado */
  });
}

/** SÓ PARA TESTE — o app de verdade nunca chama isto (mesmo espírito do
 * `__resetForTests` de `footsteps.ts`). */
export function __resetForTests(): void {
  pool.clear();
}
