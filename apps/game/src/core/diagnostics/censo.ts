import type * as THREE from "three";

/**
 * CENSO DO GRAFO DE CENA — quantos objetos, quantos recursos ÚNICOS.
 *
 * ## A pergunta que ele responde
 *
 * "200 árvores iguais viram 200 GLBs, 200 geometrias e 200 materiais?" A
 * resposta não se dá lendo código: dá-se contando. E o número que importa não é
 * o total nem o único isolado — é a RAZÃO entre os dois. 278 malhas de prop
 * sobre 50 geometrias únicas é 5,6× de reúso; sobre 278, seria zero.
 *
 * ## Por que uma varredura sob demanda, e não uma coluna por quadro
 *
 * O grafo do `prt_fild08` passa de mil `Object3D`, e percorrer tudo a 60 Hz
 * seria o medidor pagando o custo que ele existe para acusar — a mesma regra que
 * já limita o `objetosRender` do `cenaProbe` a 10 Hz. Aqui é UMA passada, quando
 * alguém pede.
 *
 * ## O que ele NÃO é
 *
 * Os dois números de memória são **estimativa declarada**, não medição. Não há
 * API padrão de memória de GPU na web (a `GMAN_webgl_memory` não existe nesta
 * máquina — `memoriaGpuMb` saiu `null` em todos os dumps). O que se soma aqui é
 * o que o grafo DECLARA: bytes de atributo de geometria e pixels de textura.
 * Ficam de fora o overhead do driver, os render targets, o mapa de sombra e
 * qualquer compressão interna. Vender isso como medida seria repetir o erro dos
 * "8 ms de criação de contexto".
 */

export interface CensoDeRecurso {
  /** quantas VEZES o recurso é referenciado por um objeto da cena */
  referencias: number;
  /** quantos objetos DISTINTOS (por `uuid`) estão por trás dessas referências */
  unicos: number;
  /** `referencias / unicos` — 1,0 significa nenhum reúso */
  reuso: number;
}

export interface Censo {
  /** todo `Object3D` do grafo, inclusive grupos, luzes e câmeras */
  object3d: number;
  mesh: number;
  instancedMesh: number;
  /** soma dos `count` — sem isto "3 InstancedMesh" esconde se são 3 ou 3.000 peças */
  instancias: number;
  skinnedMesh: number;
  points: number;
  line: number;
  sprite: number;
  luzes: number;
  cameras: number;
  /** malhas VISÍVEIS com geometria — comparável ao `objetosRender` do quadro */
  renderizaveis: number;
  esqueletos: CensoDeRecurso;
  materiais: CensoDeRecurso;
  geometrias: CensoDeRecurso;
  texturas: CensoDeRecurso;
  /** ESTIMATIVA — ver o cabeçalho do módulo */
  memoria: {
    geometriasMb: number;
    texturasMb: number;
    totalMb: number;
    /** o que a conta exclui, para o número não ser lido como medição */
    exclui: string;
  };
  /** os maiores consumidores, para saber onde olhar primeiro */
  maioresGeometrias: { nome: string; mb: number }[];
  maioresTexturas: { nome: string; mb: number; tamanho: string }[];
  /**
   * A MESMA IMAGEM carregada como vários objetos `Texture`.
   *
   * É o desperdício que a lista de "maiores texturas" só insinua: oito linhas
   * com o mesmo nome são oito `uuid` diferentes apontando para o mesmo arquivo.
   * Aqui o agrupamento é pela FONTE da imagem, então o número sai pronto em vez
   * de exigir que alguém divida o total pelo tamanho de uma.
   *
   * Medido no `prt_fild08`: `forest_texture.png` tem 48 KB em disco, é
   * 1024×1024 e é referenciado por **101 dos 105 `.gltf`** do pacote Forest.
   * Cada `.gltf` é um documento à parte, então o `GLTFLoader` cria um `Texture`
   * NOVO por arquivo — e o cache do drei é por url do gltf, não da imagem, e
   * por isso nunca enxerga que são a mesma.
   */
  texturasDuplicadas: { fonte: string; copias: number; mbCada: number; mbDesperdicado: number }[];
}

// ---------------------------------------------------------------- tipos frouxos

/**
 * O grafo é percorrido por DUCK TYPING, não por `instanceof`.
 *
 * `instanceof THREE.Mesh` obrigaria a importar three em tempo de execução só
 * para contar — e o teste, que roda em node sem WebGL, teria de construir
 * objetos three de verdade. As flags `isMesh`/`isSkinnedMesh` são a API pública
 * do próprio three para exatamente isto.
 */
interface No {
  uuid?: string;
  name?: string;
  type?: string;
  visible?: boolean;
  children?: No[];
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isSkinnedMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  isLight?: boolean;
  isCamera?: boolean;
  count?: number;
  skeleton?: { uuid?: string };
  geometry?: Geo;
  material?: Mat | Mat[];
}

interface Geo {
  uuid?: string;
  name?: string;
  attributes?: Record<string, { count?: number; itemSize?: number; array?: { BYTES_PER_ELEMENT?: number } }>;
  index?: { count?: number; array?: { BYTES_PER_ELEMENT?: number } } | null;
}

interface Tex {
  uuid?: string;
  name?: string;
  /**
   * `src` é a URL resolvida da imagem, e é ela que identifica DUPLICATA.
   *
   * Num `.gltf` com imagem externa o three guarda um `HTMLImageElement` e o
   * `src` é o caminho do arquivo — dois `Texture` com o mesmo `src` são a mesma
   * imagem em dobro. Num `.glb` com imagem embutida o `src` é um blob diferente
   * a cada carga, e aí a duplicata não é detectável por aqui: cai no `name`,
   * que é pista e não prova. O pacote Forest usa `.gltf` externo, que é o caso
   * que interessa.
   */
  image?: { width?: number; height?: number; src?: string };
  generateMipmaps?: boolean;
}

interface Mat {
  uuid?: string;
  name?: string;
  uniforms?: Record<string, { value?: unknown }>;
  [k: string]: unknown;
}

// ---------------------------------------------------------------- bytes

/**
 * Bytes dos atributos de uma geometria.
 *
 * Mesma conta do `bytesDaGeometria` de `grid/squareChunks.ts`, reescrita aqui
 * sobre o tipo frouxo porque aquela exige um `THREE.BufferGeometry` de verdade —
 * e este módulo tem de rodar num grafo de mentira, no vitest.
 */
export function bytesDeGeometria(geo: Geo): number {
  let total = 0;
  for (const attr of Object.values(geo.attributes ?? {})) {
    const bpe = attr?.array?.BYTES_PER_ELEMENT ?? 4;
    total += (attr?.count ?? 0) * (attr?.itemSize ?? 0) * bpe;
  }
  const idx = geo.index;
  if (idx) total += (idx.count ?? 0) * (idx.array?.BYTES_PER_ELEMENT ?? 2);
  return total;
}

/**
 * Bytes de uma textura, assumindo RGBA8.
 *
 * O `× 1,33` do mipmap é a soma da série geométrica 1 + ¼ + 1/16 + … — é
 * exatamente o que a cadeia completa de mips acrescenta. Textura sem mipmap não
 * paga isso.
 */
export function bytesDeTextura(tex: Tex): number {
  const w = tex.image?.width ?? 0;
  const h = tex.image?.height ?? 0;
  if (!w || !h) return 0;
  const base = w * h * 4;
  return tex.generateMipmaps === false ? base : Math.round(base * 4 / 3);
}

/** todos os slots de textura de um material, incluindo os `uniforms` de shader */
function texturasDe(mat: Mat): Tex[] {
  const fora: Tex[] = [];
  const talvez = (v: unknown) => {
    const t = v as Tex & { isTexture?: boolean };
    if (t && typeof t === "object" && (t as { isTexture?: boolean }).isTexture) fora.push(t);
  };
  // os slots nomeados do material (map, normalMap, emissiveMap, alphaMap…):
  // varrer as CHAVES pega todos sem precisar de uma lista que envelhece
  for (const v of Object.values(mat)) talvez(v);
  // `ShaderMaterial` guarda as texturas dentro dos uniforms, fora do alcance
  // do laço acima — e é ele que o terreno, a água e os VFX usam
  for (const u of Object.values(mat.uniforms ?? {})) talvez(u?.value);
  return fora;
}

function mb(bytes: number): number {
  return Math.round((bytes / 1048576) * 100) / 100;
}

// ---------------------------------------------------------------- censo

export function censoDaCena(raiz: No | null | undefined): Censo {
  const geos = new Map<string, Geo>();
  const mats = new Map<string, Mat>();
  const texs = new Map<string, Tex>();
  const esqs = new Set<string>();
  let refGeo = 0;
  let refMat = 0;
  let refTex = 0;
  let refEsq = 0;

  const c = {
    object3d: 0,
    mesh: 0,
    instancedMesh: 0,
    instancias: 0,
    skinnedMesh: 0,
    points: 0,
    line: 0,
    sprite: 0,
    luzes: 0,
    cameras: 0,
    renderizaveis: 0,
  };

  const andar = (o: No) => {
    c.object3d++;
    if (o.isInstancedMesh) {
      c.instancedMesh++;
      c.instancias += o.count ?? 0;
    } else if (o.isSkinnedMesh) c.skinnedMesh++;
    else if (o.isMesh) c.mesh++;
    if (o.isPoints) c.points++;
    if (o.isLine) c.line++;
    if (o.isSprite) c.sprite++;
    if (o.isLight) c.luzes++;
    if (o.isCamera) c.cameras++;

    const desenhavel = Boolean((o.isMesh || o.isPoints || o.isLine) && o.geometry);
    if (desenhavel && o.visible !== false) c.renderizaveis++;

    if (o.skeleton?.uuid) {
      refEsq++;
      esqs.add(o.skeleton.uuid);
    }
    if (o.geometry?.uuid) {
      refGeo++;
      if (!geos.has(o.geometry.uuid)) geos.set(o.geometry.uuid, o.geometry);
    }
    const lista = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of lista) {
      if (!m?.uuid) continue;
      refMat++;
      if (!mats.has(m.uuid)) mats.set(m.uuid, m);
      for (const t of texturasDe(m)) {
        if (!t.uuid) continue;
        refTex++;
        if (!texs.has(t.uuid)) texs.set(t.uuid, t);
      }
    }

    for (const f of o.children ?? []) andar(f);
  };
  if (raiz) andar(raiz);

  const recurso = (referencias: number, unicos: number): CensoDeRecurso => ({
    referencias,
    unicos,
    reuso: unicos > 0 ? Math.round((referencias / unicos) * 100) / 100 : 0,
  });

  let bytesGeo = 0;
  const porGeo: { nome: string; mb: number }[] = [];
  for (const g of geos.values()) {
    const b = bytesDeGeometria(g);
    bytesGeo += b;
    porGeo.push({ nome: g.name || "(sem nome)", mb: mb(b) });
  }
  let bytesTex = 0;
  const porTex: { nome: string; mb: number; tamanho: string }[] = [];
  /** agrupamento por FONTE da imagem — é o que prova a duplicata */
  const porFonte = new Map<string, { copias: number; bytes: number }>();
  for (const t of texs.values()) {
    const b = bytesDeTextura(t);
    bytesTex += b;
    porTex.push({
      nome: t.name || "(sem nome)",
      mb: mb(b),
      tamanho: `${t.image?.width ?? 0}x${t.image?.height ?? 0}`,
    });
    // sem `src` (imagem embutida) o nome é o melhor disponível — pista, não prova
    const fonte = t.image?.src || t.name;
    if (!fonte) continue;
    const g = porFonte.get(fonte) ?? { copias: 0, bytes: b };
    g.copias++;
    porFonte.set(fonte, g);
  }
  const duplicadas = [...porFonte.entries()]
    .filter(([, g]) => g.copias > 1)
    .map(([fonte, g]) => ({
      fonte,
      copias: g.copias,
      mbCada: mb(g.bytes),
      // o desperdício é tudo menos a primeira: uma cópia é legítima
      mbDesperdicado: mb(g.bytes * (g.copias - 1)),
    }))
    .sort((a, b) => b.mbDesperdicado - a.mbDesperdicado);

  return {
    ...c,
    esqueletos: recurso(refEsq, esqs.size),
    materiais: recurso(refMat, mats.size),
    geometrias: recurso(refGeo, geos.size),
    texturas: recurso(refTex, texs.size),
    memoria: {
      geometriasMb: mb(bytesGeo),
      texturasMb: mb(bytesTex),
      totalMb: mb(bytesGeo + bytesTex),
      exclui: "driver, render targets, mapa de sombra, compressão — ESTIMATIVA do que o grafo declara",
    },
    maioresGeometrias: porGeo.sort((a, b) => b.mb - a.mb).slice(0, 8),
    maioresTexturas: porTex.sort((a, b) => b.mb - a.mb).slice(0, 8),
    texturasDuplicadas: duplicadas,
  };
}

/**
 * O censo mais a CONFERÊNCIA CRUZADA contra o renderer.
 *
 * O censo conta o que está no GRAFO; `gl.info.memory` conta o que o renderer
 * tem carregado. Os dois divergirem é esperado — canvases de retrato, texturas
 * de UI e recurso pendente de descarte não estão na cena do jogo. A diferença é
 * ACHADO, não erro: um censo que bate exatamente com o renderer provavelmente
 * está contando o objeto errado.
 */
export function censoComRenderer(
  raiz: No | null | undefined,
  info?: { memory?: { geometries?: number; textures?: number }; programs?: unknown[] },
): Censo & { renderer: Record<string, number | string> } {
  const c = censoDaCena(raiz);
  const geoR = info?.memory?.geometries ?? 0;
  const texR = info?.memory?.textures ?? 0;
  return {
    ...c,
    renderer: {
      geometrias: geoR,
      texturas: texR,
      programas: info?.programs?.length ?? 0,
      geometriasForaDaCena: geoR - c.geometrias.unicos,
      texturasForaDaCena: texR - c.texturas.unicos,
      nota: "diferença = recurso do renderer que não está na cena do jogo (retratos, UI, pendente de descarte)",
    },
  };
}
