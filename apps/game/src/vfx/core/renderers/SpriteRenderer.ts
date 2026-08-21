import * as THREE from "three";
import { computeFrame } from "../animation";
import { frameToUv } from "../assets/atlasTypes";
import { loadedAtlas } from "../assets/atlasLoader";
import type { VfxInstanceRuntime, VfxWorldContext } from "../types";
import { InstancedBillboardBase } from "./instancedBillboardBase";
import { computeFlightOffset } from "./flightOffset";
import { computeCurveOffset } from "./curveOffset";
import { computeOrbitOffset } from "./orbitOffset";
import { computeFacingOffset } from "./facingOffset";
import { computeDropOffset } from "./dropOffset";
import { computeDropStretch } from "./dropStretch";
import { computeBurstEnvelope } from "./burstEnvelope";
import { computeCastChargeEnvelope } from "./castChargeEnvelope";
import { computeIdleFlicker } from "./idleFlicker";

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

  onInstanceCreate(instance: VfxInstanceRuntime, world: VfxWorldContext): void {
    const slot = this.acquireSlot();
    this.slots.set(instance.instanceId, slot.index);
    this.trySyncAtlas(instance.def);
    this.writeFromInstance(instance, 0, world);
  }

  onInstanceUpdate(instance: VfxInstanceRuntime, elapsedMs: number, world: VfxWorldContext): void {
    this.writeFromInstance(instance, elapsedMs, world);
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

  private writeFromInstance(instance: VfxInstanceRuntime, elapsedMs: number, world: VfxWorldContext): void {
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
        // `payload.flipX` (Eletrocutar, 2026-08-19-s: "varia invertendo
        // horizontalmente a cada hit") — inverte a amostra U (troca u0/u1),
        // mesma textura/frame, espelhada. Genérico: qualquer skill com
        // atlas pode pedir isto, nunca um mecanismo novo por skill.
        uv = instance.spawnOptions.payload?.flipX === true ? [u1, v0, u0, v1] : [u0, v0, u1, v1];
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
    const curve = computeCurveOffset(instance, elapsedMs);
    const orbit = computeOrbitOffset(instance, elapsedMs, world);
    const facing = computeFacingOffset(instance);
    const drop = computeDropOffset(instance, elapsedMs);
    // `payload.stretchY` (Fire Wall, "chama alta, não redonda") — alongamento
    // VERTICAL CONSTANTE, independente de `computeDropStretch` (que só existe
    // enquanto `payload.fallMs` está ativo, ex. Fire Lance caindo). Ausente/`1`
    // = comportamento de sempre; os dois multiplicam juntos sem conflito (uma
    // skill caindo E alongada estaticamente nunca coexistiu, mas nada impede).
    const staticStretch = Number(instance.spawnOptions.payload?.stretchY ?? 1);
    const stretch = computeDropStretch(instance, elapsedMs) * staticStretch;
    const burst = computeBurstEnvelope(instance, elapsedMs);
    const charge = computeCastChargeEnvelope(instance, elapsedMs);
    const idle = computeIdleFlicker(instance, elapsedMs);

    // `payload.rotation` (Eletrocutar, 2026-08-19-g: "cada SEGMENTO do raio
    // precisa da PRÓPRIA rotação, não a instância inteira") — override por
    // CAMADA em cima de `spawnOptions.rotation` (que continua compartilhado
    // por todas as camadas de uma instância, ex. o losango 45° de Fire
    // Lance/Cold Bolt). Ausente = comportamento de sempre; só quem passa
    // `params.rotation` numa layer específica (via `VfxLayer.params`, já
    // mesclado no payload da própria layer por `buildLayerRuntime`) ganha
    // rotação independente da instância.
    // somado (não substitui) `spawnOptions.rotation` — deixa uma skill
    // combinar uma inclinação pequena POR HIT (`spawnOptions.rotation`,
    // instância inteira, ex. "hit 3 ligeiramente pra direita") com a
    // irregularidade PRÓPRIA de cada segmento (`payload.rotation`, camada).
    const payloadRotation = instance.spawnOptions.payload?.rotation;
    const rotation = (typeof payloadRotation === "number" ? payloadRotation : 0) + (instance.spawnOptions.rotation ?? 0) + idle.rotationRad;

    // `payload.flameShape`/`noiseAmt` (Fire Wall) — mesma fase determinística
    // por `instance.instanceId` que `idleFlicker.ts` já usa, pra cada célula
    // "crepitar" fora de sincronia com as vizinhas.
    const flameShape = instance.spawnOptions.payload?.flameShape === true;
    const noiseAmt = Number(instance.spawnOptions.payload?.noiseAmt ?? (flameShape ? 1 : 0));
    const seed = flameShape ? (instance.instanceId % 1000) / 1000 : 0;
    // pedido "animação balançando pra frente/pra trás começa em 0% na base,
    // termina em 100% no topo" — pra `flameShape`, `idle.scaleMul` deixa de
    // multiplicar o `aScale` inteiro (que escalava simétrico a partir do
    // CENTRO, arrastando a base junto) e vira `breatheAmt`, aplicado no
    // VERTEX ponderado por `uv.y` (ver `instancedBillboardBase.ts`). Sprites
    // sem `flameShape` continuam com o `idle.scaleMul` de sempre no `aScale`
    // — nenhuma outra skill muda.
    const breatheAmt = flameShape ? idle.scaleMul - 1 : 0;
    const scaleMulForAttr = flameShape ? 1 : idle.scaleMul;

    this.writeSlot(index, {
      position: [
        instance.position.x + flight.x + curve.x + orbit.x + facing.x + drop.x,
        instance.position.y + flight.y + curve.y + orbit.y + facing.y + drop.y,
        instance.position.z + flight.z + curve.z + orbit.z + facing.z + drop.z,
      ],
      scale: scale * burst.scaleMul * charge.scaleMul * scaleMulForAttr,
      opacity: opacity * burst.opacityMul * charge.opacityMul * idle.opacityMul,
      rotation,
      stretch,
      color,
      uv,
      seed,
      noiseAmt,
      flameShape,
      breatheAmt,
    });
  }
}
