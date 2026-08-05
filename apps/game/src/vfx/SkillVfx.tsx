import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { cellToWorld, type LegacyMapping } from "../net/legacyCells";
import { interpolatedCell, useWorldStore } from "../net/worldStore";
import { useVfxStore, type VfxInstance } from "./vfxStore";

/**
 * Efeitos de skill na cena.
 *
 * Placeholders combinados (tenta-entender.txt §3): área = disco com gradiente
 * radial no chão, buff = anel subindo no personagem, impacto = flash rápido.
 * Nenhum deles decide nada — todos nascem de um pacote do servidor e morrem por
 * tempo ou por ordem dele.
 */
export function SkillVfx({
  map,
  mapping,
  cellSize,
}: {
  map: GameMap;
  mapping: LegacyMapping;
  /** largura de uma célula em unidades de mundo — o efeito é medido EM CÉLULAS
   * (a área de uma skill do RO é "5x5 células"), senão o mesmo disco fica
   * gigante num mapa e invisível noutro quando o hexScale muda. */
  cellSize: number;
}) {
  const effects = useVfxStore((s) => s.effects);

  // Limpeza por tempo roda no laço de render (não em setInterval): efeito curto
  // tem que sumir no frame certo, não "em até 200ms".
  useFrame(() => {
    useVfxStore.getState().prune(performance.now());
  });

  // grupo NOMEADO e inerte, só como rótulo para a contagem por categoria do
  // flight recorder (`core/diagnostics/cenaProbe`)
  return (
    <group name="skill-vfx">
      {effects.map((effect) => (
        <VfxNode key={effect.id} effect={effect} map={map} mapping={mapping} cellSize={cellSize} />
      ))}
    </group>
  );
}

function VfxNode({
  effect,
  map,
  mapping,
  cellSize,
}: {
  effect: VfxInstance;
  map: GameMap;
  mapping: LegacyMapping;
  cellSize: number;
}) {
  const group = useRef<THREE.Group>(null);
  const born = useRef(performance.now());

  // Posição JÁ no primeiro render: só posicionar no useFrame deixa o efeito
  // aparecer um frame na origem do mundo — um anel gigante no canto do mapa,
  // que é exatamente o que se via.
  const initial = useMemo(
    () => worldPositionOf(effect, map, mapping) ?? { x: 0, y: -999, z: 0 },
    [effect, map, mapping],
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;

    const world = worldPositionOf(effect, map, mapping);
    if (!world) return;

    // "vida" do efeito em 0..1 — o disco cresce e some, o anel sobe
    const life = Math.min(1, (performance.now() - born.current) / 600);

    // A altura é SEMPRE recalculada a partir do chão. Somar no y do frame
    // anterior fazia o anel subir sem parar (ele saía voando do mapa).
    const lift = effect.kind === "buff" ? life * cellSize : 0;
    g.position.set(world.x, world.y + 0.05 + lift, world.z);

    // A escala de célula já está no `scale` do grupo (montado no primeiro
    // render); aqui só entra a animação, senão o efeito fica cellSize² e cobre
    // meia tela.
    const grow =
      effect.kind === "impact" ? 0.4 + life * 0.8 : effect.kind === "buff" ? 1 - life * 0.3 : 1;
    g.scale.setScalar(grow * cellSize);
  });

  return (
    <group ref={group} position={[initial.x, initial.y + 0.05, initial.z]} scale={cellSize}>
      {effect.kind === "area" ? (
        <AreaCell />
      ) : effect.kind === "cast" ? (
        <AreaDisc kind="cast" />
      ) : effect.kind === "buff" ? (
        <BuffRing />
      ) : (
        <ImpactFlash />
      )}
    </group>
  );
}

/**
 * UMA CÉLULA pintada — a área da skill, célula a célula.
 *
 * Cada `skill:ground` do servidor é uma unidade de skill plantada em UMA célula
 * (`skill_unit`, o layout do `Unit.Layout`). Desenhando um disco de duas células
 * em cada uma, uma Storm Gust — que planta 81 unidades — virava 81 círculos
 * sobrepostos, e o que se via era uma mancha de bolhas em vez da área.
 *
 * Pintando a célula, o conjunto das unidades DESENHA a área: o quadrado 9×9
 * aparece porque ele é 9×9 de células, sem ninguém precisar saber o raio.
 *
 * O quadrado é 1×1 no espaço local e o grupo é escalado por `cellSize`, então
 * ele cobre exatamente a célula em qualquer escala de mundo.
 */
function AreaCell() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color("#c084fc") }, uTime: { value: 0 } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        /**
         * Miolo fraco e BORDA marcada.
         *
         * Com o preenchimento chapado, células vizinhas viram um bloco só e a
         * grade some — e é a grade que diz quais células pegam. A borda desenha
         * a divisão sem precisar de linha geométrica nenhuma.
         */
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            vec2 d = abs(vUv - 0.5) * 2.0;
            float borda = max(d.x, d.y);
            float linha = smoothstep(0.78, 1.0, borda);
            float pulso = 0.8 + 0.2 * sin(uTime * 5.0);
            gl_FragColor = vec4(uColor, (0.16 + linha * 0.5) * pulso);
          }
        `,
      }),
    [],
  );

  useFrame((_, dt) => {
    material.uniforms.uTime!.value += dt;
  });
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/** disco no chão com gradiente radial (shader — sem textura no projeto) */
function AreaDisc({ kind }: { kind: "area" | "cast" }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color(kind === "cast" ? "#7dd3fc" : "#c084fc") },
          uTime: { value: 0 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        // gradiente do centro para a borda + pulso lento; a borda fica mais
        // forte que o miolo, como um círculo mágico
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float d = distance(vUv, vec2(0.5)) * 2.0;
            if (d > 1.0) discard;
            float edge = smoothstep(0.75, 1.0, d);
            float core = 1.0 - smoothstep(0.0, 0.9, d);
            float pulse = 0.75 + 0.25 * sin(uTime * 4.0);
            gl_FragColor = vec4(uColor, (core * 0.35 + edge * 0.75) * pulse);
          }
        `,
      }),
    [kind],
  );

  useFrame((_, dt) => {
    material.uniforms.uTime!.value += dt;
  });

  useEffect(() => () => material.dispose(), [material]);

  return (
    // 2 células de raio: o tamanho médio de área do RO (5x5 células)
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[2, 40]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/** anel que sobe no personagem (buff) */
/**
 * Buff: anel deitado + coluna translúcida.
 *
 * Só o anel no chão desaparecia na câmera do jogo (visto quase de lado, um anel
 * plano vira uma linha). A coluna dá volume e lê de qualquer ângulo.
 */
function BuffRing() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, 0.7, 28]} />
        <meshBasicMaterial color="#fde047" transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 1.2, 20, 1, true]} />
        <meshBasicMaterial color="#fde047" transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** flash de impacto */
function ImpactFlash() {
  return (
    <mesh position={[0, 0.6, 0]}>
      <sphereGeometry args={[0.45, 14, 10]} />
      <meshBasicMaterial color="#fca5a5" transparent opacity={0.6} depthWrite={false} />
    </mesh>
  );
}

/** onde o efeito é desenhado: na entidade (impacto/buff) ou na célula (área). */
function worldPositionOf(
  effect: VfxInstance,
  map: GameMap,
  mapping: LegacyMapping,
): { x: number; y: number; z: number } | null {
  if (effect.cell) {
    return cellToWorld(map, mapping, effect.cell.x, effect.cell.y);
  }
  if (!effect.gid) return null;

  const world = useWorldStore.getState();
  const source = effect.gid === world.selfGid ? world.self : world.entities[effect.gid];
  if (!source) return null;

  const cell = interpolatedCell(source, performance.now());
  return cellToWorld(map, mapping, cell.x, cell.y);
}
