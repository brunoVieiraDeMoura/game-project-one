import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { registrarEvento } from "../core/diagnostics/flightRecorder";

/**
 * Petrificar aplicado DIRETO no material do body do alvo — sem overlay, sem
 * mesh extra. Duas fases reais (`net/entityOption.OPT1_STONEWAIT`/`OPT1_STONE`,
 * ver `net/NetEntity.tsx` — quem calcula `phase` a partir do `opt1` real).
 *
 * ## Por que clonar o material (e não mutar direto)
 *
 * `assets.ts: useCharacter()` funde as malhas do personagem ANTES de clonar
 * a entidade (`fundirSkinned`, na cena do cache do `useGLTF`) — o `material`
 * de cada malha fundida vem desse cache e é o MESMO objeto `THREE.Material`
 * para TODA entidade que usa aquele modelo (“Geometria e material NÃO são
 * descartados: vêm do cache do useGLTF e são compartilhados com todos os
 * outros personagens na tela”, docblock de `useCharacter`). Escrever
 * `mesh.material.color` direto petrificaria visualmente todo mundo que usa o
 * mesmo `.glb`, não só o alvo.
 *
 * A saída é clonar o material (mantém o MESMO mapa/textura — só ganha uma
 * instância própria de `color`/`roughness`/etc) e trocar `mesh.material` para
 * a cópia SÓ nas malhas da entidade afetada.
 *
 * ## Por que isto nunca clona por quadro
 *
 * A troca só acontece dentro de um `useEffect` com dependência `[scene,
 * phase]` — roda uma vez por TRANSIÇÃO de fase (normal→fase1, fase1→fase2,
 * fase→normal), nunca em loop. O cleanup do próprio efeito restaura o
 * material original e descarta o clone (`.dispose()`) — cobre os três jeitos
 * de “deixar de estar naquela fase”: o status terminar, a fase mudar de novo,
 * e a entidade desmontar (morte/despawn empurra o mesmo cleanup de graça).
 *
 * ## Por que é TEXTURA REAL de pedra, não só tint (2026-08-14, pedido
 * explícito "não quero um filtro marrom")
 *
 * O UV do personagem é um atlas recortado POR PARTE DO CORPO (braço, perna,
 * torso em ilhas separadas — `assets.ts: fundirSkinned`/`compartilharTexturas`)
 * — colar uma textura de pedra nesse UV mostraria costura em cada ilha, cada
 * uma numa escala/rotação diferente. A saída é TRIPLANAR: projeta a textura
 * pela posição/normal de MUNDO do vértice, então ela cobre o corpo inteiro
 * como uma superfície contínua, sem depender do UV nenhum — mesma técnica que
 * `grid/SquareTerrain.tsx` já usa pro chão (`terrenoTriplanar`), só mais
 * simples aqui (1 textura, sem array/multi-camada).
 *
 * Único cuidado que o personagem pede e o terreno não: é SKINNED (osso
 * deforma vértice). A posição/normal de mundo usada na projeção têm que vir
 * DEPOIS de `#include <skinning_vertex>`/`<defaultnormal_vertex>` do three —
 * antes disso o vértice ainda está na bind pose (T-pose), e a pedra ficaria
 * "grudada no ar" em vez de acompanhar a animação.
 */

export type PetrifyPhase = "none" | "wait" | "stone";

interface Tint {
  /** multiplicador sobre o mapa/textura original (`finalDiffuse = map × color`,
   * pipeline padrão do MeshStandardMaterial) — sozinho, NUNCA basta: uma
   * região já escura da textura original (bota preta, correia) multiplicada
   * por qualquer coisa continua preta. Ver `emissive` abaixo. */
  color: THREE.Color;
  /** aditivo, fora da luz da cena e da textura (`finalColor ≈ map×color×luz +
   * emissive`) — garante piso de cor mesmo onde a textura original é preto
   * puro, porque não é multiplicado por nada. */
  emissive: THREE.Color;
  roughness: number;
  metalness: number;
  /** 0..1 — quanto da TEXTURA DE PEDRA (triplanar) substitui a
   * cor/textura original nesse ponto da superfície. É a variável que faz
   * "personagem colorido de marrom" virar "personagem virando pedra de
   * verdade": 0 = só o tint acima (textura original ainda domina), 1 = a
   * pedra domina quase por completo. */
  stoneBlend: number;
}

const WHITE = new THREE.Color(1, 1, 1);

/**
 * Calibração de COR 2026-08-14 (pedido explícito "fase 1 fraca demais" /
 * "fase 2 virando preto"): `color` sozinho é multiplicador — mirar um alvo
 * quase preto esmaga QUALQUER textura pra preto puro nas regiões já escuras
 * (bota, correia). A correção soma um piso ADITIVO (`emissive`) por cima de
 * um multiplicador mais moderado, então nunca zera de vez. Isso continua
 * valendo por cima do blend de pedra (ver `stoneBlend`) — o tint dá o TOM
 * geral, a textura triplanar dá o DETALHE/relevo real de superfície.
 */
const PHASE1_DIFFUSE_TARGET = new THREE.Color("#8a5a34");
const PHASE1_DIFFUSE_BLEND = 0.6;
const PHASE1_EMISSIVE = new THREE.Color("#5c3d22").multiplyScalar(0.38);

const PHASE2_DIFFUSE_TARGET = new THREE.Color("#4a2f1a");
const PHASE2_DIFFUSE_BLEND = 0.88;
const PHASE2_EMISSIVE = new THREE.Color("#3a2413").multiplyScalar(0.55);

const PHASE1: Tint = {
  color: WHITE.clone().lerp(PHASE1_DIFFUSE_TARGET, PHASE1_DIFFUSE_BLEND),
  emissive: PHASE1_EMISSIVE,
  roughness: 0.7,
  metalness: 0.05,
  // "primeiros sinais de petrificação" — pedra ainda MINORIA, textura
  // original claramente reconhecível por baixo do tint
  stoneBlend: 0.28,
};
const PHASE2: Tint = {
  color: WHITE.clone().lerp(PHASE2_DIFFUSE_TARGET, PHASE2_DIFFUSE_BLEND),
  emissive: PHASE2_EMISSIVE,
  roughness: 1,
  metalness: 0,
  // "estátua de pedra" — pedra DOMINA; ~8% de original sobra de propósito
  // (não 100%) pra não virar um bloco de cor perfeitamente uniforme
  stoneBlend: 0.92,
};

function tintFor(phase: PetrifyPhase): Tint | null {
  if (phase === "wait") return PHASE1;
  if (phase === "stone") return PHASE2;
  return null;
}

/**
 * Textura de pedra REAL do acervo (`public/assets/terrain/stone-Rock033.png`)
 * — das 6 imagens em `terrain/stone*.png`, a única que lê como SUPERFÍCIE
 * orgânica de rocha/estátua (veios/rachaduras finos e distribuídos): as
 * outras são junta de alvenaria (`stone-broken_wall`), padrão poligonal
 * estilizado (`stone-procedural`) ou placas grandes de lama rachada
 * (`stone-rock_boulder_cracked`) — nenhuma das três se parece com pele de
 * personagem/estátua de perto.
 *
 * Cache de MÓDULO — carregada uma vez pro jogo inteiro, nunca por entidade
 * (mesmo padrão de `SquareTerrain.aquarelaDe`/`terrainArrayTexture`). Nunca
 * descartada: é acervo fixo.
 */
let stoneTex: THREE.Texture | null = null;
function stoneStatueTexture(): THREE.Texture {
  if (stoneTex) return stoneTex;
  const tex = new THREE.TextureLoader().load("/assets/terrain/stone-Rock033.png");
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // é COR (vira `diffuseColor`, não bump/roughness) — precisa da decodificação
  // sRGB→linear que o resto do pipeline já espera de qualquer `map`
  tex.colorSpace = THREE.SRGBColorSpace;
  stoneTex = tex;
  return tex;
}

/** repetições da textura por unidade de mundo — personagem tem ~1,8 unidade
 * de altura; um tile só ficaria um borrão sem detalhe, e tiling demais vira
 * ruído. Ajustável sem recompilar nada além do clone em si. */
const STONE_TRIPLANAR_SCALE = 1.35;

/**
 * Injeta a projeção triplanar no material clonado — mesma técnica de
 * `SquareTerrain: terrenoTriplanar`, adaptada pra malha SKINNED (posição/
 * normal de mundo lidas DEPOIS do skinning do three, não da bind pose) e
 * sem os atributos de camada do terreno (aqui é 1 textura só, blend por um
 * uniform escalar).
 *
 * O texto do shader injetado é IDÊNTICO pra toda entidade petrificada — só
 * `uStoneBlend` (uniform, não literal no GLSL) muda por clone — então o
 * three compila o programa UMA vez e reaproveita entre todos os monstros
 * petrificados ao mesmo tempo; cada clone só sobe um float novo pro
 * uniform, nunca recompila shader nem recria textura.
 */
function injectStoneTriplanar(mat: THREE.Material, blend: number): void {
  const std = mat as THREE.MeshStandardMaterial;
  std.onBeforeCompile = (shader) => {
    shader.uniforms.uStoneMap = { value: stoneStatueTexture() };
    shader.uniforms.uStoneScale = { value: STONE_TRIPLANAR_SCALE };
    shader.uniforms.uStoneBlend = { value: blend };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vStoneWorldPos;
varying vec3 vStoneWorldNormal;`,
      )
      // POST-skin: `objectNormal` já reflete o osso aqui (skinnormal_vertex
      // já rodou), defaultnormal_vertex só lê, nunca sobrescreve o objectNormal
      .replace(
        "#include <defaultnormal_vertex>",
        `#include <defaultnormal_vertex>
vStoneWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
      // POST-skin: `worldpos_vertex` já computou `worldPosition` a partir do
      // `transformed` DEPOIS de `skinning_vertex` ter deformado ele
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vStoneWorldPos = worldPosition.xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vStoneWorldPos;
varying vec3 vStoneWorldNormal;
uniform sampler2D uStoneMap;
uniform float uStoneScale;
uniform float uStoneBlend;

// triplanar de 3 eixos (não só topo/lado como o terreno) — braço, torso e
// cabeça de um personagem viram em qualquer direção, ao contrário de um chão
// que é majoritariamente horizontal ou vertical
vec3 pedraTriplanar(vec3 posMundo, vec3 nMundo) {
  vec3 peso = abs(nMundo);
  peso = peso / max(peso.x + peso.y + peso.z, 1e-5);
  vec3 amostraX = texture2D(uStoneMap, posMundo.yz * uStoneScale).rgb;
  vec3 amostraY = texture2D(uStoneMap, posMundo.xz * uStoneScale).rgb;
  vec3 amostraZ = texture2D(uStoneMap, posMundo.xy * uStoneScale).rgb;
  return amostraX * peso.x + amostraY * peso.y + amostraZ * peso.z;
}`,
      )
      // depois do tint (color/emissive já aplicados via `diffuse`/`map`
      // padrão do three) — mistura por cima, mesmo ponto que o terreno usa
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
if (uStoneBlend > 0.001) {
  vec3 pedra = pedraTriplanar(vStoneWorldPos, normalize(vStoneWorldNormal));
  diffuseColor.rgb = mix(diffuseColor.rgb, pedra, uStoneBlend);
}`,
      );
  };
  // `onBeforeCompile` muda o texto do shader — sem isto o three pode
  // reaproveitar um programa já compilado (do material ORIGINAL, sem a
  // injeção) achando que nada mudou
  mat.needsUpdate = true;
}

function applyTint(mat: THREE.Material, tint: Tint): void {
  const m = mat as THREE.Material & { color?: THREE.Color; roughness?: number; metalness?: number; emissive?: THREE.Color };
  if (m.color) m.color.copy(tint.color);
  // substitui de vez (não multiplica o emissivo original) — cobre também o
  // `Glow` dos olhos do Skeleton_Warrior, que vira o MESMO tom em vez de
  // continuar brilhando com a cor própria dele por baixo da pedra
  if (m.emissive) m.emissive.copy(tint.emissive);
  if (typeof m.roughness === "number") m.roughness = tint.roughness;
  if (typeof m.metalness === "number") m.metalness = tint.metalness;
  injectStoneTriplanar(mat, tint.stoneBlend);
}

export function usePetrifyMaterial(scene: THREE.Object3D | null | undefined, phase: PetrifyPhase): void {
  const { gl, camera, scene: cenaRaiz } = useThree();
  useEffect(() => {
    const tint = tintFor(phase);
    if (!scene || !tint) return;

    const restores: Array<() => void> = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;

      if (Array.isArray(mesh.material)) {
        const original = mesh.material;
        const clones = original.map((mat) => {
          const clone = mat.clone();
          applyTint(clone, tint);
          return clone;
        });
        mesh.material = clones;
        restores.push(() => {
          for (const c of clones) c.dispose();
          mesh.material = original;
        });
      } else {
        const original = mesh.material;
        const clone = original.clone();
        applyTint(clone, tint);
        mesh.material = clone;
        restores.push(() => {
          clone.dispose();
          mesh.material = original;
        });
      }
    });

    /**
     * FASE 7 (auditoria de performance) — mesma técnica de `assets.ts`
     * (useCharacter, "FASE E2"): compila o material NOVO atrás de um
     * `requestAnimationFrame`, nunca dentro do `render()` que o disparou.
     *
     * Achado que motivou isto: o material de Petrificar injeta GLSL
     * triplanar via `onBeforeCompile` (`injectStoneTriplanar` acima) — um
     * programa que nunca existiu antes da 1ª petrificação da sessão inteira
     * (`stoneTex`/o programa em si são cache de módulo, nunca por entidade).
     * Sem aquecimento, o primeiro Petrificar de uma sessão pagava o
     * link do programa de forma SÍNCRONA dentro de `gl.render()` — medido em
     * produção: quadro de 356,8ms, 337,4ms dentro de `renderMs`. Nenhum dos
     * outros 8 usos de `onBeforeCompile` do projeto sofre disso porque todos
     * pertencem ao MAPA (terreno/água/vento/etc.) e já são varridos pela
     * cortina de carregamento comum — este é o único material acionado por
     * EVENTO DE GAMEPLAY (status effect), fora do alcance dela.
     *
     * A textura (`stoneStatueTexture()`, chamada dentro de
     * `injectStoneTriplanar`/`applyTint` acima) continua carregando por rede
     * na 1ª vez — isso é assíncrono por natureza (não é o que bloqueava o
     * frame) e permanece fora do escopo desta correção.
     */
    let vivo = true;
    const t0 = performance.now();
    const idRaf = requestAnimationFrame(() => {
      if (!vivo) return;
      const pronto = gl.compileAsync
        ? gl.compileAsync(scene, camera, cenaRaiz)
        : (gl.compile(scene, camera), Promise.resolve());
      void Promise.resolve(pronto).then(() => {
        if (!vivo || !import.meta.env.DEV) return;
        registrarEvento("cena", "shader:compile-petrificar", {
          ms: Math.round(performance.now() - t0),
          programas: gl.info.programs?.length ?? 0,
        });
      });
    });

    return () => {
      vivo = false;
      cancelAnimationFrame(idRaf);
      for (const restore of restores) restore();
    };
  }, [scene, phase, gl, camera, cenaRaiz]);
}
