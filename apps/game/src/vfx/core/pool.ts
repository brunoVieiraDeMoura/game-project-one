/**
 * Pool genérico acquire/release — item 12 do pedido ("em vez de
 * spawn→create→destroy constantemente: pool→acquire→reuse→release").
 *
 * Usado por qualquer renderer que precise reciclar slots (índice de
 * `InstancedMesh`, nó DOM do `DomRenderer`) sem alocar um objeto novo por
 * cast. Genérico em `T` de propósito: o Core não sabe o que é um "slot" de
 * cada renderer, só sabe reciclar o que o renderer pede pra reciclar.
 */
export class VfxPool<T> {
  private readonly free: T[] = [];
  private readonly factory: () => T;
  private readonly reset?: (item: T) => void;
  private liveCount = 0;

  constructor(factory: () => T, reset?: (item: T) => void) {
    this.factory = factory;
    this.reset = reset;
  }

  acquire(): T {
    this.liveCount++;
    const item = this.free.pop();
    if (item !== undefined) return item;
    return this.factory();
  }

  release(item: T): void {
    this.liveCount = Math.max(0, this.liveCount - 1);
    this.reset?.(item);
    this.free.push(item);
  }

  /** quantas instâncias estão em uso agora (não devolvidas ao pool) */
  get inUse(): number {
    return this.liveCount;
  }

  /** quantas instâncias ociosas o pool guarda pra reuso */
  get idle(): number {
    return this.free.length;
  }
}
