import { beforeEach, describe, expect, it, vi } from "vitest";

const respostas = new Map<number, { drops?: unknown[]; mvpDrops?: unknown[] } | null>();
const chamadas: string[] = [];
const fetchMock = vi.fn((url: string) => {
  chamadas.push(url);
  const id = Number(url.split("/").pop());
  const corpo = respostas.get(id);
  if (corpo === undefined) return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
  if (corpo === null) return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
  return Promise.resolve({ ok: true, json: async () => corpo } as Response);
});
(globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

const { ensureMonsterDrops, dropRateFor, __resetForTests } = await import("./monsterDropCatalog");

beforeEach(() => {
  respostas.clear();
  chamadas.length = 0;
  fetchMock.mockClear();
  __resetForTests();
});

describe("ensureMonsterDrops / dropRateFor", () => {
  it("sem catalogar ainda: dropRateFor devolve undefined", () => {
    expect(dropRateFor(1002, 501)).toBeUndefined();
  });

  it("depois de catalogado, devolve a taxa real do item", async () => {
    respostas.set(1002, { drops: [{ itemId: 501, rate: 0.05 }] });
    ensureMonsterDrops(1002);
    await new Promise((r) => setTimeout(r, 0));
    expect(dropRateFor(1002, 501)).toBe(0.05);
  });

  it("item que não está na tabela do monstro: undefined", async () => {
    respostas.set(1002, { drops: [{ itemId: 501, rate: 0.05 }] });
    ensureMonsterDrops(1002);
    await new Promise((r) => setTimeout(r, 0));
    expect(dropRateFor(1002, 999)).toBeUndefined();
  });

  it("também procura em mvpDrops", async () => {
    respostas.set(1038, { drops: [], mvpDrops: [{ itemId: 7666, rate: 0.02 }] });
    ensureMonsterDrops(1038);
    await new Promise((r) => setTimeout(r, 0));
    expect(dropRateFor(1038, 7666)).toBe(0.02);
  });

  it("mobId já pedido não gera segunda requisição (idempotente)", () => {
    respostas.set(1002, { drops: [] });
    ensureMonsterDrops(1002);
    ensureMonsterDrops(1002);
    ensureMonsterDrops(1002);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("mobId inválido (<=0, ex.: entidade que não é monstro) não busca nada", () => {
    ensureMonsterDrops(0);
    ensureMonsterDrops(-1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404/erro de rede não quebra — só fica sem o dado", async () => {
    ensureMonsterDrops(9999); // sem entrada em `respostas` → ok:false
    await new Promise((r) => setTimeout(r, 0));
    expect(dropRateFor(9999, 501)).toBeUndefined();
  });
});
