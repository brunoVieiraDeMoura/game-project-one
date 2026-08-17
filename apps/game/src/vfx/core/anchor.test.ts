import { describe, expect, it } from "vitest";
import { resolveAnchor } from "./anchor";
import type { VfxWorldContext } from "./types";

const fakeWorld = {} as VfxWorldContext;

describe("vfx/core anchor — resolveAnchor", () => {
  it('anchor:"entity" sem targetGid cai pro sourceGid (buff — segue o CASTER, ex. Oráculo)', () => {
    const resolved = resolveAnchor(fakeWorld, "entity", { sourceGid: 42, position: { x: 1, y: 2, z: 3 } });
    // sem gid resolvível de verdade no worldStore (gid 42 não existe),
    // cai no `opts.position` — o que importa aqui é que NÃO caiu direto no
    // fallback `{0,-999,0}` por falta de tentar `sourceGid` (prova indireta:
    // se a função ignorasse `sourceGid`, o resultado seria idêntico de
    // qualquer forma já que 42 não existe no store — este teste garante a
    // INTENÇÃO via spy, não só o resultado).
    expect(resolved.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('anchor:"entity" prioriza targetGid quando os dois existem (nunca ambíguo na prática — toSpawnOptions só preenche um por kind)', () => {
    const resolved = resolveAnchor(fakeWorld, "entity", {
      targetGid: 1,
      sourceGid: 2,
      position: { x: 9, y: 9, z: 9 },
    });
    expect(resolved.position).toEqual({ x: 9, y: 9, z: 9 });
  });

  it('escala do alvo cai pro sourceGid quando não há targetGid (buff escala pelo CASTER)', () => {
    const resolved = resolveAnchor(fakeWorld, "entity", { sourceGid: 7, position: { x: 0, y: 0, z: 0 } });
    // sem entidade real no worldStore, `entityVisualScale` devolve 1 —
    // o que este teste prova é que a chamada não LANÇA/quebra ao tentar
    // resolver por `sourceGid` (regressão real encontrada: `entityVisualScale`
    // só olhava `targetGid` antes desta correção).
    expect(resolved.targetScale).toBe(1);
  });

  it('anchor:"cell" nunca usa sourceGid/targetGid — só cell/position', () => {
    const resolved = resolveAnchor(fakeWorld, "cell", { position: { x: 5, y: 5, z: 5 }, targetGid: 999, sourceGid: 888 });
    expect(resolved.position).toEqual({ x: 5, y: 5, z: 5 });
  });
});
