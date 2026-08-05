import * as THREE from "three";
import { corDoCeuGLSL } from "./skyGradient.glsl";

/**
 * NÉVOA COM A COR DO CÉU — o que faz o horizonte dissolver em vez de virar
 * silhueta.
 *
 * O `THREE.Fog` tem UMA cor. O céu é um DEGRADÊ vertical (azul em cima, pálido
 * no horizonte). Enquanto a névoa desbotava para a cor do horizonte, tudo o que
 * ficava 100% enevoado saía pálido — inclusive o topo de uma montanha, que na
 * tela está bem acima da linha do horizonte, onde o céu já é azul. O resultado
 * é um recorte claro contra o azul, com a borda serrilhada da malha aparecendo
 * (referência `Desktop/ref/silhueta.jpg`).
 *
 * Aqui a névoa desbota para a cor do céu NAQUELE ÂNGULO DE ELEVAÇÃO — a mesma
 * função que a cúpula do céu desenha (`scene/skyGradient.glsl`). Geometria
 * totalmente enevoada fica exatamente da cor do que está atrás dela, ou seja,
 * some de verdade, em qualquer altura e com a câmera apontada para qualquer
 * lado. Não há silhueta porque não há diferença de cor para desenhar contorno.
 *
 * ## Por que mexer no `ShaderChunk` e não em cada material
 *
 * A névoa é aplicada pelo chunk `fog_fragment`, que TODO material embutido do
 * three inclui. Trocar o chunk uma vez pega chão, água, props, monstros e
 * personagem de uma vez; fazer material por material significaria repetir a
 * injeção em cinco lugares e esquecer o sexto. Nada disto toca a geometria nem
 * o fatiamento em chunks do terreno — é só a cor final do fragmento.
 *
 * ## Como a elevação chega ao fragmento sem uniform novo
 *
 * `fog_vertex` roda depois do `project_vertex`, então `mvPosition` está lá; a
 * rotação da view é ortonormal, então `transpose(mat3(viewMatrix))` devolve a
 * direção em mundo sem inverter matriz. Um varying `float` e duas contas.
 */

let aplicada = false;

/**
 * Troca o chunk de névoa do three pela versão que usa a cor do céu.
 *
 * Idempotente e global: chamar uma vez, ANTES de qualquer material compilar
 * (por isso o `PlayView` importa este módulo no topo). O editor não é afetado
 * porque a cena dele não tem `fog` — o chunk inteiro vive dentro de
 * `#ifdef USE_FOG`.
 */
export function aplicarNevoaDoCeu(): void {
  if (aplicada) return;
  aplicada = true;

  /**
   * A elevação chega ao fragmento sem uniform novo.
   *
   * `fog_vertex` roda depois do `project_vertex`, então `mvPosition` (posição em
   * espaço de VISTA) está lá — e é a única coisa que dá para usar: `transformed`
   * NÃO existe no shader de sprite nem no de points, e usá-lo quebraria a
   * compilação deles.
   *
   * A rotação da view é ortonormal, então a inversa dela é a transposta: girar
   * `mvPosition` por `transpose(mat3(viewMatrix))` devolve a direção em MUNDO, e
   * o `.y` do normalizado é o seno da elevação — exatamente a grandeza que a
   * cúpula do céu usa. Antes disto o varying era a tangente da elevação em
   * espaço de VISTA, que casava com um fundo preso à tela.
   */
  /**
   * O varying é a DIREÇÃO crua, e o `normalize` acontece no FRAGMENTO.
   *
   * Normalizar no vértice e deixar o rasterizador interpolar o resultado está
   * errado: `normalize(v).y` não é linear em `v`, então no meio de um triângulo
   * grande — um chunk de terreno inteiro, por exemplo — o valor interpolado não
   * é a elevação de ponto nenhum. A cúpula do céu normaliza por fragmento, e a
   * divergência entre as duas contas VOLTA a desenhar silhueta: medido com o
   * varying normalizado no vértice, **46/255**; passando a direção crua, 1/255.
   *
   * A direção, sim, interpola linearmente: ela é uma diferença de posições.
   */
  const varying = `
#ifdef USE_FOG
  varying vec3 vDirCeu;
#endif`;
  THREE.ShaderChunk.fog_pars_vertex += varying;
  THREE.ShaderChunk.fog_pars_fragment += varying;
  THREE.ShaderChunk.fog_vertex += `
#ifdef USE_FOG
  vDirCeu = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`;

  /**
   * A função do céu entra nos PARS do fragmento (declarações), não no corpo:
   * é lá que o GLSL aceita definição de função, e é o mesmo texto que a cúpula
   * compila. Se as duas divergirem, a geometria distante deixa de ser igual ao
   * fundo e a silhueta volta.
   */
  THREE.ShaderChunk.fog_pars_fragment += `
#ifdef USE_FOG
${corDoCeuGLSL()}
#endif`;

  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, corDoCeu( normalize( vDirCeu ).y ), fogFactor );
#endif`;
}
