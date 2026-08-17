import * as THREE from "three";
import { moldarMalhaTerreno } from "../../../play/pickGround";
import type { VfxInstanceRuntime, VfxWorldContext } from "../types";
import type { VfxRenderer } from "./rendererTypes";

/**
 * `renderer:"ring"` — disco/anel no chão, MOLDADO ao relevo real (mesma
 * técnica de `AreaCell`/`AreaDisc` em `vfx/SkillVfx.tsx` hoje —
 * `moldarMalhaTerreno`, reusada, não reimplementada).
 *
 * Diferente de Sprite/Particle/Beam: cada instância tem geometria PRÓPRIA
 * (a malha molda ao terreno NAQUELE ponto específico) — não dá pra
 * compartilhar um `InstancedMesh` sem perder o relevo por instância. Áreas
 * são raras (poucas dezenas no máximo, nunca centenas simultâneas como
 * partículas), então um pool de `THREE.Mesh` — não instanciado, mas ainda
 * 100% GPU — é a troca certa aqui.
 *
 * Achado da auditoria Fase 4 (relatório, seção C, corrigido na Fase 5): a
 * versão original criava `Mesh`+`Geometry`+`Material` NOVOS a cada
 * `onInstanceCreate` e descartava tudo em `onInstanceDestroy` — exatamente
 * o create/destroy por cast que o Core existe pra evitar. `SEGMENTS` é
 * constante pro renderer inteiro, então a contagem de vértices nunca muda
 * entre instâncias — reformar a MESMA geometria via `moldarMalhaTerreno`
 * (ela só reescreve `position`, não recria buffer) é seguro. Pool: mesh
 * liberado fica `visible=false` e disponível pro próximo `onInstanceCreate`,
 * nunca desanexado do grupo nem descartado até `dispose()`.
 */
const SEGMENTS = 8;
const HEIGHT_OFFSET = 0.05;

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uMode; // 0 = borda de célula, 1 = disco radial
varying vec2 vUv;
void main() {
  float alpha;
  if (uMode > 0.5) {
    float d = distance(vUv, vec2(0.5)) * 2.0;
    if (d > 1.0) discard;
    float edge = smoothstep(0.75, 1.0, d);
    float core = 1.0 - smoothstep(0.0, 0.9, d);
    alpha = (core * 0.35 + edge * 0.75) * (0.75 + 0.25 * sin(uTime * 4.0));
  } else {
    vec2 d = abs(vUv - 0.5) * 2.0;
    float borda = max(d.x, d.y);
    float linha = smoothstep(0.78, 1.0, borda);
    alpha = (0.16 + linha * 0.5) * (0.8 + 0.2 * sin(uTime * 5.0));
  }
  gl_FragColor = vec4(uColor, alpha * uOpacity);
}`;

interface RingEntry {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

function buildEntry(): RingEntry {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false, // VFX de skill fica por cima de propósito (mesma regra do AreaCell hoje)
    side: THREE.DoubleSide,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: new THREE.Color("#c084fc") },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uMode: { value: 0 },
    },
  });
  const geometry = new THREE.PlaneGeometry(1, 1, SEGMENTS, SEGMENTS);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  return { mesh, material };
}

export class RingRenderer implements VfxRenderer {
  readonly kind = "ring";
  private readonly group: THREE.Group;
  private readonly entries = new Map<number, RingEntry>();
  private readonly pool: RingEntry[] = [];

  constructor(group: THREE.Group) {
    this.group = group;
  }

  private acquire(): RingEntry {
    const reused = this.pool.pop();
    if (reused) return reused;
    const entry = buildEntry();
    this.group.add(entry.mesh);
    return entry;
  }

  onInstanceCreate(instance: VfxInstanceRuntime, world: VfxWorldContext): void {
    const radius = Number(instance.spawnOptions.payload?.radius ?? 0.5) * world.cellSize;
    const mode = instance.spawnOptions.payload?.mode === "disc" ? 1 : 0;
    const colorHex = String(instance.spawnOptions.payload?.color ?? "#c084fc");

    const entry = this.acquire();
    entry.material.uniforms.uColor!.value.set(colorHex);
    entry.material.uniforms.uMode!.value = mode;
    entry.material.uniforms.uOpacity!.value = 1;
    moldarMalhaTerreno(entry.mesh.geometry, instance.position.x, instance.position.z, radius, SEGMENTS, HEIGHT_OFFSET, world.terrain);
    entry.mesh.visible = true;
    this.entries.set(instance.instanceId, entry);
  }

  onInstanceUpdate(): void {
    // posição/forma são fixas no nascimento (`anchor:"cell"` — mesma regra
    // documentada em `SkillVfx.tsx: presoNaCelula`); só a animação do
    // shader (`uTime`) muda, feita no `flush()`.
  }

  /** frustum culling — `mesh.visible=false` some com o draw call inteiro
   * desta instância (nem sequer entra no comando de desenho da GPU), o
   * caso mais barato dos 5 renderers porque cada `Ring` já é 1 mesh
   * próprio (não instanciado, seção C do relatório da Fase 4). */
  setActive(instance: VfxInstanceRuntime, active: boolean): void {
    const entry = this.entries.get(instance.instanceId);
    if (entry) entry.mesh.visible = active;
  }

  onInstanceDestroy(instance: VfxInstanceRuntime): void {
    const entry = this.entries.get(instance.instanceId);
    if (!entry) return;
    entry.mesh.visible = false;
    this.entries.delete(instance.instanceId);
    this.pool.push(entry);
  }

  flush(dt: number): void {
    for (const entry of this.entries.values()) entry.material.uniforms.uTime!.value += dt;
  }

  dispose(): void {
    for (const entry of [...this.entries.values(), ...this.pool]) {
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.material.dispose();
    }
    this.entries.clear();
    this.pool.length = 0;
  }

  get debugActiveSlots(): number {
    return this.entries.size;
  }
}
