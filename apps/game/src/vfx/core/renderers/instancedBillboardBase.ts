import * as THREE from "three";
import { loadedAtlas } from "../assets/atlasLoader";
import { ensureAtlasLoaded } from "../assets/manifest";
import type { VfxDefinition, VfxInstanceRuntime, VfxWorldContext } from "../types";
import type { VfxRenderer } from "./rendererTypes";

/**
 * Base compartilhada por `SpriteRenderer`/`ParticleRenderer` — UM
 * `InstancedMesh` (item 3 do pedido: "batching quando possível"), billboard
 * calculado no vertex shader a partir da `viewMatrix` (MESMA técnica já
 * provada em `vfx/AmbientParticles.tsx`, não uma segunda implementação).
 *
 * Slot morto (instância destruída) não é COMPACTADO — é escrito com
 * `scale=0` e devolvido ao pool (`pool.ts`) pra reuso. `InstancedMesh`
 * precisa de um `count` contíguo desde o índice 0; escrever "invisível" em
 * vez de remover é o jeito padrão de reciclar slot sem re-empacotar o
 * buffer inteiro a cada morte.
 *
 * Sem atlas registrado (estado atual do projeto — invariante leia1.txt:
 * nenhum asset definitivo existe ainda), a textura cai num placeholder
 * PROCEDURAL (disco radial gerado em runtime, nunca um arquivo no disco) —
 * suficiente pra provar o pipeline (posição/escala/UV/draw) sem inventar
 * arte nenhuma. Documentado explicitamente como "não é a arte final".
 */

const QUAD = new THREE.PlaneGeometry(1, 1);

const VERTEX = `
uniform float uTime;
attribute vec3 aOffset;
attribute float aScale;
attribute float aStretch;
attribute vec4 aFrameUv; // u0, v0, u1, v1
attribute vec3 aColor;
attribute float aOpacity;
attribute float aRotation;
varying vec2 vUv;
varying vec3 vColor;
varying float vOpacity;
void main() {
  vec2 frameUv = mix(aFrameUv.xy, aFrameUv.zw, uv);
  vUv = frameUv;
  vColor = aColor;
  vOpacity = aOpacity;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(aRotation);
  float s = sin(aRotation);
  vec2 rotated = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  // esticado no eixo VERTICAL DA TELA (up), depois de rotacionar — nunca antes
  // (esticar antes da rotação enviesaria o losango pra uma direção diagonal em
  // vez de alongar reto na tela, ver docblock de dropStretch.ts).
  rotated.y *= aStretch;
  vec3 worldOffset = (right * rotated.x + up * rotated.y) * aScale;
  gl_Position = projectionMatrix * viewMatrix * vec4(aOffset + worldOffset, 1.0);
}`;

const FRAGMENT = `
uniform sampler2D uMap;
uniform bool uHasAtlas;
varying vec2 vUv;
varying vec3 vColor;
varying float vOpacity;
void main() {
  vec4 tex = uHasAtlas ? texture2D(uMap, vUv) : vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.0, distance(vUv, vec2(0.5))));
  gl_FragColor = vec4(vColor * tex.rgb, tex.a * vOpacity);
  if (gl_FragColor.a <= 0.001) discard;
}`;

let placeholderTexture: THREE.Texture | null = null;
/** disco radial branco, gerado em canvas — placeholder de VALIDAÇÃO, nunca
 * usado por uma `VfxDefinition` real (as 18 famílias migradas até a Fase 5
 * usam `renderer:"dom"`, que nem passa por aqui). */
function getPlaceholderTexture(): THREE.Texture {
  if (placeholderTexture) return placeholderTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  placeholderTexture = new THREE.CanvasTexture(canvas);
  return placeholderTexture;
}

interface Slot {
  index: number;
}

export abstract class InstancedBillboardBase implements VfxRenderer {
  abstract readonly kind: string;

  private mesh: THREE.InstancedMesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private capacity = 0;
  private highWater = 0;
  private readonly freeSlots: number[] = [];
  private readonly group: THREE.Group;

  private offset!: Float32Array;
  private scaleAttr!: Float32Array;
  private stretchAttr!: Float32Array;
  private uvAttr!: Float32Array;
  private colorAttr!: Float32Array;
  private opacityAttr!: Float32Array;
  private rotationAttr!: Float32Array;

  /**
   * Achado da auditoria Fase 4 (relatório, seção C): `flush()` marcava os 6
   * atributos como `needsUpdate=true` TODO quadro, incondicionalmente — o
   * driver reenviava o buffer INTEIRO (tamanho = capacidade, não instâncias
   * ativas) mesmo sem nada ter mudado. `dirtyMin`/`dirtyMax` rastreiam a
   * FAIXA de índices tocados desde o último flush (`writeSlot` é o único
   * escritor); flush usa `addUpdateRange` pra reenviar só essa faixa, e pula
   * o upload inteiro quando nada mudou (idle steady-state, o caso comum de
   * uma instância só animando opacidade via CSS não existe aqui — mas
   * partículas paradas entre pulsos de vida, sim).
   */
  private dirtyMin = Infinity;
  private dirtyMax = -Infinity;

  constructor(group: THREE.Group, initialCapacity = 128) {
    this.group = group;
    this.ensureCapacity(initialCapacity);
  }

  private markDirty(index: number): void {
    if (index < this.dirtyMin) this.dirtyMin = index;
    if (index > this.dirtyMax) this.dirtyMax = index;
  }

  private ensureCapacity(min: number): void {
    if (min <= this.capacity) return;
    const newCapacity = Math.max(min, this.capacity === 0 ? 128 : this.capacity * 2);

    const geometry = QUAD.clone();
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uTime: { value: 0 }, uMap: { value: getPlaceholderTexture() }, uHasAtlas: { value: false } },
    });

    const offset = new Float32Array(newCapacity * 3);
    const scaleAttr = new Float32Array(newCapacity);
    const stretchAttr = new Float32Array(newCapacity).fill(1);
    const uvAttr = new Float32Array(newCapacity * 4);
    const colorAttr = new Float32Array(newCapacity * 3).fill(1);
    const opacityAttr = new Float32Array(newCapacity);
    const rotationAttr = new Float32Array(newCapacity);

    // default do frame UV é "atlas inteiro" (u1=v1=1) — preenchido ANTES de
    // copiar o estado preservado, pra nunca sobrescrever um UV real por
    // engano (evita depender de "== 0" pra distinguir default de valor real).
    for (let i = 0; i < newCapacity; i++) {
      uvAttr[i * 4 + 2] = 1;
      uvAttr[i * 4 + 3] = 1;
    }

    // preserva o que já existia (crescimento nunca perde instância viva)
    if (this.offset) offset.set(this.offset);
    if (this.scaleAttr) scaleAttr.set(this.scaleAttr);
    if (this.stretchAttr) stretchAttr.set(this.stretchAttr);
    if (this.uvAttr) uvAttr.set(this.uvAttr);
    if (this.colorAttr) colorAttr.set(this.colorAttr);
    if (this.opacityAttr) opacityAttr.set(this.opacityAttr);
    if (this.rotationAttr) rotationAttr.set(this.rotationAttr);

    geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offset, 3));
    geometry.setAttribute("aScale", new THREE.InstancedBufferAttribute(scaleAttr, 1));
    geometry.setAttribute("aStretch", new THREE.InstancedBufferAttribute(stretchAttr, 1));
    geometry.setAttribute("aFrameUv", new THREE.InstancedBufferAttribute(uvAttr, 4));
    geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(colorAttr, 3));
    geometry.setAttribute("aOpacity", new THREE.InstancedBufferAttribute(opacityAttr, 1));
    geometry.setAttribute("aRotation", new THREE.InstancedBufferAttribute(rotationAttr, 1));

    const mesh = new THREE.InstancedMesh(geometry, material, newCapacity);
    mesh.frustumCulled = false;
    mesh.count = 0;

    // achado real da auditoria Fase 4 (não ideal, corrigido aqui): a
    // geometria/material ANTIGOS eram desanexados do grupo mas nunca
    // recebiam `.dispose()` — vazava 1 geometria + 1 material por
    // crescimento de capacidade (raro, ~log2(N) vezes por sessão, mas real).
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.material?.dispose();
    }
    this.group.add(mesh);

    this.mesh = mesh;
    this.material = material;
    this.offset = offset;
    this.scaleAttr = scaleAttr;
    this.stretchAttr = stretchAttr;
    this.uvAttr = uvAttr;
    this.colorAttr = colorAttr;
    this.opacityAttr = opacityAttr;
    this.rotationAttr = rotationAttr;
    this.capacity = newCapacity;
    // índices em [highWater, newCapacity) ficam DISPONÍVEIS mas fora da
    // free-list de propósito (lista "preguiçosa" — `acquireSlot` incrementa
    // `highWater` direto quando a free-list está vazia; não há necessidade
    // de pré-popular nada aqui, só garantir que o espaço existe).
  }

  protected acquireSlot(): Slot {
    const reused = this.freeSlots.pop();
    if (reused !== undefined) return { index: reused };
    this.ensureCapacity(this.highWater + 1);
    const index = this.highWater++;
    return { index };
  }

  protected releaseSlot(slot: Slot): void {
    this.writeSlot(slot.index, { position: [0, -9999, 0], scale: 0, opacity: 0, rotation: 0, color: [1, 1, 1] });
    this.freeSlots.push(slot.index);
  }

  /** frustum culling (`rendererTypes.ts: VfxRenderer.setActive`) — escala
   * 0 é a MESMA técnica de `releaseSlot` (vértice degenerado, ~0 custo de
   * fragmento), mas sem devolver o slot ao pool: a instância ainda existe,
   * só está fora da câmera. Não mexe em posição/UV/cor — o próximo
   * `onInstanceUpdate` (quando a instância voltar a ficar visível) já
   * reescreve tudo via `writeSlot`. */
  protected writeInactiveSlot(index: number): void {
    this.scaleAttr[index] = 0;
    this.opacityAttr[index] = 0;
    this.markDirty(index);
  }

  protected writeSlot(
    index: number,
    data: {
      position: readonly [number, number, number];
      scale: number;
      opacity: number;
      rotation?: number;
      /** multiplicador não-uniforme aplicado ao eixo VERTICAL DA TELA
       * (`aStretch`, ver `VERTEX` acima) — ausente/`1` = quad normal, mesmo
       * comportamento de sempre. Só quem passa isso explicitamente (Fire
       * Lance, via `dropStretch.ts`) muda de forma. */
      stretch?: number;
      color?: readonly [number, number, number];
      uv?: readonly [number, number, number, number];
    },
  ): void {
    this.offset[index * 3] = data.position[0];
    this.offset[index * 3 + 1] = data.position[1];
    this.offset[index * 3 + 2] = data.position[2];
    this.scaleAttr[index] = data.scale;
    this.stretchAttr[index] = data.stretch ?? 1;
    this.opacityAttr[index] = data.opacity;
    this.rotationAttr[index] = data.rotation ?? 0;
    const color = data.color ?? [1, 1, 1];
    this.colorAttr[index * 3] = color[0];
    this.colorAttr[index * 3 + 1] = color[1];
    this.colorAttr[index * 3 + 2] = color[2];
    const uv = data.uv ?? [0, 0, 1, 1];
    this.uvAttr[index * 4] = uv[0];
    this.uvAttr[index * 4 + 1] = uv[1];
    this.uvAttr[index * 4 + 2] = uv[2];
    this.uvAttr[index * 4 + 3] = uv[3];
    this.markDirty(index);
  }

  /** tenta anexar o atlas real da definição — sem-op enquanto não existe
   * (`loadedAtlas` devolve `undefined`, o placeholder continua valendo). */
  protected trySyncAtlas(def: VfxDefinition): void {
    if (!def.atlas || !this.material) return;
    void ensureAtlasLoaded(def.atlas).catch(() => {
      /* atlas ainda não registrado/disponível — placeholder segue valendo */
    });
    const atlas = loadedAtlas(def.atlas);
    if (atlas) {
      this.material.uniforms.uMap!.value = atlas.texture;
      this.material.uniforms.uHasAtlas!.value = true;
    }
  }

  flush(dt: number, _world: VfxWorldContext): void {
    void _world;
    if (!this.mesh || !this.material) return;
    this.material.uniforms.uTime!.value += dt;
    this.mesh.count = this.highWater;

    // nada escrito desde o último flush (nenhum spawn/update/release tocou
    // um slot) — pula o upload inteiro. Era o comportamento incondicional
    // encontrado na auditoria; aqui o caso comum (steady-state entre pulsos
    // de vida) custa 0 upload em vez de 6 buffers do tamanho da capacidade.
    if (this.dirtyMin > this.dirtyMax) return;

    const start = this.dirtyMin;
    const count = this.dirtyMax - this.dirtyMin + 1;
    const attrs: [string, number][] = [
      ["aOffset", 3],
      ["aScale", 1],
      ["aStretch", 1],
      ["aFrameUv", 4],
      ["aColor", 3],
      ["aOpacity", 1],
      ["aRotation", 1],
    ];
    for (const [name, componentsPerVertex] of attrs) {
      const attr = this.mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(start * componentsPerVertex, count * componentsPerVertex);
      attr.needsUpdate = true;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -Infinity;
  }

  abstract onInstanceCreate(instance: VfxInstanceRuntime, world: VfxWorldContext): void;
  abstract onInstanceUpdate(instance: VfxInstanceRuntime, elapsedMs: number, world: VfxWorldContext): void;
  abstract onInstanceDestroy(instance: VfxInstanceRuntime): void;

  dispose(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.material?.dispose();
      this.mesh = null;
    }
  }

  /** só pra teste: quantos slots estão em uso agora. */
  get debugActiveSlots(): number {
    return this.highWater - this.freeSlots.length;
  }
}
