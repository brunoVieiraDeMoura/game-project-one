import { useMemo } from "react";
import { GEO_PLANO, materialDeBrilho } from "./recursosCompartilhados";

/**
 * Uma luz fraca no chão, sob o que o ponteiro está apontando.
 *
 * Não é `THREE.PointLight`: luz de verdade custa um passo de iluminação por
 * objeto atingido e, com dezenas de mobs na tela, acender uma por hover seria
 * pagar caro por um efeito de meio segundo. Aqui é um disco deitado com um
 * degradê radial no shader — um triângulo par, sem textura e sem luz.
 *
 * O degradê é feito no fragmento (e não com uma textura de halo) porque assim a
 * cor entra como uniform: o mesmo componente serve o vermelho do inimigo e o
 * dourado do item sem carregar dois PNG.
 */

/** o disco fica um dedo acima do chão para não brigar em z com o terreno */
const ALTURA = 0.06;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * `d` é a distância ao centro em UV. O halo é forte no meio e some na borda com
 * `smoothstep`, e o `pow` puxa a curva para dentro — sem ele o disco parece um
 * círculo chapado com a borda serrilhada em vez de um brilho.
 */
const FRAG = /* glsl */ `
uniform vec3 uCor;
uniform float uForca;
uniform float uAro;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = pow(a, 2.2) * uForca;
  /**
   * O ARO do alvo selecionado.
   *
   * Some ao halo em vez de substituí-lo: o mob mirado tem as duas coisas — o
   * brilho que diz "é neste que vou bater" e a circunferência que diz "este é o
   * meu alvo". Uma faixa fina colada na borda, suavizada dos DOIS lados para
   * ela não serrilhar; sem o segundo smoothstep o aro viraria um disco chapado
   * da borda para dentro.
   */
  if (uAro > 0.0) {
    float aro = smoothstep(0.74, 0.88, d) * (1.0 - smoothstep(0.94, 1.0, d));
    a += aro * uAro;
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCor, a);
}
`;

export function GlowChao({
  cor,
  raio,
  aceso,
  /** o quanto ele brilha no centro; "de leve" é o pedido, não um holofote */
  forca = 0.55,
  /**
   * Intensidade do ARO em volta — 0 desliga.
   *
   * É o círculo do alvo SELECIONADO. Separado da `forca` de propósito: hover e
   * seleção são estados diferentes e podem estar os dois no mesmo mob, então
   * cada um tem o seu número em vez de disputarem o mesmo.
   */
  aro = 0,
}: {
  cor: string;
  raio: number;
  aceso: boolean;
  forca?: number;
  aro?: number;
}) {
  /**
   * COMPARTILHADO por combinação de cor/força/aro, não um por entidade.
   *
   * Antes cada `GlowChao` construía o seu num `useMemo` e o descartava na
   * limpeza — correto enquanto o material era dele, e com `area_size: 60` isso
   * é um `ShaderMaterial` novo a cada mob que entra no alcance. As combinações,
   * porém, são um punhado: duas cores × quatro níveis de força × com e sem aro.
   *
   * **Sem `dispose` agora**, e isso não é esquecimento: descartar aqui apagaria
   * o brilho de todas as outras entidades que usam a mesma combinação. Recurso
   * de módulo vive enquanto o módulo viver — ver `net/recursosCompartilhados`.
   */
  const material = useMemo(() => materialDeBrilho(cor, forca, aro, VERT, FRAG), [cor, forca, aro]);

  /**
   * `visible` em vez de desmontar: o hover entra e sai o tempo todo, e remontar
   * a cada passada de mouse é trabalho puro.
   *
   * Geometria UNITÁRIA com `scale`: o plano é 1×1 e o tamanho real vai na
   * escala, que é o que permite um mob de raio grande e um item de raio pequeno
   * dividirem a mesma geometria.
   */
  return (
    <mesh
      position={[0, ALTURA, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[raio * 2, raio * 2, 1]}
      visible={aceso}
      material={material}
      geometry={GEO_PLANO}
      renderOrder={-1}
    />
  );
}
