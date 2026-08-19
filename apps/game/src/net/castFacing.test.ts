import { describe, expect, it } from "vitest";
import { passoDeGiroParaAlvo } from "./castFacing";

/**
 * Giro do personagem para o alvo do cast: suave (nunca salta de uma vez) e
 * sempre pelo caminho CURTO (mesma regra de `play/cameraNorth.shortestTurn`,
 * ver `play/northSnap.test.ts`) — errar o lado faria o personagem girar por
 * trás quando o alvo está do lado oposto.
 */

const EASE = 0.22;

/** simula quadros até a rotação convergir para o ângulo que aponta a (dx, dz) */
function girarAte(rotacaoInicial: number, dx: number, dz: number): { fim: number; frames: number; maiorPasso: number } {
  let rot = rotacaoInicial;
  let frames = 0;
  let maiorPasso = 0;
  for (; frames < 600; frames++) {
    const proxima = passoDeGiroParaAlvo(rot, dx, dz, EASE);
    if (proxima === null) break;
    maiorPasso = Math.max(maiorPasso, Math.abs(proxima - rot));
    if (Math.abs(proxima - rot) < 1e-4) {
      rot = proxima;
      break;
    }
    rot = proxima;
  }
  return { fim: rot, frames, maiorPasso };
}

describe("passoDeGiroParaAlvo", () => {
  it("alvo em cima do personagem: ângulo indefinido, não gira", () => {
    expect(passoDeGiroParaAlvo(0, 0, 0, EASE)).toBeNull();
    expect(passoDeGiroParaAlvo(1.2, 1e-9, -1e-9, EASE)).toBeNull();
  });

  it("nunca salta de uma vez — cada quadro é uma FRAÇÃO do giro que falta", () => {
    // alvo diretamente atrás (dz negativo, dx=0 → atan2 = π): giro de meia volta
    const passo = passoDeGiroParaAlvo(0, 0, -1, EASE);
    expect(passo).not.toBeNull();
    // um passo só não pode ter chegado no alvo (π), senão seria snap
    expect(Math.abs(passo! - Math.PI)).toBeGreaterThan(0.1);
    // e o tamanho do passo bate com EASE * (diferença total)
    expect(Math.abs(passo!)).toBeCloseTo(Math.PI * EASE, 5);
  });

  it("escolhe o caminho curto: alvo um pouco à direita de trás gira para o lado certo", () => {
    // partindo de uma rotação quase virada para trás, alvo um pouco além pelo
    // MESMO lado não deve girar pelo lado oposto
    const de = Math.PI - 0.2; // já quase olhando para trás, um pouco à esquerda
    const alvoAngulo = Math.PI + 0.2; // alvo um pouco além, pelo mesmo lado
    const dx = Math.sin(alvoAngulo);
    const dz = Math.cos(alvoAngulo);
    const passo = passoDeGiroParaAlvo(de, dx, dz, EASE)! - de;
    // a diferença real é pequena (0.4 rad) e deve girar nesse sentido, não dar
    // a volta inteira pelo outro lado
    expect(Math.abs(passo)).toBeLessThan(0.2);
  });

  it("converge para encarar o alvo, sem salto brusco, de qualquer ângulo inicial", () => {
    const alvoAngulo = 0.7; // alvo fixo nesta direção
    const dx = Math.sin(alvoAngulo);
    const dz = Math.cos(alvoAngulo);
    for (let g = 0; g < 360; g += 15) {
      const inicio = (g * Math.PI) / 180;
      const { fim, frames, maiorPasso } = girarAte(inicio, dx, dz);
      // atan2 devolve em (−π, π]; compara pelo cosseno/seno para não falhar
      // por wraparound (2π ≡ 0)
      expect(Math.cos(fim)).toBeCloseTo(Math.cos(alvoAngulo), 3);
      expect(Math.sin(fim)).toBeCloseTo(Math.sin(alvoAngulo), 3);
      expect(frames).toBeLessThan(60); // converge bem antes de 1s a 60fps
      expect(maiorPasso).toBeLessThanOrEqual(Math.PI * EASE + 1e-9); // nunca mais que uma fração da meia-volta
    }
  });

  it("alvo se move durante o cast: o giro persegue o novo ângulo a cada quadro", () => {
    let rot = 0;
    // alvo começa à frente (dz=1) e "anda" para o lado (dx cresce) quadro a
    // quadro — como um mob se movendo durante a conjuração
    for (let i = 0; i <= 10; i++) {
      const dx = i / 10; // 0 → 1
      const dz = 1;
      const proxima = passoDeGiroParaAlvo(rot, dx, dz, EASE);
      expect(proxima).not.toBeNull();
      rot = proxima!;
    }
    const alvoFinal = Math.atan2(1, 1); // último ponto do "mob"
    // depois de perseguir o alvo andando, a rotação está a caminho do ângulo
    // final — mais perto dele do que do ponto de partida (0)
    expect(Math.abs(shortestDiff(rot, alvoFinal))).toBeLessThan(Math.abs(shortestDiff(0, alvoFinal)));
  });
});

function shortestDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
