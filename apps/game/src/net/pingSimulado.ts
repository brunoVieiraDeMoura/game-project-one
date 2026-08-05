/**
 * Ping falso, para poder DESENVOLVER netcode numa máquina onde o servidor está
 * a zero milissegundo de distância.
 *
 * Predição, reconciliação e interpolação são todas remédios para latência. No
 * WSL local o RTT é ~0, então nenhuma delas se manifesta: o código pode estar
 * completamente errado e parecer perfeito. Este módulo é o banco de provas —
 * sem ele, "melhorou" volta a ser opinião.
 *
 * Ele embrulha o socket UMA vez, no `gateway()`, que é o único ponto de contato
 * com o servidor. Só em DEV.
 *
 * ## Por que o `off` precisa do mapa
 *
 * Atrasar a CHEGADA significa registrar no socket um handler DIFERENTE do que o
 * chamador passou. Quem depois chama `socket.off("entity:move", onMove)` com a
 * função original não removeria nada, e o `useWorldEvents` desmontaria deixando
 * todos os handlers vivos — cada remonte (StrictMode, troca de mapa) somaria uma
 * cópia, e o mundo passaria a receber cada pacote duas, três, quatro vezes.
 * O mapa original→embrulhado é o que fecha esse buraco, e é a única parte disto
 * que tem regra de verdade — por isso está em teste.
 */

/** um socket com o mínimo que precisamos embrulhar (o Socket.IO satisfaz) */
export interface SocketEmbrulhavel {
  emit: (evento: string, ...args: unknown[]) => unknown;
  on: (evento: string, fn: (...args: unknown[]) => void) => unknown;
  off: (evento: string, fn?: (...args: unknown[]) => void) => unknown;
}

export interface PingSimulado {
  /** atraso do cliente para o servidor, em ms */
  subida: number;
  /** atraso do servidor para o cliente, em ms */
  descida: number;
  /**
   * Variação aleatória somada a cada atraso, em ms.
   *
   * É o jitter que a interpolação de snapshots existe para absorver: com atraso
   * constante o pacote atrasa mas chega em ordem e em ritmo, e o defeito não
   * aparece. Quem produz o "congela e salta" é a VARIAÇÃO.
   */
  jitter: number;
}

export const SEM_PING: PingSimulado = { subida: 0, descida: 0, jitter: 0 };

/**
 * Lê a configuração da URL: `?ping=120` (dividido meio a meio entre ida e
 * volta, como um RTT de verdade) e `?jitter=40`.
 *
 * `?ping` é o número que o jogador reconhece — ninguém pensa em "60 ms de
 * subida". Quem quiser assimetria mexe no `__ping()` do console.
 */
/**
 * Onde a escolha fica guardada entre as telas.
 *
 * O socket é criado no LOGIN (é lá que `gateway()` é chamado primeiro), não no
 * `/play` — então `?ping=150` na URL do jogo chegava tarde demais: o embrulho já
 * tinha sido instalado, com a busca da tela de login, que não tem ping nenhum.
 * Era por isso que `/play?ping=` não fazia nada.
 *
 * Guardando, o parâmetro vale a partir de QUALQUER tela (inclusive a de login) e
 * sobrevive à navegação. `?ping=0` limpa.
 */
const CHAVE = "ragnarok:ping-simulado";

export function lerPingGuardado(): PingSimulado | null {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return null;
    const p = JSON.parse(cru) as Partial<PingSimulado>;
    if (typeof p.subida !== "number" || typeof p.descida !== "number") return null;
    return { subida: p.subida, descida: p.descida, jitter: typeof p.jitter === "number" ? p.jitter : 0 };
  } catch {
    return null;
  }
}

export function guardarPing(p: PingSimulado): void {
  try {
    if (p.subida <= 0 && p.descida <= 0 && p.jitter <= 0) localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, JSON.stringify(p));
  } catch {
    /* modo privado, cota cheia: o ping simulado não vale uma exceção */
  }
}

export function pingDaUrl(busca: string): PingSimulado {
  const p = new URLSearchParams(busca);
  const rtt = Number(p.get("ping") ?? 0);
  const jitter = Number(p.get("jitter") ?? 0);
  if (!Number.isFinite(rtt) || rtt <= 0) {
    return { ...SEM_PING, jitter: Number.isFinite(jitter) && jitter > 0 ? jitter : 0 };
  }
  return {
    subida: rtt / 2,
    descida: rtt / 2,
    jitter: Number.isFinite(jitter) && jitter > 0 ? jitter : 0,
  };
}

/**
 * Embrulha o socket para atrasar ida e volta.
 *
 * `cfg` é lido POR REFERÊNCIA a cada evento, então dá para mudar o ping ao vivo
 * (`__ping(...)` no console) sem reconectar nem re-registrar handler nenhum.
 *
 * `agendar` é injetável só para o teste não precisar de relógio de verdade.
 */
export function aplicarPingSimulado(
  socket: SocketEmbrulhavel,
  cfg: PingSimulado,
  agendar: (fn: () => void, ms: number) => void = (fn, ms) => {
    setTimeout(fn, ms);
  },
): void {
  const emitOriginal = socket.emit.bind(socket);
  const onOriginal = socket.on.bind(socket);
  const offOriginal = socket.off.bind(socket);
  /** original → embrulhado, para o `off` conseguir remover (ver o topo) */
  const embrulhados = new Map<(...a: unknown[]) => void, (...a: unknown[]) => void>();

  const atraso = (base: number) => {
    if (base <= 0 && cfg.jitter <= 0) return 0;
    return Math.max(0, base + (cfg.jitter > 0 ? Math.random() * cfg.jitter : 0));
  };

  socket.emit = (evento, ...args) => {
    const ms = atraso(cfg.subida);
    if (ms <= 0) return emitOriginal(evento, ...args);
    agendar(() => void emitOriginal(evento, ...args), ms);
    return socket;
  };

  socket.on = (evento, fn) => {
    let embrulhado = embrulhados.get(fn);
    if (!embrulhado) {
      embrulhado = (...args: unknown[]) => {
        const ms = atraso(cfg.descida);
        if (ms <= 0) {
          fn(...args);
          return;
        }
        agendar(() => fn(...args), ms);
      };
      embrulhados.set(fn, embrulhado);
    }
    return onOriginal(evento, embrulhado);
  };

  socket.off = (evento, fn) => {
    if (!fn) return offOriginal(evento);
    // remove o EMBRULHADO — foi ele que entrou no socket
    return offOriginal(evento, embrulhados.get(fn) ?? fn);
  };
}
