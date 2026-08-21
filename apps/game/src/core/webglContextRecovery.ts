import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { create } from "zustand";
import type * as THREE from "three";
import { resetMigratedVfx } from "../vfx/migratedVfxBridge";

/**
 * Recuperação REAL de perda de contexto WebGL.
 *
 * ## Achado 1 (rodada "ainda está acontecendo") — `preventDefault` já era do three
 *
 * `core/diagnostics/rendererProbe.ts` só OBSERVA de propósito (nunca chama
 * `preventDefault`). A hipótese original era que NINGUÉM chamava — falso:
 * `node_modules/three/src/renderers/WebGLRenderer.js: onContextLost` JÁ
 * chama `event.preventDefault()` e `onContextRestore` JÁ roda
 * `initGLContext()` sozinho, sempre existiu, embutido no próprio three. O
 * navegador SEMPRE tentava restaurar — o log `THREE.WebGLRenderer: Context
 * Lost.`/`Context Restored.` vem de LÁ, não faltava nada nessa parte.
 *
 * ## Achado 2 (raiz de verdade) — os renderers do VFX Core não sabem que
 * o contexto trocou
 *
 * `VfxRoot.tsx` cria os 7 renderers do Core (`SpriteRenderer`/
 * `ParticleRenderer`/etc — `InstancedMesh`/`InstancedBufferAttribute`/
 * material criados à mão, FORA do reconciler do R3F) dentro de um
 * `useEffect(..., [gl])`. `gl` (a instância de `THREE.WebGLRenderer`) é o
 * MESMO objeto antes e depois de uma perda de contexto — o three restaura
 * o contexto INTERNO da MESMA instância (`initGLContext()`), nunca troca a
 * instância — então esse efeito NUNCA re-roda sozinho num restore, e os
 * `InstancedMesh` do Core continuam presos aos buffers/programas do
 * contexto MORTO. Terreno/personagem recompilam bem porque são geridos
 * pelo reconciler do R3F, que reage à mudança de estado interno do MESMO
 * `gl`; os pools do Core, criados por fora, não têm esse gatilho.
 *
 * `useWebglRecoveryEpoch` é esse gatilho que faltava: um número que só
 * muda quando o contexto É restaurado de verdade. `VfxRoot.tsx` inclui
 * esse número no MESMO array de dependências do efeito que cria os
 * renderers — quando o número muda, o efeito roda de novo: descarta os
 * renderers antigos (`dispose()`, já existia, pensado pra remonte de
 * StrictMode) e cria novos, com `InstancedMesh`/buffers frescos no
 * contexto restaurado.
 */
interface WebglRecoveryEpochState {
  epoch: number;
  bump: () => void;
}
export const useWebglRecoveryEpoch = create<WebglRecoveryEpochState>((set) => ({
  epoch: 0,
  bump: () => set((s) => ({ epoch: s.epoch + 1 })),
}));

/**
 * `attachWebglContextRecovery(gl)` — função PURA, anexa os dois listeners e
 * devolve o cleanup. Anexada no `onCreated` do `<Canvas>` (síncrono, antes
 * de qualquer filho montar — achado da rodada anterior: o `Context Lost`
 * real acontece logo no login, durante `AquecerCena`/pico de compilação de
 * shader, cedo demais pra um componente-filho com `useEffect` pegar essa
 * janela a tempo).
 */
export function attachWebglContextRecovery(gl: THREE.WebGLRenderer): () => void {
  const canvas = gl.domElement;

  const onContextLost = (): void => {
    // `event.preventDefault()` já é feito pelo `WebGLRenderer` do three
    // (ver docblock acima) — aqui só log, pra saber que aconteceu de novo.
    console.error("[webgl] contexto perdido");
  };

  const onContextRestored = (): void => {
    console.error("[webgl] contexto restaurado — reconstruindo VFX Core");
    // limpa instâncias vivas (posições/timers do período congelado ficaram
    // stale) ANTES de forçar `VfxRoot` a recriar os renderers — nada fica
    // pra re-anexar num renderer que já nasce vazio de propósito.
    resetMigratedVfx();
    useWebglRecoveryEpoch.getState().bump();
  };

  canvas.addEventListener("webglcontextlost", onContextLost, false);
  canvas.addEventListener("webglcontextrestored", onContextRestored, false);
  return () => {
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
  };
}

/** versão-hook de `attachWebglContextRecovery` pra montar de dentro da
 * árvore do Canvas (`VfxBenchView`/`EditorView`) — o jogo real (`PlayView`)
 * usa a função direto no `onCreated`, ver docblock acima do porquê. */
export function useWebglContextRecovery(): void {
  const gl = useThree((s) => s.gl);
  useEffect(() => attachWebglContextRecovery(gl), [gl]);
}
