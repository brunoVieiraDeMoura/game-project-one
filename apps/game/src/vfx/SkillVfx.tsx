import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import type { TerrainQuery } from "@ragnarok/engine-core";
import { cellToWorld, type LegacyMapping } from "../net/legacyCells";
import { interpolatedCell, useWorldStore } from "../net/worldStore";
import { useSkillCatalog } from "../net/skillCatalog";
import { useVfxStore, type VfxInstance } from "./vfxStore";
import { moldarMalhaTerreno } from "../play/pickGround";
import { ColdBoltImpact } from "./mage/cold-bolt/ColdBoltImpact";
import { ColdBoltCastFrost } from "./mage/cold-bolt/ColdBoltCastFrost";
import { FireLanceImpact } from "./mage/fire-lance/FireLanceImpact";
import { FireLanceCastFire } from "./mage/fire-lance/FireLanceCastFire";
import { ThunderStormImpact } from "./mage/thunder-storm/ThunderStormImpact";
import { ThunderStormCastElectric } from "./mage/thunder-storm/ThunderStormCastElectric";
import { mobModel, NPC_MODEL } from "../entities/mobModels";
import { classModelFor } from "../entities/classModels";

/** skills de "N hits com VFX próprio" (skill_db, nome Aegis — nunca id, ele
 * diverge de projeto pra projeto no rAthena) — cada uma tem um par
 * cast/impacto PRÓPRIO em vez do disco de área/flash genérico. Lookup por
 * Aegis em vez de um `if` por skill nova (o registro de duração fica em
 * `vfx/mage/multiHitRegistry`, usado por `net/useWorldEvents`; aqui só
 * escolhe QUAL componente desenhar — são preocupações diferentes, mesma
 * fonte de nomes Aegis). */
const CAST_VFX: Record<string, typeof ColdBoltCastFrost> = {
  MG_COLDBOLT: ColdBoltCastFrost,
  MG_FIREBOLT: FireLanceCastFire,
  MG_THUNDERSTORM: ThunderStormCastElectric,
};
const IMPACT_VFX: Record<string, typeof ColdBoltImpact> = {
  MG_COLDBOLT: ColdBoltImpact,
  MG_FIREBOLT: FireLanceImpact,
  MG_THUNDERSTORM: ThunderStormImpact,
};

/**
 * Tamanho visual do ALVO — MESMO catálogo que `net/NetEntity` já usa pra
 * escalar o modelo 3D (`mobModel`/`classModelFor`, nunca uma tabela nova) —
 * pra escalar o aro/flash/fragmentos do impacto proporcionalmente (pedido:
 * "um Poring pequeno e um monstro grande não devem receber o mesmo tamanho
 * de impacto"). `charScale` (multiplicador GLOBAL de sessão) fica de fora
 * de propósito: ele é igual pra toda entidade, não diferencia espécie — só
 * o `scale` PRÓPRIO de cada bicho/classe importa aqui.
 */
function targetVisualScale(gid: number | undefined): number {
  if (gid === undefined) return 1;
  const entity = useWorldStore.getState().entities[gid];
  if (!entity) return 1;
  if (entity.kind === "mob") return mobModel(entity.job).scale;
  if (entity.kind === "player") return classModelFor(entity.job).scale;
  if (entity.kind === "npc") return NPC_MODEL.scale;
  return 1;
}

/** subdivisões dos discos moldados — mesma ordem de grandeza da mira e do marcador de destino */
const VFX_MOLD_SEGS = 8;
/** um dedo acima do chão, como todo decal deste projeto */
const VFX_ALTURA = 0.05;

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
  terrain,
}: {
  map: GameMap;
  mapping: LegacyMapping;
  /** largura de uma célula em unidades de mundo — o efeito é medido EM CÉLULAS
   * (a área de uma skill do RO é "5x5 células"), senão o mesmo disco fica
   * gigante num mapa e invisível noutro quando o hexScale muda. */
  cellSize: number;
  /** para o disco de área/conjuração vestir o relevo (ver `AreaCell`/`AreaDisc`) */
  terrain: TerrainQuery;
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
        <VfxNode key={effect.id} effect={effect} map={map} mapping={mapping} cellSize={cellSize} terrain={terrain} />
      ))}
    </group>
  );
}

function VfxNode({
  effect,
  map,
  mapping,
  cellSize,
  terrain,
}: {
  effect: VfxInstance;
  map: GameMap;
  mapping: LegacyMapping;
  cellSize: number;
  terrain: TerrainQuery;
}) {
  const group = useRef<THREE.Group>(null);
  const born = useRef(performance.now());

  // O tamanho do disco de conjuração tem que ser o da ÁREA DE VERDADE da
  // skill, não um chute — sem o catálogo, o disco saía sempre do mesmo
  // tamanho (2 células) para qualquer magia, do Bash à Storm Gust. O nível de
  // quem conjura raramente se sabe (mob, ou outro jogador) — `ensure` sem
  // `niveis` cai no nível 1, a mesma lacuna honesta do resto do catálogo.
  const areaInfo = useSkillCatalog((s) => (effect.kind === "cast" ? s.byId[effect.skillId] : undefined));
  // "impact" também precisa do catálogo — é o `aegisName` que decide entre o
  // flash genérico e um visual próprio (`ColdBoltImpact`); sem `ensure` aqui,
  // o primeiro impacto de uma skill nunca antes vista no catálogo cai sempre
  // no flash genérico (mesmo lapso honesto do disco de conjuração acima).
  const impactInfo = useSkillCatalog((s) => (effect.kind === "impact" ? s.byId[effect.skillId] : undefined));
  useEffect(() => {
    if ((effect.kind === "cast" || effect.kind === "impact") && effect.skillId) {
      useSkillCatalog.getState().ensure([effect.skillId]);
    }
  }, [effect.kind, effect.skillId]);

  // Posição JÁ no primeiro render: só posicionar no useFrame deixa o efeito
  // aparecer um frame na origem do mundo — um anel gigante no canto do mapa,
  // que é exatamente o que se via.
  const initial = useMemo(
    () => worldPositionOf(effect, map, mapping) ?? { x: 0, y: -999, z: 0 },
    [effect, map, mapping],
  );

  /**
   * `area`/`cast` são PRESOS À CÉLULA — `worldPositionOf` devolve o mesmo
   * ponto do nascimento ao fim da vida (não seguem entidade nenhuma). Por
   * isso eles NÃO passam pelo grupo animado abaixo: `AreaCell`/`AreaDisc` se
   * posicionam e se moldam ao relevo sozinhos, uma vez, em vez de herdar um
   * `position`/`scale` que mudaria a forma da malha moldada a cada quadro.
   */
  const presoNaCelula = effect.kind === "area" || effect.kind === "cast";

  useFrame(() => {
    if (presoNaCelula) return;
    const g = group.current;
    if (!g) return;

    const world = worldPositionOf(effect, map, mapping);
    if (!world) return;

    // "vida" do efeito em 0..1 — o anel sobe, o flash cresce
    const life = Math.min(1, (performance.now() - born.current) / 600);

    // A altura é SEMPRE recalculada a partir do chão. Somar no y do frame
    // anterior fazia o anel subir sem parar (ele saía voando do mapa).
    const lift = effect.kind === "buff" ? life * cellSize : 0;
    g.position.set(world.x, world.y + 0.05 + lift, world.z);

    // A escala de célula já está no `scale` do grupo (montado no primeiro
    // render); aqui só entra a animação, senão o efeito fica cellSize² e cobre
    // meia tela.
    const grow = effect.kind === "impact" ? 0.4 + life * 0.8 : 1 - life * 0.3;
    g.scale.setScalar(grow * cellSize);
  });

  if (effect.kind === "area") {
    return <AreaCell cx={initial.x} cz={initial.z} raioMundo={cellSize / 2} terrain={terrain} />;
  }
  if (effect.kind === "cast") {
    // skills de "N hits" ganham o VFX próprio no CASTER em vez do disco de
    // área genérico — nenhuma delas é skill de chão pro cliente (mesmo
    // Thunder Storm, cujo "cast" pedido é no caster, não no alvo), então o
    // disco sempre saía do tamanho mínimo (`areaRadius` 0) sem dizer nada.
    const CastComponent = areaInfo?.aegisName ? CAST_VFX[areaInfo.aegisName] : undefined;
    if (CastComponent) {
      // `effect.gid` é o CASTER pra "cast" de skill de alvo (ver
      // `net/useWorldEvents.onSkillCasting`) — sentinela -1 se por algum
      // motivo vier ausente, só faz `anchorDeArma` não achar nada e o
      // componente cair no fallback (peito do personagem), nunca quebra.
      return <CastComponent x={initial.x} y={initial.y} z={initial.z} sourceGid={effect.gid ?? -1} expiresAt={effect.expiresAt} />;
    }
    const raioMundo = Math.max(0.5, (areaInfo?.areaRadius ?? 0) + 0.5) * cellSize;
    return <AreaDisc cx={initial.x} cz={initial.z} raioMundo={raioMundo} terrain={terrain} />;
  }

  const ImpactComponent =
    effect.kind === "impact" && impactInfo?.aegisName ? IMPACT_VFX[impactInfo.aegisName] : undefined;
  // só calcula (lookup no worldStore) quando realmente vai ser usado
  const targetScale = useMemo(
    () => (ImpactComponent ? targetVisualScale(effect.gid) : 1),
    [ImpactComponent, effect.gid],
  );

  return (
    <group ref={group} position={[initial.x, initial.y + 0.05, initial.z]} scale={cellSize}>
      {effect.kind === "buff" ? (
        <BuffRing />
      ) : ImpactComponent === ThunderStormImpact ? (
        // única exceção com prop própria no lookup genérico: Thunder Storm é
        // AoE de verdade (skill_db `type:"area"`) — os raios decorativos
        // caem espalhados no raio REAL da área, não num chute fixo. Cold
        // Bolt/Fire Lance continuam com a MESMA assinatura de sempre.
        <ThunderStormImpact
          damage={effect.damage}
          crit={effect.crit}
          onSelf={effect.onSelf}
          targetScale={targetScale}
          areaRadius={impactInfo?.areaRadius}
        />
      ) : ImpactComponent ? (
        <ImpactComponent damage={effect.damage} crit={effect.crit} onSelf={effect.onSelf} targetScale={targetScale} />
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
function AreaCell({
  cx,
  cz,
  raioMundo,
  terrain,
}: {
  /** centro da célula, em mundo */
  cx: number;
  cz: number;
  /** meia-largura do quadrado, em unidades de mundo (já com `cellSize` embutido) */
  raioMundo: number;
  terrain: TerrainQuery;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        // sempre por CIMA do chão, propositalmente: é VFX de skill, e a regra
        // do projeto é ela ficar visível por cima do que estiver na frente —
        // inclusive o personagem (ver `net/GlowChao`, que é o oposto porque é
        // decoração de UI, não efeito de combate). Moldar (abaixo) resolve a
        // FORMA sumir na encosta; `depthTest` continua fora disso.
        depthTest: false,
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

  // Molda UMA VEZ: a célula não se move nem muda de tamanho durante a vida do
  // efeito (ao contrário do marcador de destino, que segue o mouse). Vértices
  // em coordenada de MUNDO, como `play/AimPreview` — por isso não há
  // `rotation` na malha: ela já nasce deitada, não gira depois de deitada.
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    moldarMalhaTerreno(m.geometry as THREE.BufferGeometry, cx, cz, raioMundo, VFX_MOLD_SEGS, VFX_ALTURA, terrain);
  }, [cx, cz, raioMundo, terrain]);

  return (
    <mesh ref={mesh}>
      <planeGeometry args={[1, 1, VFX_MOLD_SEGS, VFX_MOLD_SEGS]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/**
 * Disco no chão com gradiente radial (shader — sem textura no projeto).
 *
 * Só usado para `kind: "cast"` — o círculo que aparece quando alguém COMEÇA a
 * conjurar uma skill de área, avisando onde ela vai cair antes de sair.
 *
 * Malha de PLANO com máscara circular no fragmento (`d = distance(vUv,0.5)`),
 * não `circleGeometry`: `moldarMalhaTerreno` espera a topologia em GRADE
 * (linha × coluna) de um `PlaneGeometry`, a mesma técnica de
 * `play/AimPreview` — e é de lá que ela é copiada, letra por letra, para o
 * disco de conjuração parecer com a prévia que o jogador já viu antes de
 * clicar.
 */
function AreaDisc({
  cx,
  cz,
  raioMundo,
  terrain,
}: {
  /** centro da célula-alvo, em mundo */
  cx: number;
  cz: number;
  /** raio do disco em unidades de mundo (já com `cellSize` embutido) */
  raioMundo: number;
  terrain: TerrainQuery;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        // idem `AreaCell`: VFX de skill fica por cima de propósito.
        depthTest: false,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color("#7dd3fc") },
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
    [],
  );

  useFrame((_, dt) => {
    material.uniforms.uTime!.value += dt;
  });

  useEffect(() => () => material.dispose(), [material]);

  // Molda UMA VEZ, mesma razão de `AreaCell`: a célula-alvo não se move nem
  // muda de raio durante a vida do efeito.
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    moldarMalhaTerreno(m.geometry as THREE.BufferGeometry, cx, cz, raioMundo, VFX_MOLD_SEGS, VFX_ALTURA, terrain);
  }, [cx, cz, raioMundo, terrain]);

  return (
    <mesh ref={mesh}>
      <planeGeometry args={[1, 1, VFX_MOLD_SEGS, VFX_MOLD_SEGS]} />
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
