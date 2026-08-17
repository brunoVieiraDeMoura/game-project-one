import { useEffect } from "react";
import { getMusicVolume, getSfxVolume, useAudioSettings } from "./audioSettingsStore";

/**
 * Música + natureza AMBIENTE do mapa, por `mapId` — mesmo padrão de
 * módulo-singleton do `ui/LoginMusic`: um único `<audio>` por CANAL para a
 * sessão inteira (não um por montagem), pausar em vez de recriar quando o
 * mapa não pede nada, e nunca reiniciar a faixa que já está tocando.
 *
 * Dois canais porque o pedido pede os dois tocando JUNTOS (trilha da cidade +
 * cama de natureza) — não é escolha de qual toca, os dois são independentes.
 * Volume-alvo de cada canal vem de `audio/audioSettingsStore`: música lê
 * `musicVolume`, natureza lê `sfxVolume` (o pedido não separa um canal
 * "ambiente" — natureza é SFX).
 */
const MUSIC_BY_MAP: Record<string, string> = {
  prt_fild08: "/assets/audio/music/prt_fild08.mp3",
};
const AMBIENT_BY_MAP: Record<string, string> = {
  prt_fild08: "/assets/audio/ambient/prt_fild08.mp3",
};

const FADE_MS = 700;

interface Canal {
  el: HTMLAudioElement;
  /** qual entrada de `MUSIC_BY_MAP`/`AMBIENT_BY_MAP` está carregada agora (não a URL — evita comparar `el.src` resolvido contra caminho relativo) */
  srcKey: string | undefined;
  /** cada fade novo invalida o anterior — sem isto, sair-e-voltar rápido do mapa deixava dois `requestAnimationFrame` brigando pelo volume */
  fadeToken: number;
  /**
   * 0..1 — SÓ a entrada/saída de mapa anima isto (`fadeTo`). O volume de
   * verdade tocado (`el.volume`) é `envelope × volumeAlvo()`: assim o slider
   * de Configurações muda o som na hora (lê `volumeAlvo()` de novo), sem
   * disputar com o fade de mapa nem reiniciar ele.
   */
  envelope: number;
  volumeAlvo: () => number;
}

function criarCanal(volumeAlvo: () => number): Canal {
  const el = new Audio();
  el.loop = true;
  el.volume = 0;
  return { el, srcKey: undefined, fadeToken: 0, envelope: 0, volumeAlvo };
}

const musica = criarCanal(getMusicVolume);
const ambiente = criarCanal(getSfxVolume);

function aplicarVolume(canal: Canal): void {
  canal.el.volume = canal.envelope * canal.volumeAlvo();
}

/** troca de volume nas Configurações aplica IMEDIATAMENTE nos dois canais,
 * tocando ou não — é o que faz o slider surtir efeito sem esperar o próximo
 * fade de entrada/saída de mapa */
useAudioSettings.subscribe(() => {
  aplicarVolume(musica);
  aplicarVolume(ambiente);
});

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __mapAmbience?: { musica: HTMLAudioElement; ambiente: HTMLAudioElement } }).__mapAmbience = {
    musica: musica.el,
    ambiente: ambiente.el,
  };
}

/** navegador bloqueia som antes de qualquer interação — tenta de novo no primeiro clique/tecla, uma vez, sem loop de retentativa */
function desbloquear(el: HTMLAudioElement): void {
  el.play().catch(() => {
    const retomar = () => {
      el.play().catch(() => {
        /* segue bloqueado — não insiste além desta segunda tentativa */
      });
    };
    window.addEventListener("pointerdown", retomar, { once: true });
    window.addEventListener("keydown", retomar, { once: true });
  });
}

function fadeTo(canal: Canal, alvoEnvelope: number): void {
  const meuToken = ++canal.fadeToken;
  const inicio = canal.envelope;
  const t0 = performance.now();
  const passo = () => {
    if (canal.fadeToken !== meuToken) return; // outro fade assumiu o canal
    const t = Math.min(1, (performance.now() - t0) / FADE_MS);
    canal.envelope = inicio + (alvoEnvelope - inicio) * t;
    aplicarVolume(canal);
    if (t < 1) {
      requestAnimationFrame(passo);
    } else if (alvoEnvelope === 0) {
      canal.el.pause();
    }
  };
  requestAnimationFrame(passo);
}

function definirFaixa(canal: Canal, key: string | undefined, src: string | undefined): void {
  if (!src) {
    // sem faixa para este mapa: fade-out e para (mantém o `srcKey` — voltar
    // ao mesmo mapa retoma em vez de recarregar do início)
    if (canal.srcKey !== undefined) fadeTo(canal, 0);
    return;
  }
  if (canal.srcKey === key) {
    // mesma faixa: nunca reinicia, só garante que está tocando no volume certo
    if (canal.el.paused) desbloquear(canal.el);
    fadeTo(canal, 1);
    return;
  }
  canal.srcKey = key;
  canal.el.pause();
  canal.el.src = src;
  canal.el.currentTime = 0;
  canal.envelope = 0;
  canal.el.volume = 0;
  desbloquear(canal.el);
  fadeTo(canal, 1);
}

/**
 * Monta uma vez em `PlayView` (não remonta na troca de mapa — só `mapId`
 * muda), então os dois `useEffect` abaixo são os únicos gatilhos: o de cima
 * reage a QUAL mapa (nunca a posição/quadro), o de baixo só ao desmonte real
 * (fim de sessão) do próprio `PlayView`.
 */
export function MapAmbience({ mapId }: { mapId: string | null }) {
  useEffect(() => {
    definirFaixa(musica, mapId ?? undefined, mapId ? MUSIC_BY_MAP[mapId] : undefined);
    definirFaixa(ambiente, mapId ?? undefined, mapId ? AMBIENT_BY_MAP[mapId] : undefined);
  }, [mapId]);

  useEffect(() => {
    return () => {
      fadeTo(musica, 0);
      fadeTo(ambiente, 0);
    };
  }, []);

  return null;
}

/**
 * Cleanup de fim de sessão (`audio/audioLifecycle`) — para os dois canais NA
 * HORA, sem esperar o fade de 700ms do desmonte gracioso (`useEffect` de
 * `MapAmbience` acima). Um disconnect não é uma troca de mapa: o jogador já
 * está indo pra `/login`, e a última coisa que ele deveria ouvir é a trilha
 * do mapa anterior morrendo aos poucos por cima da tela de login.
 * `srcKey`/`el.src` sobrevivem de propósito — o próximo mapa que carregar
 * essa MESMA faixa (outro personagem, mesma conta) não precisa recarregar do
 * zero.
 */
export function pararAoDesconectar(): void {
  for (const canal of [musica, ambiente]) {
    canal.fadeToken++; // invalida qualquer fade em andamento
    canal.envelope = 0;
    canal.el.pause();
  }
}

/**
 * SÓ PARA TESTE — chama a MESMA lógica que os `useEffect` de `MapAmbience`
 * chamam, sem precisar montar o componente React (este repo não tem
 * jsdom/testing-library; a lógica de canal é testável direto, o componente é
 * só um wrapper fino de efeito em cima dela). `musica`/`ambiente` continuam
 * módulo-singleton — `__resetForTests` existe porque um arquivo de teste com
 * vários casos reusaria os MESMOS dois `<audio>` entre eles.
 */
export const __test = { musica, ambiente, definirFaixa, fadeTo };

export function __resetForTests(): void {
  for (const canal of [musica, ambiente]) {
    canal.fadeToken++; // invalida qualquer fade em andamento de um teste anterior
    canal.srcKey = undefined;
    canal.envelope = 0;
    canal.el.pause();
    canal.el.src = "";
    canal.el.currentTime = 0;
    canal.el.volume = 0;
  }
}
