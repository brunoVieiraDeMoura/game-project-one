/**
 * ISOLAMENTO — desligar um subsistema por vez para provar (ou descartar) quem
 * causa um hitch, sem recompilar.
 *
 * A escolha entra por query string (`?iso=chave1,chave2`) e sobrevive à
 * navegação até o `/play` dentro da MESMA ABA — é `sessionStorage`, não
 * `localStorage`, e a troca é de propósito: `?iso=semCeuFoto,semAgua,
 * semSombra` (teste A/B real desta auditoria) ficou preso em disco por
 * sessões inteiras — todo `/play` seguinte, em toda aba NOVA, herdava céu/
 * água/sombra desligados calado, parecendo regressão de código. Sessão
 * fechada (aba fechada) = isolamento limpo sozinho; dentro da MESMA sessão de
 * teste, recarregar a página continua lembrando a escolha (o motivo de não
 * ser só `?iso=` sem guardar nada).
 *
 * Um ponto de controle só, não oito arquiteturas: cada consumidor faz UM `if`
 * de uma linha (`if (semTerreno()) return null;` ou equivalente) no lugar
 * onde já decide o que montar — nenhum subsistema precisa saber que existe
 * isolamento, só perguntar se está isolado.
 *
 * Custo em produção: zero. `ativo()` começa por `import.meta.env.DEV`, que o
 * Vite substitui por `false` no build — o `&&` inteiro morre e o corpo de
 * quem chama nem executa a comparação.
 */

/**
 * Uma chave por subsistema testável pela Fase C da auditoria de render.
 *
 * `semHorizonte` existe desde já mesmo sem o horizonte existir ainda (Fase G)
 * — a chave é barata de declarar e a Fase H precisa dela pronta.
 */
export const CHAVES_ISOLAMENTO = [
  "semRetratoAlvo",
  "semAoe",
  "semCursor",
  "semProps",
  "semTerreno",
  "semNevoa",
  "semHorizonte",
  "semVento",
  "semSol",
  "semAmbiente",
  "semAgua",
  "semSombra",
  "semParticulas",
  "semCeuFoto",
  "semImpostorArvore",
] as const;

export type ChaveIsolamento = (typeof CHAVES_ISOLAMENTO)[number];

const CHAVE_STORAGE = "ragnarok:iso";

function ehChaveValida(v: string): v is ChaveIsolamento {
  return (CHAVES_ISOLAMENTO as readonly string[]).includes(v);
}

function lerConjuntoGuardado(): Set<ChaveIsolamento> {
  if (typeof window === "undefined") return new Set();
  try {
    const url = new URLSearchParams(window.location.search).get("iso");
    if (url !== null) {
      // `?iso=` vazio limpa (mesma convenção do `?voo=0`); `?iso=a,b` troca
      // o conjunto inteiro, não soma ao que já estava guardado — trocar de
      // teste sem carregar o anterior junto é o ponto
      const partes = url
        .split(",")
        .map((s) => s.trim())
        .filter(ehChaveValida);
      const conjunto = new Set(partes);
      window.sessionStorage.setItem(CHAVE_STORAGE, [...conjunto].join(","));
      return conjunto;
    }
    const guardado = window.sessionStorage.getItem(CHAVE_STORAGE);
    if (!guardado) return new Set();
    return new Set(guardado.split(",").filter(ehChaveValida));
  } catch {
    return new Set();
  }
}

let ligadas = new Set<ChaveIsolamento>();
let carregado = false;

function garantirCarregado(): void {
  if (carregado) return;
  carregado = true;
  ligadas = lerConjuntoGuardado();
}

function gravar(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CHAVE_STORAGE, [...ligadas].join(","));
  } catch {
    /* modo privado / cota cheia: não vale uma exceção */
  }
}

/**
 * A chave está isolada (desligada) agora?
 *
 * `import.meta.env.DEV` primeiro — igual ao `flightRecorder.ativo()` — para
 * o corpo inteiro morrer no tree-shake de produção.
 */
export function isolado(chave: ChaveIsolamento): boolean {
  if (!import.meta.env.DEV) return false;
  garantirCarregado();
  return ligadas.has(chave);
}

export function isolar(chave: ChaveIsolamento): void {
  garantirCarregado();
  ligadas.add(chave);
  gravar();
}

export function reativar(chave: ChaveIsolamento): void {
  garantirCarregado();
  ligadas.delete(chave);
  gravar();
}

export function limparIsolamento(): void {
  garantirCarregado();
  ligadas.clear();
  gravar();
}

export function chavesIsoladas(): ChaveIsolamento[] {
  garantirCarregado();
  return [...ligadas];
}

/** só para teste: reseta o módulo sem passar pelo `localStorage` */
export function forcarIsolamento(chaves: ChaveIsolamento[]): void {
  carregado = true;
  ligadas = new Set(chaves);
}

// `typeof window` porque este módulo é importado por TESTE (ambiente node)
if (import.meta.env.DEV && typeof window !== "undefined") {
  garantirCarregado();
  (window as unknown as { __iso?: unknown }).__iso = {
    ativas: chavesIsoladas,
    isolar,
    reativar,
    limpar: limparIsolamento,
    chaves: () => CHAVES_ISOLAMENTO,
  };
}
