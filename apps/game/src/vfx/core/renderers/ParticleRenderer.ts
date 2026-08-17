import * as THREE from "three";
import type { VfxInstanceRuntime, VfxWorldContext } from "../types";
import { InstancedBillboardBase } from "./instancedBillboardBase";
import { createSeededRng } from "../particleMath";
import { computeFlightOffset } from "./flightOffset";

/**
 * `renderer:"particle"` — N slots do MESMO `InstancedMesh` por instância de
 * VFX (ex.: as 66 partículas de área do Oráculo, os fragmentos de uma
 * explosão) — em vez de N `<div>`/`useFrame` por partícula como hoje.
 *
 * A distribuição (raio, atraso, duração) é procedural — MESMA técnica de
 * `buildAreaParticles`/`buildDecoys` (seed determinístico por instância),
 * só que a ANIMAÇÃO acontece aqui, escrita no slot a cada quadro em vez de
 * `@keyframes` CSS.
 */
interface ParticleSpec {
  dx: number;
  dz: number;
  dy: number;
  delayMs: number;
  durMs: number;
  seed: number;
}

function buildParticles(seed: number, count: number, radius: number): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < count; i++) {
    const angle = rnd() * Math.PI * 2;
    const r = 0.25 + rnd() ** 1.8 * Math.max(0.1, radius - 0.25);
    out.push({ dx: Math.cos(angle) * r, dz: Math.sin(angle) * r, dy: 0.1, delayMs: rnd() * 2200, durMs: 1200 + rnd() * 1000, seed: rnd() });
  }
  return out;
}

export const DEFAULT_PARTICLE_COUNT = 24;

// reusado a nível de módulo — nunca alocado por instância/quadro (mesmo
// princípio de `BeamRenderer.ts`/`SpriteRenderer.ts`).
const _color = new THREE.Color();

/**
 * Fix mecânico (Fase 5, rodada "reestruturar VFX pra escala", leia1.txt
 * item 1): `payload.color` não era lido (toda partícula saía branca,
 * `color` nunca passado pra `writeSlot`) — `payload.opacity`, quando
 * presente, entra como MULTIPLICADOR do fade animado (nunca substitui a
 * animação em si, que é a identidade deste renderer: partículas nascem e
 * somem sozinhas, opacidade "fixa" não faz sentido aqui do jeito que faz
 * pro `SpriteRenderer`).
 */
export class ParticleRenderer extends InstancedBillboardBase {
  readonly kind = "particle";
  private readonly slots = new Map<number, { indices: number[]; specs: ParticleSpec[] }>();

  constructor(group: THREE.Group) {
    super(group);
  }

  onInstanceCreate(instance: VfxInstanceRuntime): void {
    const count = Number(instance.spawnOptions.payload?.particleCount ?? DEFAULT_PARTICLE_COUNT);
    const radius = Number(instance.spawnOptions.payload?.radius ?? 1);
    const specs = buildParticles(instance.instanceId * 7919 + 1, count, radius);
    const indices = specs.map(() => this.acquireSlot().index);
    this.slots.set(instance.instanceId, { indices, specs });
    this.trySyncAtlas(instance.def);
    this.writeFromInstance(instance, 0);
  }

  onInstanceUpdate(instance: VfxInstanceRuntime, elapsedMs: number): void {
    this.writeFromInstance(instance, elapsedMs);
  }

  onInstanceDestroy(instance: VfxInstanceRuntime): void {
    const entry = this.slots.get(instance.instanceId);
    if (!entry) return;
    for (const index of entry.indices) this.releaseSlot({ index });
    this.slots.delete(instance.instanceId);
  }

  setActive(instance: VfxInstanceRuntime, active: boolean): void {
    if (active) return; // religa sozinho no próximo onInstanceUpdate
    const entry = this.slots.get(instance.instanceId);
    if (!entry) return;
    for (const index of entry.indices) this.writeInactiveSlot(index);
  }

  private writeFromInstance(instance: VfxInstanceRuntime, elapsedMs: number): void {
    const entry = this.slots.get(instance.instanceId);
    if (!entry) return;
    const scaleSpec = instance.def.scale;
    const baseScale = typeof scaleSpec === "number" ? scaleSpec : (scaleSpec?.base ?? 0.15);

    const colorHex = instance.spawnOptions.payload?.color;
    let color: readonly [number, number, number] | undefined;
    if (typeof colorHex === "string") {
      _color.set(colorHex);
      color = [_color.r, _color.g, _color.b];
    }
    const opacityRaw = instance.spawnOptions.payload?.opacity;
    const opacityMultiplier = typeof opacityRaw === "number" ? opacityRaw : 1;
    const flight = computeFlightOffset(instance, elapsedMs);
    // mesmo campo que `SpriteRenderer` já lê ("crítico = maior", auditoria
    // "Hit VFX genérico" 2026-08-19) — nenhum renderer decide sozinho o
    // que é crítico, só multiplica o que `hitVfxResolver.criticalScaleFor`
    // já resolveu.
    const critScale = instance.spawnOptions.scale ?? 1;

    for (let i = 0; i < entry.indices.length; i++) {
      const spec = entry.specs[i]!;
      const index = entry.indices[i]!;
      const cycle = ((elapsedMs - spec.delayMs) % spec.durMs) / spec.durMs;
      const alive = elapsedMs >= spec.delayMs;
      const fade = alive ? Math.sin(Math.max(0, Math.min(1, cycle)) * Math.PI) : 0;
      this.writeSlot(index, {
        position: [instance.position.x + flight.x + spec.dx, instance.position.y + flight.y + spec.dy, instance.position.z + flight.z + spec.dz],
        scale: baseScale * (0.7 + 0.3 * spec.seed) * critScale,
        opacity: fade * opacityMultiplier,
        color,
      });
    }
  }
}
