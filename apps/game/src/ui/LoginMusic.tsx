import { useEffect, useState } from "react";

/**
 * Trilha de `/login` e `/char-select`, em loop.
 *
 * Um `<audio>` SÓ para a sessão inteira, não um por montagem: `/login` e
 * `/char-select` montam este componente cada um no seu `LoginBackdrop`, e
 * pausar (em vez de descartar) no desmonte é o que faz a música CONTINUAR de
 * onde parou ao trocar de tela, em vez de reiniciar do zero a cada login bem
 * sucedido. Sai de vez só quando nenhuma das duas telas está montada (o
 * `/play`, por exemplo).
 *
 * Volume e mudo são estado de MÓDULO (como `net/aimStore`), fora do React: o
 * botão (`LoginVolumeButton`, canto inferior-esquerdo) e o próprio `<audio>`
 * são dois consumidores independentes do mesmo valor, sem um ser filho do
 * outro. `ouvintes` é o jeito de um `useState` de componente saber que o
 * módulo mudou.
 */
const LS_VOLUME = "ragnarok:login-volume";
const LS_MUDO = "ragnarok:login-mudo";

function lerVolumeInicial(): number {
  // `Number(null)` é `0` em JS — sem essa checagem, a falta de valor salvo
  // PASSA no `isFinite`/faixa e vira volume 0 (mudo) em vez do padrão 0,45.
  const bruto = localStorage.getItem(LS_VOLUME);
  if (bruto === null) return 0.45;
  const v = Number(bruto);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.45;
}

let audio: HTMLAudioElement | null = null;
let volume = lerVolumeInicial();
let mudo = localStorage.getItem(LS_MUDO) === "1";
const ouvintes = new Set<() => void>();

function publicar() {
  if (audio) audio.volume = mudo ? 0 : volume;
  ouvintes.forEach((fn) => fn());
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio("/assets/audio/login-theme.mp3");
    audio.loop = true;
    audio.volume = mudo ? 0 : volume;
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (window as unknown as { __loginMusic: HTMLAudioElement }).__loginMusic = audio;
    }
  }
  return audio;
}

/** arrastar a barra pra cima do zero também tira do mudo — é o que se espera
 * ao mexer no controle, mesmo vindo de um clique de "ativar som" anterior */
export function setLoginVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (volume > 0) mudo = false;
  localStorage.setItem(LS_VOLUME, String(volume));
  localStorage.setItem(LS_MUDO, mudo ? "1" : "0");
  publicar();
}

export function toggleLoginMudo() {
  mudo = !mudo;
  localStorage.setItem(LS_MUDO, mudo ? "1" : "0");
  publicar();
}

export function useLoginVolume(): { volume: number; mudo: boolean } {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    ouvintes.add(fn);
    return () => {
      ouvintes.delete(fn);
    };
  }, []);
  return { volume, mudo };
}

export function LoginMusic() {
  useEffect(() => {
    const el = getAudio();
    let ativo = true;
    const tentar = () => {
      el.play().catch(() => {
        /* autoplay bloqueado — `retomar` tenta de novo na primeira interação */
      });
    };
    tentar();

    /**
     * Navegador bloqueia som antes de QUALQUER interação do usuário — a
     * primeira `tentar()` falha calada, e fica escutando o clique/tecla
     * seguinte (de qualquer lugar da página) para tentar de novo, uma vez só.
     */
    const retomar = () => {
      if (!ativo) return;
      tentar();
      window.removeEventListener("pointerdown", retomar);
      window.removeEventListener("keydown", retomar);
    };
    window.addEventListener("pointerdown", retomar);
    window.addEventListener("keydown", retomar);

    return () => {
      ativo = false;
      window.removeEventListener("pointerdown", retomar);
      window.removeEventListener("keydown", retomar);
      el.pause();
    };
  }, []);

  return null;
}
