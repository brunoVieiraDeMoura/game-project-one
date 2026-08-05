import { describe, expect, it } from "vitest";
import {
  decidirClique,
  melhorAlvo,
  PESO_ATACANDO,
  RAIO_ASSIST_PX,
  TETO_PERTO_DO_JOGADOR,
  type Candidato,
} from "./aimAssist";

/**
 * SMART TARGET — o clique que passou raspando vale como clique no alvo.
 *
 * A hitbox do monstro é uma caixa no espaço 3D: com a câmera afastada, com ele
 * atrás de um prop, ou andando entre o apertar e o soltar do botão, o raio passa
 * de lado. Num jogo de clique esse "quase" é o pior resultado — em vez de bater,
 * o personagem sai correndo para a célula clicada.
 *
 * O que estes testes travam é a escolha em PIXEL DE TELA. A versão anterior
 * media no plano do chão, e com a câmera inclinada o monstro mais perto em
 * CÉLULA é frequentemente o que está mais longe do CURSOR — é o primeiro caso
 * aqui, e foi o defeito que motivou a mudança.
 */

/** um candidato válido; cada teste sobrescreve só o que interessa */
const cand = (gid: number, p: Partial<Candidato> = {}): Candidato => ({
  gid,
  px: 0,
  py: 0,
  naTela: true,
  visivel: true,
  distanciaDoJogador: 5,
  atacando: false,
  ...p,
});

const PONTO = { px: 100, py: 100 };

describe("melhorAlvo", () => {
  it("escolhe por pixel de tela, não por distância de mundo", () => {
    // o 2 está mais perto do JOGADOR (o que a conta antiga premiava) e mais
    // longe do cursor; o 1 é o que está debaixo do ponteiro
    const sobOCursor = cand(1, { px: 105, py: 100, distanciaDoJogador: 30 });
    const pertoDoPlayer = cand(2, { px: 140, py: 100, distanciaDoJogador: 1 });
    expect(melhorAlvo(PONTO, [pertoDoPlayer, sobOCursor])?.gid).toBe(1);
  });

  it("fora do raio não puxa nada, mesmo sendo o único", () => {
    const fora = cand(1, { px: 100 + RAIO_ASSIST_PX + 1, py: 100 });
    expect(melhorAlvo(PONTO, [fora])).toBeNull();
    // e a diagonal conta: hipotenusa, não eixo
    const diagonal = cand(2, { px: 100 + RAIO_ASSIST_PX * 0.8, py: 100 + RAIO_ASSIST_PX * 0.8 });
    expect(melhorAlvo(PONTO, [diagonal])).toBeNull();
  });

  it("quem está me batendo ganha o empate próximo", () => {
    const parado = cand(1, { px: 108, py: 100 });
    const batendo = cand(2, { px: 118, py: 100, atacando: true });
    // 18 px contra 8: a diferença (10) é menor que o peso (14), então vence
    expect(melhorAlvo(PONTO, [parado, batendo])?.gid).toBe(2);
  });

  it("...mas perde de um alvo claramente sob o cursor", () => {
    const sobOCursor = cand(1, { px: 101, py: 100 });
    const batendo = cand(2, { px: 101 + PESO_ATACANDO + 6, py: 100, atacando: true });
    // o peso não pode virar trava: mirar de propósito no OUTRO monstro tem de
    // funcionar mesmo enquanto se apanha
    expect(melhorAlvo(PONTO, [sobOCursor, batendo])?.gid).toBe(1);
  });

  it("fora da tela e atrás da névoa não são candidatos", () => {
    // os dois em cima do ponteiro E batendo: só as portas os excluem
    const atras = cand(1, { px: 100, py: 100, naTela: false, atacando: true });
    const naNevoa = cand(2, { px: 100, py: 100, visivel: false, atacando: true });
    expect(melhorAlvo(PONTO, [atras, naNevoa])).toBeNull();
  });

  it("a distância ao jogador só desempata — não inverte diferença de pixel", () => {
    const colado = cand(1, { px: 100, py: 100, distanciaDoJogador: 60 });
    const pertoDoPlayer = cand(2, { px: 120, py: 100, distanciaDoJogador: 0 });
    // 60 células valem só o TETO, que é menor que os 20 px de diferença
    expect(TETO_PERTO_DO_JOGADOR).toBeLessThan(20);
    expect(melhorAlvo(PONTO, [colado, pertoDoPlayer])?.gid).toBe(1);

    // sobrepostos na tela (o de trás e o da frente), aí sim vence o da frente
    const atras = cand(3, { px: 100, py: 100, distanciaDoJogador: 12 });
    const frente = cand(4, { px: 100, py: 100, distanciaDoJogador: 4 });
    expect(melhorAlvo(PONTO, [atras, frente])?.gid).toBe(4);
  });

  it("lista vazia e raio zero não quebram", () => {
    expect(melhorAlvo(PONTO, [])).toBeNull();
    expect(melhorAlvo(PONTO, [cand(1, { px: 100, py: 100 })], 0)?.gid).toBe(1);
    expect(melhorAlvo(PONTO, [cand(1, { px: 101, py: 100 })], 0)).toBeNull();
  });
});

describe("decidirClique — a ordem pedida", () => {
  /**
   * Bater no que está perto; **não havendo em quem bater**, pegar o que está no
   * chão; não havendo nada, andar.
   */
  it("monstro ganha do item, mesmo estando mais longe do cursor", () => {
    const mob = cand(7, { px: 130, py: 100 });
    const item = cand(99, { px: 101, py: 100 });
    expect(decidirClique(PONTO, [mob], [item])).toEqual({ tipo: "atacar", gid: 7 });
  });

  it("sem monstro por perto, o clique pega o drop", () => {
    const longe = cand(7, { px: 400, py: 400 });
    const item = cand(99, { px: 110, py: 100 });
    expect(decidirClique(PONTO, [longe], [item])).toEqual({ tipo: "pegar", gid: 99 });
  });

  it("nada por perto: anda, como sempre", () => {
    expect(decidirClique(PONTO, [], [])).toEqual({ tipo: "andar" });
    const fora = [cand(1, { px: 400, py: 400 })];
    expect(decidirClique(PONTO, fora, fora)).toEqual({ tipo: "andar" });
  });

  it("entre dois drops, o mais próximo na TELA", () => {
    const a = cand(1, { px: 130, py: 100 });
    const b = cand(2, { px: 104, py: 100 });
    expect(decidirClique(PONTO, [], [a, b])).toEqual({ tipo: "pegar", gid: 2 });
  });
});
