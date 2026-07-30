import { describe, expect, it } from "vitest";
import { NORTH_AZIMUTH, SNAP_EASE, shortestTurn as deltaCurto } from "./cameraNorth";

/**
 * O "voltar ao norte" (dois cliques com o direito) precisa girar pelo caminho
 * CURTO: errar o sinal do módulo faz a câmera dar a volta por trás,
 * atravessando o personagem — bug que só aparece em um dos lados do círculo.
 */

/** simula o loop de frames até parar */
function girarAteNorte(inicio: number): { fim: number; frames: number; maiorPasso: number } {
  let az = inicio;
  let frames = 0;
  let maiorPasso = 0;
  for (; frames < 600; frames++) {
    const d = deltaCurto(az, NORTH_AZIMUTH);
    if (Math.abs(d) < 0.01) {
      az = NORTH_AZIMUTH;
      break;
    }
    const passo = d * SNAP_EASE;
    maiorPasso = Math.max(maiorPasso, Math.abs(passo));
    az += passo;
  }
  return { fim: az, frames, maiorPasso };
}

describe("voltar ao norte", () => {
  it("norte é +z (a coordenada y do rAthena cresce para o norte)", () => {
    expect(NORTH_AZIMUTH).toBeCloseTo(Math.PI);
    // com az = π a câmera fica no lado −z e olha para +z
    expect(Math.cos(NORTH_AZIMUTH)).toBeCloseTo(-1);
  });

  it("nunca gira mais que meia volta, venha de onde vier", () => {
    for (let g = 0; g < 360; g += 5) {
      const de = (g * Math.PI) / 180;
      expect(Math.abs(deltaCurto(de, NORTH_AZIMUTH))).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });

  it("escolhe o lado certo: 10° a mais que o norte volta para trás", () => {
    const de = NORTH_AZIMUTH + 0.17;
    expect(deltaCurto(de, NORTH_AZIMUTH)).toBeLessThan(0);
    const de2 = NORTH_AZIMUTH - 0.17;
    expect(deltaCurto(de2, NORTH_AZIMUTH)).toBeGreaterThan(0);
  });

  it("converge para o norte de qualquer ângulo, e sem salto brusco", () => {
    for (let g = 0; g < 360; g += 15) {
      const { fim, frames, maiorPasso } = girarAteNorte((g * Math.PI) / 180);
      expect(fim).toBeCloseTo(NORTH_AZIMUTH, 5);
      expect(frames).toBeLessThan(60); // menos de 1 s a 60 fps
      expect(maiorPasso).toBeLessThanOrEqual(Math.PI * SNAP_EASE + 1e-9);
    }
  });
});
