import { afterAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { descartarPersonagem, fundirSkinned } from "../entities/personagemGltf";
import { buildChunkGeometry, bytesDaGeometria, chunkCounts, CHUNK_CELLS } from "../grid/squareChunks";
import { melhorAlvo, type Candidato } from "../play/aimAssist";
import { calibrar, custoRelativo, imprimirRelatorio } from "./orcamento";
import type { GameMap } from "@ragnarok/map-format";

/**
 * ORÇAMENTO DE DESEMPENHO — o que custa POR ENTIDADE e o que custa POR MAPA.
 *
 * O `desempenho.test.ts` cuida do terreno; este cuida do que aparece e some o
 * tempo todo. A diferença importa: com `area_size: 60` e 271 mobs no
 * `prt_fild08`, entidade nascendo e morrendo é o evento MAIS FREQUENTE do jogo,
 * e foi ali que o vazamento de textura passou meses sem ser notado.
 *
 * Vale a mesma lição do arquivo irmão: as invariantes de CONTAGEM valem mais que
 * as de tempo. "Quantos esqueletos sobraram" não tem ruído de medição e aponta a
 * CAUSA; um cronômetro só mostra o sintoma.
 */

/**
 * Um personagem de mentira com a MESMA forma dos .glb do KayKit.
 *
 * Medido nos arquivos: 9 malhas skinadas, uma skin só, um material só (o
 * `Skeleton_Warrior` tem dois, por causa do `Glow` dos olhos), sem morph target
 * e com os mesmos atributos em todas. Reproduzir a forma aqui é o que permite
 * testar sem carregar .glb nem WebGL.
 */
function personagemFalso(materiais = 1, malhas = 9): THREE.Group {
  const raiz = new THREE.Group();
  const ossos = [new THREE.Bone(), new THREE.Bone()];
  ossos[0]!.add(ossos[1]!);
  raiz.add(ossos[0]!);
  const skeleton = new THREE.Skeleton(ossos);
  const mats = Array.from({ length: materiais }, () => new THREE.MeshStandardMaterial());

  for (let i = 0; i < malhas; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new THREE.SkinnedMesh(geo, mats[i % materiais]!);
    mesh.bind(skeleton, new THREE.Matrix4());
    raiz.add(mesh);
  }
  return raiz;
}

const contarSkinned = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((x) => {
    if ((x as THREE.SkinnedMesh).isSkinnedMesh) n++;
  });
  return n;
};

describe("personagem: fusão das malhas skinadas", () => {
  it("nove malhas de um material viram UMA", () => {
    /**
     * É a invariante que trava o custo por quadro. Cada SkinnedMesh é um draw
     * call E um upload de bone texture por quadro: com ~25 mobs à vista, nove
     * malhas por mob davam ~225 de cada, quando poderiam ser ~25.
     */
    const p = personagemFalso(1, 9);
    expect(contarSkinned(p)).toBe(9);
    fundirSkinned(p);
    expect(contarSkinned(p)).toBe(1);
  });

  it("material a mais é malha a mais — o Glow dos olhos não se funde no corpo", () => {
    const p = personagemFalso(2, 9);
    fundirSkinned(p);
    expect(contarSkinned(p)).toBe(2);
  });

  it("é idempotente: o StrictMode chama duas vezes e nada muda", () => {
    const p = personagemFalso(1, 9);
    fundirSkinned(p);
    fundirSkinned(p);
    expect(contarSkinned(p)).toBe(1);
  });

  it("NÃO funde o que não é seguro fundir", () => {
    // bindMatrix diferente = pose diferente; uma malha a mais custa um draw
    // call, uma fusão errada deforma o personagem
    const p = personagemFalso(1, 3);
    const malhas: THREE.SkinnedMesh[] = [];
    p.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) malhas.push(o as THREE.SkinnedMesh);
    });
    malhas[1]!.bindMatrix.makeTranslation(0, 5, 0);
    fundirSkinned(p);
    expect(contarSkinned(p)).toBe(3);
  });

  it("a fusão preserva o esqueleto e o total de vértices", () => {
    const p = personagemFalso(1, 9);
    let skeletonOriginal: THREE.Skeleton | null = null;
    p.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && !skeletonOriginal) skeletonOriginal = m.skeleton;
    });
    fundirSkinned(p);
    let fundida: THREE.SkinnedMesh | null = null;
    p.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) fundida = m;
    });
    expect(fundida).not.toBeNull();
    const m = fundida as unknown as THREE.SkinnedMesh;
    expect(m.skeleton).toBe(skeletonOriginal);
    // 9 malhas × 3 vértices
    expect(m.geometry.getAttribute("position").count).toBe(27);
  });
});

describe("personagem: o que o clone aloca volta ao descartar", () => {
  it("cada SkinnedMesh clonado tem esqueleto PRÓPRIO — é daí que vem o vazamento", () => {
    /**
     * `SkeletonUtils.clone` faz `clonedMesh.skeleton = sourceMesh.skeleton.clone()`,
     * e cada `Skeleton` aloca um `boneTexture` na primeira vez que é desenhado.
     * Este teste existe para o dia em que alguém achar que o clone compartilha o
     * esqueleto do original e tirar o descarte.
     */
    const original = personagemFalso(1, 3);
    const clone = cloneSkinned(original) as THREE.Group;
    const skelsOriginais = new Set<THREE.Skeleton>();
    const skelsClone = new Set<THREE.Skeleton>();
    original.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) skelsOriginais.add(m.skeleton);
    });
    clone.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) skelsClone.add(m.skeleton);
    });
    for (const s of skelsClone) expect(skelsOriginais.has(s)).toBe(false);
  });

  it("descartar libera UM esqueleto por malha skinada", () => {
    const espia = vi.spyOn(THREE.Skeleton.prototype, "dispose");
    const clone = cloneSkinned(personagemFalso(1, 9)) as THREE.Group;
    const liberados = descartarPersonagem(clone);
    expect(liberados).toBe(9);
    expect(espia).toHaveBeenCalledTimes(9);
    espia.mockRestore();
  });

  it("depois de fundir, o descarte tem UM esqueleto para liberar", () => {
    const base = personagemFalso(1, 9);
    fundirSkinned(base);
    const clone = cloneSkinned(base) as THREE.Group;
    expect(descartarPersonagem(clone)).toBe(1);
  });

  it("descartar e voltar a animar — o ciclo que o StrictMode faz em todo mount", () => {
    /**
     * REGRESSÃO. O descarte roda no cleanup de um `useEffect`, e no dev o
     * StrictMode desmonta e remonta todo efeito — mas `scene`, `mixer` e
     * `actions` vêm de `useMemo` cuja dependência NÃO mudou, então eles
     * SOBREVIVEM à limpeza e o efeito seguinte volta a tocar o idle.
     *
     * A primeira versão do descarte chamava `mixer.uncacheRoot(scene)` junto.
     * Isso apaga as ligações daquele root e deixa as actions órfãs: o
     * `play()` seguinte estourava em `_lendBinding` ("Cannot set properties of
     * undefined (setting '_cacheIndex')") e derrubava o `<Canvas>` inteiro.
     *
     * A regra que este teste trava: **o descarte tem de ser reversível**. Tudo
     * o que ele destrói, ou o three reconstrói sozinho (o `boneTexture`), ou não
     * pode ser destruído aqui.
     */
    const raiz = cloneSkinned(personagemFalso(1, 3)) as THREE.Group;
    const mixer = new THREE.AnimationMixer(raiz);
    const clip = new THREE.AnimationClip("Idle_A", 1, [
      new THREE.VectorKeyframeTrack(`${raiz.children[0]!.name || raiz.children[0]!.uuid}.position`, [0, 1], [0, 0, 0, 0, 1, 0]),
    ]);
    const action = mixer.clipAction(clip);

    action.reset().play();
    mixer.update(0.016);

    // o ciclo do StrictMode: limpa…
    mixer.stopAllAction();
    descartarPersonagem(raiz);

    // …e o efeito remonta sobre os MESMOS objetos
    expect(() => {
      action.reset().fadeIn(0.2).play();
      mixer.update(0.016);
    }).not.toThrow();

    // descartar duas vezes é o caso normal (limpeza simulada + desmonte real)
    expect(() => descartarPersonagem(raiz)).not.toThrow();
  });

  it("descartar NÃO toca em geometria nem material — eles são do cache do useGLTF", () => {
    /**
     * A regra que protege as outras entidades da tela: `useGLTF` cacheia por
     * url, e o `SkeletonUtils.clone` compartilha geometria e material com o
     * original. Descartá-los ao sumir um mob apagaria todos os outros.
     */
    const clone = cloneSkinned(personagemFalso(1, 3)) as THREE.Group;
    const geo = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const mat = vi.spyOn(THREE.Material.prototype, "dispose");
    descartarPersonagem(clone);
    expect(geo).not.toHaveBeenCalled();
    expect(mat).not.toHaveBeenCalled();
    geo.mockRestore();
    mat.mockRestore();
  });
});

// ---------------------------------------------------------------------------

const W = 128;
const H = 128;

function mapaPlano(): GameMap {
  const n = W * H;
  return {
    id: "perf-plano",
    name: "perf-plano",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
  } as unknown as GameMap;
}

describe("pré-carga do mapa inteiro", () => {
  const map = mapaPlano();
  const calibracao = calibrar();
  afterAll(imprimirRelatorio);

  it("a projeção de memória bate com a geometria de verdade", () => {
    /**
     * É este número que decide se o mapa inteiro pode ser construído de uma vez
     * ou se o streaming continua. Um mapa plano de 400×400 dá ~35 MB e cabe
     * folgado; o mesmo mapa cheio de relevo emite muito mais vértice e a conta
     * passa de 170 MB — construir tudo ali trocaria um engasgo por falta de
     * memória. Se `bytesDaGeometria` deixar de somar um atributo novo, o teto
     * passa a mentir para menos, e é isso que este teste pega.
     */
    const geo = buildChunkGeometry(map, 1, 1);
    const bytes = bytesDaGeometria(geo);

    // soma independente: cada atributo pelo seu próprio tamanho de elemento
    let esperado = 0;
    for (const attr of Object.values(geo.attributes)) {
      const a = attr as THREE.BufferAttribute;
      esperado += a.count * a.itemSize * (a.array as Float32Array).BYTES_PER_ELEMENT;
    }
    const idx = geo.getIndex()!;
    esperado += idx.count * (idx.array as Uint16Array).BYTES_PER_ELEMENT;
    expect(bytes).toBe(esperado);

    // um chunk plano é 32×32 quads × 4 vértices, sem saia
    expect(geo.getAttribute("position").count).toBe(CHUNK_CELLS * CHUNK_CELLS * 4);
    // e cabe na ordem de grandeza que motivou a pré-carga (~204 KB por chunk)
    expect(bytes).toBeGreaterThan(150 * 1024);
    expect(bytes).toBeLessThan(300 * 1024);
    geo.dispose();
  });

  it("o mapa inteiro cabe no orçamento de tempo de uma tela de carregamento", () => {
    /**
     * A pré-carga só é uma boa ideia enquanto couber em torno de meio segundo.
     * Medido no `prt_fild08`: 169 chunks × ~2,7 ms ≈ 450 ms. Este teste mede um
     * chunk e multiplica pelo total — se o custo por chunk dobrar, o número
     * aparece aqui antes de virar uma tela de carregamento de dois segundos.
     */
    const { cols, rows } = chunkCounts(map);
    const custo = custoRelativo("chunk (mapa plano)", calibracao, 12, () => {
      buildChunkGeometry(map, 1, 1).dispose();
    });
    // o chunk plano é o caso BARATO (sem água, sem saia): medido ~1,0 da
    // calibração, teto com folga de ~3×
    expect(custo).toBeLessThan(3);
    expect(cols * rows).toBeGreaterThan(4);
  });
});

/**
 * A ASSISTÊNCIA DE MIRA roda por QUADRO, e projeta um vetor por candidato.
 *
 * É a única parte do Smart Target com custo recorrente: enquanto a pontuação é
 * aritmética, a projeção multiplica duas matrizes por alvo. Com `area_size: 60`
 * o servidor anuncia dezenas de mobs ao mesmo tempo, e todos entram na lista.
 *
 * Este teste não afirma "é rápido" — afirma que continua sendo o trabalho de um
 * punhado de multiplicações de matriz. Se alguém puser um raycast ou uma
 * varredura do mapa dentro do laço, o número salta aqui.
 */
describe("assistência de mira: escolher o alvo por quadro", () => {
  const calibracao = calibrar();
  afterAll(imprimirRelatorio);

  /** a câmera do /play: perspectiva, inclinada, olhando o personagem */
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
  camera.position.set(0, 60, 60);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  /** 40 mobs espalhados no campo de visão, como num campo cheio */
  const alvos = Array.from({ length: 40 }, (_, i) => ({
    gid: i + 1,
    x: Math.cos(i) * (10 + i),
    z: Math.sin(i) * (10 + i),
  }));

  it("projetar e pontuar 40 candidatos custa uma fração da calibração", () => {
    const scratch = new THREE.Vector3();
    const ponto = { px: 640, py: 360 };
    const tela = { width: 1280, height: 720 };

    const custo = custoRelativo("mira: 40 candidatos", calibracao, 40, () => {
      const cands: Candidato[] = [];
      for (const a of alvos) {
        scratch.set(a.x, 0, a.z);
        const dx = a.x - camera.position.x;
        const dz = a.z - camera.position.z;
        const visivel = dx * dx + dz * dz <= 120 * 120;
        scratch.project(camera);
        cands.push({
          gid: a.gid,
          px: (scratch.x * 0.5 + 0.5) * tela.width,
          py: (-scratch.y * 0.5 + 0.5) * tela.height,
          naTela: scratch.z >= -1 && scratch.z <= 1 && Math.abs(scratch.x) <= 1 && Math.abs(scratch.y) <= 1,
          visivel,
          distanciaDoJogador: Math.hypot(a.x, a.z) / 2,
          atacando: false,
        });
      }
      melhorAlvo(ponto, cands);
    });

    /**
     * O teto é folgado de propósito: o valor medido é tão pequeno que o ruído de
     * medição domina, e o que interessa aqui é pegar a mudança de NATUREZA (um
     * raycast, uma varredura do mapa), não o terceiro decimal.
     */
    expect(custo).toBeLessThan(0.05);
  });
});
