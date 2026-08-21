import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import type { GameMap, MapProp } from "@ragnarok/map-format";
import { propCategory, propUrl } from "./registry";
import { compartilharTexturas } from "../gltfTexturas";
import { windCategoryFor, windMaterialFor, resolveWindProfile } from "./wind";
import { treeMaterialFor } from "./treeRevealMaterial";
import { REVEAL_CONFIG, createRevealState, tickRevealFade, type RevealState, type RevealCandidate } from "./vegetationReveal";
import { registrarInstancias } from "./instancedPropRegistry";
import { registrarEvento } from "../core/diagnostics/flightRecorder";
import { isolado } from "../core/diagnostics/isolamento";
import { medir } from "../core/diagnostics/medir";
import { Y_DEPOSITO } from "../play/PreCompilarProps";

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

/**
 * categorias que este módulo assume — grama/decoração rasteira + as sólidas
 * com hull. `rock`/`stone` entraram na Fase de instancing de pedra
 * (`render-tecnic.txt` seção 22.9): mesmo padrão já provado pra árvore —
 * props REPETIDOS (catálogo tem 9 espécies de `rock`, 21 de `stone`) cresciam
 * draw call linear em `PropInstance` (1 `Mesh` por prop, seção 14/18) sem
 * motivo — nenhuma das duas precisa de identidade individual (ao contrário
 * de `building`/`hill`/`mountain`, que ficam de fora de propósito: são
 * landmark, não decoração repetida). Colisão não muda: `propCells.ts`/
 * `propBlockers.ts` já derivam bloqueio de `colliderType`/`isSolidProp`,
 * independente de a malha ser `InstancedMesh` ou `Mesh` — `tree` (hull)
 * prova isso há tempo. Vento não se aplica (`props/wind.ts` já exclui rock/
 * stone de propósito — pedra não balança).
 */
export const CATEGORIAS_INSTANCIAVEIS = new Set(["grass", "flower", "plant", "bush", "tree", "tree_bare", "rock", "stone"]);

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
 *
 * O RAIO em si (a fração) mora em `play/worldVisibility.ts`
 * (`vegetacaoRasteira`) desde a Fase de coerência de horizonte — é uma
 * decisão de VISIBILIDADE, do mesmo orçamento central que decide o teto do
 * impostor de árvore, não algo que este módulo de instancing deveria saber
 * calcular sozinho. Aqui só sobra a CATEGORIZAÇÃO (quem é rasteiro), que é
 * sobre a malha, não sobre distância.
 */
const CATEGORIAS_RASTEIRAS = new Set(["grass", "flower", "plant"]);

/**
 * Categorias que recebem REVELAÇÃO (fade de proximidade/corredor + copa) —
 * ver `vegetationReveal.ts`/`treeRevealMaterial.ts`. Só árvore por ora: são
 * as únicas com copa alta o bastante para esconder o personagem, e o
 * `canopyWeight` do shader só faz sentido para uma malha com tronco+copa.
 */
const CATEGORIAS_COM_REVELACAO = new Set(["tree", "tree_bare"]);

/**
 * DENSIDADE ADAPTATIVA DE VEGETAÇÃO RASTEIRA (`render-tecnic.txt` seção
 * 22.7/22.8, item 3 da fila de prioridade da seção 26): antes desta Fase, o
 * corte de grama/flor/planta era BINÁRIO — 100% de densidade até
 * `vegetacaoRasteira` (seção 23), depois nada. Uma lâmina de grama a 5
 * unidades do jogador e outra a 75% do raio de corte tinham a MESMA
 * contagem de instância por área, embora a segunda cubra muito menos pixel
 * de tela.
 *
 * `ANEIS_DENSIDADE_RASTEIRA` reduz a FRAÇÃO de instâncias ativas por anel de
 * distância, em vez de só cortar de vez na borda — os números do pedido
 * original (§14: "0–20m 100% / 20–40m 60% / 40–60m 25%") eram METROS
 * ABSOLUTOS; aqui são FRAÇÃO DO PRÓPRIO RAIO (`raioEfetivo`, que já é
 * `vegetacaoRasteira` = 60% de `detalhe`) — um admin que ajusta
 * `renderDistance` muda a ESCALA dos anéis junto, não a FORMA deles (mesma
 * razão de `worldVisibility.ts` já expressar tudo em fração/derivação, nunca
 * em metro fixo independente de config). O pedido original também deixa
 * explícito que os valores são exemplo, "calcular através de benchmark" —
 * sem mapa de produção com grama densa pra medir (mesma limitação
 * documentada nas seções 25/22.11), os três anéis abaixo são um PALPITE
 * razoável, não um número medido — ajustar sem hesitar assim que houver
 * conteúdo real pra comparar antes/depois.
 */
export interface AnelDensidade {
  /** até esta fração do raio (0..1), mantém esta fração das instâncias */
  ateFracaoDoRaio: number;
  mantem: number;
}

export const ANEIS_DENSIDADE_RASTEIRA: readonly AnelDensidade[] = [
  { ateFracaoDoRaio: 0.4, mantem: 1 },
  { ateFracaoDoRaio: 0.7, mantem: 0.6 },
  { ateFracaoDoRaio: 1.0, mantem: 0.3 },
];

/** fração de instâncias a manter numa dada fração de distância (0..1) do raio — pura, testável */
export function densidadeMantida(fracaoDaDistancia: number, aneis: readonly AnelDensidade[] = ANEIS_DENSIDADE_RASTEIRA): number {
  for (const anel of aneis) {
    if (fracaoDaDistancia <= anel.ateFracaoDoRaio) return anel.mantem;
  }
  return aneis[aneis.length - 1]?.mantem ?? 1;
}

/**
 * Hash determinístico [0,1) por id — mesmo padrão de `hashFlip` em
 * `grid/TreeImpostors.tsx` (fase de coerência de horizonte): a MESMA
 * instância de grama sempre cai do mesmo lado do sorteio entre recargas, e
 * entre um quadro e o seguinte — decimação por `Math.random()` faria a
 * grama "piscar" (aparecer/sumir) sem o jogador se mover, porque o sorteio
 * mudaria a cada reescrita de `center`.
 */
function hashUnit01(id: string): number {
  // FNV-1a + finalizador estilo murmur3 — a variante simples (`h = h*31 +
  // charCode`, a mesma de `hashFlip` em TreeImpostors.tsx) tem espalhamento
  // péssimo pra ids curtos/numéricos: medido, ids como "g0".."g499" saíam
  // TODOS abaixo de 0,0001 (nunca "davam a volta" no inteiro de 32 bits, já
  // que a soma nunca cresce o bastante) — decimação virava "quase tudo
  // sumido" em vez de uma fração alvo. `hashFlip` se safa porque só lê o BIT
  // menos significativo (`h & 1`), que já alterna mesmo com essa fraqueza;
  // aqui o valor de PONTO FLUTUANTE inteiro importa, então precisa de
  // avalanche de verdade. Medido: 500 ids "g0".."g499", frac esperada 0,30 →
  // frac medida 0,312 (era 0,004 com o hash simples).
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

export function ehCategoriaInstanciavel(assetId: string): boolean {
  const cat = propCategory(assetId);
  return !!cat && CATEGORIAS_INSTANCIAVEIS.has(cat);
}

export interface InstanciaVegetacao {
  prop: MapProp;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

/**
 * Cone de visão HORIZONTAL (câmera→personagem), pura — mesmo padrão de
 * `vegetationReveal.ts: computeTargetFade` (sem `THREE.*`, testável sem
 * `<Canvas>`). NÃO usada ainda em nenhum caminho de renderização — só
 * benchmark, enquanto o custo de aplicar isto ao `InstancedMesh` não está
 * medido (ver `VegetationInstancer.cone.perf.test.ts`).
 *
 * Direção do cone reaproveita o MESMO vetor câmera→personagem que o corredor
 * de revelação já calcula — nenhum dado novo (azimute de câmera, FOV real)
 * precisa entrar no sistema. É um teste GROSSEIRO de propósito (plano
 * horizontal, sem pitch/aspecto) — a única pergunta que precisa responder é
 * "esta árvore está claramente atrás/de lado da câmera", não um frustum
 * exato: o hardware já recorta triângulo fora do frustum de qualquer jeito
 * (ver o docblock do benchmark sobre o que isto ganha e o que NÃO ganha).
 */
export interface ConeDeVisao {
  camX: number;
  camZ: number;
  /** direção NORMALIZADA câmera→personagem */
  dirX: number;
  dirZ: number;
  /** cos(meio-ângulo) — folga generosa acima do FOV real, nunca exata */
  cosMeioAngulo: number;
}

export function dentroDoConeDeVisao(inst: { x: number; z: number }, cone: ConeDeVisao): boolean {
  const dx = inst.x - cone.camX;
  const dz = inst.z - cone.camZ;
  const d2 = dx * dx + dz * dz;
  if (d2 < 1e-6) return true; // exatamente na câmera — sem direção definida, não descarta
  const inv = 1 / Math.sqrt(d2);
  const cosAngulo = dx * inv * cone.dirX + dz * inv * cone.dirZ;
  return cosAngulo >= cone.cosMeioAngulo;
}

/**
 * Decide QUAIS instâncias de uma espécie desenham neste `center` — pura,
 * testável sem `<Canvas>` (mesmo padrão de `TreeImpostors.resolverInstancias
 * Visiveis`). O `useEffect` de `CamadaDeEspecie` só escreve o resultado nos
 * buffers de GPU.
 *
 * Corte por raio (sempre) + densidade adaptativa (só se `rasteira`,
 * decimação DETERMINÍSTICA por `hashUnit01(prop.id)` — nunca
 * `Math.random()`, ver o comentário da função). Árvore/arbusto/pedra
 * mantêm densidade cheia até o próprio raio de corte — o binário 3D↔sumiço/
 * impostor já é a técnica certa pra essas categorias (seção 22.4).
 */
export function instanciasVisiveisNaCamada(
  instancias: readonly InstanciaVegetacao[],
  center: { x: number; z: number },
  raioEfetivo: number,
  rasteira: boolean,
): InstanciaVegetacao[] {
  const r2 = raioEfetivo * raioEfetivo;
  const out: InstanciaVegetacao[] = [];
  for (const inst of instancias) {
    const dx = inst.position.x - center.x;
    const dz = inst.position.z - center.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    if (rasteira && raioEfetivo > 0) {
      const mantem = densidadeMantida(Math.sqrt(d2) / raioEfetivo);
      if (mantem < 1 && hashUnit01(inst.prop.id) >= mantem) continue;
    }
    out.push(inst);
  }
  return out;
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

export interface ParteEspecie {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface GltfMinimoComCena {
  scene: THREE.Object3D;
  parser?: unknown;
}

/**
 * Extrai, de UMA vez por espécie, cada sub-malha (geometria + material) com a
 * transform local do nó já cozida na geometria — cacheado por URL (o mesmo
 * `.gltf` nunca precisa ser rebakeado, mesmo que o mapa troque e volte).
 *
 * Exportado: `props/grass/GrassPatch.tsx` reaproveita esta mesma extração
 * (mesmo cache por URL) pra grama procedural — nunca duplicar o bake do
 * glTF entre os dois sistemas de instancing.
 */
const cacheDePartes = new Map<string, ParteEspecie[]>();

export function bakeSpeciesParts(url: string, gltf: GltfMinimoComCena): ParteEspecie[] {
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
  radiusRasteira,
  playerPos,
}: {
  camada: CamadaInstanciada;
  center: { x: number; z: number };
  radius: number;
  /** raio (já pronto, de `play/worldVisibility.ts`) pras categorias rasteiras — grama/flor/planta */
  radiusRasteira: number;
  /** posição do personagem (ref, lido só dentro de `useFrame` — nunca dispara re-render) — só usado por categorias com revelação */
  playerPos?: RefObject<THREE.Vector3>;
}) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const primeira = useRef(true);
  const castShadow = !SEM_SOMBRA_PROPRIA.has(camada.category);
  const raioEfetivo = CATEGORIAS_RASTEIRAS.has(camada.category) ? radiusRasteira : radius;

  const rasteira = CATEGORIAS_RASTEIRAS.has(camada.category);
  const temRevelacao = CATEGORIAS_COM_REVELACAO.has(camada.category) && !!playerPos && !isolado("semRevelacaoArvore");

  // REVELAÇÃO (ver vegetationReveal.ts): estado persistente (nunca recriado
  // por quadro) + o buffer de GPU que `advanceAndUpload` escreve direto —
  // ele É o `.array` de todo `InstancedBufferAttribute` desta camada
  // (compartilhado por referência entre as N sub-malhas/partes).
  const revealState = useRef<RevealState | null>(null);
  const fadeArray = useRef<Float32Array | null>(null);
  const fadeAttrs = useRef<THREE.InstancedBufferAttribute[]>([]);
  // slot→posição de mundo dos ativos AGORA — construído pela MESMA passada
  // que já escreve `instanceMatrix` abaixo (zero custo extra de iteração);
  // é o "candidatos dos chunks/instâncias próximas" do pedido: nunca a
  // espécie inteira do mapa, só quem já está desenhando no raio de detalhe.
  const candidatosRef = useRef<RevealCandidate[]>([]);

  useEffect(() => {
    if (!temRevelacao) return;
    const cap = camada.instancias.length;
    const arr = new Float32Array(cap);
    fadeArray.current = arr;
    revealState.current = createRevealState(cap);
    const attrs: THREE.InstancedBufferAttribute[] = [];
    for (const parte of camada.partes) {
      const attr = new THREE.InstancedBufferAttribute(arr, 1);
      attr.setUsage(THREE.DynamicDrawUsage);
      parte.geometry.setAttribute("instanceFade", attr);
      attrs.push(attr);
    }
    fadeAttrs.current = attrs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camada, temRevelacao]);

  useEffect(() => {
    medir("vegetacao→camada", () => {
      const meshes = refs.current;
      // a DECISÃO (corte por raio + densidade adaptativa pra categoria
      // rasteira) mora em `instanciasVisiveisNaCamada` — pura, testada sem
      // `<Canvas>`. Aqui só sobra escrever o resultado nos buffers de GPU.
      const visiveis = instanciasVisiveisNaCamada(camada.instancias, center, raioEfetivo, rasteira);
      const ativos: MapProp[] = [];
      const candidatos: RevealCandidate[] = [];
      let n = 0;
      for (const inst of visiveis) {
        _m.compose(inst.position, inst.quaternion, inst.scale);
        for (const mesh of meshes) mesh?.setMatrixAt(n, _m);
        ativos.push(inst.prop);
        if (temRevelacao) candidatos.push({ slot: n, x: inst.position.x, z: inst.position.z });
        n++;
      }
      candidatosRef.current = candidatos;
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camada, center.x, center.z, raioEfetivo, temRevelacao]);

  // baixa frequência por dentro (ver tickRevealFade/REVEAL_CONFIG.updateHz) —
  // o `useFrame` roda todo quadro só pra chamar uma função que, na maior
  // parte deles, faz só o lerp barato de `trackedSlots` (tipicamente
  // dezenas). NUNCA itera `camada.instancias` inteira.
  //
  // Upload PARCIAL (3º tuning — desempenho): `tickRevealFade` devolve o
  // intervalo de slots tocado neste quadro; `addUpdateRange` sobe só esses
  // bytes pra GPU em vez do buffer inteiro da espécie (`needsUpdate=true`
  // sozinho reenviaria a capacidade inteira, mesmo com 2 slots mudando numa
  // espécie de 300).
  useFrame((state, dt) => {
    if (!temRevelacao) return;
    const rs = revealState.current;
    const arr = fadeArray.current;
    const player = playerPos?.current;
    if (!rs || !arr || !player) return;
    const r = tickRevealFade(
      rs,
      dt,
      () => candidatosRef.current,
      { x: player.x, z: player.z },
      { x: state.camera.position.x, z: state.camera.position.z },
      arr,
      REVEAL_CONFIG,
    );
    if (r.changed) {
      const count = r.maxSlot - r.minSlot + 1;
      for (const attr of fadeAttrs.current) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(r.minSlot, count);
        attr.needsUpdate = true;
      }
    }
  });

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
  radiusRasteira,
  playerPos,
  aoPrecompilar,
}: {
  map: GameMap;
  center: { x: number; z: number };
  radius: number;
  /** raio (já pronto, de `play/worldVisibility.ts`) pras categorias rasteiras — grama/flor/planta */
  radiusRasteira: number;
  /**
   * Posição do personagem — habilita a REVELAÇÃO de árvore/árvore-seca perto
   * dele ou no corredor câmera→personagem (`vegetationReveal.ts`). Ausente =
   * comportamento de sempre (corte binário por raio, sem fade nenhum).
   */
  playerPos?: RefObject<THREE.Vector3>;
  /**
   * Chamado quando a fila de precompile (uma espécie por quadro, ver o
   * efeito abaixo) esvazia — ou já na hora, se não há nenhuma espécie
   * instanciável no mapa. `PlayView.tsx` usa isto pra `gameReady` não
   * declarar pronto com precompile ainda rodando (ver o comentário lá).
   */
  aoPrecompilar?: () => void;
}) {
  // sistema de grama PROCEDURAL (props/grass/) foi removido (pesado demais) —
  // `map.props` de categoria "grass" agora renderiza normal por aqui, como
  // qualquer outra categoria instanciável, sem filtro nenhum.
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
      const temRevelacao = CATEGORIAS_COM_REVELACAO.has(category);
      const partes = partesCruas.map((p) => {
        if (temRevelacao && windCat) {
          // vento + revelação no MESMO onBeforeCompile (treeRevealMaterial.ts)
          // — `semVento` zera a amplitude em vez de trocar de material, pra
          // não acoplar a isolação de vento à disponibilidade do fade
          const profile = resolveWindProfile(assetId, windCat);
          const efetivo = isolado("semVento") ? { ...profile, amp: 0, gustAmp: 0 } : profile;
          // casca/galho (Bark_*) não segue a curva por altura — ver o
          // docblock de `uIsBark` em treeRevealMaterial.ts (bug real:
          // galho alto virando silhueta transparente contra o céu)
          const isBark = /bark|tronco|trunk/i.test(p.material.name ?? "");
          return { geometry: p.geometry, material: treeMaterialFor(p.material, p.geometry, assetId, efetivo, isBark) };
        }
        return {
          geometry: p.geometry,
          material: windCat && !isolado("semVento") ? windMaterialFor(p.material, p.geometry, assetId, windCat) : p.material,
        };
      });
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
   * agora para vegetação instanciada.
   *
   * ## Por que virou INCREMENTAL, com dummy fora do frustum
   * (correção, `voo-1786573041420.json`)
   *
   * A versão original chamava `gl.compileAsync(scene, camera)` UMA vez com a
   * `scene` INTEIRA — medido ao vivo: 502 ms para compilar 33 espécies/60
   * programas num quadro só (`quadro #313`, `especies=33 ms=502
   * programas=60`). Este componente, diferente de `PreCompilarProps`, é
   * montado O TEMPO TODO (não só durante `aquecendo` — `PlayView.tsx` nunca
   * o condiciona ao aquecimento), e o `<Suspense fallback={null}>` que o
   * embrulha lá NÃO bloqueia `cenaMontada` — então nada garantia que este
   * precompile terminasse antes de `GAME_READY`; só terminava cedo NESTE
   * laudo por coincidência de timing.
   *
   * A troca: UMA espécie por `requestAnimationFrame`, cada uma contra um
   * `InstancedMesh` DESCARTÁVEL de 1 instância só (`count=1`) — precisa ser
   * `InstancedMesh` mesmo (não um `Mesh` comum) porque é a flag
   * `USE_INSTANCING` que muda o programa; um `Mesh` comum compilaria a
   * variante ERRADA. Depositado em `Y_DEPOSITO` (mesma constante de
   * `PreCompilarProps` — fora do frustum de qualquer câmera do mapa) para
   * não arriscar aparecer um quadro na origem enquanto o dummy está na cena.
   * Geometria/material são os MESMOS objetos do `camada.partes` real
   * (compartilhados, nunca clonados) — só o `InstancedMesh` (o wrapper) e o
   * `Group` são descartáveis, e saem da cena assim que aquela espécie
   * termina de compilar.
   */
  useEffect(() => {
    if (camadas.length === 0) {
      // nada pra precompilar (mapa sem vegetação instanciável) — avisa na
      // hora, senão `gameReady` esperaria um sinal que nunca chegaria
      aoPrecompilar?.();
      return;
    }
    let vivo = true;
    let indice = 0;
    let rafId = 0;
    const t0 = performance.now();

    const compilarProxima = () => {
      if (!vivo) return;
      if (indice >= camadas.length) {
        registrarEvento("cena", "vegetacaoInstanciada:precompilou", {
          especies: camadas.length,
          ms: Math.round(performance.now() - t0),
          programas: gl.info.programs?.length ?? 0,
        });
        aoPrecompilar?.();
        return;
      }
      const camada = camadas[indice]!;
      indice++;
      // grupo descartável só pra puxar a variante USE_INSTANCING do
      // material real — nunca entra no raycast/clique nem no censo de props
      const escrutinio = new THREE.Group();
      escrutinio.position.set(0, Y_DEPOSITO, 0);
      for (const parte of camada.partes) {
        const dummy = new THREE.InstancedMesh(parte.geometry, parte.material, 1);
        dummy.setMatrixAt(0, _m.identity());
        dummy.instanceMatrix.needsUpdate = true;
        escrutinio.add(dummy);
      }
      scene.add(escrutinio);
      const pronto = gl.compileAsync
        ? gl.compileAsync(escrutinio, camera)
        : (gl.compile(escrutinio, camera), Promise.resolve());
      void Promise.resolve(pronto).then(() => {
        scene.remove(escrutinio);
        if (!vivo) return;
        rafId = requestAnimationFrame(compilarProxima);
      });
    };
    rafId = requestAnimationFrame(compilarProxima);
    return () => {
      vivo = false;
      cancelAnimationFrame(rafId);
    };
  }, [gl, camera, scene, camadas, aoPrecompilar]);

  if (isolado("semProps")) return null;

  return (
    <>
      {camadas.map((camada) => (
        <CamadaDeEspecie key={camada.assetId} camada={camada} center={center} radius={radius} radiusRasteira={radiusRasteira} playerPos={playerPos} />
      ))}
    </>
  );
}
