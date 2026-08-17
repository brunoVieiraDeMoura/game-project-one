import { describe, expect, it, beforeEach, vi } from "vitest";
import * as THREE from "three";
import { VFXManager } from "./manager";
import { projectWorldToScreen } from "./renderers/screenProjection";
import { useWorldStore } from "../../net/worldStore";
import type { VfxWorldContext } from "./types";
// side effect: registra as VfxDefinition REAIS de produção (não fixtures
// sintéticas) — este teste precisa flagrar um `freezeAnchorAfterMs`
// faltando no ARQUIVO DE VERDADE, não numa cópia local que sempre passaria.
import "../skillVfxBindings";

/**
 * Regressão específica (auditoria "dano desloca pra baixo/direita quando o
 * hit mata o mob", 2026-08-19): garante que a posição do Multi-Hit Damage
 * VFX é capturada UMA VEZ no momento do hit e nunca mais recalculada —
 * nem quando o alvo morre, nem quando o alvo é removido (`vanish`), nem
 * quando o gid é reusado por um respawn. Testa contra as `VfxDefinition`
 * REGISTRADAS DE VERDADE (`cold_bolt_impact_gpu`/`thunder_storm_impact`/
 * `soul_strike_impact_gpu`), não uma fixture local — se algum dia alguém
 * remover `freezeAnchorAfterMs` de um desses arquivos, ESTE teste quebra.
 */
vi.mock("../../net/legacyCells", () => ({
  cellToWorld: (_map: unknown, _mapping: unknown, x: number, y: number) => ({ x, y: 0, z: y }),
}));

function makeCameraWorld(): VfxWorldContext {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return { camera } as unknown as VfxWorldContext;
}

const world = makeCameraWorld();

function screenOf(position: { x: number; y: number; z: number }) {
  return projectWorldToScreen(world.camera, 1280, 800, position);
}

describe("vfx/core — Multi-Hit Damage VFX nunca desloca quando o alvo morre/despawna (2026-08-19)", () => {
  beforeEach(() => {
    useWorldStore.setState({ entities: {}, gids: [], target: null });
  });

  it("Cold Bolt (freezeAnchorAfterMs:0): posição e projeção em tela estáveis do hit até depois do despawn", () => {
    useWorldStore.getState().spawn({ gid: 701, kind: "mob", job: 1002, x: 4, y: 6, dir: 0, speed: 150, hp: 500, maxHp: 500 });

    const manager = new VFXManager();
    manager.setWorldContext(world);

    // 1) NO MOMENTO DO HIT — mesma chamada que `migratedVfxBridge.
    // spawnMigratedVfx` faz em produção.
    const handle = manager.play("cold_bolt_impact_gpu", { targetGid: 701, payload: { damage: 500, hits: 5 } })!;
    const noHit = { ...manager.getInstance(handle.instanceId)!.position };
    const telaNoHit = screenOf(noHit);
    expect(noHit).toEqual({ x: 4, y: 0, z: 6 });

    // 2) IMEDIATAMENTE ANTES DA MORTE — cascata ainda tocando, mob vivo,
    // vários quadros passam.
    manager.update(0.016);
    manager.update(0.016);
    manager.update(0.016);
    const antesDaMorte = { ...manager.getInstance(handle.instanceId)!.position };
    expect(antesDaMorte).toEqual(noHit);
    expect(screenOf(antesDaMorte)).toEqual(telaNoHit);

    // 3) NO FRAME DA MORTE — HP cai a 0 (o hit que acabou de tocar MATOU o
    // mob), mob ainda existe no worldStore por enquanto (corpo/animação de
    // morte, antes do `vanish`).
    useWorldStore.getState().setHp(701, 0, 500);
    manager.update(0.016);
    const noFrameDaMorte = { ...manager.getInstance(handle.instanceId)!.position };
    expect(noFrameDaMorte).toEqual(noHit);
    expect(screenOf(noFrameDaMorte)).toEqual(telaNoHit);

    // 4) DEPOIS DO DESPAWN — `entity:vanish` real chega, entidade some do
    // worldStore de vez.
    useWorldStore.getState().vanish(701);
    manager.update(0.016);
    manager.update(0.016);
    const depoisDoDespawn = { ...manager.getInstance(handle.instanceId)!.position };
    expect(depoisDoDespawn).toEqual(noHit);
    expect(depoisDoDespawn).not.toEqual({ x: 0, y: -999, z: 0 }); // nunca o sentinela
    expect(screenOf(depoisDoDespawn)).toEqual(telaNoHit); // pixel idêntico, não só o Vec3
  });

  it("Cold Bolt que NÃO mata o mob: posição igualmente estável (morte não é o gatilho, é só o cenário mais visível)", () => {
    useWorldStore.getState().spawn({ gid: 702, kind: "mob", job: 1002, x: 2, y: 2, dir: 0, speed: 150, hp: 500, maxHp: 500 });
    const manager = new VFXManager();
    manager.setWorldContext(world);

    const handle = manager.play("cold_bolt_impact_gpu", { targetGid: 702, payload: { damage: 80, hits: 5 } })!;
    const noHit = { ...manager.getInstance(handle.instanceId)!.position };

    useWorldStore.getState().setHp(702, 420, 500); // sobrevive
    manager.update(0.016);
    manager.update(0.016);
    // mob anda depois do hit — a posição do dano NÃO deveria seguir
    useWorldStore.setState((s) => ({ entities: { ...s.entities, 702: { ...s.entities[702]!, x: 9, toX: 9 } } }));
    manager.update(0.016);

    expect(manager.getInstance(handle.instanceId)!.position).toEqual(noHit);
  });

  it("vários hits consecutivos coalescidos (Thunder Storm) — congela na posição do PRIMEIRO hit, mesmo se um pulso seguinte matar o mob", () => {
    useWorldStore.getState().spawn({ gid: 703, kind: "mob", job: 1002, x: 7, y: 3, dir: 0, speed: 150, hp: 200, maxHp: 200 });
    const manager = new VFXManager();
    manager.setWorldContext(world);

    const h1 = manager.play("thunder_storm_impact", { targetGid: 703, payload: { damage: 60, hits: 5 } })!;
    const noPrimeiroHit = { ...manager.getInstance(h1.instanceId)!.position };

    // pulso 2 (dentro da janela de coalescência) — MESMA instância
    const h2 = manager.play("thunder_storm_impact", { targetGid: 703, payload: { damage: 60, hits: 5 } })!;
    expect(h2.instanceId).toBe(h1.instanceId);
    manager.update(0.016);
    expect(manager.getInstance(h1.instanceId)!.position).toEqual(noPrimeiroHit);

    // pulso 3 — este É o que mata o mob
    useWorldStore.getState().setHp(703, 0, 200);
    const h3 = manager.play("thunder_storm_impact", { targetGid: 703, payload: { damage: 60, hits: 5 } })!;
    expect(h3.instanceId).toBe(h1.instanceId);
    manager.update(0.016);
    useWorldStore.getState().vanish(703);
    manager.update(0.016);

    expect(manager.getInstance(h1.instanceId)!.position).toEqual(noPrimeiroHit);
  });

  it("Soul Strike (freezeAnchorAfterMs:SOUL_FLIGHT_MS, voo caster→alvo) — congela na CHEGADA, mob morre logo depois, posição não desloca", () => {
    useWorldStore.getState().spawn({ gid: 704, kind: "mob", job: 1002, x: 5, y: 5, dir: 0, speed: 150, hp: 100, maxHp: 100 });
    useWorldStore.getState().spawn({ gid: 705, kind: "player", job: 1, x: 0, y: 0, dir: 0, speed: 150 });
    const manager = new VFXManager();
    manager.setWorldContext(world);

    const handle = manager.play("soul_strike_impact_gpu", { targetGid: 704, sourceGid: 705, payload: { damage: 999, hits: 5 } })!;
    const instance = manager.getInstance(handle.instanceId)!;

    // depois do voo (SOUL_FLIGHT_MS já passou) — congela na chegada
    instance.bornAt = performance.now() - 2000;
    manager.update(0.016);
    const naChegada = { ...instance.position };

    // o hit que acabou de chegar MATA o mob
    useWorldStore.getState().setHp(704, 0, 100);
    manager.update(0.016);
    useWorldStore.getState().vanish(704);
    manager.update(0.016);
    manager.update(0.016);

    expect(instance.position).toEqual(naChegada);
    expect(instance.position).not.toEqual({ x: 0, y: -999, z: 0 });
  });

  it("vários mobs morrendo por hits DIFERENTES — a morte de um não desloca o Damage VFX do outro", () => {
    useWorldStore.getState().spawn({ gid: 706, kind: "mob", job: 1002, x: 1, y: 1, dir: 0, speed: 150, hp: 100, maxHp: 100 });
    useWorldStore.getState().spawn({ gid: 707, kind: "mob", job: 1002, x: 8, y: 8, dir: 0, speed: 150, hp: 100, maxHp: 100 });
    const manager = new VFXManager();
    manager.setWorldContext(world);

    const hA = manager.play("cold_bolt_impact_gpu", { targetGid: 706, payload: { damage: 999, hits: 5 } })!;
    const hB = manager.play("fire_lance_impact_gpu", { targetGid: 707, payload: { damage: 999, hits: 5 } })!;
    const posA = { ...manager.getInstance(hA.instanceId)!.position };
    const posB = { ...manager.getInstance(hB.instanceId)!.position };

    // mata SÓ o mob 706
    useWorldStore.getState().setHp(706, 0, 100);
    useWorldStore.getState().vanish(706);
    manager.update(0.016);

    expect(manager.getInstance(hA.instanceId)!.position).toEqual(posA); // o próprio continua parado
    expect(manager.getInstance(hB.instanceId)!.position).toEqual(posB); // o OUTRO nunca deveria ter se mexido
  });

  it("respawn/reuso do gid depois da morte — o VFX antigo NUNCA salta pro mob novo", () => {
    useWorldStore.getState().spawn({ gid: 708, kind: "mob", job: 1002, x: 3, y: 3, dir: 0, speed: 150, hp: 50, maxHp: 50 });
    const manager = new VFXManager();
    manager.setWorldContext(world);

    const handle = manager.play("cold_bolt_impact_gpu", { targetGid: 708, payload: { damage: 999, hits: 5 } })!;
    const posOriginal = { ...manager.getInstance(handle.instanceId)!.position };

    useWorldStore.getState().setHp(708, 0, 50);
    useWorldStore.getState().vanish(708);
    manager.update(0.016);

    // respawn: MESMO gid, monstro NOVO, posição BEM diferente
    useWorldStore.getState().spawn({ gid: 708, kind: "mob", job: 1002, x: 20, y: 20, dir: 0, speed: 150, hp: 50, maxHp: 50 });
    manager.update(0.016);
    manager.update(0.016);

    expect(manager.getInstance(handle.instanceId)!.position).toEqual(posOriginal);
    expect(manager.getInstance(handle.instanceId)!.position).not.toEqual({ x: 20, y: 0, z: 20 });
  });
});
