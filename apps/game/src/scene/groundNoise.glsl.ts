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
// Hash SEM \`sin\`.
//
// O clássico \`fract(sin(dot(p, k)) * grande)\` custa uma transcendental por
// amostra, e aqui são QUATRO amostras por oitava, TRÊS oitavas — doze \`sin\` em
// cada pixel de chão, e o chão cobre a tela inteira. Esta versão usa só
// multiplicação e \`fract\`, que a GPU faz na unidade comum.
//
// Não é a mesma sequência de números da anterior (nenhum hash é), mas é a mesma
// COISA: ruído branco em [0,1) descorrelacionado entre células inteiras. O que
// se vê continua sendo mancha larga de baixa amplitude.
float groundHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
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
