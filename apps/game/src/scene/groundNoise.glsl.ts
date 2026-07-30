/**
 * Ruído do chão (GLSL), compartilhado pelos dois terrenos.
 *
 * É ele que impede o chão de parecer um plano de cor chapada: manchas largas
 * mais granulado fino, amostrados em coordenada de MUNDO (não de tile), então o
 * padrão não repete célula a célula e não denuncia a grade.
 *
 * Vive fora de `hex/groundMaterial.ts` porque a grade quadrada precisa do mesmo
 * ruído sobre uma malha de cor por vértice, sem nada do resto daquele shader
 * (que existe para recolorir a grama do ATLAS das peças KayKit por matiz).
 */
export const GROUND_NOISE_GLSL = `
float groundHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float groundNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(groundHash(i), groundHash(i + vec2(1.0, 0.0)), u.x),
             mix(groundHash(i + vec2(0.0, 1.0)), groundHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float groundFbm(vec2 p) {
  return groundNoise(p) * 0.62 + groundNoise(p * 2.3) * 0.26 + groundNoise(p * 4.7) * 0.12;
}`;
