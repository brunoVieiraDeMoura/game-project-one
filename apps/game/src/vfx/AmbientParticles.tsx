import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Partículas ambientais LEVES (poeira, brasa, faísca, brilho mágico, névoa
 * d'água) — `assets-new/particles` (Kenney) → `public/assets/particles`.
 *
 * UM `InstancedMesh` por emissor, geometria e material compartilhados entre
 * TODAS as instâncias daquele emissor (1 draw call, `count` livre — 20 ou
 * 2000 custam o mesmo em draw calls). Nenhuma partícula é um objeto React:
 * a posição-base de cada uma é escrita UMA VEZ no `instanceMatrix` na
 * montagem; a deriva/subida/ciclo de vida daí em diante é 100% GPU, lida a
 * partir de `uTime` (um `useFrame` só, por emissor — não por partícula) e de
 * uma semente por instância (`aSeed`, atributo instanced, gera fase/tamanho
 * diferentes sem nenhum uniform por partícula).
 *
 * Billboard: em vez de girar o `instanceMatrix` pra encarar a câmera (que
 * exigiria recompor a matriz por partícula por quadro — exatamente o update
 * individual que o pedido pede pra evitar), o vértice do quad é deslocado no
 * PRÓPRIO shader pelos eixos direita/cima extraídos de `viewMatrix` — a
 * mesma conta pra N instâncias, de graça.
 *
 * Culling: bounding sphere cobrindo origem+raio+altura pro frustum culling
 * padrão do three pegar sozinho, MAIS um corte por distância (esconde o
 * emissor inteiro além de `cullDistance`) — um `useFrame` por EMISSOR, não
 * por partícula, mesma classe de custo do `SunRig` seguindo o player.
 */

export type ParticleKind = "dust" | "ember" | "spark" | "magic" | "mist";

interface Preset {
  url: string;
  color: string;
  blending: THREE.Blending;
  size: number;
  rise: number;
  speed: number;
  drift: number;
  opacity: number;
}

const PRESETS: Record<ParticleKind, Preset> = {
  // poeira — área seca, deriva lenta, quase sem subida
  dust: { url: "/assets/particles/dust.png", color: "#c9b78c", blending: THREE.NormalBlending, size: 0.5, rise: 0.8, speed: 0.18, drift: 0.35, opacity: 0.5 },
  // brasa — fogueira, sobe rápido, aditivo (brilha)
  ember: { url: "/assets/particles/ember.png", color: "#ff9a3c", blending: THREE.AdditiveBlending, size: 0.35, rise: 2.2, speed: 0.55, drift: 0.25, opacity: 0.85 },
  // faísca — acompanha a fogueira, mais rápida e pequena
  spark: { url: "/assets/particles/spark.png", color: "#ffd27a", blending: THREE.AdditiveBlending, size: 0.22, rise: 3.0, speed: 0.9, drift: 0.4, opacity: 0.9 },
  // brilho mágico — área mágica, flutua devagar, aditivo suave
  magic: { url: "/assets/particles/magic.png", color: "#b98cff", blending: THREE.AdditiveBlending, size: 0.6, rise: 0.5, speed: 0.12, drift: 0.5, opacity: 0.7 },
  // névoa d'água — perto do lago, deriva quase parada, translúcida
  mist: { url: "/assets/particles/mist.png", color: "#dff0f5", blending: THREE.NormalBlending, size: 1.1, rise: 0.15, speed: 0.06, drift: 0.6, opacity: 0.3 },
};

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
          uSpeed: { value: preset.speed },
          uDrift: { value: preset.drift },
        },
      }),
    [preset, scale],
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
     * `InstancedMesh` INTEIRO. Era por isso que "5 InstancedMesh confirmados
     * por script" não aparecia na tela: cortado antes do draw call, não
     * depois. A esfera certa é centrada no PRÓPRIO `origin`.
     */
    m.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(origin[0], origin[1], origin[2]), radius + preset.rise + 1);
  }, [count, origin, radius, preset.rise]);

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
