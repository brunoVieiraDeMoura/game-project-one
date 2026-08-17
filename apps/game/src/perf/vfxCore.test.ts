import { describe, expect, it, afterAll } from "vitest";
import { VFXManager } from "../vfx/core/manager";
import { defineVfx, resetVfxRegistry } from "../vfx/core/registry";
import { VfxPool } from "../vfx/core/pool";
import type { VfxInstanceRuntime, VfxWorldContext } from "../vfx/core/types";
import type { VfxRenderer } from "../vfx/core/renderers/rendererTypes";
import { calibrar, custoRelativo, imprimirRelatorio } from "./orcamento";

/**
 * Orçamento do VFX Core — mesma filosofia de `perf/desempenho.test.ts`
 * (razão contra calibração, nunca ms cru). Mede o CAMINHO QUENTE do
 * `VFXManager`: reposicionar/atualizar N instâncias por quadro é o
 * substituto direto de "N `VfxNode` React + N `useFrame`" que este Core
 * existe pra eliminar — se este número regredir, a arquitetura nova
 * ficou tão cara quanto a antiga que ela devia substituir.
 *
 * GPU (custo real de `SpriteRenderer`/`DomRenderer` desenhando na tela) NÃO
 * é medido aqui — mesma fronteira que o resto do projeto já usa (three.js/
 * R3F não é exercitado em vitest, ver `/vfx-bench` pra medição em runtime
 * real, `docs/claude-context/05-diagnostics-flight-recorder.md`).
 */

// `anchor:"entity"` sem gid cai direto em `opts.position` (ver
// `anchor.ts: resolveAnchor`) — mede o CAMINHO de reposicionamento por
// quadro sem depender de `net/worldStore`/mapa reais.
const fakeWorld = {} as VfxWorldContext;

function noopRenderer(kind: string): VfxRenderer {
  return {
    kind,
    onInstanceCreate() {},
    onInstanceUpdate() {},
    onInstanceDestroy() {},
    flush() {},
    dispose() {},
  };
}

describe("orçamento de desempenho — vfx/core", () => {
  const calibracao = calibrar();
  afterAll(imprimirRelatorio);

  it("manager.update() com 200 instâncias vivas (anchor:entity, reposiciona todo quadro)", () => {
    resetVfxRegistry();
    defineVfx({ id: "bench_entity", renderer: "sprite", anchor: "entity" });
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(noopRenderer("sprite"));
    for (let i = 0; i < 200; i++) manager.play("bench_entity", { position: { x: i, y: 0, z: 0 } });

    const custo = custoRelativo("manager.update 200 instâncias (entity)", calibracao, 20, () => {
      manager.update(0.016);
    });
    expect(custo).toBeLessThan(2.5);
  });

  it("manager.update() com 200 instâncias vivas (anchor:cell, posição fixa)", () => {
    resetVfxRegistry();
    defineVfx({ id: "bench_cell", renderer: "ring", anchor: "cell" });
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(noopRenderer("ring"));
    for (let i = 0; i < 200; i++) manager.play("bench_cell", { position: { x: i, y: 0, z: 0 } });

    const custo = custoRelativo("manager.update 200 instâncias (cell)", calibracao, 20, () => {
      manager.update(0.016);
    });
    expect(custo).toBeLessThan(1.5);
  });

  it("play()+destroy() de 200 instâncias, nascendo e morrendo todo quadro (pior caso de VFX curto)", () => {
    resetVfxRegistry();
    defineVfx({ id: "bench_flash", renderer: "sprite", anchor: "entity", lifetimeMs: 0 });
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(noopRenderer("sprite"));

    const custo = custoRelativo("play+update(poda) 200 instâncias efêmeras", calibracao, 20, () => {
      for (let i = 0; i < 200; i++) manager.play("bench_flash", { position: { x: i, y: 0, z: 0 } });
      manager.update(0.016);
    });
    expect(custo).toBeLessThan(3.5);
  });

  it("VfxPool acquire/release de 1000 slots não aloca acima do necessário", () => {
    let created = 0;
    const pool = new VfxPool(() => ({ id: created++ }));
    const items: ReturnType<typeof pool.acquire>[] = [];

    const custo = custoRelativo("pool acquire/release 1000", calibracao, 10, () => {
      for (let i = 0; i < 1000; i++) items.push(pool.acquire());
      for (const item of items) pool.release(item);
      items.length = 0;
    });
    expect(custo).toBeLessThan(1.5);
    // 1ª rodada aloca 1000; todas as seguintes reciclam — nunca cresce de novo
    expect(created).toBeLessThanOrEqual(1000);
  });

  it("coalescência: 200 pulses no MESMO alvo não criam instância nova (item 14)", () => {
    resetVfxRegistry();
    defineVfx({
      id: "bench_coalesce",
      renderer: "beam",
      anchor: "entity",
      lifetimeMs: 5000,
      coalesce: { by: "target", windowMs: 5000 },
    });
    const manager = new VFXManager();
    manager.setWorldContext(fakeWorld);
    manager.registerRenderer(noopRenderer("beam"));
    manager.play("bench_coalesce", { targetGid: 1, position: { x: 0, y: 0, z: 0 } });

    const custo = custoRelativo("pulse 200x no mesmo alvo", calibracao, 20, () => {
      for (let i = 0; i < 200; i++) manager.play("bench_coalesce", { targetGid: 1, position: { x: 0, y: 0, z: 0 } });
    });
    expect(manager.activeCount).toBe(1); // nunca virou 201 instâncias
    expect(custo).toBeLessThan(2.5);
  });
});
