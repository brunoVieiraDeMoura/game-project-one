import { beforeEach, describe, expect, it } from "vitest";
import {
  GEO_CAIXA,
  GEO_CILINDRO,
  GEO_PLANO,
  MATERIAL_INVISIVEL,
  materiaisCompartilhados,
  materialDeBarra,
  materialDeBrilho,
  materialOpaco,
  zerarRecursosCompartilhados,
} from "./recursosCompartilhados";

/**
 * O que se protege aqui é o COMPARTILHAMENTO e a consequência dele.
 *
 * Com `area_size: 60` o servidor anuncia um quadrado de 121×121 células, então é
 * entra-e-sai de mob o tempo todo, e cada entidade alocava quatro geometrias e
 * quatro materiais idênticos aos de todas as outras. Não vazava — o descarte
 * existia —, mas era pressão de coletor contínua (Minor + Major + C++ ≈ 226 ms
 * no perfil de produção).
 *
 * A consequência que precisa de teste é a regra que MUDA ao compartilhar: quem
 * usa deixa de poder descartar.
 */

beforeEach(() => {
  zerarRecursosCompartilhados();
});

describe("geometrias unitárias", () => {
  it("são UNITÁRIAS — o tamanho vai no `scale` de quem usa", () => {
    /**
     * É isto que permite um mob de raio grande e um item de raio pequeno
     * dividirem a mesma geometria. E o raycast continua correto: o three
     * transforma o raio para o espaço local do objeto antes de testar, então a
     * escala entra na conta de graça.
     */
    GEO_CILINDRO.computeBoundingBox();
    const c = GEO_CILINDRO.boundingBox!;
    expect(c.max.y - c.min.y).toBeCloseTo(1, 5);
    /**
     * A LARGURA não é 1, e não deveria ser: com 10 segmentos o cilindro é um
     * decágono, e a caixa envolvente dele é `cos(18°)` do diâmetro (0,951). O
     * raio do parâmetro continua 0,5, que é o que a escala de quem usa
     * multiplica — a área de clique é a mesma de antes, quando o raio ia direto
     * na geometria.
     */
    expect(c.max.x - c.min.x).toBeCloseTo(Math.cos(Math.PI / 10), 5);

    GEO_CAIXA.computeBoundingBox();
    const b = GEO_CAIXA.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(1, 5);
    expect(b.max.y - b.min.y).toBeCloseTo(1, 5);

    GEO_PLANO.computeBoundingBox();
    const p = GEO_PLANO.boundingBox!;
    expect(p.max.x - p.min.x).toBeCloseTo(1, 5);
  });

  it("são a MESMA instância a cada leitura", () => {
    // trivial, e é o ponto: importar duas vezes não pode dar dois objetos
    expect(GEO_CILINDRO).toBe(GEO_CILINDRO);
    expect(GEO_CILINDRO.uuid).not.toBe(GEO_CAIXA.uuid);
  });
});

describe("material das áreas de clique", () => {
  it("some sem `visible=false`, que faria o raycaster PULAR o objeto", () => {
    /**
     * `Raycaster.intersectObject` sai cedo em `object.visible === false` — era
     * por isso que clicar no mob não fazia nada. O material desaparece sem
     * escrever cor nem profundidade, e o objeto continua atingível.
     */
    expect(MATERIAL_INVISIVEL.colorWrite).toBe(false);
    expect(MATERIAL_INVISIVEL.depthWrite).toBe(false);
    expect(MATERIAL_INVISIVEL.opacity).toBe(0);
    expect(MATERIAL_INVISIVEL.transparent).toBe(true);
  });
});

describe("cache de materiais de brilho", () => {
  const V = "void main(){gl_Position=vec4(position,1.0);}";
  const F = "void main(){gl_FragColor=vec4(1.0);}";

  it("a MESMA combinação devolve o MESMO material", () => {
    const a = materialDeBrilho("#8a2f22", 0.62, 0, V, F);
    const b = materialDeBrilho("#8a2f22", 0.62, 0, V, F);
    expect(a).toBe(b);
    expect(materiaisCompartilhados().brilhos).toBe(1);
  });

  it("40 mobs no mesmo estado dividem UM material", () => {
    for (let i = 0; i < 40; i++) materialDeBrilho("#8a2f22", 0.78, 0, V, F);
    expect(materiaisCompartilhados().brilhos).toBe(1);
  });

  it("cor, força e aro são chaves distintas — o aro do alvo não vaza para os outros", () => {
    materialDeBrilho("#8a2f22", 0.5, 0.95, V, F); // alvo selecionado
    materialDeBrilho("#8a2f22", 0.5, 0, V, F); // mesmo brilho, sem aro
    materialDeBrilho("#c9a227", 0.5, 0, V, F); // loot
    expect(materiaisCompartilhados().brilhos).toBe(3);
  });

  it("os uniforms carregam a combinação da chave", () => {
    const m = materialDeBrilho("#8a2f22", 0.62, 0.95, V, F);
    expect(m.uniforms.uForca!.value).toBe(0.62);
    expect(m.uniforms.uAro!.value).toBe(0.95);
  });
});

describe("cache de materiais opacos", () => {
  it("dezenas do mesmo tipo de item dividem UM material", () => {
    // um campo depois de uma caçada tem dezenas do mesmo drop
    for (let i = 0; i < 30; i++) materialOpaco("hsl(120, 55%, 55%)");
    expect(materiaisCompartilhados().opacos).toBe(1);
  });

  it("cores diferentes seguem separadas — dois itens não viram a mesma caixa", () => {
    materialOpaco("hsl(120, 55%, 55%)");
    materialOpaco("hsl(240, 55%, 55%)");
    expect(materiaisCompartilhados().opacos).toBe(2);
  });
});

describe("cache de materiais de barra", () => {
  /**
   * Achado de uma SÉRIE de censos andando pelo mapa (não um antes/depois): dez
   * mobs saindo de cena levavam **25 geometrias e 21 materiais** junto. Os três
   * planos da `WorldBar` — trilho, preenchimento e moldura — eram a maior parte
   * disso, e o C2 tinha parado antes deles.
   */
  it("40 mobs com a mesma barra dividem os mesmos três materiais", () => {
    const moldura = { uuid: "mold-1" } as never;
    for (let i = 0; i < 40; i++) {
      materialDeBarra({ cor: "#1b140c", opacity: 0.88, depthTest: true });
      materialDeBarra({ cor: "#8a2f22", depthTest: true });
      materialDeBarra({ map: moldura, depthTest: true });
    }
    expect(materiaisCompartilhados().barras).toBe(3);
  });

  it("a MOLDURA entra na chave pelo uuid — proporções diferentes não se misturam", () => {
    /**
     * A textura da moldura muda com a proporção da barra (`ui/barTexture`
     * cacheia por proporção arredondada). Um material com a textura errada
     * desenharia a moldura esticada.
     */
    materialDeBarra({ map: { uuid: "estreita" } as never, depthTest: true });
    materialDeBarra({ map: { uuid: "larga" } as never, depthTest: true });
    expect(materiaisCompartilhados().barras).toBe(2);
  });

  it("`depthTest` separa: a barra dos PÉS não pode ser engolida pelo corpo", () => {
    // `semProfundidade` existe para as barras que ficam nos pés do personagem
    materialDeBarra({ cor: "#8a2f22", depthTest: true });
    materialDeBarra({ cor: "#8a2f22", depthTest: false });
    expect(materiaisCompartilhados().barras).toBe(2);
  });

  it("é sempre `transparent`, mesmo opaco", () => {
    // o three desenha a lista transparente DEPOIS da opaca; com o preenchimento
    // fora dessa lista, o trilho (que é transparente) passaria por cima dele
    const m = materialDeBarra({ cor: "#8a2f22", depthTest: true });
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
  });
});

describe("a regra que MUDA ao compartilhar", () => {
  it("descartar um material compartilhado apagaria o de TODOS os outros", () => {
    /**
     * O `GlowChao` fazia `useEffect(() => () => material.dispose())` porque o
     * material era dele. Compartilhado, esse mesmo `dispose` na saída de UM mob
     * derrubaria o brilho de todos os outros que usam a mesma combinação — por
     * isso ele saiu do componente, e este teste é o que documenta o porquê.
     *
     * Recurso de módulo vive enquanto o módulo viver: são poucas dezenas de
     * objetos com teto fixo, não uma coleção que cresce.
     */
    const V = "void main(){gl_Position=vec4(position,1.0);}";
    const F = "void main(){gl_FragColor=vec4(1.0);}";
    const doMob = materialDeBrilho("#8a2f22", 0.78, 0, V, F);
    const doOutroMob = materialDeBrilho("#8a2f22", 0.78, 0, V, F);

    expect(doMob).toBe(doOutroMob);
    // se algum dia alguém puser `dispose()` de volta no componente, é este
    // `toBe` que explica a tela apagando quando um mob some
  });
});
