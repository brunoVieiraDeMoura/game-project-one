import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAP_QUADROS,
  QUADROS_ANTES,
  QUADROS_DEPOIS,
  LIMITE_CAPTURA_MS,
  MAX_CASOS,
  abrirQuadro,
  avaliarGatilho,
  casosCapturados,
  configurarGatilho,
  confirmarQuadro,
  despejo,
  dispararCaptura,
  estado,
  estadoDosGatilhos,
  eventosOrdenados,
  fecharCapturaPorPrazo,
  forcarFlag,
  limpar,
  novaCaminhada,
  novoTrecho,
  preencherQuadro,
  quadro,
  quadroCorrente,
  quadrosGravados,
  registrarEvento,
  somarChunk,
  timeline,
} from "./flightRecorder";

/**
 * O gravador é a única peça desta investigação que não pode estar errada: se
 * ele mentir, o laudo mente junto. Daí o teste cobrir as três coisas que
 * silenciosamente o inutilizariam — o anel crescer, a janela do gatilho vir
 * torta, e ele gravar quando deveria estar desligado.
 *
 * Nada aqui precisa de DOM: o módulo só toca `window` no bloco do console.
 */

/**
 * A tabela de gatilhos como o MÓDULO nasce.
 *
 * Ela é estado global e os testes abaixo a mutam (é para isso que
 * `configurarGatilho` existe, e o `limpar()` de propósito NÃO a desfaz — senão
 * `__voo.limpar()` no console apagaria o gatilho que se acabou de armar). Como
 * o `beforeEach` já mexe nela, o único instante em que dá para ler o default é
 * este, na carga do módulo.
 */
const PADRAO = estadoDosGatilhos();

/** grava N quadros com `t` crescendo 16 ms, como um quadro de verdade */
function gravar(n: number, t0 = 1000, decorar?: (i: number) => void): void {
  for (let i = 0; i < n; i++) {
    quadro().t = t0 + i * 16;
    decorar?.(i);
    confirmarQuadro();
  }
}

beforeEach(() => {
  limpar();
  forcarFlag(true);
  configurarGatilho("rollback", true, 1);
  configurarGatilho("frameLongo", false, 50);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("anel de quadros", () => {
  it("não cresce além da capacidade", () => {
    gravar(CAP_QUADROS + 500);
    expect(quadrosGravados()).toBe(CAP_QUADROS);
    expect(estado().totalQuadros).toBe(CAP_QUADROS + 500);
  });

  it("sobrescreve o mais antigo, preservando a ordem", () => {
    // uma volta inteira mais 10: os 10 primeiros já foram por cima
    let n = 0;
    const contar = () => {
      quadro().logicoX = n++;
    };
    gravar(CAP_QUADROS + 10, 0, contar);
    dispararCaptura("manual");
    gravar(QUADROS_DEPOIS, 90_000, contar);
    const c = casosCapturados()[0]!;
    const xs = c.quadros.map((q) => q.logicoX);
    // estritamente crescente: se o anel embaralhasse a volta, aqui quebraria
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it("os acumuladores de chunk zeram a cada quadro; o resto persiste", () => {
    quadro().t = 1;
    quadro().logicoX = 7;
    somarChunk(2, 5);
    somarChunk(1, 3);
    confirmarQuadro();
    quadro().t = 2;
    confirmarQuadro();

    dispararCaptura("manual");
    gravar(QUADROS_DEPOIS, 3);
    const q = casosCapturados()[0]!.quadros;
    expect(q[0]!.chunksConstruidos).toBe(3);
    expect(q[0]!.msDeChunk).toBe(8);
    // o quadro seguinte não herda o acumulado…
    expect(q[1]!.chunksConstruidos).toBe(0);
    // …mas herda o estado (ninguém reescreveu `logicoX`)
    expect(q[1]!.logicoX).toBe(7);
  });
});

describe("desligado", () => {
  it("não grava quadro, evento nem caso", () => {
    forcarFlag(false);
    gravar(10);
    registrarEvento("network", "self:move");
    avaliarGatilho("rollback", 99);
    expect(quadrosGravados()).toBe(0);
    expect(eventosOrdenados()).toHaveLength(0);
    expect(casosCapturados()).toHaveLength(0);
  });
});

describe("gatilhos", () => {
  it("desligado não captura; ligar por nome passa a capturar", () => {
    configurarGatilho("frameLongo", false, 50);
    gravar(5);
    avaliarGatilho("frameLongo", 120);
    gravar(QUADROS_DEPOIS + 5, 2000);
    expect(casosCapturados()).toHaveLength(0);

    configurarGatilho("frameLongo", true, 50);
    avaliarGatilho("frameLongo", 120);
    gravar(QUADROS_DEPOIS + 5, 5000);
    expect(casosCapturados()).toHaveLength(1);
    expect(casosCapturados()[0]!.motivo).toBe("frameLongo");
  });

  it("respeita o limiar — só dispara ACIMA dele", () => {
    gravar(5);
    avaliarGatilho("rollback", 1); // exatamente no limiar: não é rollback
    gravar(QUADROS_DEPOIS + 5, 2000);
    expect(casosCapturados()).toHaveLength(0);

    avaliarGatilho("rollback", 1.4);
    gravar(QUADROS_DEPOIS + 5, 5000);
    expect(casosCapturados()).toHaveLength(1);
  });

  it("um disparo durante uma captura não substitui a janela em andamento", () => {
    gravar(50);
    avaliarGatilho("rollback", 2, {});
    gravar(3, 2000);
    // o eco do mesmo solavanco, dois quadros depois
    avaliarGatilho("rollback", 9);
    gravar(QUADROS_DEPOIS, 3000);
    const cs = casosCapturados();
    expect(cs).toHaveLength(1);
    expect(cs[0]!.valor).toBe(2);
  });

  it("guarda no máximo MAX_CASOS, descartando o mais antigo", () => {
    for (let i = 0; i < MAX_CASOS + 2; i++) {
      gravar(10, 10_000 * (i + 1));
      dispararCaptura(`caso${i}`, i);
      gravar(QUADROS_DEPOIS, 10_000 * (i + 1) + 500);
    }
    const cs = casosCapturados();
    expect(cs).toHaveLength(MAX_CASOS);
    expect(cs[0]!.motivo).toBe(`caso${2}`);
    expect(cs[cs.length - 1]!.motivo).toBe(`caso${MAX_CASOS + 1}`);
  });
});

describe("janela de captura", () => {
  it("pega QUADROS_ANTES antes e QUADROS_DEPOIS depois", () => {
    gravar(600);
    dispararCaptura("rollback", 2);
    expect(casosCapturados()).toHaveLength(0); // ainda gravando o depois
    gravar(QUADROS_DEPOIS - 1, 20_000);
    expect(casosCapturados()).toHaveLength(0);
    gravar(1, 30_000);

    const c = casosCapturados()[0]!;
    expect(c.quadros).toHaveLength(QUADROS_ANTES + QUADROS_DEPOIS);
    /**
     * O quadro do gatilho é o PRIMEIRO da metade de depois, não um a mais no
     * meio: o gatilho dispara durante um quadro que ainda não foi confirmado,
     * então ele abre o "depois" em vez de fechar o "antes".
     */
    const i = c.quadros.findIndex((q) => q.quadro === c.quadroGatilho);
    expect(i).toBe(QUADROS_ANTES);
  });

  it("no começo da sessão pega só o que existe, sem quebrar", () => {
    gravar(5);
    dispararCaptura("manual");
    gravar(QUADROS_DEPOIS);
    const c = casosCapturados()[0]!;
    expect(c.quadros).toHaveLength(5 + QUADROS_DEPOIS);
  });

  it("leva os eventos do intervalo e descarta os de fora", () => {
    registrarEvento("network", "antigo-demais", undefined, 0);
    gravar(400, 100_000);
    registrarEvento("prediction", "dentro", undefined, 100_000 + 400 * 16 - 5);
    dispararCaptura("rollback", 2);
    gravar(QUADROS_DEPOIS, 200_000);

    const tipos = casosCapturados()[0]!.eventos.map((e) => e.tipo);
    expect(tipos).toContain("dentro");
    expect(tipos).not.toContain("antigo-demais");
  });
});

describe("caminhada", () => {
  it("o walkId sobrevive à emenda e só troca na ordem nova", () => {
    const a = novaCaminhada();
    gravar(2);
    novoTrecho(); // a emenda pede o trecho seguinte da MESMA caminhada
    gravar(2, 2000);
    const b = novaCaminhada(); // clique novo
    gravar(2, 4000);

    dispararCaptura("manual");
    gravar(QUADROS_DEPOIS, 6000);
    const q = casosCapturados()[0]!.quadros;
    expect(b).toBe(a + 1);
    expect(q[0]!.walkId).toBe(a);
    expect(q[0]!.trechoSeq).toBe(0);
    expect(q[2]!.walkId).toBe(a);
    expect(q[2]!.trechoSeq).toBe(1);
    expect(q[4]!.walkId).toBe(b);
    // caminhada nova recomeça a contagem de trechos
    expect(q[4]!.trechoSeq).toBe(0);
  });

  it("o caso guarda o walkId do GATILHO, não o do fim da captura", () => {
    const a = novaCaminhada();
    gravar(10);
    dispararCaptura("rollback", 2);
    novaCaminhada(); // o jogador clicou de novo enquanto a captura corria
    gravar(QUADROS_DEPOIS, 5000);
    expect(casosCapturados()[0]!.walkId).toBe(a);
  });
});

describe("eventos", () => {
  it("o anel de eventos também tem teto e sai em ordem", () => {
    for (let i = 0; i < 700; i++) registrarEvento("network", `e${i}`, undefined, i);
    const es = eventosOrdenados();
    expect(es.length).toBeLessThanOrEqual(512);
    for (let i = 1; i < es.length; i++) expect(es[i]!.t).toBeGreaterThan(es[i - 1]!.t);
    // os mais novos são os que sobrevivem
    expect(es[es.length - 1]!.tipo).toBe("e699");
  });

  it("carimba a caminhada em vigor", () => {
    const id = novaCaminhada();
    registrarEvento("prediction", "previu", { passos: 12 });
    expect(eventosOrdenados()[0]!.walkId).toBe(id);
  });
});

describe("timeline", () => {
  it("sai em ordem cronológica, com t relativo ao gatilho", () => {
    novaCaminhada();
    gravar(100, 0);
    registrarEvento("network", "move:to", { alvo: "10,10" }, 1_000);
    registrarEvento("prediction", "previu", { passos: 8 }, 1_010);
    registrarEvento("network", "self:move", undefined, 1_200);
    gravar(20, 1_000);
    dispararCaptura("rollback", 1.8);
    gravar(QUADROS_DEPOIS, 1_400);

    const txt = timeline(casosCapturados()[0]!);
    // o `t` é alinhado à direita com espaços, então tem de vir por regex
    const ts = [...txt.matchAll(/^t=\s*(-?\d+\.\d+)/gm)].map((m) => Number(m[1]));
    expect(ts.length).toBeGreaterThan(3);
    for (let i = 1; i < ts.length; i++) expect(ts[i]!).toBeGreaterThanOrEqual(ts[i - 1]!);
    // eventos anteriores ao gatilho têm t NEGATIVO
    expect(ts[0]!).toBeLessThan(0);
    expect(txt).toContain("ROLLBACK");
    expect(txt).toContain("network/move:to");
    expect(txt).toContain("posição final");
  });

  it("marca quadro longo como marco derivado da série", () => {
    gravar(10);
    quadro().t = 5_000;
    quadro().quadroMs = 120;
    confirmarQuadro();
    dispararCaptura("rollback", 2);
    gravar(QUADROS_DEPOIS, 6_000);
    expect(timeline(casosCapturados()[0]!)).toContain("quadro-longo");
  });
});

describe("despejo", () => {
  /**
   * Um despejo com ZERO casos é o resultado NORMAL de conferir uma correção — e
   * era exatamente nele que o arquivo não dizia nada. `casos: []` ficava
   * idêntico se nada de errado aconteceu e se ninguém apertou "gravar", e o
   * anel de 512 eventos era jogado fora junto.
   */
  it("sem caso nenhum, ele ainda PROVA que estava gravando e leva os eventos", () => {
    gravar(30);
    registrarEvento("cena", "precompilou", { especies: 12 });

    const d = despejo();
    expect(d.casos).toHaveLength(0);
    expect(d.gravacao.gravando).toBe(true);
    expect(d.gravacao.quadros).toBe(30);
    expect(d.eventos.map((e) => e.tipo)).toContain("precompilou");
  });

  it("gravador PARADO fica distinguível de 'nada aconteceu'", () => {
    forcarFlag(false);
    const d = despejo();
    expect(d.gravacao.gravando).toBe(false);
    expect(d.gravacao.quadros).toBe(0);
  });


  it("é serializável e traz uma coluna por campo, do tamanho da janela", () => {
    gravar(50, 0, (i) => {
      quadro().logicoX = i / 3;
    });
    dispararCaptura("rollback", 2);
    gravar(QUADROS_DEPOIS, 9_000);

    const d = despejo();
    const caso = d.casos[0]!;
    expect(d.campos).toContain("logicoX");
    for (const campo of d.campos) {
      expect(caso.quadros[campo]).toHaveLength(50 + QUADROS_DEPOIS);
    }
    // NaN não existe em JSON: vira null, e o arquivo continua legível
    const texto = JSON.stringify(d);
    expect(texto).not.toContain("NaN");
    expect(JSON.parse(texto).casos[0].timeline).toContain("ROLLBACK");
  });
});

/**
 * A partir daqui é a extensão de RENDERIZAÇÃO (`leia1.txt`).
 *
 * Três coisas silenciosamente a inutilizariam, e são as três que estão aqui: a
 * captura do contexto perdido nunca fechar (porque o quadro para junto), o anel
 * não girar sem sessão, e as colunas novas não chegarem ao JSON.
 */
describe("prazo de captura", () => {
  it("fecha a captura sem quadro nenhum — é o caso do CONTEXTO PERDIDO", () => {
    const agora = vi.spyOn(performance, "now").mockReturnValue(1_000);
    gravar(50);
    dispararCaptura("contextoPerdido", 1);
    expect(casosCapturados()).toHaveLength(0);

    // o laço congelou junto com o contexto: nenhum `confirmarQuadro` virá
    fecharCapturaPorPrazo();
    expect(casosCapturados()).toHaveLength(0); // ainda dentro do prazo

    agora.mockReturnValue(1_000 + LIMITE_CAPTURA_MS + 1);
    fecharCapturaPorPrazo();
    const cs = casosCapturados();
    expect(cs).toHaveLength(1);
    expect(cs[0]!.motivo).toBe("contextoPerdido");
    // e ela leva os quadros que existiam ANTES do gatilho, que é o que se quer ler
    expect(cs[0]!.quadros).toHaveLength(50);
  });

  it("exportar no meio de uma captura não devolve arquivo SEM ela", () => {
    gravar(50);
    dispararCaptura("contextoPerdido", 1);
    // o fluxo real: provoca-se a perda e a primeira coisa é baixar o JSON
    expect(despejo().casos).toHaveLength(1);
    expect(estado().capturando).toBe(false);
  });
});

describe("abrirQuadro", () => {
  it("fecha a linha anterior quando ninguém a fechou (sem NetPlayer)", () => {
    // o `NetPlayer` só monta com sessão; sem ele o anel não girava
    for (let i = 0; i < 5; i++) {
      abrirQuadro();
      quadro().t = 1000 + i * 16;
      quadro().logicoX = i;
    }
    // 4 fechadas: a quinta ainda está aberta, e a primeira não tem anterior
    expect(quadrosGravados()).toBe(4);
  });

  it("não duplica linha quando o dono fecha", () => {
    for (let i = 0; i < 5; i++) {
      abrirQuadro();
      quadro().t = 1000 + i * 16;
      confirmarQuadro();
    }
    expect(quadrosGravados()).toBe(5);
  });

  it("o primeiro abrirQuadro da sessão não grava um quadro zerado", () => {
    abrirQuadro();
    expect(quadrosGravados()).toBe(0);
  });
});

describe("colunas do renderer", () => {
  it("chegam ao despejo, e o que não foi medido sai como null", () => {
    gravar(10, 0, () => {
      const q = quadro();
      q.drawCalls = 42;
      q.geometrias = 7;
      q.programas = 3;
      q.texturas = 11;
      q.renderMs = 4.5;
      q.contextosVivos = 2;
      q.rendererId = 1;
      // `gpuMs`/`memoriaGpuMb`/`heapMb` ficam como nasceram: NaN
    });
    dispararCaptura("frameLongo", 210);
    gravar(QUADROS_DEPOIS, 9_000);

    const d = despejo();
    for (const campo of ["geometrias", "programas", "texturas", "renderMs", "gpuMs", "memoriaGpuMb", "heapMb", "contextosVivos", "rendererId"]) {
      expect(d.campos).toContain(campo);
      expect(d.casos[0]!.quadros[campo]).toHaveLength(10 + QUADROS_DEPOIS);
    }
    expect(d.casos[0]!.quadros.gpuMs![0]).toBeNull();
    expect(d.casos[0]!.quadros.geometrias![0]).toBe(7);
    expect(d.versao).toBe(3);
  });

  it("as colunas da CENA também chegam ao despejo", () => {
    gravar(10, 0, () => {
      const q = quadro();
      q.sceneFilhos = 6;
      q.sceneVisivel = 0;
      q.objetosRender = 0;
      q.chunksNoCache = 212;
      q.propsVisiveis = 34;
      q.suspensoes = 2;
      q.assetsEmVoo = 1;
    });
    dispararCaptura("mundoVazio", 1);
    gravar(QUADROS_DEPOIS, 9_000);

    const d = despejo();
    for (const campo of [
      "sceneFilhos",
      "sceneVisivel",
      "objetosRender",
      "cameraId",
      "cameraOk",
      "chunksNoCache",
      "propsVisiveis",
      "suspensoes",
      "desmontagensCena",
      "assetsEmVoo",
      "suspensoMs",
    ]) {
      expect(d.campos).toContain(campo);
      expect(d.casos[0]!.quadros[campo]).toHaveLength(10 + QUADROS_DEPOIS);
    }
    // a linha derivada da timeline separa "escondida" de "desmontada"
    const txt = d.casos[0]!.timeline;
    expect(txt).toContain("estado da cena");
    expect(txt).toContain("filhos 6");
    expect(txt).toContain("visível NÃO");
    expect(txt).toContain("props 34");
  });

  it("preencherQuadro escreve numa linha JÁ gravada — é o backfill do timer de GPU", () => {
    gravar(5);
    const alvo = quadroCorrente() - 3;
    expect(preencherQuadro(alvo, "gpuMs", 6.25)).toBe(true);
    // fora do anel: recusa em vez de escrever na linha errada
    expect(preencherQuadro(quadroCorrente() - CAP_QUADROS - 1, "gpuMs", 1)).toBe(false);

    dispararCaptura("manual");
    gravar(QUADROS_DEPOIS, 5_000);
    const q = casosCapturados()[0]!.quadros;
    expect(q.find((l) => l.quadro === alvo)!.gpuMs).toBe(6.25);
  });

  it("a timeline resume o estado do renderer no instante do gatilho", () => {
    gravar(10, 0, () => {
      const q = quadro();
      q.drawCalls = 23;
      q.triangulos = 120_000;
      q.geometrias = 30;
      q.texturas = 12;
      q.programas = 40;
      q.contextosVivos = 4;
    });
    dispararCaptura("contextoPerdido", 1);
    gravar(QUADROS_DEPOIS, 9_000);

    const txt = timeline(casosCapturados()[0]!);
    expect(txt).toContain("estado do renderer");
    expect(txt).toContain("23 calls");
    expect(txt).toContain("geo/tex/prog 30/12/40");
    expect(txt).toContain("contextos 4");
    // o que não foi medido aparece como lacuna, nunca como zero
    expect(txt).toContain("gpu — ms");
  });
});

describe("gatilhos de renderização", () => {
  it("frameLongo vem LIGADO em 200 ms — em 50 a carga de mapa queima os slots", () => {
    expect(PADRAO.frameLongo.ligado).toBe(true);
    expect(PADRAO.frameLongo.limiar).toBe(200);
    expect(PADRAO.contextoPerdido.ligado).toBe(true);
    expect(PADRAO.rendererRecriado.ligado).toBe(true);
    // o de recriação compara com a GERAÇÃO, e a primeira não é recriação
    expect(PADRAO.rendererRecriado.limiar).toBe(1);
    // o do apagão da cena: quem o avalia relata a TRANSIÇÃO, não o valor
    expect(PADRAO.mundoVazio.ligado).toBe(true);
  });

  it("contextoPerdido dispara sempre; rendererRecriado só acima da primeira geração", () => {
    configurarGatilho("contextoPerdido", true, 0);
    configurarGatilho("rendererRecriado", true, 1);
    gravar(5);

    // geração 1 é o NASCIMENTO do renderer, não uma recriação
    avaliarGatilho("rendererRecriado", 1);
    expect(estado().capturando).toBe(false);

    avaliarGatilho("rendererRecriado", 2);
    expect(estado().capturando).toBe(true);

    limpar();
    gravar(5);
    avaliarGatilho("contextoPerdido", 1);
    expect(estado().capturando).toBe(true);
  });
});
