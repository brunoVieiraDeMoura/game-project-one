import { describe, expect, it, beforeEach, vi } from "vitest";
import * as THREE from "three";
import { VFXManager } from "./manager";
import { defineVfx, resetVfxRegistry } from "./registry";
import { useWorldStore } from "../../net/worldStore";
import type { VfxInstanceRuntime, VfxWorldContext } from "./types";
import type { VfxRenderer } from "./renderers/rendererTypes";

// `anchor:"cell"` com `opts.cell` presente resolve posição via
// `net/legacyCells.cellToWorld`, que precisa de um `GameMap`/grid reais —
// fora do escopo deste teste (que verifica só a LÓGICA do manager, não a
// conversão célula→mundo, já coberta por `net/legacyCells` em si). Stub
// determinístico: x,y da célula viram x,z do mundo.
vi.mock("../../net/legacyCells", () => ({
  cellToWorld: (_map: unknown, _mapping: unknown, x: number, y: number) => ({ x, y: 0, z: y }),
}));

/** contexto de mundo mínimo — `anchor:"cell"` sem `opts.cell` cai direto em
 * `opts.position`, nunca toca `map`/`mapping`/`terrain` de verdade (ver
 * `anchor.ts: resolveAnchor`), então um cast vazio é seguro aqui. */
const fakeWorld = {} as VfxWorldContext;

function mockRenderer(kind: string): VfxRenderer & {
  created: number[];
  updated: number[];
  pulsed: number[];
  destroyed: number[];
  flushes: number;
  activeCalls: { instanceId: number; active: boolean }[];
} {
  return {
    kind,
    created: [],
    updated: [],
    pulsed: [],
    destroyed: [],
    flushes: 0,
    activeCalls: [],
    onInstanceCreate(instance: VfxInstanceRuntime) {
      this.created.push(instance.instanceId);
    },
    onInstanceUpdate(instance: VfxInstanceRuntime) {
      this.updated.push(instance.instanceId);
    },
    onInstancePulse(instance: VfxInstanceRuntime) {
      this.pulsed.push(instance.instanceId);
    },
    onInstanceDestroy(instance: VfxInstanceRuntime) {
      this.destroyed.push(instance.instanceId);
    },
    setActive(instance: VfxInstanceRuntime, active: boolean) {
      this.activeCalls.push({ instanceId: instance.instanceId, active });
    },
    flush() {
      this.flushes++;
    },
    dispose() {},
  };
}

/** câmera de verdade em (0,0,10) olhando pra origem — instância em (0,0,0)
 * fica DENTRO do frustum, instância em (0,0,50) fica ATRÁS da câmera (fora). */
function makeCameraWorld(): VfxWorldContext {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return { camera } as unknown as VfxWorldContext;
}

describe("vfx/core VFXManager", () => {
  beforeEach(() => {
    resetVfxRegistry();
    vi.useRealTimers();
  });

  it("play() sem definição registrada devolve undefined, nunca lança", () => {
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    expect(manager.play("nao_existe", {})).toBeUndefined();
  });

  it("play() sem worldContext devolve undefined", () => {
    const manager = new VFXManager();
    defineVfx({ id: "x", renderer: "ring", anchor: "cell" });
    expect(manager.play("x", {})).toBeUndefined();
  });

  it("play() cria instância e chama onInstanceCreate no renderer certo", () => {
    defineVfx({ id: "ring_vfx", renderer: "ring", anchor: "cell" });
    const ring = mockRenderer("ring");
    const beam = mockRenderer("beam");
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(ring);
    manager.registerRenderer(beam);

    const handle = manager.play("ring_vfx", { position: { x: 1, y: 0, z: 2 } });
    expect(handle).toBeDefined();
    expect(ring.created).toEqual([handle!.instanceId]);
    expect(beam.created).toEqual([]);
    expect(manager.activeCount).toBe(1);
  });

  it("update() poda instância expirada e chama onInstanceDestroy", () => {
    defineVfx({ id: "flash", renderer: "ring", anchor: "cell", lifetimeMs: 10 });
    const ring = mockRenderer("ring");
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(ring);

    const handle = manager.play("flash", { position: { x: 0, y: 0, z: 0 } })!;
    expect(manager.activeCount).toBe(1);

    const real = performance.now.bind(performance);
    performance.now = () => real() + 50;
    try {
      manager.update(0.016);
    } finally {
      performance.now = real;
    }

    expect(manager.activeCount).toBe(0);
    expect(ring.destroyed).toEqual([handle.instanceId]);
  });

  it("instância sem lifetimeMs vive até stop() explícito", () => {
    defineVfx({ id: "persistent", renderer: "ring", anchor: "cell" });
    const ring = mockRenderer("ring");
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(ring);

    const handle = manager.play("persistent", { position: { x: 0, y: 0, z: 0 } })!;
    manager.update(0.016);
    expect(manager.activeCount).toBe(1);

    manager.stop(handle);
    expect(manager.activeCount).toBe(0);
    expect(ring.destroyed).toEqual([handle.instanceId]);
  });

  it("coalescência por target: pacote repetido pra mesmo alvo alimenta a instância viva (item 14)", () => {
    defineVfx({
      id: "thunder_impact",
      renderer: "beam",
      anchor: "entity",
      lifetimeMs: 1000,
      coalesce: { by: "target", windowMs: 500 },
    });
    const beam = mockRenderer("beam");
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(beam);

    const h1 = manager.play("thunder_impact", { targetGid: 42, position: { x: 0, y: 0, z: 0 } })!;
    const h2 = manager.play("thunder_impact", { targetGid: 42, position: { x: 0, y: 0, z: 0 } })!;
    const h3 = manager.play("thunder_impact", { targetGid: 99, position: { x: 5, y: 0, z: 5 } })!;

    expect(h2.instanceId).toBe(h1.instanceId); // MESMA instância — não criou outra
    expect(h3.instanceId).not.toBe(h1.instanceId); // alvo diferente — instância própria
    expect(manager.activeCount).toBe(2); // 1 por alvo, nunca 1 por pacote
    expect(beam.created).toEqual([h1.instanceId, h3.instanceId]);
    expect(beam.pulsed).toEqual([h1.instanceId]); // o segundo play() virou pulse

    const inst = manager.getInstance(h1.instanceId)!;
    expect(inst.pulseCount).toBe(2);
  });

  it("coalescência por célula usa (x,y), não gid", () => {
    defineVfx({ id: "area_vfx", renderer: "ring", anchor: "cell", coalesce: { by: "cell", windowMs: 500 } });
    const ring = mockRenderer("ring");
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(ring);

    const a = manager.play("area_vfx", { cell: { x: 3, y: 4 }, position: { x: 0, y: 0, z: 0 } })!;
    const b = manager.play("area_vfx", { cell: { x: 3, y: 4 }, position: { x: 0, y: 0, z: 0 } })!;
    const c = manager.play("area_vfx", { cell: { x: 9, y: 9 }, position: { x: 0, y: 0, z: 0 } })!;
    expect(b.instanceId).toBe(a.instanceId);
    expect(c.instanceId).not.toBe(a.instanceId);
  });

  it("definição sem coalesce nunca funde — cada play() é uma instância nova", () => {
    defineVfx({ id: "cold_bolt_impact", renderer: "beam", anchor: "entity" });
    const beam = mockRenderer("beam");
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(beam);

    const a = manager.play("cold_bolt_impact", { targetGid: 1, position: { x: 0, y: 0, z: 0 } })!;
    const b = manager.play("cold_bolt_impact", { targetGid: 1, position: { x: 0, y: 0, z: 0 } })!;
    expect(a.instanceId).not.toBe(b.instanceId);
    expect(manager.activeCount).toBe(2);
  });

  describe("freezeAnchorAfterMs — desacoplamento do lifecycle do alvo (auditoria multi-hit 2026-08-17)", () => {
    beforeEach(() => {
      useWorldStore.setState({ entities: {}, gids: [], target: null });
    });

    it('anchor:"entity" + freezeAnchorAfterMs:0 — alvo some no meio da vida, posição NÃO salta pro sentinela {0,-999,0}', () => {
      useWorldStore.getState().spawn({ gid: 501, kind: "mob", job: 1002, x: 4, y: 6, dir: 0, speed: 150 });
      defineVfx({ id: "cold_bolt_impact_gpu", renderer: "particle", anchor: "entity", freezeAnchorAfterMs: 0, lifetimeMs: 2000 });
      const particle = mockRenderer("particle");
      const manager = new VFXManager();
      manager.setWorldContext(fakeWorld);
      manager.registerRenderer(particle);

      const handle = manager.play("cold_bolt_impact_gpu", { targetGid: 501 })!;
      const resolvedNaHora = manager.getInstance(handle.instanceId)!.position;
      expect(resolvedNaHora).toEqual({ x: 4, y: 0, z: 6 }); // cellToWorld mockado (x,y célula → x,0,y mundo)

      useWorldStore.getState().vanish(501);
      manager.update(0.016);
      manager.update(0.016);

      const depoisDeSumir = manager.getInstance(handle.instanceId)!.position;
      expect(depoisDeSumir).toEqual(resolvedNaHora); // continua onde o hit aconteceu, nunca o sentinela
      expect(depoisDeSumir).not.toEqual({ x: 0, y: -999, z: 0 });
    });

    it('anchor:"entity" SEM freezeAnchorAfterMs (comportamento de sempre) — alvo some, posição SALTA pro sentinela (prova de que o bug é real sem o campo)', () => {
      useWorldStore.getState().spawn({ gid: 502, kind: "mob", job: 1002, x: 4, y: 6, dir: 0, speed: 150 });
      defineVfx({ id: "cold_bolt_impact_gpu_sem_freeze", renderer: "particle", anchor: "entity", lifetimeMs: 2000 });
      const particle = mockRenderer("particle");
      const manager = new VFXManager();
      manager.setWorldContext(fakeWorld);
      manager.registerRenderer(particle);

      const handle = manager.play("cold_bolt_impact_gpu_sem_freeze", { targetGid: 502 })!;
      expect(manager.getInstance(handle.instanceId)!.position).toEqual({ x: 4, y: 0, z: 6 });

      useWorldStore.getState().vanish(502);
      manager.update(0.016);

      expect(manager.getInstance(handle.instanceId)!.position).toEqual({ x: 0, y: -999, z: 0 });
    });

    it('anchor:"caster-to-target" + freezeAnchorAfterMs:SOUL_FLIGHT_MS — rastreia o alvo DURANTE o voo, congela na chegada', () => {
      useWorldStore.getState().spawn({ gid: 601, kind: "mob", job: 1002, x: 4, y: 6, dir: 0, speed: 150 });
      useWorldStore.getState().spawn({ gid: 602, kind: "player", job: 1, x: 0, y: 0, dir: 0, speed: 150 });
      defineVfx({ id: "soul_strike_impact_gpu", renderer: "trail", anchor: "caster-to-target", freezeAnchorAfterMs: 300, lifetimeMs: 2000 });
      const trail = mockRenderer("trail");
      const manager = new VFXManager();
      manager.setWorldContext(fakeWorld);
      manager.registerRenderer(trail);

      const handle = manager.play("soul_strike_impact_gpu", { targetGid: 601, sourceGid: 602 })!;
      const instance = manager.getInstance(handle.instanceId)!;
      expect(instance.position).toEqual({ x: 4, y: 0, z: 6 });

      // ANTES do limite (voo ainda em curso, `bornAt` manipulado em vez de
      // mockar `performance.now()` global — não afeta `interpolatedCell`
      // nem o resto do relógio do teste): alvo anda, posição rastreia.
      instance.bornAt = performance.now() - 100; // 100ms desde o spawn, < 300 do limite
      useWorldStore.getState().entities[601]!.x = 9;
      useWorldStore.getState().entities[601]!.toX = 9;
      manager.update(0.016);
      const duranteVoo = manager.getInstance(handle.instanceId)!.position;
      expect(duranteVoo).toEqual({ x: 9, y: 0, z: 6 }); // já rastreou o alvo que andou

      // DEPOIS do limite (chegou) — congela; some o alvo, posição fica onde
      // chegou, nunca o sentinela.
      instance.bornAt = performance.now() - 500; // 500ms desde o spawn, > 300 do limite
      manager.update(0.016);
      const naChegada = manager.getInstance(handle.instanceId)!.position;
      expect(naChegada).toEqual(duranteVoo); // update() acima de novo não muda mais nada relevante

      useWorldStore.getState().vanish(601);
      manager.update(0.016);
      expect(manager.getInstance(handle.instanceId)!.position).toEqual(naChegada);
      expect(manager.getInstance(handle.instanceId)!.position).not.toEqual({ x: 0, y: -999, z: 0 });
    });
  });

  it("reset() derruba tudo sem exigir expiresAt", () => {
    defineVfx({ id: "persistent", renderer: "ring", anchor: "cell" });
    const ring = mockRenderer("ring");
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(ring);
    manager.play("persistent", { position: { x: 0, y: 0, z: 0 } });
    manager.play("persistent", { position: { x: 0, y: 0, z: 0 } });
    expect(manager.activeCount).toBe(2);
    manager.reset();
    expect(manager.activeCount).toBe(0);
    expect(ring.destroyed.length).toBe(2);
  });

  it("registrar um renderer NOVO recria instâncias já vivas (StrictMode/Fast Refresh remonta VfxRoot, ver docblock de registerRenderer)", () => {
    defineVfx({ id: "persistent", renderer: "ring", anchor: "cell", coalesce: undefined });
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    const ringA = mockRenderer("ring");
    manager.registerRenderer(ringA);
    const handle = manager.play("persistent", { position: { x: 0, y: 0, z: 0 } })!;
    expect(ringA.created).toEqual([handle.instanceId]);

    // "remonte" — o renderer velho sai, um novo (vazio) entra
    const ringB = mockRenderer("ring");
    manager.registerRenderer(ringB);
    expect(ringB.created).toEqual([handle.instanceId]); // recriado, sem precisar de play() novo
  });

  it("update() chama flush só dos renderers com instância ativa, mas também dos outros pra permitir cleanup pendente", () => {
    defineVfx({ id: "ring_vfx", renderer: "ring", anchor: "cell" });
    const ring = mockRenderer("ring");
    const beam = mockRenderer("beam"); // sem instância nenhuma
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(ring);
    manager.registerRenderer(beam);
    manager.play("ring_vfx", { position: { x: 0, y: 0, z: 0 } });
    manager.update(0.016);
    expect(ring.flushes).toBe(1);
    expect(beam.flushes).toBe(1);
  });

  describe("frustum culling (Fase 5, item 11)", () => {
    it("instância fora do frustum: onInstanceUpdate para de ser chamado, setActive(false) só na transição", () => {
      defineVfx({ id: "ring_vfx", renderer: "ring", anchor: "cell" });
      const ring = mockRenderer("ring");
      const manager = new VFXManager();
      manager.setWorldContext(makeCameraWorld());
      manager.registerRenderer(ring);

      const handle = manager.play("ring_vfx", { position: { x: 0, y: 0, z: 50 } })!; // atrás da câmera
      ring.updated.length = 0; // onInstanceCreate não conta como update

      manager.update(0.016);
      manager.update(0.016);
      manager.update(0.016);

      expect(ring.updated).toEqual([]); // nunca chamado enquanto culled
      expect(ring.activeCalls).toEqual([{ instanceId: handle.instanceId, active: false }]); // só 1x, na transição
    });

    it("instância dentro do frustum: onInstanceUpdate roda normal, setActive nunca chamado", () => {
      defineVfx({ id: "ring_vfx", renderer: "ring", anchor: "cell" });
      const ring = mockRenderer("ring");
      const manager = new VFXManager();
      manager.setWorldContext(makeCameraWorld());
      manager.registerRenderer(ring);

      const handle = manager.play("ring_vfx", { position: { x: 0, y: 0, z: 0 } })!;
      manager.update(0.016);
      manager.update(0.016);

      expect(ring.updated).toEqual([handle.instanceId, handle.instanceId]);
      expect(ring.activeCalls).toEqual([]);
    });

    it("transição fora→dentro: setActive(true) uma vez, onInstanceUpdate volta a rodar", () => {
      defineVfx({ id: "ring_vfx", renderer: "ring", anchor: "cell" });
      const ring = mockRenderer("ring");
      const manager = new VFXManager();
      const world = makeCameraWorld();
      manager.setWorldContext(world);
      manager.registerRenderer(ring);

      const handle = manager.play("ring_vfx", { position: { x: 0, y: 0, z: 50 } })!;
      manager.update(0.016); // culled — setActive(false)
      expect(ring.activeCalls).toEqual([{ instanceId: handle.instanceId, active: false }]);

      const instance = manager.getInstance(handle.instanceId)!;
      instance.position = { x: 0, y: 0, z: 0 }; // "entra" no frustum
      manager.update(0.016);

      expect(ring.activeCalls).toEqual([
        { instanceId: handle.instanceId, active: false },
        { instanceId: handle.instanceId, active: true },
      ]);
      expect(ring.updated).toEqual([handle.instanceId]); // voltou a atualizar no mesmo quadro em que reentrou
    });

    it("LOD: thresholds padrão (Infinity) mantêm tier \"full\" mesmo longe; thresholds calibrados mudam o tier", () => {
      defineVfx({ id: "ring_vfx", renderer: "ring", anchor: "cell" });
      const ring = mockRenderer("ring");
      const manager = new VFXManager();
      manager.setWorldContext(makeCameraWorld());
      manager.registerRenderer(ring);

      const handle = manager.play("ring_vfx", { position: { x: 0, y: 0, z: 0 } })!; // dist ~10 da câmera
      manager.update(0.016);
      expect(manager.getInstance(handle.instanceId)!.lod).toBe("full"); // padrão: sempre full

      manager.setLodThresholds({ reducedAtDistance: 5, coreAtDistance: 15 });
      manager.update(0.016);
      expect(manager.getInstance(handle.instanceId)!.lod).toBe("reduced"); // dist ~10, entre 5 e 15
    });

    it("budget: computeBudgetPressure() é leitura diagnóstica, padrão Infinity nunca exclui", () => {
      defineVfx({ id: "ring_vfx", renderer: "ring", anchor: "cell" });
      const ring = mockRenderer("ring");
      const manager = new VFXManager();
      manager.setWorldContext(makeCameraWorld());
      manager.registerRenderer(ring);

      manager.play("ring_vfx", { position: { x: 0, y: 0, z: 0 } });
      manager.play("ring_vfx", { position: { x: 0, y: 0, z: 0 } });
      manager.update(0.016);

      // padrão: nunca exclui nada, mesmo com candidatas
      expect(manager.computeBudgetPressure().excluded.size).toBe(0);
      expect(manager.computeBudgetPressure().totalActive).toBe(2);
      expect(ring.updated.length).toBe(2);
    });

    it("budget: update() APLICA a exclusão (Fase 5, item 13 ligado) — recompute a cada 15 quadros (histerese), setActive próprio de culled", () => {
      defineVfx({ id: "ring_vfx", renderer: "ring", anchor: "cell" });
      const ring = mockRenderer("ring");
      const manager = new VFXManager();
      manager.setWorldContext(makeCameraWorld());
      manager.registerRenderer(ring);
      manager.setBudgetLimits({ maxActiveInstances: 1 });

      const h1 = manager.play("ring_vfx", { position: { x: 0, y: 0, z: 0 } })!;
      const h2 = manager.play("ring_vfx", { position: { x: 0, y: 0, z: 0 } })!;

      // limite setado ANTES do play — o recompute periódico só roda dentro
      // de update(), então nenhum quadro aplicou nada ainda.
      manager.update(0.016);
      expect(ring.updated.length).toBe(2); // 1º quadro: ainda sem recompute (tick=1)

      for (let i = 0; i < 14; i++) manager.update(0.016); // completa os 15 quadros do intervalo

      expect(manager.budgetExcludedCount).toBe(1); // exclusão aplicada de verdade
      const excludedHandle = manager.getInstance(h1.instanceId)!.budgetExcluded ? h1 : h2;
      const keptHandle = excludedHandle === h1 ? h2 : h1;
      expect(manager.getInstance(excludedHandle.instanceId)!.budgetExcluded).toBe(true);
      expect(manager.getInstance(keptHandle.instanceId)!.budgetExcluded).toBeFalsy();
      expect(ring.activeCalls).toContainEqual({ instanceId: excludedHandle.instanceId, active: false });
      expect(ring.activeCalls).not.toContainEqual({ instanceId: keptHandle.instanceId, active: false });

      const updatedBefore = ring.updated.length;
      manager.update(0.016); // 1 quadro normal (fora do intervalo de recompute)
      // só a instância NÃO excluída ganha mais 1 update
      expect(ring.updated.length).toBe(updatedBefore + 1);
      expect(ring.updated[ring.updated.length - 1]).toBe(keptHandle.instanceId);
    });

    it("budget granular: maxActiveParticles exclui por PESO de partícula, não por contagem de instância", () => {
      defineVfx({ id: "burst_vfx", renderer: "particle", anchor: "cell", layers: [{ renderer: "particle", params: { particleCount: 30 } }] });
      const particle = mockRenderer("particle");
      const manager = new VFXManager();
      manager.setWorldContext(makeCameraWorld());
      manager.registerRenderer(particle);
      manager.setBudgetLimits({ maxActiveParticles: 40 }); // cabe 1 instância de 30, não 2 (60 > 40)

      const h1 = manager.play("burst_vfx", { position: { x: 0, y: 0, z: 0 } })!;
      const h2 = manager.play("burst_vfx", { position: { x: 0, y: 0, z: 0 } })!;
      for (let i = 0; i < 15; i++) manager.update(0.016);

      expect(manager.budgetExcludedCount).toBe(1);
      const excluded = manager.getInstance(h1.instanceId)!.budgetExcluded ? h1 : h2;
      expect(manager.getInstance(excluded.instanceId)!.budgetExcluded).toBe(true);
    });

    it("budget granular: maxParticlesPerSkill limita CADA vfxId independente — outra skill não é afetada", () => {
      defineVfx({ id: "burst_a", renderer: "particle", anchor: "cell", layers: [{ renderer: "particle", params: { particleCount: 30 } }] });
      defineVfx({ id: "burst_b", renderer: "particle", anchor: "cell", layers: [{ renderer: "particle", params: { particleCount: 30 } }] });
      const particle = mockRenderer("particle");
      const manager = new VFXManager();
      manager.setWorldContext(makeCameraWorld());
      manager.registerRenderer(particle);
      manager.setBudgetLimits({ maxParticlesPerSkill: 40 }); // 40 por SKILL, não no total

      manager.play("burst_a", { position: { x: 0, y: 0, z: 0 } });
      manager.play("burst_a", { position: { x: 0, y: 0, z: 0 } }); // 60 partículas de "burst_a" — estoura o teto DELA
      manager.play("burst_b", { position: { x: 0, y: 0, z: 0 } }); // 30 de "burst_b" — sozinha, dentro do teto
      for (let i = 0; i < 15; i++) manager.update(0.016);

      // só 1 das 2 instâncias de burst_a cai; burst_b nunca é tocada (grupo próprio)
      expect(manager.budgetExcludedCount).toBe(1);
    });

    it("budget granular: maxDomInstances só conta instâncias com camada `dom` — GPU puro nunca cai por esse limite", () => {
      defineVfx({ id: "dmg_dom", renderer: "dom", anchor: "cell", dom: { art: "x" } });
      defineVfx({ id: "gpu_only", renderer: "ring", anchor: "cell" });
      const dom = mockRenderer("dom");
      const ring = mockRenderer("ring");
      const manager = new VFXManager();
      manager.setWorldContext(makeCameraWorld());
      manager.registerRenderer(dom);
      manager.registerRenderer(ring);
      manager.setBudgetLimits({ maxDomInstances: 1 });

      manager.play("dmg_dom", { position: { x: 0, y: 0, z: 0 } });
      manager.play("dmg_dom", { position: { x: 0, y: 0, z: 0 } }); // 2 DOM — estoura o teto de 1
      manager.play("gpu_only", { position: { x: 0, y: 0, z: 0 } });
      manager.play("gpu_only", { position: { x: 0, y: 0, z: 0 } }); // GPU puro, sem limite nenhum setado pra ele
      for (let i = 0; i < 15; i++) manager.update(0.016);

      expect(manager.budgetExcludedCount).toBe(1); // só 1 das 2 DOM cai; os 2 ring nunca contam
    });

    it("sem câmera no VfxWorldContext (fixture antigo `{} as VfxWorldContext`), culling fica desligado", () => {
      defineVfx({ id: "ring_vfx", renderer: "ring", anchor: "cell" });
      const ring = mockRenderer("ring");
      const manager = new VFXManager();
      manager.setWorldContext(fakeWorld);
      manager.registerRenderer(ring);

      const handle = manager.play("ring_vfx", { position: { x: 0, y: 0, z: 9999 } })!;
      manager.update(0.016);

      expect(ring.updated).toEqual([handle.instanceId]);
      expect(ring.activeCalls).toEqual([]);
    });
  });
});
