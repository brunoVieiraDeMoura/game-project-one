import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { windUniforms } from "../props/wind";

/**
 * Partículas ambientais LEVES (poeira, neve, brasa, faísca, brilho mágico,
 * névoa d'água) — `assets-new/particles` (Kenney) → `public/assets/particles`.
 *
 * UM `InstancedMesh` por emissor, geometria e material compartilhados entre
 * TODAS as instâncias daquele emissor (1 draw call, `count` livre — 20 ou
 * 2000 custam o mesmo em draw calls). Nenhuma partícula é um objeto React:
 * a posição-base de cada uma é escrita UMA VEZ no `instanceMatrix` na
 * montagem; a deriva/subida/varredura/ciclo de vida daí em diante é 100% GPU,
 * lida a partir de `uTime` (um `useFrame` só, por emissor — não por
 * partícula) e de uma semente por instância (`aSeed`, atributo instanced,
 * gera fase/tamanho diferentes sem nenhum uniform por partícula).
 *
 * DOIS PADRÕES DE MOVIMENTO, não um só (era o problema da rodada anterior:
 * tudo "flutua no lugar", que serve pra brasa/brilho mas não pra "poeira
 * atravessando a área" nem "neve caindo"):
 *  • `sweep = 0` (brasa, faísca, brilho, névoa) — paira perto da ORIGEM,
 *    com pequena deriva senoidal; é o emissor LOCAL clássico (fogueira,
 *    margem de lago).
 *  • `sweep > 0` (poeira, neve) — soma um deslocamento CONTÍNUO na direção
 *    do vento GLOBAL (`props/wind.ts: windUniforms`, o MESMO uniform que já
 *    move grama/árvore — reaproveitado, não duplicado) proporcional ao
 *    ciclo de vida: a partícula nasce numa borda, atravessa a área ao longo
 *    da vida e reaparece do outro lado. É isso que lê como "atravessando o
 *    mapa" em vez de "balançando no mesmo lugar".
 *
 * Billboard: em vez de girar o `instanceMatrix` pra encarar a câmera (que
 * exigiria recompor a matriz por partícula por quadro — exatamente o update
 * individual que o pedido pede pra evitar), o vértice do quad é deslocado no
 * PRÓPRIO shader pelos eixos direita/cima extraídos de `viewMatrix` — a
 * mesma conta pra N instâncias, de graça.
 *
 * Culling: bounding sphere cobrindo origem+raio+alcance (subida/queda +
 * varredura) pro frustum culling padrão do three pegar sozinho, MAIS um
 * corte por distância (esconde o emissor inteiro além de `cullDistance`) —
 * um `useFrame` por EMISSOR, não por partícula, mesma classe de custo do
 * `SunRig` seguindo o player.
 */

export type ParticleKind = "dust" | "snow" | "ember" | "spark" | "magic" | "mist";

interface Preset {
  url: string;
  color: string;
  blending: THREE.Blending;
  size: number;
  /** deslocamento vertical ao longo do ciclo de vida — negativo = cai */
  rise: number;
  speed: number;
  drift: number;
  opacity: number;
  /** alcance (unidades de mundo) da varredura na direção do vento global —
   * 0 = paira perto da origem (emissor local); >0 = atravessa a área */
  sweep: number;
}

const PRESETS: Record<ParticleKind, Preset> = {
  // poeira — área seca, VARRE a área na direção do vento (não paira no lugar)
  dust: { url: "/assets/particles/dust.png", color: "#c9b78c", blending: THREE.NormalBlending, size: 0.5, rise: 0.6, speed: 0.16, drift: 0.3, opacity: 0.45, sweep: 22 },
  // neve — cai devagar, varre um pouco menos que a poeira (mais pesada).
  // SEM asset de floco real no pacote (assets-new/particles não tem nada
  // com forma de floco/folha/pétala — auditado, ver relatório): usa
  // `circle_01` (disco branco suave), técnica comum e honesta pra neve, não
  // pretende ser floco desenhado.
  snow: { url: "/assets/particles/snow.png", color: "#ffffff", blending: THREE.NormalBlending, size: 0.35, rise: -3.5, speed: 0.22, drift: 0.4, opacity: 0.8, sweep: 10 },
  // brasa — fogueira, sobe rápido, aditivo (brilha), paira perto da origem
  ember: { url: "/assets/particles/ember.png", color: "#ff9a3c", blending: THREE.AdditiveBlending, size: 0.35, rise: 2.2, speed: 0.55, drift: 0.25, opacity: 0.85, sweep: 0 },
  // faísca — acompanha a fogueira, mais rápida e pequena
  spark: { url: "/assets/particles/spark.png", color: "#ffd27a", blending: THREE.AdditiveBlending, size: 0.22, rise: 3.0, speed: 0.9, drift: 0.4, opacity: 0.9, sweep: 0 },
  // brilho mágico — área mágica, flutua devagar, aditivo suave
  magic: { url: "/assets/particles/magic.png", color: "#b98cff", blending: THREE.AdditiveBlending, size: 0.6, rise: 0.5, speed: 0.12, drift: 0.5, opacity: 0.7, sweep: 0 },
  // névoa d'água — perto do lago, deriva quase parada, translúcida
  mist: { url: "/assets/particles/mist.png", color: "#dff0f5", blending: THREE.NormalBlending, size: 1.1, rise: 0.15, speed: 0.06, drift: 0.6, opacity: 0.3, sweep: 0 },
};

/** guarda de runtime — `map.ambientParticles[].particleId` vem de fora
 * (config do mapa, salva pelo editor) como string solta, não como
 * `ParticleKind`; isso valida antes de indexar `PRESETS` (chave
 * desconhecida ali seria `undefined.blending` explodindo o material). */
export function isParticleKind(v: string): v is ParticleKind {
  return v === "dust" || v === "snow" || v === "ember" || v === "spark" || v === "magic" || v === "mist";
}

/** catálogo pro editor listar (id + rótulo em pt-br) — mesma fonte que
 * `PRESETS`, pra nunca ficar dessincronizado do que o cliente sabe desenhar */
export const PARTICLE_CATALOG: { id: ParticleKind; label: string }[] = [
  { id: "dust", label: "Poeira (varre a área)" },
  { id: "snow", label: "Neve (cai + varre)" },
  { id: "ember", label: "Brasa (emissor local)" },
  { id: "spark", label: "Faísca (emissor local)" },
  { id: "magic", label: "Brilho mágico (emissor local)" },
  { id: "mist", label: "Névoa d'água (emissor local)" },
];

const textureCache = new Map<string, THREE.Texture>();
function textureFor(url: string): THREE.Texture {
  let t = textureCache.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(url, t);
  }
  return t;
}

const VERTEX = `
uniform float uTime;
uniform float uSize;
uniform float uRise;
uniform float uSpeed;
uniform float uDrift;
uniform float uSweep;
uniform vec2 uWindDir;
uniform float uWindStrength;
attribute float aSeed;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float cycle = fract(uTime * uSpeed * 0.2 + aSeed);
  float t = uTime * uSpeed + aSeed * 6.2831853;
  vec3 world = base;
  world.y += cycle * uRise;
  world.x += sin(t * 0.7 + aSeed * 11.0) * uDrift;
  world.z += cos(t * 0.5 + aSeed * 9.0) * uDrift;
  // VARREDURA: desloca na direção do vento GLOBAL (mesmo uniform da grama/
  // árvore) proporcional ao ciclo — 0 no nascimento, uSweep unidades no
  // fim da vida, então reaparece do outro lado. uSweep=0 (emissor local)
  // zera o termo inteiro, sem if nenhum.
  vec2 windDir = normalize(uWindDir + vec2(1e-5, 0.0));
  world.xz += windDir * (cycle * uSweep * (0.4 + 0.6 * uWindStrength));
  vFade = smoothstep(0.0, 0.15, cycle) * smoothstep(1.0, 0.85, cycle);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float sz = uSize * (0.7 + 0.3 * sin(aSeed * 13.0));
  vec3 offset = (right * position.x + up * position.y) * sz;
  gl_Position = projectionMatrix * viewMatrix * vec4(world + offset, 1.0);
}`;

const FRAGMENT = `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vFade;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  gl_FragColor = vec4(uColor * tex.rgb, tex.a * uOpacity * vFade);
}`;

const QUAD = new THREE.PlaneGeometry(1, 1);

export function AmbientParticles({
  kind,
  origin,
  count = 24,
  radius = 2.5,
  cullDistance = 90,
  scale = 1,
  speedScale = 1,
}: {
  kind: ParticleKind;
  origin: readonly [number, number, number];
  /** quantas partículas — livre, 1 draw call de qualquer tamanho (teste de estresse) */
  count?: number;
  /** raio (unidades de mundo) da área onde as partículas nascem */
  radius?: number;
  /** além desta distância da câmera, o emissor INTEIRO some (1 check/quadro, não por partícula) */
  cullDistance?: number;
  /** multiplica o tamanho do preset — presets pensados pra ambientação sutil
   * de gameplay ficam pequenos demais num mapa de SHOWCASE, onde o pedido é
   * "obviamente visível"; em vez de mudar o preset global, quem monta pede
   * mais escala aqui */
  scale?: number;
  /** multiplica velocidade de deriva/subida/varredura do preset (config de mapa) */
  speedScale?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const preset = PRESETS[kind];

  const geometry = useMemo(() => {
    const geo = QUAD.clone();
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = Math.random();
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    return geo;
  }, [count]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: preset.blending,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uMap: { value: textureFor(preset.url) },
          uColor: { value: new THREE.Color(preset.color) },
          uOpacity: { value: preset.opacity },
          uSize: { value: preset.size * scale },
          uRise: { value: preset.rise },
          uSpeed: { value: preset.speed * speedScale },
          uDrift: { value: preset.drift },
          uSweep: { value: preset.sweep * speedScale },
          // MESMOS objetos do vento da vegetação — referência compartilhada,
          // não cópia: quando `WindSystem` avança `uWindTime` em outro
          // material, `uWindDir`/`uWindStrength` aqui já são os valores
          // atuais, sem nenhuma sincronização extra.
          uWindDir: windUniforms.uWindDir,
          uWindStrength: windUniforms.uWindStrength,
        },
      }),
    [preset, scale, speedScale],
  );

  // posição-base de cada instância — escrita UMA VEZ, nunca mais tocada
  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    let seed = Math.floor(origin[0] * 1000 + origin[2] * 7 + 1);
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < count; i++) {
      const ang = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * radius;
      dummy.position.set(origin[0] + Math.cos(ang) * r, origin[1], origin[2] + Math.sin(ang) * r);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    /**
     * NÃO `geometry.computeBoundingSphere()` — esse método mede só o QUAD
     * base (4 cantos em torno de LOCAL 0,0,0, raio ~0,5). Toda instância é
     * deslocada por `instanceMatrix`, não pela geometria, então a esfera daí
     * saía centrada na ORIGEM DO MUNDO com raio ~0,5 — qualquer emissor longe
     * de (0,0,0) ficava fora do frustum e o three parava de desenhar o
     * `InstancedMesh` INTEIRO. A esfera certa é centrada no PRÓPRIO `origin`,
     * com raio suficiente pra cobrir raio de nascimento + subida/queda +
     * varredura (as partículas de vento chegam a viajar `sweep` unidades).
     */
    const alcance = radius + Math.abs(preset.rise) + preset.sweep + 1;
    m.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(origin[0], origin[1], origin[2]), alcance);
  }, [count, origin, radius, preset.rise, preset.sweep]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(({ camera, clock }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
    const m = meshRef.current;
    if (!m) return;
    const dx = camera.position.x - origin[0];
    const dz = camera.position.z - origin[2];
    m.visible = dx * dx + dz * dz <= cullDistance * cullDistance;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled />;
}
