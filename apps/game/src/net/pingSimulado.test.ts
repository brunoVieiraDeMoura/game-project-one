import { describe, expect, it } from "vitest";
import { aplicarPingSimulado, pingDaUrl, SEM_PING, type SocketEmbrulhavel } from "./pingSimulado";

/**
 * O banco de provas do netcode não pode ter defeito PRÓPRIO.
 *
 * Se o ping simulado registrar handler que o `off` não remove, cada remonte do
 * `useWorldEvents` (StrictMode no dev, troca de mapa, warp) soma uma cópia de
 * TODOS os handlers de mundo — e aí cada pacote é processado duas, três, quatro
 * vezes. O mundo ficaria errado por causa da ferramenta de medir o mundo, que é
 * o pior tipo de defeito que existe.
 */

/** socket de mentira que registra o que foi chamado */
function socketFalso() {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const emitidos: { evento: string; args: unknown[] }[] = [];
  const s: SocketEmbrulhavel & {
    disparar: (evento: string, ...args: unknown[]) => void;
    quantos: (evento: string) => number;
    emitidos: typeof emitidos;
  } = {
    emit: (evento, ...args) => {
      emitidos.push({ evento, args });
      return s;
    },
    on: (evento, fn) => {
      if (!handlers.has(evento)) handlers.set(evento, new Set());
      handlers.get(evento)!.add(fn);
      return s;
    },
    off: (evento, fn) => {
      if (!fn) handlers.delete(evento);
      else handlers.get(evento)?.delete(fn);
      return s;
    },
    disparar: (evento, ...args) => {
      for (const fn of handlers.get(evento) ?? []) fn(...args);
    },
    quantos: (evento) => handlers.get(evento)?.size ?? 0,
    emitidos,
  };
  return s;
}

/** agendador de mentira: guarda as tarefas e as roda quando mandado */
function relogioFalso() {
  const tarefas: { fn: () => void; ms: number }[] = [];
  return {
    agendar: (fn: () => void, ms: number) => {
      tarefas.push({ fn, ms });
    },
    correr: () => {
      const todas = [...tarefas];
      tarefas.length = 0;
      for (const t of todas) t.fn();
    },
    pendentes: () => tarefas.length,
    atrasos: () => tarefas.map((t) => t.ms),
  };
}

describe("ping simulado", () => {
  it("`off` remove o handler EMBRULHADO — senão o mundo dobra a cada remonte", () => {
    const s = socketFalso();
    aplicarPingSimulado(s, { subida: 50, descida: 50, jitter: 0 });

    const meu = () => {};
    s.on("entity:move", meu);
    expect(s.quantos("entity:move")).toBe(1);

    // o chamador remove com a função ORIGINAL, que não é a que entrou no socket
    s.off("entity:move", meu);
    expect(s.quantos("entity:move")).toBe(0);
  });

  it("registrar o MESMO handler duas vezes não cria dois embrulhos", () => {
    // se cada `on` criasse um embrulho novo, o `off` removeria só o último e o
    // primeiro ficaria vivo para sempre
    const s = socketFalso();
    aplicarPingSimulado(s, { subida: 50, descida: 50, jitter: 0 });
    const meu = () => {};
    s.on("a", meu);
    s.on("a", meu);
    s.off("a", meu);
    expect(s.quantos("a")).toBe(0);
  });

  it("a CHEGADA é atrasada, e chega inteira", () => {
    const s = socketFalso();
    const r = relogioFalso();
    aplicarPingSimulado(s, { subida: 0, descida: 80, jitter: 0 }, r.agendar);

    const recebidos: unknown[][] = [];
    s.on("entity:move", (...a) => recebidos.push(a));
    s.disparar("entity:move", { gid: 1 }, 42);

    // ainda não chegou
    expect(recebidos).toHaveLength(0);
    expect(r.atrasos()).toEqual([80]);
    r.correr();
    expect(recebidos).toEqual([[{ gid: 1 }, 42]]);
  });

  it("a SAÍDA é atrasada", () => {
    const s = socketFalso();
    const r = relogioFalso();
    aplicarPingSimulado(s, { subida: 60, descida: 0, jitter: 0 }, r.agendar);

    s.emit("move:to", { x: 5, y: 5 });
    expect(s.emitidos).toHaveLength(0);
    r.correr();
    expect(s.emitidos).toEqual([{ evento: "move:to", args: [{ x: 5, y: 5 }] }]);
  });

  it("ping ZERO não agenda nada — o caminho normal não paga por existir isto", () => {
    const s = socketFalso();
    const r = relogioFalso();
    aplicarPingSimulado(s, SEM_PING, r.agendar);

    const recebidos: unknown[] = [];
    s.on("x", () => recebidos.push(1));
    s.disparar("x");
    s.emit("y");

    expect(r.pendentes()).toBe(0);
    expect(recebidos).toHaveLength(1); // síncrono
    expect(s.emitidos).toHaveLength(1);
  });

  it("o jitter varia o atraso, e nunca o deixa negativo", () => {
    const s = socketFalso();
    const r = relogioFalso();
    aplicarPingSimulado(s, { subida: 0, descida: 10, jitter: 100 }, r.agendar);

    for (let i = 0; i < 40; i++) s.emit("nada");
    s.on("z", () => {});
    for (let i = 0; i < 40; i++) s.disparar("z");

    const atrasos = r.atrasos();
    expect(atrasos.every((ms) => ms >= 0)).toBe(true);
    // com jitter de 100 sobre base 10, é praticamente impossível 40 amostras
    // saírem todas iguais — se saírem, o jitter não está sendo aplicado
    expect(new Set(atrasos).size).toBeGreaterThan(1);
  });

  it("`?ping` é RTT e se divide entre ida e volta", () => {
    expect(pingDaUrl("?ping=120")).toEqual({ subida: 60, descida: 60, jitter: 0 });
    expect(pingDaUrl("?ping=150&jitter=40")).toEqual({ subida: 75, descida: 75, jitter: 40 });
  });

  it("URL sem ping (ou com lixo) não atrasa nada", () => {
    expect(pingDaUrl("")).toEqual(SEM_PING);
    expect(pingDaUrl("?ping=abc")).toEqual(SEM_PING);
    expect(pingDaUrl("?ping=-50")).toEqual(SEM_PING);
  });
});
