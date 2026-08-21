import * as THREE from "three";
import type { VfxInstanceRuntime, VfxWorldContext } from "../types";
import type { VfxRenderer } from "./rendererTypes";
import { computeIdleFlicker } from "./idleFlicker";

/**
 * `renderer:"beam"` — coluna/raio: quad vertical esticado a partir da
 * âncora, MESMO `InstancedMesh` pra todas as instâncias vivas (matriz por
 * instância via `setMatrixAt`, técnica padrão do three.js — não precisa de
 * shader próprio como o billboard, porque o beam tem orientação FIXA
 * relativa ao mundo, não vira de frente pra câmera).
 *
 * Sem atlas ainda, o material é um gradiente vertical procedural
 * (`ShaderMaterial`, sem textura) — mesma ressalva do `SpriteRenderer`:
 * placeholder de validação, nunca arte final.
 *
 * Achados da auditoria Fase 4 (relatório, seção C), corrigidos na Fase 5:
 *  1. `uColor`/`uOpacity` eram UNIFORMS do material — todo beam vivo
 *     compartilhava a MESMA cor (Thunder Storm azul + qualquer outro beam
 *     de cor diferente ficariam ambos azuis). Viraram atributos por
 *     instância (`aColor`/`aOpacity`, `InstancedBufferAttribute`, mesma
 *     técnica de `instancedBillboardBase.ts`) — 1 renderer, N cores.
 *  2. `acquire()` incrementava `highWater` sem checar a capacidade fixa
 *     (32) — passar de 32 beams vivos escrevia matriz FORA do buffer do
 *     `InstancedMesh`, calado. Cresce agora do mesmo jeito que a base de
 *     Sprite/Particle (dobra, preserva estado, dispõe geometria/material
 *     antigos).
 *
 * Fixes mecânicos (Fase 5, rodada "reestruturar VFX pra escala", leia1.txt
 * item 1): `onInstanceUpdate` alocava `Vector3`/`Quaternion`/`Vector3`
 * NOVOS a cada chamada, por beam, por quadro — reusa objetos de módulo
 * agora (mesmo princípio de "zero alocação em estado estável" já aplicado
 * em `manager.ts`/`screenProjection.ts`). `flush()` marcava
 * `instanceMatrix.needsUpdate = true` incondicionalmente todo quadro e
 * `writeColor`/`onInstanceDestroy`/`setActive` marcavam o atributo INTEIRO
 * sujo na hora — trocado por faixa suja (`dirtyMin`/`dirtyMax` +
 * `addUpdateRange`), MESMA técnica de `instancedBillboardBase.ts`.
 */
const QUAD_BASE = new THREE.PlaneGeometry(1, 1);
QUAD_BASE.translate(0, 0.5, 0); // pivô na base, esticar pra cima com escala Y

const VERTEX = `
attribute vec3 aColor;
attribute float aOpacity;
varying vec2 vUv;
varying vec3 vColor;
varying float vOpacity;
void main() {
  vUv = uv;
  vColor = aColor;
  vOpacity = aOpacity;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = `
varying vec2 vUv;
varying vec3 vColor;
varying float vOpacity;
void main() {
  float fade = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
  float core = smoothstep(0.5, 0.0, abs(vUv.x - 0.5));
  gl_FragColor = vec4(vColor, fade * core * vOpacity);
  if (gl_FragColor.a <= 0.001) discard;
}`;

const DEFAULT_COLOR = new THREE.Color("#a9d8ff");

// reusados a nível de módulo — nunca alocados por instância nem por quadro
// (mesmo princípio já aplicado em `manager.ts: _frustum/_sphere/_distVec`).
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _deadPosition = new THREE.Vector3(0, -9999, 0);
const _deadScale = new THREE.Vector3(0, 0, 0);

export class BeamRenderer implements VfxRenderer {
  readonly kind = "beam";
  private mesh: THREE.InstancedMesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private capacity = 0;
  private highWater = 0;
  private readonly freeSlots: number[] = [];
  private readonly group: THREE.Group;
  private readonly matrix = new THREE.Matrix4();
  private readonly slots = new Map<number, number>();

  private colorAttr!: Float32Array;
  private opacityAttr!: Float32Array;

  /** faixa suja pra aColor/aOpacity — mesmo padrão de
   * `instancedBillboardBase.ts`. A matriz de instância tem a PRÓPRIA faixa
   * (muda todo quadro por beam em movimento, ritmo diferente do
   * color/opacity que só mudam em create/destroy/setActive). */
  private colorDirtyMin = Infinity;
  private colorDirtyMax = -Infinity;
  private matrixDirtyMin = Infinity;
  private matrixDirtyMax = -Infinity;

  constructor(group: THREE.Group, initialCapacity = 32) {
    this.group = group;
    this.ensureCapacity(initialCapacity);
  }

  private markColorDirty(index: number): void {
    if (index < this.colorDirtyMin) this.colorDirtyMin = index;
    if (index > this.colorDirtyMax) this.colorDirtyMax = index;
  }

  private markMatrixDirty(index: number): void {
    if (index < this.matrixDirtyMin) this.matrixDirtyMin = index;
    if (index > this.matrixDirtyMax) this.matrixDirtyMax = index;
  }

  private ensureCapacity(min: number): void {
    if (min <= this.capacity) return;
    const newCapacity = Math.max(min, this.capacity === 0 ? 32 : this.capacity * 2);

    const geometry = QUAD_BASE.clone();
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });

    const colorAttr = new Float32Array(newCapacity * 3);
    const opacityAttr = new Float32Array(newCapacity);
    for (let i = 0; i < newCapacity; i++) {
      colorAttr[i * 3] = DEFAULT_COLOR.r;
      colorAttr[i * 3 + 1] = DEFAULT_COLOR.g;
      colorAttr[i * 3 + 2] = DEFAULT_COLOR.b;
    }
    if (this.colorAttr) colorAttr.set(this.colorAttr);
    if (this.opacityAttr) opacityAttr.set(this.opacityAttr);

    geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(colorAttr, 3));
    geometry.setAttribute("aOpacity", new THREE.InstancedBufferAttribute(opacityAttr, 1));

    const mesh = new THREE.InstancedMesh(geometry, material, newCapacity);
    mesh.frustumCulled = false;
    mesh.count = 0;

    // matriz de cada slot já vivo precisa sobreviver ao crescimento — o
    // `InstancedMesh` velho já tinha a matriz certa por slot, copiar direto
    // do buffer antigo antes de descartar.
    if (this.mesh) {
      const oldArray = this.mesh.instanceMatrix.array as Float32Array;
      (mesh.instanceMatrix.array as Float32Array).set(oldArray);
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.material?.dispose();
    }
    this.group.add(mesh);

    this.mesh = mesh;
    this.material = material;
    this.colorAttr = colorAttr;
    this.opacityAttr = opacityAttr;
    this.capacity = newCapacity;
    // crescimento reescreve o buffer de matriz inteiro (copiado acima) —
    // toda a faixa precisa subir de novo no próximo flush.
    if (this.highWater > 0) {
      this.markMatrixDirty(0);
      this.markMatrixDirty(this.highWater - 1);
    }
  }

  private acquire(): number {
    const reused = this.freeSlots.pop();
    if (reused !== undefined) return reused;
    this.ensureCapacity(this.highWater + 1);
    return this.highWater++;
  }

  onInstanceCreate(instance: VfxInstanceRuntime): void {
    const index = this.acquire();
    this.slots.set(instance.instanceId, index);
    this.writeColor(index, instance);
  }

  private writeColor(index: number, instance: VfxInstanceRuntime): void {
    const colorHex = String(instance.spawnOptions.payload?.color ?? "#a9d8ff");
    const c = new THREE.Color(colorHex);
    this.colorAttr[index * 3] = c.r;
    this.colorAttr[index * 3 + 1] = c.g;
    this.colorAttr[index * 3 + 2] = c.b;
    this.opacityAttr[index] = 1;
    this.markColorDirty(index);
  }

  onInstanceUpdate(instance: VfxInstanceRuntime, elapsedMs: number): void {
    const index = this.slots.get(instance.instanceId);
    if (index === undefined || !this.mesh) return;
    // "crítico = maior", mesmo campo universal que `SpriteRenderer`/
    // `ParticleRenderer`/`TrailRenderer` já leem (auditoria "Hit VFX
    // genérico" 2026-08-19) — um raio (Light Bolt) engrossa/alonga no
    // crítico pelo MESMO mecanismo, sem composição nova.
    const critScale = instance.spawnOptions.scale ?? 1;
    // `payload.idleFlicker` (loot rarity, 2026-08-21) — MESMO envelope que
    // `SpriteRenderer` já usa (`idleFlicker.ts`, genérico por renderer, só
    // lia `spawnOptions.payload` até agora); ausente = `{1,1,0}`, exatamente
    // o comportamento de sempre pra Thunder Storm/Light Bolt/Frost Diver e
    // qualquer outro `beam` existente, que nunca passam este campo.
    const idle = computeIdleFlicker(instance, elapsedMs);
    const width = Number(instance.spawnOptions.payload?.width ?? 0.6) * instance.targetScale * critScale * idle.scaleMul;
    const height = Number(instance.spawnOptions.payload?.height ?? 3) * instance.targetScale * critScale;
    _position.set(instance.position.x, instance.position.y, instance.position.z);
    _scale.set(width, height, 1);
    this.matrix.compose(_position, _quaternion, _scale);
    this.mesh.setMatrixAt(index, this.matrix);
    this.markMatrixDirty(index);
    if (idle.opacityMul !== 1) {
      this.opacityAttr[index] = idle.opacityMul;
      this.markColorDirty(index);
    }
  }

  onInstanceDestroy(instance: VfxInstanceRuntime): void {
    const index = this.slots.get(instance.instanceId);
    if (index === undefined || !this.mesh) return;
    this.matrix.compose(_deadPosition, _quaternion, _deadScale);
    this.mesh.setMatrixAt(index, this.matrix);
    this.markMatrixDirty(index);
    this.opacityAttr[index] = 0;
    this.markColorDirty(index);
    this.freeSlots.push(index);
    this.slots.delete(instance.instanceId);
  }

  setActive(instance: VfxInstanceRuntime, active: boolean): void {
    const index = this.slots.get(instance.instanceId);
    if (index === undefined || !this.mesh) return;
    this.opacityAttr[index] = active ? 1 : 0;
    this.markColorDirty(index);
  }

  flush(): void {
    if (!this.mesh) return;
    this.mesh.count = this.highWater;

    if (this.matrixDirtyMin <= this.matrixDirtyMax) {
      const attr = this.mesh.instanceMatrix;
      const start = this.matrixDirtyMin * 16;
      const count = (this.matrixDirtyMax - this.matrixDirtyMin + 1) * 16;
      attr.clearUpdateRanges();
      attr.addUpdateRange(start, count);
      attr.needsUpdate = true;
      this.matrixDirtyMin = Infinity;
      this.matrixDirtyMax = -Infinity;
    }

    if (this.colorDirtyMin <= this.colorDirtyMax) {
      const start = this.colorDirtyMin;
      const count = this.colorDirtyMax - this.colorDirtyMin + 1;
      const colorAttr = this.mesh.geometry.getAttribute("aColor") as THREE.InstancedBufferAttribute;
      colorAttr.clearUpdateRanges();
      colorAttr.addUpdateRange(start * 3, count * 3);
      colorAttr.needsUpdate = true;
      const opacityAttr = this.mesh.geometry.getAttribute("aOpacity") as THREE.InstancedBufferAttribute;
      opacityAttr.clearUpdateRanges();
      opacityAttr.addUpdateRange(start, count);
      opacityAttr.needsUpdate = true;
      this.colorDirtyMin = Infinity;
      this.colorDirtyMax = -Infinity;
    }
  }

  dispose(): void {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material?.dispose();
    this.mesh = null;
  }

  get debugActiveSlots(): number {
    return this.highWater - this.freeSlots.length;
  }
}
