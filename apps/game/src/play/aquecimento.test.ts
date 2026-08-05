import { describe, expect, it } from "vitest";
import {
  AQUECIMENTO_INICIAL,
  QUADROS_SEM_SHADER_NOVO,
  TETO_AQUECIMENTO_MS,
  passoDeAquecimento,
  type EstadoAquecimento,
} from "./aquecimento";

/**
 * A tela de carregamento tem de SAIR, e não pode sair CEDO DEMAIS.
 *
 * As duas metades importam e falham de jeitos opostos:
 *
 *  • sair cedo devolve o engasgo que a fase de aquecimento existe para esconder
 *    — o primeiro quadro visível compila todos os materiais de uma vez, bem no
 *    instante em que o jogador ganha o controle;
 *  • não sair nunca é pior: o jogo fica preso numa tela de carregamento para
 *    sempre, e o jogador não tem o que fazer a não ser recarregar.
 */

/** roda N quadros com a contagem de shaders que a função devolver */
function rodar(programasPorQuadro: (i: number) => number, quadros: number, msPorQuadro = 16) {
  let estado: EstadoAquecimento = AQUECIMENTO_INICIAL;
  for (let i = 0; i < quadros; i++) {
    const passo = passoDeAquecimento(estado, programasPorQuadro(i), i * msPorQuadro);
    estado = passo.estado;
    if (passo.pronto) return { quadro: i, porTeto: passo.porTeto };
  }
  return null;
}

describe("aquecimento da cena", () => {
  it("não revela enquanto shader novo continua aparecendo", () => {
    // um shader novo por quadro: a contagem nunca para, então a estabilidade
    // nunca é atingida — só o teto pode encerrar isto
    const fim = rodar((i) => i, 20);
    expect(fim).toBeNull();
  });

  it("revela depois de N quadros seguidos sem shader novo", () => {
    // 40 shaders compilam no primeiro quadro e nada mais entra
    const fim = rodar(() => 40, 30);
    expect(fim).not.toBeNull();
    expect(fim!.porTeto).toBe(false);
    // o 1º quadro só ESTABELECE a contagem (de -1 para 40); os N seguintes é que
    // são os parados — por isso o índice é N, não N-1
    expect(fim!.quadro).toBe(QUADROS_SEM_SHADER_NOVO);
  });

  it("uma rajada tardia de shaders ADIA a revelação", () => {
    // estabiliza quase até o limite, e aí entra um shader novo: a conta reinicia
    const quaseLa = QUADROS_SEM_SHADER_NOVO - 1;
    const fim = rodar((i) => (i < quaseLa ? 10 : 11), 40);
    expect(fim).not.toBeNull();
    // teve de esperar mais que o caso limpo
    expect(fim!.quadro).toBeGreaterThan(QUADROS_SEM_SHADER_NOVO);
    expect(fim!.porTeto).toBe(false);
  });

  it("SEMPRE revela pelo teto, mesmo com shader novo em todo quadro", () => {
    // este é o teste que impede a tela de carregamento eterna
    const msPorQuadro = 16;
    const quadrosDoTeto = Math.ceil(TETO_AQUECIMENTO_MS / msPorQuadro) + 5;
    const fim = rodar((i) => i, quadrosDoTeto, msPorQuadro);
    expect(fim).not.toBeNull();
    expect(fim!.porTeto).toBe(true);
    expect(fim!.quadro * msPorQuadro).toBeGreaterThan(TETO_AQUECIMENTO_MS);
  });

  it("máquina LENTA espera o trabalho, não o relógio", () => {
    /**
     * O motivo de contar shader em vez de tempo: num quadro de 100 ms (máquina
     * lenta compilando), oito quadros parados são 800 ms — e a revelação
     * acontece por ESTABILIDADE, não por teto, desde que caiba nele. Um
     * `setTimeout` fixo de, digamos, 300 ms teria revelado no meio da
     * compilação.
     */
    const fim = rodar(() => 40, 30, 100);
    expect(fim).not.toBeNull();
    expect(fim!.porTeto).toBe(false);
    expect(fim!.quadro).toBe(QUADROS_SEM_SHADER_NOVO);
  });

  it("renderer sem lista de programas não trava a tela", () => {
    // `gl.info.programs` pode ser undefined; quem chama passa 0. Contagem parada
    // em zero é contagem parada — revela pela estabilidade, sem esperar o teto.
    const fim = rodar(() => 0, 30);
    expect(fim).not.toBeNull();
    expect(fim!.porTeto).toBe(false);
  });
});
