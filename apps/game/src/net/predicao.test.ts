import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interpolatedCell, previstosPendentes, setPathfinder, useWorldStore } from "./worldStore";
import type { Cell } from "./pathfind";

/**
 * CLIENT-SIDE PREDICTION e SERVER RECONCILIATION, do lado do jogador local.
 *
 * O problema: até aqui a posição do personagem vinha EXCLUSIVAMENTE de pacote
 * do servidor. Enquanto a resposta não chegava, `interpolatedCell` devolvia
 * `moving: false` e o boneco ficava cravado — com 100 ms de ping, mais os até
 * 200 ms da janela do `filaDePedidos`, passava de 300 ms entre clicar e o
 * primeiro pixel de movimento.
 *
 * A predição resolve isso, mas cria um risco novo: adivinhar ERRADO é pior que
 * não adivinhar, porque cada erro vira uma correção que o jogador vê. Estes
 * testes travam os dois lados — que a predição ande, e que a correção nunca
 * empurre o personagem para trás.
 *
 * A regra que atravessa tudo é a mesma que o projeto já seguia antes de existir
 * predição: **o desenho nunca anda de ré**. A deriva se paga em TEMPO.
 */

/** caminho reto, uma célula por passo — chega para o que se testa aqui */
function rotaReta(from: Cell, to: Cell): Cell[] | null {
  const out: Cell[] = [];
  let { x, y } = from;
  let guarda = 0;
  while ((x !== to.x || y !== to.y) && guarda++ < 200) {
    if (x < to.x) x++;
    else if (x > to.x) x--;
    if (y < to.y) y++;
    else if (y > to.y) y--;
    out.push({ x, y });
  }
  return out.length > 0 ? out : null;
}

const st = () => useWorldStore.getState();
const visual = () => interpolatedCell(st().self, performance.now());

beforeEach(() => {
  vi.useFakeTimers();
  setPathfinder(rotaReta);
  st().clear();
  st().setSelfCell(10, 10);
  st().setSelfSpeed(100); // 100 ms por célula
});

afterEach(() => {
  vi.useRealTimers();
  setPathfinder(null);
});

describe("predição: o personagem anda antes da resposta", () => {
  it("sem predição o boneco ficaria CRAVADO — com ela, anda", () => {
    // é o defeito que a predição existe para resolver, medido
    expect(visual().moving).toBe(false);

    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    expect(visual().moving).toBe(true);

    vi.advanceTimersByTime(300); // 3 células a 100 ms
    const depois = visual();
    expect(depois.x).toBeGreaterThan(12);
    expect(depois.x).toBeLessThan(14);
  });

  it("a predição fica MARCADA — é assim que o pacote seguinte se sabe resposta", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    expect(st().self.predito).toBe(true);
    st().selfMove({ x: 10, y: 10 }, { x: 20, y: 10 });
    expect(st().self.predito).toBe(false);
  });

  it("prever no MEIO de um trecho parte de onde o personagem está desenhado", () => {
    // a mesma regra do redirecionamento: nunca recomeçar de uma célula atrás
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(350);
    const antes = visual();

    st().preverMovimento({ x: Math.round(antes.x), y: 10 }, { x: 5, y: 10 });
    const depois = visual();
    // mudou de direção, mas não foi TELEPORTADO para trás
    expect(Math.abs(depois.x - antes.x)).toBeLessThan(1);
  });
});

describe("reconciliação: o servidor confirma", () => {
  it("confirmação NÃO move o personagem", () => {
    /**
     * O ponto inteiro da reconciliação. O pacote descreve o movimento que o
     * cliente já começou; se ele fizesse o boneco pular para a célula que o
     * servidor mandou, a predição teria só trocado a espera por um solavanco.
     */
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(250);
    const antes = visual();

    // o servidor concorda: mesmo destino, saindo da célula de origem
    st().selfMove({ x: 10, y: 10 }, { x: 20, y: 10 });
    const depois = visual();

    expect(Math.abs(depois.x - antes.x)).toBeLessThan(0.05);
    expect(Math.abs(depois.y - antes.y)).toBeLessThan(0.05);
  });

  it("o cliente ADIANTADO desacelera em vez de ser puxado para trás", () => {
    /**
     * Prever significa sair andando ~meio RTT antes do servidor, então o cliente
     * fica na frente por construção. A correção é a que o projeto já usava para
     * a deriva: o trecho passa a durar o que vai durar PARA O SERVIDOR
     * (`celulasExtras` estica os `stepEnds`), o desenho fica um pouco mais lento
     * e os dois se reencontram no fim. Nada é puxado.
     */
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(300);
    const antes = visual();

    // o servidor ainda acha que saiu de (10,10) — está 3 células atrás
    st().selfMove({ x: 10, y: 10 }, { x: 20, y: 10 });

    // não voltou...
    expect(visual().x).toBeGreaterThanOrEqual(antes.x - 0.01);
    // ...e o trecho passou a cobrir o caminho do SERVIDOR, que é mais longo
    expect(st().self.durationMs).toBeGreaterThan(700);
  });
});

describe("reconciliação: o servidor discorda", () => {
  it("destino diferente corrige SEM andar de ré", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(300);
    const antes = visual();

    // o servidor mandou para outro lugar (recusou o pedido e reposicionou)
    st().selfMove({ x: 12, y: 10 }, { x: 12, y: 18 });

    const depois = visual();
    expect(depois.x).toBeGreaterThanOrEqual(antes.x - 0.05);
    expect(st().self.toX).toBe(12);
    expect(st().self.toY).toBe(18);
    expect(st().self.predito).toBe(false);
  });

  it("spam de predição + confirmação não faz o personagem recuar", () => {
    /**
     * O caso de campo: clicar repetidamente enquanto anda, com o servidor
     * sempre algumas células atrás. É a mesma invariante de
     * `redirecionamento.test.ts`, agora com predição no meio.
     */
    let maiorRecuo = 0;
    let anterior = visual().x;
    for (let i = 0; i < 12; i++) {
      st().preverMovimento({ x: Math.round(visual().x), y: 10 }, { x: 40, y: 10 });
      vi.advanceTimersByTime(120);
      const meio = visual();
      maiorRecuo = Math.max(maiorRecuo, anterior - meio.x);
      anterior = meio.x;

      // o servidor responde de uma célula atrás
      st().selfMove({ x: Math.max(10, Math.round(meio.x) - 1), y: 10 }, { x: 40, y: 10 });
      const pos = visual();
      maiorRecuo = Math.max(maiorRecuo, anterior - pos.x);
      anterior = pos.x;
    }
    expect(maiorRecuo).toBeLessThan(0.05);
  });
});

describe("ZIGZAG: vários cliques no ar ao mesmo tempo", () => {
  /**
   * O relato: "dando zigzag ele ainda dá umas recuadas".
   *
   * É o defeito que a fila de pendentes existe para resolver, e a literatura o
   * descreve exatamente assim (Gambetta, *Client-Side Prediction and Server
   * Reconciliation*): com vários inputs no ar, a resposta do servidor descreve
   * um ANTIGO. Aplicá-la sobre a predição corrente joga o personagem de volta
   * para o destino que o jogador já abandonou.
   *
   * O algoritmo canônico guarda os pedidos enviados, descarta os reconhecidos e
   * REAPLICA os pendentes por cima do estado autoritativo. Aqui cada pedido é um
   * destino ABSOLUTO (não um input incremental), então reaplicar todos equivale
   * a manter a predição mais nova — ou seja, ignorar o ack antigo.
   */
  it("o ack de um clique JÁ SUBSTITUÍDO não vira a trajetória", () => {
    // clique 1: para a direita
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    vi.advanceTimersByTime(100);
    // clique 2 (o jogador mudou de ideia): para cima
    st().preverMovimento({ x: 11, y: 10 }, { x: 11, y: 30 });
    vi.advanceTimersByTime(100);

    const antes = visual();
    expect(st().self.toY).toBe(30); // indo para cima

    // ...e só AGORA chega a resposta do clique 1
    st().selfMove({ x: 10, y: 10 }, { x: 30, y: 10 });

    // a trajetória tem de continuar sendo a do clique 2
    expect(st().self.toX).toBe(11);
    expect(st().self.toY).toBe(30);
    // e o personagem não pode ter sido movido por causa disso
    const depois = visual();
    expect(Math.abs(depois.x - antes.x)).toBeLessThan(0.05);
    expect(Math.abs(depois.y - antes.y)).toBeLessThan(0.05);
  });

  it("quando o último ack chega, a fila esvazia e a confirmação volta a valer", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    st().preverMovimento({ x: 10, y: 10 }, { x: 10, y: 30 });
    expect(previstosPendentes()).toBe(2);

    st().selfMove({ x: 10, y: 10 }, { x: 30, y: 10 }); // ack do 1º
    expect(previstosPendentes()).toBe(1);
    st().selfMove({ x: 10, y: 10 }, { x: 10, y: 30 }); // ack do 2º
    expect(previstosPendentes()).toBe(0);
    expect(st().self.predito).toBe(false);
  });

  it("zigzag rápido de verdade: o destino nunca volta a ser um já abandonado", () => {
    /**
     * O caso de campo, com o servidor sempre dois cliques atrás — que é o que
     * acontece com ping de verdade e cliques rápidos.
     *
     * A invariante medida é a TRAJETÓRIA, não o deslocamento: um ack antigo não
     * teleporta o personagem, ele o faz VIRAR, e a recuada é a consequência dos
     * quadros seguintes. Conferir o destino pega a causa no instante em que ela
     * acontece, e não depende de o alvo velho estar geometricamente atrás.
     */
    const acks: { x: number; y: number }[] = [];
    let ultimoAlvo = { x: 0, y: 0 };

    for (let i = 0; i < 16; i++) {
      // zigzag de verdade: alterna dos DOIS lados, como o jogador faz
      const alvo = i % 2 === 0 ? { x: 4 + i, y: 20 } : { x: 26 - i, y: 2 };
      const aqui = visual();
      st().preverMovimento({ x: Math.round(aqui.x), y: Math.round(aqui.y) }, alvo);
      acks.push(alvo);
      ultimoAlvo = alvo;

      vi.advanceTimersByTime(60);

      // o servidor responde ao pedido de DOIS cliques atrás
      const atrasado = acks.length > 2 ? acks[acks.length - 3]! : null;
      if (atrasado) {
        const s = visual();
        st().selfMove({ x: Math.round(s.x), y: Math.round(s.y) }, atrasado);
        // o ack é velho: o personagem tem de continuar indo para onde o jogador
        // mandou por ÚLTIMO
        expect({ x: st().self.toX, y: st().self.toY }).toEqual(ultimoAlvo);
      }
      vi.advanceTimersByTime(40);
    }
  });

  it("pedido que o servidor engoliu não entope a fila para sempre", () => {
    /**
     * O rAthena recusa EM SILÊNCIO (unit.cpp:860). Sem prazo, aquele pedido
     * ficaria na fila eternamente e TODO ack seguinte pareceria "antigo" — a
     * reconciliação congelaria e a predição nunca mais seria corrigida.
     */
    st().preverMovimento({ x: 10, y: 10 }, { x: 99, y: 99 }); // este some
    vi.advanceTimersByTime(2500);
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    expect(previstosPendentes()).toBe(1);

    st().selfMove({ x: 10, y: 10 }, { x: 20, y: 10 });
    expect(previstosPendentes()).toBe(0);
  });

  it("um fixpos esvazia a fila — o mundo de antes não vale mais", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    expect(previstosPendentes()).toBe(1);
    st().aplicarFixpos(80, 80);
    expect(previstosPendentes()).toBe(0);
  });
});

describe("fixpos: o servidor atrás de nós não puxa para trás", () => {
  /**
   * A recuada que sobrou depois da fila de pendentes, e que a predição tornou
   * SISTEMÁTICA.
   *
   * O rAthena manda `clif_fixpos` sempre que interrompe a caminhada —
   * `unit_stop_walking` com `USW_FIXPOS`, o que acontece ao ATACAR
   * (unit.cpp:2975, antes do golpe), ao usar skill e ao parar. Com predição o
   * cliente anda ~meio RTT à frente por construção, então esse pacote quase
   * sempre aponta uma célula ATRÁS de onde o personagem está desenhado — e
   * deslizar até lá em 120 ms é andar de ré.
   */
  it("fixpos numa célula JÁ PERCORRIDA para o personagem onde ele está", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(400); // ~4 células à frente
    const antes = visual();
    expect(antes.x).toBeGreaterThan(13);

    // o servidor interrompe e diz "você está em 12" — atrás de nós, na mesma rota
    st().aplicarFixpos(12, 10);

    // não deslizou de volta...
    expect(visual().x).toBeGreaterThanOrEqual(antes.x - 0.01);
    // ...e parou onde estava, em vez de continuar até o ponto do servidor
    expect(st().self.durationMs).toBe(0);
    vi.advanceTimersByTime(200);
    expect(visual().x).toBeGreaterThanOrEqual(antes.x - 0.01);
  });

  it("empurrão para o LADO continua sendo aplicado", () => {
    /**
     * A distinção não pode virar "ignore todo fixpos": knockback põe o
     * personagem num ponto que NÃO está na rota já percorrida, e ali o servidor
     * tem razão.
     */
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(300);
    // duas células para o lado: dentro do `FIXPOS_TELEPORTE`, então é
    // empurrão e não teleporte — e o ponto NÃO está na rota já percorrida
    st().aplicarFixpos(13, 12);
    expect(st().self.toX).toBe(13);
    expect(st().self.toY).toBe(12);
    expect(st().self.durationMs).toBeGreaterThan(0);
  });

  it("teleporte de verdade continua instantâneo", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(200);
    st().aplicarFixpos(80, 80);
    expect(visual()).toMatchObject({ x: 80, y: 80 });
    expect(st().self.durationMs).toBe(0);
  });

  /**
   * O CASO DO LAUDO (`voo-*.json`, caso 1, quadro 50).
   *
   * Medido no jogo: `fixpos-teleporte {alvo:"265,187", desenho:"265.00,194.00",
   * gap:7, paraTras:true}` — e no quadro seguinte o personagem estava 7 células
   * atrás, 10,5 ms depois. O pacote DIZIA que o ponto já tinha sido percorrido;
   * a classificação por `gap > 3` é que o transformava em teleporte e pulava a
   * guarda (`servidorAtras = !teleporte && paraTras`).
   *
   * Sete células de deriva não são normais — elas vinham do pathfinder nulo
   * (ver `views/PlayView`) —, mas o cliente não pode responder a uma deriva
   * grande com um salto para trás: é justamente o sintoma que ele deveria
   * evitar. Quem paga a diferença é o tempo, no pacote seguinte.
   */
  it("fixpos LONGE e para trás não crava o personagem atrás (o caso do laudo)", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    vi.advanceTimersByTime(1200); // ~12 células à frente
    const antes = visual();
    expect(antes.x).toBeGreaterThan(20);

    // o servidor interrompe a caminhada 7 células ATRÁS do desenho
    st().aplicarFixpos(Math.round(antes.x) - 7, 10);

    expect(visual().x).toBeGreaterThanOrEqual(antes.x - 0.01);
    expect(st().self.durationMs).toBe(0);
    vi.advanceTimersByTime(300);
    expect(visual().x).toBeGreaterThanOrEqual(antes.x - 0.01);
  });

  it("correção LONGE e para FRENTE desliza, em vez de saltar", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 30, y: 10 });
    vi.advanceTimersByTime(300);
    const antes = visual();
    // 6 células à frente: acima do antigo corte de 3, abaixo do teleporte
    st().aplicarFixpos(Math.round(antes.x) + 6, 10);
    expect(st().self.durationMs).toBeGreaterThan(0);
    // e chega lá andando
    expect(visual().x).toBeLessThan(antes.x + 6);
    vi.advanceTimersByTime(200);
    expect(visual().x).toBeCloseTo(Math.round(antes.x) + 6, 1);
  });
});

describe("o MINI-TELEPORTE para o centro do tile", () => {
  /**
   * O relato: andando + skill de área + clique num tile → o personagem para
   * certo, mas dá um pulinho para o centro do square e SÓ ENTÃO a animação sai.
   *
   * A causa é do protocolo, não do nosso desenho: o rAthena não tem posição
   * fracionária. `unit_skilluse_pos2` chama `unit_stop_walking(USW_FIXPOS)`
   * (unit.cpp:2750) OITO LINHAS antes do `clif_skillcasting` — daí a ordem
   * observada —, e lá dentro (unit.cpp:1734) ele faz `ud->sx = 8; ud->sy = 8`
   * com o comentário literal "Stop on cell center", mandando a célula INTEIRA.
   *
   * O que era nosso teve DUAS versões, e as duas erravam:
   *
   *  1. aplicar essa célula SEM ANIMAÇÃO quando a diferença fosse menor que
   *     0,35 célula — a célula mede 2 unidades e o personagem ocupa uma, então
   *     0,35 é 35% da largura dele, num quadro só. Virou um deslize de 120 ms;
   *  2. **deslizar até o CENTRO do tile**, que é o que este teste travava. Mais
   *     suave que o salto, mas ainda um reposicionamento — e acontecendo mesmo
   *     quando cliente e servidor concordavam perfeitamente sobre a célula.
   *
   * Hoje a regra é outra (`preservandoSubCelula`): a CÉLULA é do servidor, o
   * deslocamento DENTRO dela é do cliente. Mesma célula ⇒ nada se move. Ver
   * `net/subCelula.test.ts`.
   */
  it("correção DENTRO da mesma célula não move nada", () => {
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    // 280 ms a 100 ms/célula = desenhado em 12,8, que ARREDONDA para 13
    vi.advanceTimersByTime(280);
    const antes = visual();
    expect(antes.x).toBeCloseTo(12.8, 1);
    expect(Math.round(antes.x)).toBe(13);

    // o servidor manda exatamente essa célula: não há divergência nenhuma a
    // corrigir, e o pacote só está dizendo "a caminhada acabou"
    st().aplicarFixpos(13, 10);

    expect(visual().x).toBeCloseTo(antes.x, 6);
    expect(st().self.durationMs).toBe(0);
    // e continua assim — o centro do tile deixou de ser destino
    vi.advanceTimersByTime(150);
    expect(visual().x).toBeCloseTo(antes.x, 6);
  });

  it("ruído de float continua sem animação", () => {
    // o atalho instantâneo não sumiu — só encolheu para a ordem de grandeza
    // que o comentário dele sempre alegou
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(200);
    const p = visual();
    st().aplicarFixpos(Math.round(p.x * 100) / 100 + 0.02, 10);
    expect(st().self.durationMs).toBe(0);
  });

  it("rota em COTOVELO: o ponto já percorrido é reconhecido como atrás", () => {
    /**
     * O defeito latente que saiu junto. O teste antigo comparava distância
     * EUCLIDIANA até a origem do trecho, e isso só vale em reta que se afasta:
     * num "L", um ponto já andado pode estar mais LONGE da origem do que a
     * posição atual. Agora quem decide é o RUMO do passo em andamento.
     */
    // rota: de (10,10) sobe até (10,20) e depois vira para a direita
    setPathfinder(() => [
      { x: 10, y: 11 },
      { x: 10, y: 12 },
      { x: 11, y: 12 },
      { x: 12, y: 12 },
      { x: 13, y: 12 },
    ]);
    st().setSelfCell(10, 10);
    st().preverMovimento({ x: 10, y: 10 }, { x: 13, y: 12 });
    // 350 ms = já virou e anda para +x
    vi.advanceTimersByTime(350);
    const antes = visual();
    expect(antes.x).toBeGreaterThan(10);

    // o servidor ainda está no cotovelo (10,12) — JÁ PERCORRIDO, mas mais longe
    // da origem (10,10) em linha reta do que a posição atual em y
    st().aplicarFixpos(10, 12);

    expect(visual().x).toBeGreaterThanOrEqual(antes.x - 0.01);
    expect(st().self.durationMs).toBe(0); // segurou
  });

  it("um SEGUNDO fixpos com o personagem parado ainda sabe o que é para trás", () => {
    /**
     * O furo mais sutil da versão anterior: ela media a partir de `self.x/y`, e
     * depois de um fixpos esse campo passa a ser a própria posição desenhada —
     * a distância do desenho até ela vira 0 e "está atrás" ficava
     * matematicamente impossível. Todo fixpos seguinte voltava a cravar a célula.
     */
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(250);
    st().aplicarFixpos(12, 10); // atrás → segura
    const parado = visual();

    // segundo fixpos, ainda atrás
    st().aplicarFixpos(11, 10);
    expect(visual().x).toBeCloseTo(parado.x, 2);
    expect(st().self.durationMs).toBe(0);
  });
});

describe("teleporte continua ganhando de tudo", () => {
  it("um fixpos LONGE reposiciona na hora, predito ou não", () => {
    // `@jump` e Asa de Borboleta não podem virar caminhada suave só porque
    // existe predição — o `FIXPOS_TELEPORTE` decide, e ele não sabe de predição
    st().preverMovimento({ x: 10, y: 10 }, { x: 20, y: 10 });
    vi.advanceTimersByTime(200);
    st().aplicarFixpos(80, 80);
    const pos = visual();
    expect(pos.x).toBe(80);
    expect(pos.y).toBe(80);
    expect(st().self.durationMs).toBe(0);
  });
});
