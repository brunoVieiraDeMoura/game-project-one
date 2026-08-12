import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import type { GameMap, MapProp } from "@ragnarok/map-format";
import { propCategory, propUrl } from "./registry";
import { compartilharTexturas } from "../gltfTexturas";
import { windCategoryFor, windMaterialFor } from "./wind";
import { registrarInstancias } from "./instancedPropRegistry";
import { registrarEvento } from "../core/diagnostics/flightRecorder";
import { isolado } from "../core/diagnostics/isolamento";

/**
 * VEGETAÇÃO INSTANCIADA — substitui "1 `Mesh` por prop" (`PropInstance.tsx`) por
 * "1 `InstancedMesh` por espécie/sub-malha" para as categorias repetitivas do
 * mapa (grama, flor, planta, arbusto, árvore, árvore seca).
 *
 * ## O problema que isto resolve (profiling `voo-1786552424164.json`)
 *
 * ~1815 props visíveis sustentavam ~1831 `Mesh` separados — praticamente 1:1 — e
 * 848-1157 draw calls. O culpado maior não era triângulo nem textura (os
 * quadros mais lentos do laudo tinham CONTAGEM NORMAL de triângulo): era CPU
 * montando/desmontando centenas de componentes React (cada um clonando um
 * `.gltf`) toda vez que o jogador cruzava uma fronteira de chunk/raio de
 * detalhe — o "rajadas de montagem" do diagnóstico.
 *
 * ## A ideia
 *
 * Por ESPÉCIE (`assetId`), não por prop: um `InstancedMesh` nasce UMA vez (no
 * carregamento do mapa) com capacidade = quantas vezes aquela espécie aparece no
 * mapa inteiro, e nunca é desmontado enquanto o mapa não trocar. Cruzar uma
 * fronteira de chunk não cria nem destrói nada — só REESCREVE quais slots
 * 0..count estão ativos, exatamente o mecanismo que `grid/TreeImpostors.tsx` já
 * usa pros impostores distantes (`_m.compose` + `setMatrixAt` + `mesh.count`,
 * recalculado só quando `center` muda, nunca por quadro). Aqui a condição é o
 * OPOSTO da do impostor: perto = instância real desenhada; longe = props somem
 * (a Fase de LOD decide se viram impostor ou desaparecem, não este módulo).
 *
 * ## Por que por SUB-MALHA, não por espécie inteira
 *
 * Um `.gltf` de árvore comum tem casca e folha como MALHAS separadas (materiais
 * diferentes — conferido no catálogo Quaternius: `Bark_NormalTree` +
 * `Leaves_NormalTree`) — um `InstancedMesh` só aceita UMA geometria + UM
 * material. `bakeSpeciesParts` percorre o `.gltf` da espécie (via o MESMO
 * `useGLTF` cacheado que `PropInstance`/`preloadPropsDoMapa` já usam) e devolve
 * uma entrada por malha encontrada, com a transform LOCAL do nó já cozida na
 * geometria (`geometry.applyMatrix4(mesh.matrixWorld)`) — assim o
 * `instanceMatrix` de cada prop só precisa carregar posição/rotação/escala do
 * MUNDO, igual `PropInstance` já fazia via `<primitive position rotation
 * scale>`.
 *
 * ## Vento e sombra
 *
 * `windMaterialFor` já cacheia por MATERIAL BASE (uma vez por espécie, não por
 * instância) — reaproveitado aqui sem mudança de API; a correção necessária foi
 * só em `props/wind.ts` (hash de fase por `instanceMatrix`, ver o comentário
 * lá). Sombra é ligada/desligada por CATEGORIA (`CAST_SHADOW_BY_CATEGORY`):
 * grama/flor/planta não projetam — a lâmina é fina demais pra sombra ser
 * perceptível num shadow map de 1024px/55 unidades, e cortar isso tira um
 * passe de profundidade por instância sem custo visual.
 *
 * ## Clique
 *
 * `registrarInstancias` grava, por `InstancedMesh`, a lista de `MapProp` na
 * MESMA ordem dos slots escritos — é o que permite `play/pickGround.ts`
 * resolver "qual árvore foi clicada" a partir do `instanceId` que o raycast
 * devolve, sem precisar de um `Object3D` por prop (ver `baseDoPropInstanciado`).
 */

/** categorias que este módulo assume — grama/decoração rasteira + as sólidas com hull */
export const CATEGORIAS_INSTANCIAVEIS = new Set(["grass", "flower", "plant", "bush", "tree", "tree_bare"]);

/** grama/flor/planta não projetam sombra — a folhagem é fina demais pra valer o passe extra */
const SEM_SOMBRA_PROPRIA = new Set(["grass", "flower", "plant"]);

/**
 * LOD de vegetação RASTEIRA (Fase 2 da otimização de renderização): grama,
 * flor e planta somem num raio MENOR que o raio de detalhe normal, em vez de
 * ficarem visíveis até a borda dele.
 *
 * Não ganham billboard/impostor como árvore e arbusto — o detalhe de uma
 * lâmina de grama já é imperceptível bem antes do raio de detalhe acabar
 * (ela é rasteira, cobre poucos pixels de tela a qualquer distância média), e
 * inventar um segundo atlas só pra economia marginal violaria a regra de "não
 * duplicar arquitetura por otimização pequena". É só um raio de corte mais
 * curto pro MESMO InstancedMesh que já existe.
 */
const CATEGORIAS_RASTEIRAS = new Set(["grass", "flower", "plant"]);
/** fração do raio de detalhe em que a vegetação rasteira já pode sumir */
const RAIO_RASTEIRA_FRAC = 0.6;

export function ehCategoriaInstanciavel(assetId: string): boolean {
  const cat = propCategory(assetId);
  return !!cat && CATEGORIAS_INSTANCIAVEIS.has(cat);
}

interface InstanciaVegetacao {
  prop: MapProp;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

/** agrupa `map.props` das categorias instanciáveis por espécie (`assetId`) — pura, testável */
export function agruparPorEspecie(props: readonly MapProp[]): Map<string, InstanciaVegetacao[]> {
  const porEspecie = new Map<string, InstanciaVegetacao[]>();
  const euler = new THREE.Euler();
  for (const prop of props) {
    if (!ehCategoriaInstanciavel(prop.assetId)) continue;
    if (!propUrl(prop.assetId)) continue; // assetId desconhecido — mesma regra silenciosa do PropInstance
    const lista = porEspecie.get(prop.assetId) ?? [];
    euler.set(prop.rotation[0], prop.rotation[1], prop.rotation[2]);
    lista.push({
      prop,
      position: new THREE.Vector3(prop.position[0], prop.position[1], prop.position[2]),
      quaternion: new THREE.Quaternion().setFromEuler(euler),
      scale: new THREE.Vector3(prop.scale[0], prop.scale[1], prop.scale[2]),
    });
    porEspecie.set(prop.assetId, lista);
  }
  return porEspecie;
}

/** espécies (assetId único → url) das categorias instanciáveis presentes no mapa */
export function especiesDoMapa(props: readonly MapProp[]): { assetId: string; url: string }[] {
  const vistas = new Set<string>();
  const out: { assetId: string; url: string }[] = [];
  for (const prop of props) {
    if (!ehCategoriaInstanciavel(prop.assetId) || vistas.has(prop.assetId)) continue;
    const url = propUrl(prop.assetId);
    if (!url) continue;
    vistas.add(prop.assetId);
    out.push({ assetId: prop.assetId, url });
  }
  return out.sort((a, b) => a.assetId.localeCompare(b.assetId));
}

interface ParteEspecie {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

interface GltfMinimoComCena {
  scene: THREE.Object3D;
  parser?: unknown;
}

/**
 * Extrai, de UMA vez por espécie, cada sub-malha (geometria + material) com a
 * transform local do nó já cozida na geometria — cacheado por URL (o mesmo
 * `.gltf` nunca precisa ser rebakeado, mesmo que o mapa troque e volte).
 */
const cacheDePartes = new Map<string, ParteEspecie[]>();

function bakeSpeciesParts(url: string, gltf: GltfMinimoComCena): ParteEspecie[] {
  const cache = cacheDePartes.get(url);
  if (cache) return cache;
  // ANTES de qualquer leitura de geometria — mesma ordem que PropInstance usa
  compartilharTexturas(gltf as never);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const partes: ParteEspecie[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh & { isMesh?: boolean };
    if (!m.isMesh) return;
    const geo = m.geometry.clone();
    // cozinha a transform do NÓ (posição/rotação/escala dentro do próprio
    // .gltf) na geometria — sem isto, uma malha de folha deslocada do tronco
    // no arquivo original apareceria na ORIGEM do prop, colada no chão
    geo.applyMatrix4(m.matrixWorld);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (mat) partes.push({ geometry: geo, material: mat });
  });
  cacheDePartes.set(url, partes);
  return partes;
}

interface CamadaInstanciada {
  assetId: string;
  category: string;
  instancias: InstanciaVegetacao[];
  partes: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
}

const _m = new THREE.Matrix4();

function CamadaDeEspecie({
  camada,
  center,
  radius,
}: {
  camada: CamadaInstanciada;
  center: { x: number; z: number };
  radius: number;
}) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const primeira = useRef(true);
  const castShadow = !SEM_SOMBRA_PROPRIA.has(camada.category);
  const raioEfetivo = CATEGORIAS_RASTEIRAS.has(camada.category) ? radius * RAIO_RASTEIRA_FRAC : radius;

  useEffect(() => {
    const meshes = refs.current;
    const r2 = raioEfetivo * raioEfetivo;
    const ativos: MapProp[] = [];
    let n = 0;
    for (const inst of camada.instancias) {
      const dx = inst.position.x - center.x;
      const dz = inst.position.z - center.z;
      if (dx * dx + dz * dz > r2) continue;
      _m.compose(inst.position, inst.quaternion, inst.scale);
      for (const mesh of meshes) mesh?.setMatrixAt(n, _m);
      ativos.push(inst.prop);
      n++;
    }
    for (const mesh of meshes) {
      if (!mesh) continue;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      // registra SEMPRE, mesmo com n=0 — uma malha sem instância ativa não
      // pode continuar respondendo por props antigos no clique
      registrarInstancias(mesh, ativos);
    }
    if (primeira.current) {
      registrarEvento("cena", "vegetacaoInstanciada:create", {
        especie: camada.assetId,
        capacidade: camada.instancias.length,
        visiveis: n,
      });
      primeira.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camada, center.x, center.z, radius]);

  return (
    <>
      {camada.partes.map((parte, i) => (
        <instancedMesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          args={[parte.geometry, parte.material, camada.instancias.length]}
          // a caixa envolvente por instância não é recalculada aqui — o raio de
          // detalhe já é o culling que importa (mesmo raciocínio do HorizonMesh/
          // TreeImpostors: cortar por frustum a mais não paga o custo de manter
          // a caixa em dia a cada reescrita)
          frustumCulled={false}
          castShadow={castShadow}
          receiveShadow
          name={`vegetacao:${camada.assetId}`}
        />
      ))}
    </>
  );
}

export function VegetationInstancer({
  map,
  center,
  radius,
}: {
  map: GameMap;
  center: { x: number; z: number };
  radius: number;
}) {
  const porEspecie = useMemo(() => agruparPorEspecie(map.props), [map]);
  const especies = useMemo(() => especiesDoMapa(map.props), [map]);
  const urls = useMemo(() => especies.map((e) => e.url), [especies]);

  // suspende até TODAS as espécies carregarem — elas já vêm pré-carregadas por
  // `preloadPropsDoMapa` (chamado no boot do mapa), então na prática isto
  // resolve na hora; o `<Suspense>` em PlayView é a rede de segurança
  const gltfs = useGLTF(urls) as unknown as GltfMinimoComCena[];

  const camadas = useMemo<CamadaInstanciada[]>(() => {
    const out: CamadaInstanciada[] = [];
    for (let i = 0; i < especies.length; i++) {
      const { assetId } = especies[i]!;
      const instancias = porEspecie.get(assetId);
      if (!instancias || instancias.length === 0) continue;
      const gltf = gltfs[i];
      if (!gltf) continue;
      const partesCruas = bakeSpeciesParts(especies[i]!.url, gltf);
      const category = propCategory(assetId) ?? "";
      const windCat = windCategoryFor(category);
      const partes = partesCruas.map((p) => ({
        geometry: p.geometry,
        material: windCat && !isolado("semVento") ? windMaterialFor(p.material, p.geometry, assetId, windCat) : p.material,
      }));
      out.push({ assetId, category, instancias, partes });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [especies, gltfs, porEspecie]);

  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  /**
   * Pré-compila a variante INSTANCIADA do material — o pré-aquecimento que
   * já existia pros props NÃO instanciados (`play/PreCompilarProps.tsx`) e
   * pra entidade (`assets.ts`, "Fase E2") não cobre isto: `USE_INSTANCING`
   * entra na CHAVE DE CACHE do programa GPU (`WebGLPrograms.
   * getProgramCacheKeyBooleans`), então o material já compilado por aqueles
   * dois É UM PROGRAMA DIFERENTE do que este `InstancedMesh` precisa —
   * mesmo com `windMaterialFor` cacheando o MESMO objeto de material por
   * espécie (`props/wind.ts`), o three ainda linka um binário de shader
   * novo na primeira vez que ELE é desenhado como instanciado.
   *
   * Sem isto, a primeira espécie que entra no raio de detalhe longe do
   * spawn (o jogador anda até lá antes do `VegetationInstancer` ter
   * desenhado aquela espécie alguma vez) paga o link do programa em pleno
   * gameplay — o mesmo defeito que a Fase E2 documentou para entidade,
   * agora para vegetação instanciada. `compileAsync` usa `traverseVisible`
   * (não filtra por `count`), então cobre TODAS as espécies do mapa de uma
   * vez, mesmo as que ainda não têm nenhuma instância ativa.
   */
  useEffect(() => {
    if (camadas.length === 0) return;
    let vivo = true;
    const t0 = performance.now();
    const id = requestAnimationFrame(() => {
      if (!vivo) return;
      const pronto = gl.compileAsync ? gl.compileAsync(scene, camera) : (gl.compile(scene, camera), Promise.resolve());
      void Promise.resolve(pronto).then(() => {
        if (!vivo) return;
        registrarEvento("cena", "vegetacaoInstanciada:precompilou", {
          especies: camadas.length,
          ms: Math.round(performance.now() - t0),
          programas: gl.info.programs?.length ?? 0,
        });
      });
    });
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
    };
  }, [gl, camera, scene, camadas]);

  if (isolado("semProps")) return null;

  return (
    <>
      {camadas.map((camada) => (
        <CamadaDeEspecie key={camada.assetId} camada={camada} center={center} radius={radius} />
      ))}
    </>
  );
}
