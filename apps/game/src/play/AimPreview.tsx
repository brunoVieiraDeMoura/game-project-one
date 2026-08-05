import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainQuery } from "@ragnarok/engine-core";
import { useAimStore } from "../net/aimStore";
import { distanciaDeAtaque } from "../net/attackStore";
import { raioDeAlcance, useSkillCatalog } from "../net/skillCatalog";

/**
 * O que a skill mirada vai pegar, e de onde dá para lançá-la.
 *
 * Duas informações, e as duas vinham faltando: escolher uma skill de área
 * acendia o cursor e mais nada, então o jogador clicava no escuro — sem saber
 * onde a magia cai nem se está perto o bastante. O rAthena recusa fora de
 * alcance (`skill_castend_pos` confere antes de gastar SP), e a recusa é uma
 * mensagem de falha, não um aviso ANTES do clique.
 *
 * Desenha:
 *  • **alcance** — um anel em volta do personagem, no raio `range` da skill. É
 *    a fronteira do que o servidor aceita;
 *  • **área** — um disco na célula apontada, no raio `areaRadius`. É o que vai
 *    ser atingido.
 *
 * Os dois vêm do catálogo (`net/skillCatalog`), que já resolve os campos por
 * NÍVEL — a área da Storm Gust nível 1 não é a do nível 10.
 *
 * Skill sem área (`areaRadius` 0) mostra só o alcance: inventar um disco de uma
 * célula sugeriria uma área que ela não tem.
 */

/** cor do que está DENTRO do alcance; fora dele, o vermelho abaixo */
const COR_OK = "#7dd3fc";
const COR_FORA = "#e0524a";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * `uAnel` escolhe entre a MANCHA da área e o aro do alcance — e as duas têm
 * formas diferentes de propósito.
 *
 *  • **alcance** é um ARO REDONDO. O rAthena mede o alcance da skill em
 *    distância, e é assim que ele já estava desenhado;
 *  • **área** é um CÍRCULO INSCRITO no quadrado que a skill pega. A área de
 *    verdade é quadrada — `Unit.Layout` planta um quadrado de lado `2r+1`
 *    células (`skill_init_unit_layout`, skill.cpp:14122) —, e o desenho
 *    quadrado chegou a existir aqui por fidelidade. Foi rejeitado no uso: o
 *    informativo pedido é redondo, encostando nos quatro lados do quadrado. O
 *    tamanho continua sendo o da área; só a silhueta é arredondada.
 *
 * Os dois são círculo, então o `d` é o mesmo; o que muda é onde o alpha vive —
 * no aro ele existe só na borda. Um `if` resolve sem manter dois shaders.
 */
const FRAG = /* glsl */ `
uniform vec3 uCor;
uniform float uTempo;
uniform float uAnel;
varying vec2 vUv;
void main() {
  float d = length((vUv - 0.5) * 2.0);
  if (d > 1.0) discard;
  float pulso = 0.8 + 0.2 * sin(uTempo * 3.5);
  float a;
  if (uAnel > 0.5) {
    // aro: uma faixa fina colada na borda
    a = smoothstep(0.88, 1.0, d) * 0.55;
  } else {
    // mancha: miolo fraco e borda marcada, para a fronteira ser legível
    float borda = smoothstep(0.82, 1.0, d);
    float miolo = 1.0 - smoothstep(0.0, 0.95, d);
    a = miolo * 0.28 + borda * 0.6;
  }
  gl_FragColor = vec4(uCor, a * pulso);
}
`;

function useMaterialDeMira(anel: boolean) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uCor: { value: new THREE.Color(COR_OK) },
          uTempo: { value: 0 },
          uAnel: { value: anel ? 1 : 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [anel],
  );
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

export function AimPreview({
  playerPos,
  hoverPos,
  cellSize,
  terrain,
}: {
  /** onde o personagem está, em mundo (o anel de alcance nasce nele) */
  playerPos: React.MutableRefObject<THREE.Vector3>;
  /** célula apontada pelo mouse, em mundo — a mesma que o GroundInteract calcula */
  hoverPos: React.MutableRefObject<{ x: number; z: number } | null>;
  cellSize: number;
  terrain: TerrainQuery;
}) {
  const mirando = useAimStore((s) => s.skill);
  const info = useSkillCatalog((s) => (mirando ? s.byId[mirando.id] : undefined));

  const matArea = useMaterialDeMira(false);
  const matAlcance = useMaterialDeMira(true);
  const area = useRef<THREE.Mesh>(null);
  const alcance = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    /**
     * Sem mira aberta, este quadro não tem nada a fazer.
     *
     * O `return null` lá embaixo esconde o desenho, mas ele vem DEPOIS do hook —
     * e hook registrado é hook que roda. Sem esta saída, dois uniforms eram
     * incrementados e `terrain.getHeight` era chamado duas vezes por quadro,
     * 60 vezes por segundo, durante a partida inteira, para alimentar uma malha
     * que não está na cena. O relógio dos uniforms também não precisa correr:
     * quando a mira abrir, ele recomeça de onde parou e ninguém vê diferença
     * numa animação cíclica.
     */
    if (!mirando || mirando.mode !== "ground") return;
    matArea.uniforms.uTempo!.value += dt;
    matAlcance.uniforms.uTempo!.value += dt;
    const p = playerPos.current;
    const h = hoverPos.current;

    const anelMesh = alcance.current;
    if (anelMesh) {
      // o anel acompanha o personagem — ele anda enquanto a mira está aberta
      anelMesh.position.set(p.x, terrain.getHeight(p.x, p.z) + ALTURA, p.z);
    }

    const areaMesh = area.current;
    if (!areaMesh) return;
    if (!h) {
      areaMesh.visible = false;
      return;
    }
    areaMesh.visible = true;
    areaMesh.position.set(h.x, terrain.getHeight(h.x, h.z) + ALTURA, h.z);

    /**
     * Fora do alcance, a área fica VERMELHA.
     *
     * É o aviso que faltava: o servidor recusa antes de gastar SP, mas só
     * DEPOIS do clique. A conta aqui é literalmente a dele —
     * `battle_check_range` (battle.cpp:8226) chama `check_distance_client_bl`
     * para jogador, a mesma `distance_client` do ataque normal. Usar um
     * `hypot` cru pintaria de vermelho uma célula que o servidor aceitaria (e
     * vice-versa) bem na borda, que é onde o jogador olha.
     */
    const raio = raioDeAlcance(info?.range);
    const dx = Math.round((h.x - p.x) / cellSize);
    const dz = Math.round((h.z - p.z) / cellSize);
    const dentro = raio <= 0 || distanciaDeAtaque(dx, dz) <= raio;
    (matArea.uniforms.uCor!.value as THREE.Color).set(dentro ? COR_OK : COR_FORA);
  });

  if (!mirando || mirando.mode !== "ground") return null;

  const raio = raioDeAlcance(info?.range);
  const raioArea = Math.max(0, info?.areaRadius ?? 0);

  return (
    <group>
      {raio > 0 && (
        <mesh ref={alcance} rotation={[-Math.PI / 2, 0, 0]} material={matAlcance} renderOrder={-1}>
          {/* +0,5 célula: o aro marca a BORDA EXTERNA da última célula que o
              servidor aceita, não o centro dela — desenhado no raio cravado, a
              cor ainda dizia "pode" com o cursor já fora do aro */}
          <planeGeometry args={[(raio + 0.5) * 2 * cellSize, (raio + 0.5) * 2 * cellSize]} />
        </mesh>
      )}
      {raioArea > 0 && (
        <mesh ref={area} rotation={[-Math.PI / 2, 0, 0]} material={matArea} renderOrder={-1}>
          {/* +0,5 célula: a área do RO é contada em células INTEIRAS ("5x5"),
              então o raio 2 cobre do centro da célula até a borda da segunda */}
          <planeGeometry args={[(raioArea + 0.5) * 2 * cellSize, (raioArea + 0.5) * 2 * cellSize]} />
        </mesh>
      )}
    </group>
  );
}

/** um dedo acima do chão, para não brigar em z com o terreno */
const ALTURA = 0.08;
