import { describe, expect, it } from "vitest";
import { MAP_ZOOM, enquadrar, panAoAproximar } from "./mapWindow";

/**
 * A navegação da janela de mapa é o único pedaço dela que é regra pura, e é o
 * pedaço fácil de errar: sem o clamp o arrasto leva o mapa para fora do campo e
 * o jogador fica olhando o vazio sem saber como voltar.
 */
const campo = { w: 800, h: 500 };
/** um mapa quadrado do rAthena (prt_fild08 é 400×400) */
const mapa = { w: 400, h: 400 };

describe("enquadrar", () => {
  it("em zoom 1 o conteúdo INTEIRO cabe e fica centrado", () => {
    const v = enquadrar(campo, mapa, 1, { x: 0, y: 0 });
    // `contain`: o lado limitante é a altura (500/400 < 800/400)
    expect(v.escala).toBeCloseTo(500 / 400);
    expect(mapa.w * v.escala).toBeLessThanOrEqual(campo.w + 1e-9);
    expect(mapa.h * v.escala).toBeLessThanOrEqual(campo.h + 1e-9);
    expect(v.ox).toBeCloseTo((campo.w - mapa.w * v.escala) / 2);
    expect(v.oy).toBeCloseTo(0);
  });

  it("com o conteúdo menor que o campo, ARRASTAR não move nada", () => {
    // não há nada fora da vista para procurar: o gesto tem de ser inerte, senão
    // o jogador empurra o mapa para um canto e acha que quebrou
    const parado = enquadrar(campo, mapa, 1, { x: 0, y: 0 });
    const puxado = enquadrar(campo, mapa, 1, { x: 900, y: -400 });
    expect(puxado.ox).toBeCloseTo(parado.ox);
    expect(puxado.oy).toBeCloseTo(parado.oy);
  });

  it("ampliado, o arrasto para na BORDA do conteúdo", () => {
    const v = enquadrar(campo, mapa, 4, { x: 99999, y: 99999 });
    // puxado até o limite, a borda do conteúdo encosta na borda do campo — nunca
    // passa dela (o que deixaria faixa vazia à mostra)
    expect(v.ox).toBeCloseTo(0);
    expect(v.oy).toBeCloseTo(0);
    const w = enquadrar(campo, mapa, 4, { x: -99999, y: -99999 });
    expect(w.ox).toBeCloseTo(campo.w - mapa.w * w.escala);
    expect(w.oy).toBeCloseTo(campo.h - mapa.h * w.escala);
  });

  it("o zoom multiplica o enquadramento base", () => {
    const um = enquadrar(campo, mapa, 1, { x: 0, y: 0 });
    for (const z of MAP_ZOOM) {
      expect(enquadrar(campo, mapa, z, { x: 0, y: 0 }).escala).toBeCloseTo(um.escala * z);
    }
  });
});

describe("panAoAproximar", () => {
  it("mantém sob o PONTEIRO o ponto que já estava lá", () => {
    const ponteiro = { x: 610, y: 120 };
    const antes = { zoom: 2, pan: { x: 40, y: -20 } };
    const a = enquadrar(campo, mapa, antes.zoom, antes.pan);
    const alvo = { u: (ponteiro.x - a.ox) / a.escala, v: (ponteiro.y - a.oy) / a.escala };

    const pan = panAoAproximar(campo, mapa, antes, 3, ponteiro);
    const b = enquadrar(campo, mapa, 3, pan);
    expect(b.ox + alvo.u * b.escala).toBeCloseTo(ponteiro.x);
    expect(b.oy + alvo.v * b.escala).toBeCloseTo(ponteiro.y);
  });

  it("aproximar do centro mantém o centro", () => {
    const centro = { x: campo.w / 2, y: campo.h / 2 };
    const antes = { zoom: 1, pan: { x: 0, y: 0 } };
    const a = enquadrar(campo, mapa, antes.zoom, antes.pan);
    const alvo = { u: (centro.x - a.ox) / a.escala, v: (centro.y - a.oy) / a.escala };

    const pan = panAoAproximar(campo, mapa, antes, 4, centro);
    const b = enquadrar(campo, mapa, 4, pan);
    expect(b.ox + alvo.u * b.escala).toBeCloseTo(centro.x);
    expect(b.oy + alvo.v * b.escala).toBeCloseTo(centro.y);
  });

  it("o resultado continua passando pelo clamp: mirar a quina não abre vão", () => {
    // o pan devolvido por `panAoAproximar` pode cair fora do permitido (mirar a
    // quina do campo), e é `enquadrar` quem tem de segurar
    const pan = panAoAproximar(campo, mapa, { zoom: 1, pan: { x: 0, y: 0 } }, 8, { x: 0, y: 0 });
    const v = enquadrar(campo, mapa, 8, pan);
    expect(v.ox).toBeLessThanOrEqual(0);
    expect(v.oy).toBeLessThanOrEqual(0);
    expect(v.ox + mapa.w * v.escala).toBeGreaterThanOrEqual(campo.w);
    expect(v.oy + mapa.h * v.escala).toBeGreaterThanOrEqual(campo.h);
  });
});
