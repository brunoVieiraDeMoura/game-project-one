import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import type { TerrainQuery } from "@ragnarok/engine-core";
import type { LegacyMapping } from "../../net/legacyCells";
import { vfxManager } from "./manager";
import { SpriteRenderer } from "./renderers/SpriteRenderer";
import { ParticleRenderer } from "./renderers/ParticleRenderer";
import { BeamRenderer } from "./renderers/BeamRenderer";
import { RingRenderer } from "./renderers/RingRenderer";
import { TrailRenderer } from "./renderers/TrailRenderer";
import { CageRenderer } from "./renderers/CageRenderer";
import { DomRenderer } from "./renderers/DomRenderer";
import { useWebglRecoveryEpoch } from "../../core/webglContextRecovery";
import { prewarmDiagStart, prewarmDiagSync, prewarmDiagEnd } from "./prewarmDiag";
import type { VfxRenderer } from "./renderers/rendererTypes";

/**
 * O ÚNICO componente R3F do VFX Core (item 28 do pedido: "1 VFX Manager +
 * poucas estruturas Three.js + GPU", nunca "N VFX + N React roots").
 *
 * Monta os 5 renderers UMA VEZ (item 13: nunca criar/destruir recurso por
 * cast), registra no `vfxManager` singleton, e faz o ÚNICO `useFrame` que
 * move o sistema inteiro — nenhum outro lugar do Core assina `useFrame`.
 *
 * Convive com `vfx/SkillVfx.tsx` durante as Fases 3–5: cada skill migrada
 * para de passar pelo dispatcher antigo (`vfx/skillVfxBindings.ts` decide
 * isso) e passa a nascer aqui, via `vfxStore.spawn()` → `vfxManager.play()`.
 * Skills ainda não migradas continuam 100% pelo caminho antigo.
 */
export function VfxRoot({
  map,
  mapping,
  cellSize,
  terrain,
}: {
  map: GameMap;
  mapping: LegacyMapping;
  cellSize: number;
  terrain: TerrainQuery;
}) {
  const { camera, size, gl } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const domRendererRef = useRef<DomRenderer | null>(null);
  // `contextEpoch` — ver `core/webglContextRecovery.ts` pro raciocínio
  // completo: `gl` é a MESMA instância antes/depois de uma restauração de
  // contexto WebGL (o three reinicializa por dentro, nunca troca o
  // objeto), então este efeito nunca re-rodava sozinho num restore, e os
  // `InstancedMesh`/buffers dos renderers do Core ficavam presos ao
  // contexto morto. Incluir o epoch no array de dependências força este
  // efeito a rodar de novo (descarta os renderers antigos, cria novos)
  // toda vez que o contexto É restaurado de verdade — mesmo mecanismo de
  // resiliência que já existia pra remonte de StrictMode, só com mais um
  // gatilho.
  const contextEpoch = useWebglRecoveryEpoch((s) => s.epoch);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const sprite = new SpriteRenderer(group);
    const particle = new ParticleRenderer(group);
    const beam = new BeamRenderer(group);
    const ring = new RingRenderer(group);
    const trail = new TrailRenderer(group);
    const cage = new CageRenderer(group);
    // mesmo container que `core/diagnostics/vfxProbe.ts: registrarContainerVfx`
    // já usa como alvo de varredura — VFX de skill some daí de propósito
    // (renderer:"dom" migrado não conta mais como custo de DOM da sessão,
    // é o ganho que este Core existe pra entregar).
    const hostEl = (gl.domElement.parentElement ?? document.body) as HTMLElement;
    const dom = new DomRenderer(hostEl);
    domRendererRef.current = dom;

    vfxManager.registerRenderer(sprite);
    vfxManager.registerRenderer(particle);
    vfxManager.registerRenderer(beam);
    vfxManager.registerRenderer(ring);
    vfxManager.registerRenderer(trail);
    vfxManager.registerRenderer(cage);
    vfxManager.registerRenderer(dom);

    /**
     * PREWARM — um `WebGLRenderer` novo nasce com o cache de programa
     * compilado VAZIO (achado real, investigação Context Lost/Cold Shader:
     * disconnect→reconnect troca o Canvas inteiro, e o primeiro cast de
     * cada combinação de shader depois disso paga a compilação DURANTE o
     * próprio draw — confirmado em duas gerações de renderer independentes,
     * frame do spawn sempre seguido de `gl.info.programs` subindo no
     * PRÓXIMO quadro, nunca antes).
     *
     * `warm()` só existe em `Ring`/`Cage` (pool sob demanda — sem isto,
     * `mesh`/`material` não existiriam ainda pro `compileAsync` achar via
     * `scene.traverse()`); `Sprite`/`Particle`/`Trail`/`Beam` já criam os
     * próprios no construtor (`ensureCapacity`), `warm` neles é `undefined`
     * e o `?.()` pula sem custo.
     *
     * `gl.compileAsync(group, camera)` — MESMA API que `play/PreCompilarProps.tsx`
     * e `props/VegetationInstancer.tsx` já usam pro resto da cena (terreno/
     * props/personagens), reaproveitada aqui em vez de inventada: varre
     * `group` (só os 7 renderers do Core, não a cena toda) e compila CADA
     * material que encontrar pelo MESMO caminho que um draw real usaria
     * (inclusive a duplicata BackSide/FrontSide que o three já faz sozinho
     * pra material transparente de dupla face — não é um bug desta
     * instrumentação, é o `WebGLRenderer.compile()` do próprio three).
     * Assíncrono de propósito (`KHR_parallel_shader_compile` quando
     * existe): não bloqueia o primeiro quadro nem qualquer gameplay,
     * só garante que o programa já exista quando o primeiro cast REAL
     * chegar — igual pro Canvas inicial da sessão e pra qualquer
     * substituição de Canvas depois (`[gl, contextEpoch]` já cobre os dois
     * casos, é o MESMO gatilho que recria os 7 renderers).
     *
     * `requestAnimationFrame`, não síncrono aqui — MESMO motivo de
     * `PreCompilarProps.tsx`/`VegetationInstancer.tsx`: o `WebGLRenderer`
     * ainda não processou nenhum `render()` de verdade no exato instante em
     * que este efeito comita (achado ao vivo: chamar `compileAsync`
     * síncrono aqui lança `TypeError: Cannot read properties of undefined
     * (reading 'isReady')` de dentro do próprio `compileAsync` do three —
     * `materialProperties.currentProgram` fica `undefined` porque o estado
     * interno do renderer, que um `render()` real preenche, ainda não
     * existe). Um quadro de atraso não muda a garantia: o primeiro CAST de
     * verdade nunca acontece antes do primeiro quadro real ter passado.
     */
    let prewarmRaf = 0;
    const warmable: VfxRenderer[] = [sprite, particle, beam, ring, trail, cage];
    for (const r of warmable) r.warm?.();
    prewarmRaf = requestAnimationFrame(() => {
      const prewarm = import.meta.env.DEV ? prewarmDiagStart(gl) : null;
      if (prewarm) prewarmDiagSync(prewarm, gl);
      void gl.compileAsync(group, camera).then(() => {
        if (prewarm) prewarmDiagEnd(prewarm, gl);
      });
    });

    return () => {
      cancelAnimationFrame(prewarmRaf);
      for (const kind of ["sprite", "particle", "beam", "ring", "trail", "cage", "dom"]) vfxManager.unregisterRenderer(kind);
      sprite.dispose();
      particle.dispose();
      beam.dispose();
      ring.dispose();
      trail.dispose();
      cage.dispose();
      dom.dispose();
      domRendererRef.current = null;
    };
  }, [gl, contextEpoch]);

  useFrame((_, dt) => {
    vfxManager.setWorldContext({ map, mapping, cellSize, terrain, camera });
    domRendererRef.current?.updateViewport(camera, size.width, size.height);
    vfxManager.update(dt);
  });

  return <group name="vfx-root" ref={groupRef} />;
}
