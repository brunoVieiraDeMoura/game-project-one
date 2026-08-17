import { describe, expect, it } from "vitest";
import { VfxPool } from "./pool";

describe("vfx/core pool", () => {
  it("cria via factory quando vazio", () => {
    let created = 0;
    const pool = new VfxPool(() => ({ id: created++ }));
    const a = pool.acquire();
    expect(a.id).toBe(0);
    expect(pool.inUse).toBe(1);
    expect(created).toBe(1);
  });

  it("reusa item liberado em vez de criar outro (item 12: acquire/reuse/release)", () => {
    let created = 0;
    const pool = new VfxPool(() => ({ id: created++ }));
    const a = pool.acquire();
    pool.release(a);
    const b = pool.acquire();
    expect(b).toBe(a); // mesma referência — reciclado, não recriado
    expect(created).toBe(1);
  });

  it("chama reset() ao liberar", () => {
    const resets: number[] = [];
    const pool = new VfxPool(
      () => ({ n: 0 }),
      (item) => {
        item.n = -1;
        resets.push(item.n);
      },
    );
    const item = pool.acquire();
    item.n = 5;
    pool.release(item);
    expect(resets).toEqual([-1]);
    expect(item.n).toBe(-1);
  });

  it("inUse/idle refletem o estado corretamente", () => {
    const pool = new VfxPool(() => ({}));
    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.inUse).toBe(2);
    expect(pool.idle).toBe(0);
    pool.release(a);
    expect(pool.inUse).toBe(1);
    expect(pool.idle).toBe(1);
    void b;
  });

  it("inUse nunca fica negativo com release em excesso", () => {
    const pool = new VfxPool(() => ({}));
    const a = pool.acquire();
    pool.release(a);
    pool.release(a);
    expect(pool.inUse).toBe(0);
  });
});
