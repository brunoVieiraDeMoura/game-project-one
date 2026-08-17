import * as THREE from "three";
import { computeFrame } from "../animation";
import { frameToUv } from "../assets/atlasTypes";
import { loadedAtlas } from "../assets/atlasLoader";
import type { VfxInstanceRuntime, VfxWorldContext } from "../types";
import { InstancedBillboardBase } from "./instancedBillboardBase";
import { computeFlightOffset } from "./flightOffset";
import { computeOrbitOffset } from "./orbitOffset";
import { computeDropOffset } from "./dropOffset";

// reusado a nível de módulo — nunca alocado por instância/quadro (mesmo
// princípio de `BeamRenderer.ts: _position/_quaternion/_scale`).
const _color = new THREE.Color();

/**
 * `renderer:"sprite"` — 1 slot de `InstancedMesh` por instância de VFX. É o
 * caminho que uma skill usa quando ganha atlas de verdade (Fase 6):
 * `animation.frames` seleciona a região do atlas por quadro.
 *
 * Sem atlas ainda (estado atual): desenha o placeholder procedural da base
 * — suficiente pra provar posição/escala/vida, nunca a arte final.
 *
 * Fix mecânico (Fase 5, rodada "reestruturar VFX pra escala", leia1.txt
 * item 1): `payload.color`/`payload.opacity` não eram lidos — o buffer já
 * suportava cor/opacidade por-instância (`instancedBillboardBase.ts`), só
 * faltava conectar, mesma convenção que `BeamRenderer.ts` já usa
 * (`payload.color` como string hex, `#rrggbb`).
 */
export class SpriteRenderer extends InstancedBillboardBase {
  readonly kind = "sprite";
  private readonly slots = new Map<number, number>(); // instanceId -> slot index

  constructor(group: THREE.Group) {
    super(group);
  }

  onInstanceCreate(instance: VfxInstanceRuntime): void {
    const slot = this.acquireSlot();
    this.slots.set(instance.instanceId, slot.index);
    this.trySyncAtlas(instance.def);
    this.writeFromInstance(instance, 0);
  }

  onInstanceUpdate(instance: VfxInstanceRuntime, elapsedMs: number): void {
    this.writeFromInstance(instance, elapsedMs);
  }

  onInstanceDestroy(instance: VfxInstanceRuntime): void {
    const index = this.slots.get(instance.instanceId);
    if (index === undefined) return;
    this.releaseSlot({ index });
    this.slots.delete(instance.instanceId);
  }

  setActive(instance: VfxInstanceRuntime, active: boolean): void {
    if (active) return; // religa sozinho no próximo onInstanceUpdate
    const index = this.slots.get(instance.instanceId);
    if (index !== undefined) this.writeInactiveSlot(index);
  }

  private writeFromInstance(instance: VfxInstanceRuntime, elapsedMs: number): void {
    const index = this.slots.get(instance.instanceId);
    if (index === undefined) return;

    const def = instance.def;
    const scaleSpec = def.scale;
    const baseScale = typeof scaleSpec === "number" ? scaleSpec : (scaleSpec?.base ?? 1);
    const byTarget = typeof scaleSpec === "object" && scaleSpec.byTarget;
    const scale = baseScale * (byTarget ? instance.targetScale : 1) * (instance.spawnOptions.scale ?? 1);

    let uv: readonly [number, number, number, number] = [0, 0, 1, 1];
    if (def.animation) {
      const frameResult = computeFrame(def.animation, elapsedMs);
      const atlas = def.atlas ? loadedAtlas(def.atlas) : undefined;
      const frame = atlas?.metadata.frames[frameResult.frameName];
      if (atlas && frame) {
        const { u0, v0, u1, v1 } = frameToUv(frame, atlas.metadata.image);
        uv = [u0, v0, u1, v1];
      }
    }

    const colorHex = instance.spawnOptions.payload?.color;
    let color: readonly [number, number, number] | undefined;
    if (typeof colorHex === "string") {
      _color.set(colorHex);
      color = [_color.r, _color.g, _color.b];
    }
    const opacityRaw = instance.spawnOptions.payload?.opacity;
    const opacity = typeof opacityRaw === "number" ? opacityRaw : 1;
    const flight = computeFlightOffset(instance, elapsedMs);
    const orbit = computeOrbitOffset(instance, elapsedMs);
    const drop = computeDropOffset(instance, elapsedMs);

    this.writeSlot(index, {
      position: [
        instance.position.x + flight.x + orbit.x + drop.x,
        instance.position.y + flight.y + orbit.y + drop.y,
        instance.position.z + flight.z + orbit.z + drop.z,
      ],
      scale,
      opacity,
      rotation: instance.spawnOptions.rotation ?? 0,
      color,
      uv,
    });
  }
}
