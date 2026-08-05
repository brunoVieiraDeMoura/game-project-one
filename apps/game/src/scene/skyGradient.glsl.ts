/**
 * A CURVA DO CÉU — uma só, usada pela cúpula e pela névoa.
 *
 * Estas duas coisas não podem divergir. A névoa desbota para a cor do céu
 * (ver `scene/skyFog.ts`), então se o céu desenhar uma cor e a névoa calcular
 * outra, a geometria distante volta a ter cor diferente do fundo — que é
 * exatamente a silhueta recortada da referência `silhueta.jpg`. Uma função,
 * dois consumidores.
 *
 * ## Por elevação, não por altura de tela
 *
 * O céu antigo era um degradê preso à TELA (`scene.background` com um canvas
 * 2×256): girar a câmera não mudava nada — lia como papel de parede — e a faixa
 * clara ficava sempre na base da tela, NUNCA em cima do horizonte. Por isso o
 * chão, que desbota para o pálido, encontrava um azul já forte logo acima da
 * linha: é o encontro "seco" da marcação 1 da referência `background.jpg`.
 *
 * Com a cor saindo do ÂNGULO DE ELEVAÇÃO, a faixa clara fica onde o horizonte
 * está, em qualquer inclinação de câmera, e olhar para cima mostra o zênite.
 *
 * ## Em sRGB, sempre
 *
 * O `fog_fragment` do three é incluído DEPOIS do `colorspace_fragment`
 * (meshbasic.glsl.js:108-111), ou seja, a névoa mistura com o fragmento já
 * convertido para o espaço de saída — é por isso que o próprio three sobe o
 * `fogColor` com `getRGB(..., getUnlitUniformColorSpace(renderer))`. Fazer a
 * conta em linear já custou 74/255 de silhueta uma vez.
 */

/** azul do alto do céu */
export const SKY_TOP = "#5a8fc7";
/** pálido do horizonte — é também a cor de tudo que a névoa engole */
export const SKY_HORIZON = "#cfe0ee";

/**
 * Onde a bruma do horizonte acaba, em seno da elevação.
 *
 * 0,55 ≈ 33°: perto da linha do horizonte a cor quase não muda (a bruma), e o
 * azul entra de vez bem acima dela. É o que dá profundidade sem clarear o céu
 * inteiro.
 */
const FIM_DA_BRUMA = 0.55;
/**
 * Curvatura da subida. Abaixo de 1 a bruma se ALARGA junto ao horizonte — a
 * mesma ideia de uma atmosfera mais densa embaixo.
 */
const CURVA = 0.8;

/** componentes sRGB de um hex (0..1), que é o espaço em que a névoa mistura */
export function emSRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * A MESMA conta do shader, em TypeScript — para teste e para quem precisar da
 * cor fora da GPU.
 *
 * `senElev` é o seno do ângulo de elevação: 0 no horizonte, 1 no zênite,
 * negativo abaixo da linha (onde vive o chão, e onde o céu é a bruma pura).
 */
export function corDoCeu(senElev: number, topo = SKY_TOP, horizonte = SKY_HORIZON): [number, number, number] {
  const a = emSRGB(horizonte);
  const b = emSRGB(topo);
  const s = Math.max(0, Math.min(1, (senElev - 0) / FIM_DA_BRUMA));
  const t = Math.pow(s * s * (3 - 2 * s), CURVA); // smoothstep, depois a curva
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const glsl = (c: [number, number, number]) => `vec3(${c[0].toFixed(5)}, ${c[1].toFixed(5)}, ${c[2].toFixed(5)})`;

/**
 * A função em GLSL, com as cores já baixadas para constantes.
 *
 * Recebe as cores como parâmetro porque o EDITOR usa a mesma cúpula com uma
 * paleta de estúdio (escura) — lá não há névoa, então não há nada para casar,
 * mas o componente é o mesmo.
 */
export function corDoCeuGLSL(topo = SKY_TOP, horizonte = SKY_HORIZON): string {
  return `
vec3 corDoCeu( float senElev ) {
  float s = clamp( senElev / ${FIM_DA_BRUMA.toFixed(3)}, 0.0, 1.0 );
  float t = pow( s * s * ( 3.0 - 2.0 * s ), ${CURVA.toFixed(3)} );
  return mix( ${glsl(emSRGB(horizonte))}, ${glsl(emSRGB(topo))}, t );
}`;
}
