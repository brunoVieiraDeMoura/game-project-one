import * as THREE from "three";

/**
 * Shader de QUANTIZAÇÃO DE COR do filtro retrô — a parte "16 bits" de verdade.
 *
 * Console de 16 bits não tinha 24 bits de cor: o SNES trabalhava em RGB555 e o
 * Mega Drive em 9 bits. Aqui a cor final é arredondada pra `levels` degraus por
 * canal (32 ≈ RGB565), o que produz o mesmo "achatamento" de tons.
 *
 * Só quantizar deixa faixas visíveis onde a imagem tem gradiente suave (céu,
 * névoa). O DITHERING ordenado (matriz de Bayer 4×4) resolve isso do jeito da
 * época: espalha o erro num padrão fixo, e a faixa vira um chuviscado regular.
 * O offset do dither é ±meio degrau — mais que isso vira sujeira.
 *
 * A matriz é indexada por pixel de TELA (gl_FragCoord), não por UV: assim o
 * padrão tem sempre o tamanho de 1 pixel, independente da resolução do render.
 */
export const RetroQuantizeShader = {
  name: "RetroQuantizeShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** degraus POR CANAL (R,G,B); qualquer componente <= 1 desliga a quantização */
    levels: { value: new THREE.Vector3(32, 64, 32) },
    /** 0 = sem dithering, 1 = ligado */
    dither: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 levels;
    uniform float dither;
    varying vec2 vUv;

    // Bayer 4x4 normalizada em [-0.5, 0.5]
    float bayer(vec2 px) {
      int x = int(mod(px.x, 4.0));
      int y = int(mod(px.y, 4.0));
      int i = y * 4 + x;
      float m =
        i == 0  ?  0.0 : i == 1  ?  8.0 : i == 2  ?  2.0 : i == 3  ? 10.0 :
        i == 4  ? 12.0 : i == 5  ?  4.0 : i == 6  ? 14.0 : i == 7  ?  6.0 :
        i == 8  ?  3.0 : i == 9  ? 11.0 : i == 10 ?  1.0 : i == 11 ?  9.0 :
        i == 12 ? 15.0 : i == 13 ?  7.0 : i == 14 ? 13.0 : 5.0;
      return (m / 16.0) - 0.5;
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      if (min(levels.r, min(levels.g, levels.b)) <= 1.0) { gl_FragColor = texel; return; }
      vec3 step = 1.0 / levels;
      vec3 c = texel.rgb;
      if (dither > 0.5) c += bayer(gl_FragCoord.xy) * step;
      gl_FragColor = vec4(floor(clamp(c, 0.0, 1.0) * levels + 0.5) / levels, texel.a);
    }
  `,
};

/** níveis por canal (R,G,B) de cada modo. Zero = não quantiza. */
const PALETTES: Record<string, [number, number, number]> = {
  // RGB565: o formato de cor do SNES/Mega Drive tardio — mais degraus no verde
  "16bit": [32, 64, 32],
  // RGB332: 256 cores, o clássico 8 bits (VGA modo 13h, MSX2)
  "8bit": [8, 8, 4],
};

/**
 * Paleta do modo. "off"/"pixel" devolvem (0,0,0) = shader passa a imagem
 * intacta — pixeliza mas não mexe na cor.
 */
export function colorLevelsFor(mode: string): [number, number, number] {
  return PALETTES[mode] ?? [0, 0, 0];
}
