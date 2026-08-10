import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainQuery } from "@ragnarok/engine-core";
import { useWorldStore } from "../net/worldStore";
import { usePlayerStore } from "../net/playerStore";
import { useAimStore } from "../net/aimStore";
import { useSkillTargetStore } from "../net/skillTargetStore";
import { useSkillWalkStore } from "../net/skillWalkStore";
import { moldarMalhaTerreno } from "./pickGround";

/**
 * O anel de alcance da AÇÃO ATUAL — não só do ataque básico.
 *
 * "Até onde a ação que estou prestes a executar alcança": sem skill nenhuma
 * em jogo, é o ataque básico; indo até o alcance de uma skill de alvo/chão, é
 * o alcance DELA; com uma skill em MIRA (`useAimStore`), é `AimPreview` quem
 * desenha (mesmo raciocínio, mesma técnica de aro, mas gatilho e vida
 * diferentes — ali a mira segue o cursor, aqui o anel segue o personagem) —
 * este componente fica CALADO nesse estado, para não empilhar dois círculos.
 *
 * A prioridade (a primeira que estiver ativa vence, e só uma pode estar por
 * vez — as ordens de vários quadros já se cancelam entre si em `net/acoes`):
 *
 *  1. mirando uma skill (`aimStore.skill`) → nada aqui, `AimPreview` cobre;
 *  2. indo até o alcance para castar numa CRIATURA (`skillTargetStore.
 *     pendente`, ex.: Double Strafe com alvo já selecionado, fora do
 *     alcance) → o alcance É o da skill;
 *  3. indo até o alcance para castar numa CÉLULA (`skillWalkStore.
 *     pendente`) → idem, alcance da skill;
 *  4. só então o ataque básico (`worldStore.target` selecionado) →
 *     `playerStore.stats.atkRange`.
 *
 * As DUAS primeiras skills (2 e 3) guardam `pendente.raio` já resolvido por
 * `net/skillCatalog.alcanceEfetivoDaSkill` no instante em que a ordem nasceu
 * (`net/acoes.castarEmAlvo` e `net/NetPlayer`, o clique-no-chão com mira de
 * chão) — o MESMO valor que decide até onde `NetPlayer` anda
 * (`celulaNoAlcance`). Nenhum cálculo próprio aqui: por isso Double Strafe
 * nunca pode mostrar um círculo diferente de até onde ela realmente anda.
 *
 * Por que Double Strafe NÃO usa `atkRange`: confirmado no rAthena
 * (`skill_get_range2`, skill.cpp:324) que o alcance de skill com `Range`
 * negativo no skill_db (Double Strafe: `-9`) só vira "o alcance da arma"
 * quando `skillrange_from_weapon` está ligado (`skillrange_from_weapon: 0`
 * por padrão, `conf/battle/skill.conf:83`, não religado em
 * `rathena-conf/`) — aqui ele SEMPRE cai no outro ramo, `abs(-9)` = 9 de
 * base. Vulture's Eye ainda soma (a skill tem `Flags: AlterRangeVulture:
 * true`), mas por cima do 9, não do 5 do Bow — daí o ataque básico chegar a
 * 15 (5+10) e Double Strafe a 19 (9+10): bônus igual, base diferente,
 * números diferentes. `atkRange` e o alcance de skill são conceitos
 * DIFERENTES por design do próprio rAthena, não um bug a esconder.
 *
 * ESC volta o círculo para o ataque básico DE GRAÇA: `hotkeys.ts` já chama
 * `skillTargetStore.parar()`/`skillWalkStore.parar()` ao cancelar, e sem
 * `pendente` a prioridade 4 assume sozinha — nada aqui precisa saber que
 * ESC foi apertado.
 *
 * Só aparece com alcance MAIOR que 1 célula: um aro em cima de toda arma/
 * skill corpo a corpo seria ruído que ninguém pediu.
 */

const COR = "#7dd3fc";
const ALTURA = 0.08;
const SEGS = 24;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** faixa fina na borda — mesma fórmula do `uAnel` de `AimPreview`, opacidade um pouco mais alta pra ficar legível sem mira nenhuma aberta */
const FRAG = /* glsl */ `
uniform vec3 uCor;
uniform float uTempo;
varying vec2 vUv;
void main() {
  float d = length((vUv - 0.5) * 2.0);
  if (d > 1.0) discard;
  float pulso = 0.75 + 0.25 * sin(uTempo * 2.2);
  float a = smoothstep(0.88, 1.0, d) * 0.6;
  gl_FragColor = vec4(uCor, a * pulso);
}
`;

export function AttackRangeCircle({
  playerPos,
  cellSize,
  terrain,
}: {
  /** onde o personagem está, em mundo — o círculo nasce nele e o acompanha */
  playerPos: React.MutableRefObject<THREE.Vector3>;
  cellSize: number;
  terrain: TerrainQuery;
}) {
  const mirando = useAimStore((s) => s.skill !== null);
  const pendenteAlvo = useSkillTargetStore((s) => s.pendente);
  const pendenteChao = useSkillWalkStore((s) => s.pendente);
  const temAlvoBasico = useWorldStore((s) => s.target !== null);
  const atkRangeBasico = usePlayerStore((s) => s.stats.atkRange);

  // prioridade fixa — ver o comentário do arquivo. `mirando` vence sem raio
  // nenhum: é a AUSÊNCIA de círculo aqui que deixa o AimPreview sozinho.
  const temAlvo = !mirando && (pendenteAlvo !== null || pendenteChao !== null || temAlvoBasico);
  const raioAtual = mirando
    ? 0
    : (pendenteAlvo?.raio ?? pendenteChao?.raio ?? atkRangeBasico);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uCor: { value: new THREE.Color(COR) }, uTempo: { value: 0 } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        // mesma razão de `AimPreview`: a malha veste o relevo por amostra
        // própria, que diverge por um triz da malha REAL do chão — sem isto
        // o aro piscava entrando/saindo do z-fight.
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  const mesh = useRef<THREE.Mesh>(null);
  /** em que célula/raio a malha foi moldada pela última vez — não remolda parado */
  const moldadoEm = useRef<string | null>(null);

  useFrame((_, dt) => {
    // sem alvo (ou arma sem alcance de verdade), este quadro não tem nada a
    // fazer — hook registrado é hook que roda, mas o corpo sai cedo antes de
    // tocar terrain/uniform (mesma guarda que `AimPreview` já documenta).
    if (!temAlvo || raioAtual <= 1) return;
    material.uniforms.uTempo!.value += dt;

    const m = mesh.current;
    if (!m) return;
    const p = playerPos.current;
    const chave = `${Math.round(p.x / cellSize)},${Math.round(p.z / cellSize)},${raioAtual}`;
    if (moldadoEm.current === chave) return;
    moldadoEm.current = chave;
    moldarMalhaTerreno(m.geometry as THREE.BufferGeometry, p.x, p.z, raioAtual * cellSize, SEGS, ALTURA, terrain);
  });

  if (!temAlvo || raioAtual <= 1) return null;

  return (
    <mesh ref={mesh} material={material} renderOrder={-1}>
      <planeGeometry args={[1, 1, SEGS, SEGS]} />
    </mesh>
  );
}
