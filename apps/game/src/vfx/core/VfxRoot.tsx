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

    return () => {
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
  }, [gl]);

  useFrame((_, dt) => {
    vfxManager.setWorldContext({ map, mapping, cellSize, terrain, camera });
    domRendererRef.current?.updateViewport(camera, size.width, size.height);
    vfxManager.update(dt);
  });

  return <group name="vfx-root" ref={groupRef} />;
}
