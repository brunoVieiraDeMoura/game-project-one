import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { aplicarNevoaDoCeu } from "./skyFog";
import { corDoCeu, corDoCeuGLSL, emSRGB, SKY_HORIZON, SKY_TOP } from "./skyGradient.glsl";

/**
 * O céu e a névoa TÊM de calcular a mesma coisa.
 *
 * Não dá para renderizar em vitest (não há WebGL), mas o que quebra aqui é
 * aritmética, e isso se testa. Já quebrou duas vezes:
 *
 * • cores em espaço LINEAR quando o `fog_fragment` do three roda DEPOIS do
 *   `colorspace_fragment` — ou seja, mistura em sRGB. Medido no navegador com o
 *   erro: a montanha distante ficava 74/255 mais escura que o céu atrás dela, a
 *   silhueta continuava lá, só que escura;
 * • céu preso à TELA e névoa por elevação de VISTA — casavam por acidente
 *   enquanto o fundo era um degradê de tela, e divergiriam no instante em que
 *   um dos dois mudasse.
 */

aplicarNevoaDoCeu();

describe("curva do céu", () => {
  it("no horizonte é a cor da bruma; no zênite é o azul do topo", () => {
    expect(corDoCeu(0)).toEqual(emSRGB(SKY_HORIZON));
    expect(corDoCeu(1)).toEqual(emSRGB(SKY_TOP));
  });

  it("abaixo do horizonte continua bruma — é o que o CHÃO enevoado recebe", () => {
    // sem isto o chão distante puxaria para o azul e o encontro voltaria a ser seco
    expect(corDoCeu(-0.2)).toEqual(emSRGB(SKY_HORIZON));
    expect(corDoCeu(-1)).toEqual(emSRGB(SKY_HORIZON));
  });

  it("subir NUNCA volta para a bruma (monotônica)", () => {
    let anterior = -1;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      // quanto de azul já entrou: distância até a cor do horizonte
      const c = corDoCeu(s);
      const d = Math.abs(c[0] - emSRGB(SKY_HORIZON)[0]);
      expect(d).toBeGreaterThanOrEqual(anterior - 1e-9);
      anterior = d;
    }
  });

  it("a bruma OCUPA a vizinhança do horizonte, não some no primeiro grau", () => {
    const horizonte = emSRGB(SKY_HORIZON);
    const topo = emSRGB(SKY_TOP);
    const fracao = (s: number) => (corDoCeu(s)[0] - horizonte[0]) / (topo[0] - horizonte[0]);
    // a ~6° de elevação ainda é quase toda bruma
    expect(fracao(0.1)).toBeLessThan(0.25);
    // e a ~35° o azul já domina
    expect(fracao(0.58)).toBeGreaterThan(0.85);
  });
});

describe("névoa com a cor do céu", () => {
  it("usa a MESMA função que a cúpula do céu, texto por texto", () => {
    // é isto que impede céu e névoa de divergirem: um arquivo, dois consumidores
    expect(THREE.ShaderChunk.fog_pars_fragment).toContain(corDoCeuGLSL().trim());
    expect(THREE.ShaderChunk.fog_fragment).toContain("corDoCeu( normalize( vDirCeu ).y )");
  });

  it("as cores no GLSL estão em sRGB, NÃO em linear", () => {
    const [r] = emSRGB(SKY_TOP);
    expect(corDoCeuGLSL()).toContain(r.toFixed(5));
    // e a diferença entre os espaços é grande o bastante para virar silhueta:
    // se alguém "corrigir" para linear, este número denuncia
    expect(Math.abs(new THREE.Color(SKY_TOP).r - r)).toBeGreaterThan(0.2);
  });

  it("a elevação é de MUNDO e não usa `transformed` (sprite/points não têm)", () => {
    expect(THREE.ShaderChunk.fog_vertex).toContain("transpose( mat3( viewMatrix ) ) * mvPosition.xyz");
    expect(THREE.ShaderChunk.fog_vertex).not.toContain("transformed");
  });

  it("o varying é a DIREÇÃO crua — normalizar no vértice desenha silhueta", () => {
    // `normalize(v).y` não é linear em `v`: interpolado no meio de um triângulo
    // grande ele não é a elevação de ponto nenhum, e a cor deixa de bater com a
    // cúpula (medido: 46/255 de diferença; com a direção crua, 1/255)
    expect(THREE.ShaderChunk.fog_vertex).not.toContain("normalize");
    expect(THREE.ShaderChunk.fog_pars_vertex).toContain("varying vec3 vDirCeu");
    expect(THREE.ShaderChunk.fog_fragment).toContain("normalize( vDirCeu )");
  });

  it("o varying é declarado nos dois estágios, senão o shader não compila", () => {
    expect(THREE.ShaderChunk.fog_pars_vertex).toContain("varying vec3 vDirCeu");
    expect(THREE.ShaderChunk.fog_pars_fragment).toContain("varying vec3 vDirCeu");
  });

  it("continua respeitando os dois modos de névoa do three", () => {
    expect(THREE.ShaderChunk.fog_fragment).toContain("FOG_EXP2");
    expect(THREE.ShaderChunk.fog_fragment).toContain("smoothstep( fogNear, fogFar, vFogDepth )");
  });
});
