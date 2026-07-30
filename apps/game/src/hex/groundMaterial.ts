import * as THREE from "three";
import type { GameplayConfig } from "@ragnarok/game-data";
import { GROUND_NOISE_GLSL } from "../scene/groundNoise.glsl";

/**
 * TROCA O VISUAL DA GRAMA sem tocar nos modelos.
 *
 * Os tiles KayKit não têm textura de chão: a face de cima inteira amostra UM
 * pixel do atlas `hexagons_medieval.png` (a grama é 191,197,55, em x81..90 /
 * y590 de 1024²). Por isso o chão sai chapado, e por isso não dá pra "trocar a
 * textura da grama" repintando o atlas sem afetar mais nada: o MESMO material e
 * o MESMO atlas desenham estrada, rio, água e costa.
 *
 * A troca então é feita no fragment shader: onde a cor amostrada bate com a da
 * grama (dentro de uma tolerância), aplica a cor escolhida e, no modo
 * "texture", modula com um ruído em coordenadas de MUNDO — isso dá padrão de
 * verdade sem precisar re-UV dos 40+ modelos, e sem emendas entre tiles (o
 * ruído é contínuo no mundo, não por peça). Estrada, leito de rio e água não
 * batem com a cor de referência e passam intactos.
 *
 * Modos (ServerConfig.gameplay.groundMode):
 *  • atlas   — devolve o material original (custo zero)
 *  • color   — grama vira `groundColor`, chapada como antes
 *  • texture — `groundColor` + ruído fbm (escala/intensidade configuráveis)
 */

/** cor da grama no atlas do KayKit (sRGB, medida do PNG — o tom mais claro) */
export const ATLAS_GRASS_SRGB = { r: 191 / 255, g: 197 / 255, b: 55 / 255 };
/**
 * O bloco de grama não tem UMA cor: tem uma família de tons do mesmo verde
 * (topo 191,197,55 → lateral 162,167,33 → base 133,138,12). Por isso o match é
 * por MATIZ (cor normalizada pela luminância), não pelo valor absoluto — senão
 * só o topo trocava e as laterais ficavam com a cor antiga.
 *
 * Medido no atlas (distância de matiz até a grama):
 *   grama, todos os tons ..... 0.000 – 0.059
 *   terra da estrada / areia . 0.596 – 0.750
 *   água ..................... 2.309 – 5.912
 * 0.20 fica com folga de 10× para o vizinho mais próximo.
 */
const HUE_TOLERANCE = 0.2;
/** luminância relativa (Rec.709) — mesma fórmula usada no shader */
const luma = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** os campos de config que mudam o material — chave de memoização */
export type GroundSettings = Pick<
  GameplayConfig,
  "groundMode" | "groundColor" | "groundTextureScale" | "groundTextureStrength"
>;

export function groundKey(s: GroundSettings): string {
  return `${s.groundMode}|${s.groundColor}|${s.groundTextureScale}|${s.groundTextureStrength}`;
}

/** sRGB → linear (o shader trabalha em linear; a comparação tem que ser lá) */
function toLinear(c: THREE.Color): THREE.Color {
  return c.clone().convertSRGBToLinear();
}

/**
 * Devolve o material a usar num tile. Em modo "atlas" é o próprio material do
 * glTF; nos outros, um CLONE com o patch (o original é compartilhado pelo cache
 * do useGLTF — mutar ele vazaria pra outras cenas).
 */
export function makeGroundMaterial(base: THREE.Material, s: GroundSettings): THREE.Material {
  if (s.groundMode === "atlas") return base;

  const mat = base.clone();
  const target = toLinear(new THREE.Color(s.groundColor));
  const ref = toLinear(new THREE.Color(ATLAS_GRASS_SRGB.r, ATLAS_GRASS_SRGB.g, ATLAS_GRASS_SRGB.b));
  const textured = s.groundMode === "texture";
  // escala em unidades de mundo por repetição → frequência do ruído
  const freq = 1 / Math.max(0.05, s.groundTextureScale);

  const refLum = Math.max(luma(ref), 1e-4);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundTarget = { value: new THREE.Vector3(target.r, target.g, target.b) };
    shader.uniforms.uGroundRef = { value: new THREE.Vector3(ref.r, ref.g, ref.b) };
    shader.uniforms.uGroundRefDir = { value: new THREE.Vector3(ref.r / refLum, ref.g / refLum, ref.b / refLum) };
    shader.uniforms.uGroundRefLum = { value: refLum };
    shader.uniforms.uGroundTol = { value: HUE_TOLERANCE };
    shader.uniforms.uGroundFreq = { value: freq };
    shader.uniforms.uGroundNoise = { value: textured ? s.groundTextureStrength : 0 };

    // posição E normal de mundo no fragment: a posição porque o ruído tem que
    // ser contínuo entre tiles (senão cada hexágono repete o mesmo padrão e a
    // costura volta), a normal porque o padrão de grama só faz sentido nas
    // faces viradas pra cima — na parede lateral do bloco vira sujeira.
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGroundWorld;\nvarying vec3 vGroundNormalW;")
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
\t{
\t\tvec4 gPos = vec4(transformed, 1.0);
\t\tvec3 gNor = objectNormal;
\t\t#ifdef USE_INSTANCING
\t\t\t// o terreno é UM InstancedMesh por peça: o three só aplica a
\t\t\t// instanceMatrix depois (em project_vertex), então sem isto todos os
\t\t\t// hexágonos veem a MESMA posição e o padrão repete tile a tile —
\t\t\t// exatamente o contorno hexagonal que o weld existe pra sumir.
\t\t\tgPos = instanceMatrix * gPos;
\t\t\tgNor = mat3(instanceMatrix) * gNor;
\t\t#endif
\t\tvGroundWorld = (modelMatrix * gPos).xyz;
\t\tvGroundNormalW = normalize(mat3(modelMatrix) * gNor);
\t}`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vGroundWorld;
varying vec3 vGroundNormalW;
uniform vec3 uGroundTarget;
uniform vec3 uGroundRef;
uniform vec3 uGroundRefDir;
uniform float uGroundRefLum;
uniform float uGroundTol;
uniform float uGroundFreq;
uniform float uGroundNoise;
${GROUND_NOISE_GLSL}`,
      )
      // depois do map_fragment o diffuseColor já traz a cor do atlas em linear
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
{
  float gLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 gDir = diffuseColor.rgb / max(gLum, 1e-4);
  // matiz igual ao da grama = é grama, em qualquer tom (topo, lateral, base)
  if (distance(gDir, uGroundRefDir) < uGroundTol) {
    // mantém o degradê autoral do bloco: a lateral continua mais escura que o
    // topo na MESMA proporção de antes, só que na cor nova
    float shade = gLum / uGroundRefLum;
    vec3 groundCol = uGroundTarget * shade;
    if (uGroundNoise > 0.0) {
      vec2 gp = vGroundWorld.xz * uGroundFreq;
      // duas escalas: manchas largas + granulado fino (grama de perto)
      float n = groundFbm(gp) * 0.75 + groundFbm(gp * 5.0) * 0.25;
      float up = clamp(vGroundNormalW.y, 0.0, 1.0); // só nas faces de cima
      groundCol *= 1.0 + (n - 0.5) * uGroundNoise * 1.4 * up;
    }
    diffuseColor.rgb = groundCol;
  }
}`,
      );
  };
  // materiais com onBeforeCompile diferente precisam de programa próprio
  mat.customProgramCacheKey = () => groundKey(s);
  mat.needsUpdate = true;
  return mat;
}
