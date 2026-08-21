import * as THREE from "three";
import type { VfxInstanceRuntime, VfxWorldContext } from "../types";
import { InstancedBillboardBase } from "./instancedBillboardBase";
import { createSeededRng } from "../particleMath";
import { computeFlightOffset } from "./flightOffset";
import { computeCurveOffset } from "./curveOffset";

/**
 * `renderer:"particle"` — N slots do MESMO `InstancedMesh` por instância de
 * VFX (ex.: as 66 partículas de área do Oráculo, os fragmentos de uma
 * explosão) — em vez de N `<div>`/`useFrame` por partícula como hoje.
 *
 * A distribuição (raio, atraso, duração) é procedural — MESMA técnica de
 * `buildAreaParticles`/`buildDecoys` (seed determinístico por instância),
 * só que a ANIMAÇÃO acontece aqui, escrita no slot a cada quadro em vez de
 * `@keyframes` CSS.
 *
 * LOD (T2, `core/importancia.ts`/`instance.lod`) reduz quantas das
 * partículas ALOCADAS ficam ativas — mesmo mecanismo de
 * `TrailRenderer.activeCountFor`: os slots em excesso continuam existindo
 * (a contagem alocada na criação nunca muda), só ficam `writeInactiveSlot`.
 * Único outro renderer com essa mesma estrutura (N slots por instância);
 * Sprite/Ring/Beam/Cage são 1 slot/mesh por instância — não há "contagem"
 * pra reduzir ali sem inventar um comportamento novo sem calibração real,
 * então eles não ganham este tratamento (ver `docs/otimizacao-heuristicas.md`).
 */
interface ParticleSpec {
  dx: number;
  dz: number;
  dy: number;
  delayMs: number;
  durMs: number;
  seed: number;
}

/**
 * `delayBaseMs`/`delayMaxMs`/`durBaseMs`/`durJitterMs` — configuráveis via
 * `payload.burstDelayBaseMs`/`burstDelayMaxMs`/`burstDurBaseMs`/
 * `burstDurJitterMs` (Fire Lance impact, reconstrução 2026-08-19-b).
 * Defaults (0/2200/1200/1000) são EXATAMENTE o comportamento antigo — quem
 * não passa os 4 campos (Oracle, Fire Wall, todo o resto) nunca muda. Achado
 * documentado em `multiHitShardImpact.ts` (auditoria "Generic Hit VFX"): o
 * default antigo (`delayMs` até 2200ms, pensado pra nuvem de área de vida
 * longa) deixava a maioria das partículas de um efeito curto (~200-400ms)
 * NUNCA nascer (`elapsedMs >= spec.delayMs` falso a vida toda) — daí o
 * fragmento genérico ter evitado `particle` inteiramente. Um burst de
 * impacto passa `delayBaseMs` perto do instante de pouso + `delayMaxMs`
 * pequeno (jitter curto) + `durBaseMs`/`durJitterMs` curtos, pra nascer e
 * morrer dentro da janela real de vida da instância.
 */
/**
 * `heightMin`/`heightMax` (Cúpula Sagrada, 2026-08-19-y: "partículas
 * espalhadas dentro do prisma, não só no pé do personagem") — faixa
 * vertical de onde cada partícula nasce, sorteada por partícula. Default
 * `0.1/0.1` (faixa de largura zero) preserva o `dy:0.1` fixo de sempre pra
 * quem não passa os dois campos (Oracle/Fire Wall/embers de impacto —
 * nenhum muda).
 */
function buildParticles(
  seed: number,
  count: number,
  radius: number,
  delayBaseMs = 0,
  delayMaxMs = 2200,
  durBaseMs = 1200,
  durJitterMs = 1000,
  heightMin = 0.1,
  heightMax = 0.1,
): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < count; i++) {
    const angle = rnd() * Math.PI * 2;
    const r = 0.25 + rnd() ** 1.8 * Math.max(0.1, radius - 0.25);
    out.push({
      dx: Math.cos(angle) * r,
      dz: Math.sin(angle) * r,
      dy: heightMin + rnd() * Math.max(0, heightMax - heightMin),
      delayMs: delayBaseMs + rnd() * delayMaxMs,
      durMs: durBaseMs + rnd() * durJitterMs,
      seed: rnd(),
    });
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

  onInstanceCreate(instance: VfxInstanceRuntime, world: VfxWorldContext): void {
    void world;
    const count = Number(instance.spawnOptions.payload?.particleCount ?? DEFAULT_PARTICLE_COUNT);
    // `payload.areaRadius` (Fire Ball, 2026-08-19-w: "fumaça/brasas espalhadas
    // pela área REAL, não um raio decorativo") — mesmo fallback de
    // `RingRenderer.ts`: só entra quando a `VfxDefinition` NÃO fixa um
    // `radius` próprio (Oracle/Fire Wall sempre passam `radius` explícito,
    // nunca caem aqui). REVERTIDO (rodada "Fire Ball saindo estranho"): uma
    // tentativa de multiplicar por `world.cellSize` aqui (pra bater com a
    // AoE real, mesma ideia de `orbitOffset.ts`) quebrou o espalhamento já
    // calibrado da fumaça/brasas do Fire Ball, que dependia do valor CRU.
    // `orbitOffset.ts` manteve a multiplicação (só o Oráculo passa por lá,
    // isolado); aqui não — `radius` explícito nunca passava por conta nenhuma.
    const radius = Number(instance.spawnOptions.payload?.radius ?? instance.spawnOptions.payload?.areaRadius ?? 1);
    const payload = instance.spawnOptions.payload;
    const delayBaseMs = Number(payload?.burstDelayBaseMs ?? 0);
    const delayMaxMs = Number(payload?.burstDelayMaxMs ?? 2200);
    const durBaseMs = Number(payload?.burstDurBaseMs ?? 1200);
    const durJitterMs = Number(payload?.burstDurJitterMs ?? 1000);
    const heightMin = Number(payload?.heightMin ?? 0.1);
    const heightMax = Number(payload?.heightMax ?? 0.1);
    const specs = buildParticles(instance.instanceId * 7919 + 1, count, radius, delayBaseMs, delayMaxMs, durBaseMs, durJitterMs, heightMin, heightMax);
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

  /** slots ALOCADOS nunca mudam (fixados na criação); só quantos ficam
   * ATIVOS varia com LOD — mesma função de `TrailRenderer.activeCountFor`.
   * Thresholds de LOD calibrados em `vfx/core/lod.ts`; enquanto ficarem no
   * default (`Infinity`), `instance.lod` é sempre `"full"` e isto é no-op. */
  private activeCountFor(instance: VfxInstanceRuntime, allocated: number): number {
    if (instance.lod === "core") return Math.max(2, Math.round(allocated / 4));
    if (instance.lod === "reduced") return Math.max(2, Math.round(allocated / 2));
    return allocated;
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
    const curve = computeCurveOffset(instance, elapsedMs);
    // mesmo campo que `SpriteRenderer` já lê ("crítico = maior", auditoria
    // "Hit VFX genérico" 2026-08-19) — nenhum renderer decide sozinho o
    // que é crítico, só multiplica o que `hitVfxResolver.criticalScaleFor`
    // já resolveu.
    const critScale = instance.spawnOptions.scale ?? 1;
    const activeCount = this.activeCountFor(instance, entry.indices.length);

    for (let i = 0; i < entry.indices.length; i++) {
      const index = entry.indices[i]!;
      if (i >= activeCount) {
        this.writeInactiveSlot(index);
        continue;
      }
      const spec = entry.specs[i]!;
      const cycle = ((elapsedMs - spec.delayMs) % spec.durMs) / spec.durMs;
      const alive = elapsedMs >= spec.delayMs;
      const fade = alive ? Math.sin(Math.max(0, Math.min(1, cycle)) * Math.PI) : 0;
      this.writeSlot(index, {
        position: [
          instance.position.x + flight.x + curve.x + spec.dx,
          instance.position.y + flight.y + curve.y + spec.dy,
          instance.position.z + flight.z + curve.z + spec.dz,
        ],
        scale: baseScale * (0.7 + 0.3 * spec.seed) * critScale,
        opacity: fade * opacityMultiplier,
        color,
      });
    }
  }
}
