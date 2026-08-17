import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
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
import { ThunderStormCastElectric } from "./mage/thunder-storm/ThunderStormCastElectric";
import { LightBoltImpact } from "./mage/light-bolt/LightBoltImpact";
import { SoulStrikeImpact } from "./mage/soul-strike/SoulStrikeImpact";
import { SoulStrikeCastSpirit } from "./mage/soul-strike/SoulStrikeCastSpirit";
import { FrostDiverImpact } from "./mage/frost-diver/FrostDiverImpact";
import { StoneCurseCast } from "./mage/stone-curse/StoneCurseCast";
import { StoneCurseImpact } from "./mage/stone-curse/StoneCurseImpact";
import { mobModel, NPC_MODEL } from "../entities/mobModels";
import { anchorDeArma } from "../entities/weaponAnchors";
import { classModelFor } from "../entities/classModels";
import { aoImpactoMultiHit } from "../audio/mage/multiHitCastAudio";
import { marcarDesmontagemVfx, marcarMontagemVfx } from "../core/diagnostics/vfxProbe";

/** skills de "N hits com VFX próprio" (skill_db, nome Aegis — nunca id, ele
 * diverge de projeto pra projeto no rAthena) — cada uma tem um par
 * cast/impacto PRÓPRIO em vez do disco de área/flash genérico. Lookup por
 * Aegis em vez de um `if` por skill nova (o registro de duração fica em
 * `vfx/mage/multiHitRegistry`, usado por `net/useWorldEvents`; aqui só
 * escolhe QUAL componente desenhar — são preocupações diferentes, mesma
 * fonte de nomes Aegis).
 *
 * Light Bolt (MG_LIGHTNINGBOLT) reaproveita o CAST da Thunder Storm de
 * propósito (`ThunderStormCastElectric`, sem componente próprio) — as duas
 * são elétricas e o estágio de "carregando no caster" é IDÊNTICO na
 * natureza (partículas/arcos/glow subindo antes do raio sair); só o
 * IMPACTO diverge (AoE espalhada × raio único na cabeça de um alvo), por
 * isso só o `IMPACT_VFX` tem uma entrada própria (`LightBoltImpact`). É a
 * infra "genuinamente compartilhável" que o pedido pediu pra identificar
 * antes de duplicar.
 *
 * MG_FIREBALL e MG_THUNDERSTORM saíram de CAST_VFX/IMPACT_VFX na migração
 * pro VFX Core (leia1.txt, Fase 3) — vivem em `fire-ball/fireBallVfxDef.tsx`
 * e `thunder-storm/thunderStormVfxDef.tsx` agora. `ThunderStormCastElectric`
 * (componente React) continua viva só porque Light Bolt ainda a usa —
 * migrar Light Bolt é Fase 5; quando isso acontecer, a definição dele passa
 * a apontar pro MESMO `vfxId` `thunder_storm_cast` (a arte é idêntica) e
 * este componente é removido de vez.
 */
const CAST_VFX: Record<string, typeof ColdBoltCastFrost> = {
  MG_COLDBOLT: ColdBoltCastFrost,
  MG_FIREBOLT: FireLanceCastFire,
  MG_LIGHTNINGBOLT: ThunderStormCastElectric,
  MG_SOULSTRIKE: SoulStrikeCastSpirit,
  // Congelar reaproveita o cast de gelo da Cold Bolt de propósito — mesma
  // natureza (partículas/cristais concentrando no caster antes de sair),
  // só o IMPACTO diverge (trilha no chão + prisão condicional).
  MG_FROSTDIVER: ColdBoltCastFrost,
  MG_STONECURSE: StoneCurseCast,
};
const IMPACT_VFX: Record<string, typeof ColdBoltImpact> = {
  MG_COLDBOLT: ColdBoltImpact,
  MG_FIREBOLT: FireLanceImpact,
  MG_LIGHTNINGBOLT: LightBoltImpact,
  MG_SOULSTRIKE: SoulStrikeImpact,
  // Congelar idem — 1 hit só, dano pelo damageFeed normal, prisão de gelo
  // CONDICIONAL (só se `opt1` real virar OPT1_FREEZE, ver componente).
  MG_FROSTDIVER: FrostDiverImpact,
  // Petrificar idem — 1 hit, `damageFlags:["no_damage"]` no skill_db (dano
  // sempre 0 de propósito), transformação em pedra CONDICIONAL (`opt1 ===
  // OPT1_STONE` real, ver componente).
  MG_STONECURSE: StoneCurseImpact,
};
/** skills de "área com visual próprio por célula" — cada `skill:ground`
 * (uma célula real plantada pelo servidor) ganha o componente do aegis em
 * vez do `AreaCell` genérico (roxo). Mesmo formato de registro do
 * `CAST_VFX`/`IMPACT_VFX` acima.
 *
 * MG_SAFETYWALL e MG_FIREWALL saíram daqui na migração pro VFX Core
 * (leia1.txt, Fase 3) — vivem em `vfx/mage/ghost-dome/ghostDomeVfxDef.tsx`
 * e `vfx/mage/fire-wall/fireWallVfxDef.tsx` agora, e `vfx/vfxStore.ts:
 * spawn()` nunca deixa um efeito delas chegar até este dispatcher (ver
 * `vfx/skillVfxBindings.ts`). Fire Wall também perdeu o caso especial de
 * agrupamento (`FireWallGroup.tsx`, removido) — o `DomRenderer` do Core já
 * agrupa QUALQUER skill `renderer:"dom"` num React root só, de graça, sem
 * precisar de um componente próprio por skill agrupada. Registro vazio de
 * propósito: o formato continua aqui pronto pra qualquer área NOVA que
 * ainda não tenha sido migrada. */
const AREA_VFX: Record<string, (props: { cx: number; cy: number; cz: number; cellSize: number }) => ReactElement> = {};
/** contrato de props pra um buff PRÓPRIO ainda não migrado — mesmo formato
 * que `OracleBuff` usava antes de migrar (referência viva de contrato,
 * pra quando o próximo buff precisar dele). */
interface BuffVfxComponentProps {
  areaRadius?: number;
  targetScale: number;
  terrain: TerrainQuery;
  cellSize: number;
  anchorRef: RefObject<{ x: number; y: number; z: number }>;
}
/** skills de "self-buff com visual próprio" (`kind: "buff"`) — nunca planta
 * célula (`target:"self"`, sem `unit` no skill_db), só decide QUAL
 * componente desenhar no lugar do `BuffRing` genérico.
 *
 * MG_SIGHT saiu daqui na migração pro VFX Core (leia1.txt, Fase 3) — vive
 * em `vfx/mage/oracle/oracleVfxDef.tsx` agora (era o hotspot PRINCIPAL da
 * investigação: 111 `<Html>`/69 `useFrame` por instância). Registro vazio
 * de propósito, pronto pra qualquer buff NOVO que ainda não tenha sido
 * migrado. */
const BUFF_VFX: Record<string, (props: BuffVfxComponentProps) => ReactElement> = {};
/** impactos que precisam de onde o CASTER estava (voam/partem dele até o
 * alvo) — offset pré-calculado em `VfxNode` (`casterOffset`, abaixo). */
const NEEDS_CASTER_OFFSET = new Set<unknown>([SoulStrikeImpact, FrostDiverImpact, StoneCurseImpact]);
/** altura chutada (unidades locais) só pro FALLBACK de posição do caster
 * (célula/chão, sem cajado) — aproxima peito/mão até a ponta real resolver.
 * Frost Diver não usa (nasce no CHÃO de propósito), os outros três sim. */
const FALLBACK_LAUNCH_Y_BIAS = 1.0;
/** subconjunto de `NEEDS_CASTER_OFFSET` que voa da MÃO/cajado — usa a ponta
 * real (`anchorDeArma`) assim que ela resolve. Frost Diver fica de fora
 * (nasce no chão, ver comentário no `useFrame` que lê este set). */
const NEEDS_WAND_TIP = new Set<unknown>([SoulStrikeImpact, StoneCurseImpact]);

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

  /**
   * `ensure()` pros efeitos de ÁREA — resolve o `aegisName` cedo pra
   * `VfxNode` já poder escolher entre `AREA_VFX` (componente próprio, pra
   * quem ainda não migrou pro Core) e o `AreaCell` genérico (roxo) desde o
   * primeiro quadro, em vez de esperar o `ensure()` de dentro do próprio
   * `VfxNode` responder um quadro depois.
   */
  useEffect(() => {
    const ids = effects.filter((e) => e.kind === "area").map((e) => e.skillId);
    if (ids.length > 0) useSkillCatalog.getState().ensure(ids);
  }, [effects]);

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

  // VFX_MOUNT/VFX_UNMOUNT (leia1.txt) — `VfxNode` é o ÚNICO componente React
  // que monta para QUALQUER VFX de skill (`effects.map` abaixo, `key=
  // {effect.id}`), então instrumentar aqui cobre as 18 famílias de uma vez.
  // Roda depois do `spawn()` já ter disparado VFX_START (`vfx/vfxStore.ts`)
  // — a distinção importa porque o array pode crescer um quadro antes do
  // React comitar o novo `VfxNode`.
  useEffect(() => {
    marcarMontagemVfx(effect.id, { kind: effect.kind, skillId: effect.skillId });
    return () => marcarDesmontagemVfx(effect.id, { kind: effect.kind, skillId: effect.skillId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // "area" idem, pro `AREA_VFX` abaixo (Cúpula Fantasma/Parede de Fogo)
  // decidir entre a célula genérica roxa e um visual próprio por aegis.
  const groundInfo = useSkillCatalog((s) => (effect.kind === "area" ? s.byId[effect.skillId] : undefined));
  // "buff" idem, pro `BUFF_VFX` abaixo (registro vazio hoje, ver docblock) —
  // precisa do `aegisName` (qual componente desenhar) e do `areaRadius` real.
  const buffInfo = useSkillCatalog((s) => (effect.kind === "buff" ? s.byId[effect.skillId] : undefined));
  useEffect(() => {
    if (
      (effect.kind === "cast" || effect.kind === "impact" || effect.kind === "area" || effect.kind === "buff") &&
      effect.skillId
    ) {
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
  // pé do efeito, atualizado todo quadro (abaixo) — repassado a qualquer
  // componente com partículas/pontos deslocados do centro que ainda caia
  // neste dispatcher legado, pra consultar o TERRENO REAL na própria
  // posição em vez de herdar a altura do centro (`vfx/terrainFollow.ts`).
  // Oráculo/Fire Ball/Thunder Storm fazem o equivalente pelo Core agora
  // (`DomArtUpdateCtx.terrainFollowDeltaY`). Ref (não state) de propósito:
  // atualizar isto via setState a 60fps
  // re-renderizaria a árvore inteira por quadro.
  const anchorRef = useRef(initial);

  /**
   * `area`/`cast` são PRESOS À CÉLULA — `worldPositionOf` devolve o mesmo
   * ponto do nascimento ao fim da vida (não seguem entidade nenhuma). Por
   * isso eles NÃO passam pelo grupo animado abaixo: `AreaCell`/`AreaDisc` se
   * posicionam e se moldam ao relevo sozinhos, uma vez, em vez de herdar um
   * `position`/`scale` que mudaria a forma da malha moldada a cada quadro.
   */
  const presoNaCelula = effect.kind === "area" || effect.kind === "cast";
  // Oráculo tem VFX PRÓPRIO de buff (espíritos orbitando + partículas de
  // área) — o "sobe e assenta em 70%" genérico do `BuffRing` (pensado pra um
  // flash de 600ms) ficaria errado num efeito que fica de pé por 10s: os
  // espíritos sairiam subindo ~1 célula acima do caster e ficariam presos lá
  // em cima. `hasCustomBuffVfx` desliga esses dois ajustes só pra quem tem
  // componente PRÓPRIO — o `BuffRing` genérico continua com o comportamento
  // de sempre.
  const hasCustomBuffVfx = effect.kind === "buff" && buffInfo?.aegisName !== undefined && buffInfo.aegisName in BUFF_VFX;

  useFrame(() => {
    if (presoNaCelula) return;
    const g = group.current;
    if (!g) return;

    const world = worldPositionOf(effect, map, mapping);
    if (!world) return;
    anchorRef.current = world;

    // "vida" do efeito em 0..1 — o anel sobe, o flash cresce
    const life = Math.min(1, (performance.now() - born.current) / 600);

    // A altura é SEMPRE recalculada a partir do chão. Somar no y do frame
    // anterior fazia o anel subir sem parar (ele saía voando do mapa).
    const lift = effect.kind === "buff" && !hasCustomBuffVfx ? life * cellSize : 0;
    g.position.set(world.x, world.y + 0.05 + lift, world.z);

    // A escala de célula já está no `scale` do grupo (montado no primeiro
    // render); aqui só entra a animação, senão o efeito fica cellSize² e cobre
    // meia tela.
    const grow = effect.kind === "impact" ? 0.4 + life * 0.8 : hasCustomBuffVfx ? 1 : 1 - life * 0.3;
    g.scale.setScalar(grow * cellSize);
  });

  if (effect.kind === "area") {
    // Cúpula Fantasma (Safety Wall, `unit.layout:0`) e Parede de Fogo (Fire
    // Wall, `unit.layout:-1`) ganham visual PRÓPRIO por célula — o fluxo de
    // rede é o MESMO de qualquer área (um `skill:ground` por célula
    // plantada, some no `skill:ground-gone`), só a pintura muda.
    const AreaComponent = groundInfo?.aegisName ? AREA_VFX[groundInfo.aegisName] : undefined;
    if (AreaComponent) {
      return <AreaComponent cx={initial.x} cy={initial.y} cz={initial.z} cellSize={cellSize} />;
    }
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
  const BuffComponent = hasCustomBuffVfx && buffInfo?.aegisName ? BUFF_VFX[buffInfo.aegisName] : undefined;
  // só calcula (lookup no worldStore) quando realmente vai ser usado —
  // Oráculo também precisa (escala do CASTER, `effect.gid` pra "buff" já é o
  // `sourceGid`, ver `net/useWorldEvents.onSkillCast`)
  const targetScale = useMemo(
    () => (ImpactComponent || BuffComponent ? targetVisualScale(effect.gid) : 1),
    [ImpactComponent, BuffComponent, effect.gid],
  );
  // Soul Strike/Fire Ball/Frost Diver/Stone Curse PRECISAM de onde o caster
  // estava (os projéteis voam/partem dele até o alvo, não caem de cima do
  // alvo como as outras três) — offset LOCAL (caster menos alvo, já
  // dividido por `cellSize`). `null` quando não precisa ou o caster não
  // resolveu posição nenhuma — cada componente tem um fallback próprio pra
  // esse caso (nunca nasce em cima do alvo por falta de dado).
  //
  // Fallback IMEDIATO: posição da CÉLULA do caster (`worldPositionOf`,
  // centro do chão, sem altura de cajado) — disponível desde o primeiro
  // quadro. Assim que a ponta do cajado resolve de verdade
  // (`anchorDeArma`, MESMO registro que `FireBallCastFire`/`ColdBoltCastFrost`
  // já usam pro cast), o `useFrame` abaixo SUBSTITUI por ela — "tem que
  // iniciar na ponta do cajado", não no centro do corpo do caster. A troca
  // acontece 1-2 quadros depois do nascimento do efeito (o voo inteiro dura
  // centenas de ms), imperceptível.
  const casterOffsetFallback = useMemo(() => {
    if (!ImpactComponent || !NEEDS_CASTER_OFFSET.has(ImpactComponent) || effect.sourceGid === undefined) return null;
    const casterPos = worldPositionOf({ gid: effect.sourceGid }, map, mapping);
    if (!casterPos) return null;
    // Frost Diver nasce no CHÃO de propósito (trilha de gelo) — nunca leva
    // o viés de altura; os outros três (voam da mão/cajado) levam, só no
    // FALLBACK (a ponta REAL, abaixo, já vem com a altura certa embutida —
    // somar de novo ali jogaria o lançamento pra cima da cabeça do caster).
    const yBias = ImpactComponent === FrostDiverImpact ? 0 : FALLBACK_LAUNCH_Y_BIAS;
    return {
      x: (casterPos.x - initial.x) / cellSize,
      y: (casterPos.y - initial.y) / cellSize + yBias,
      z: (casterPos.z - initial.z) / cellSize,
    };
  }, [ImpactComponent, effect.sourceGid, map, mapping, initial, cellSize]);
  const [casterTipOffset, setCasterTipOffset] = useState<{ x: number; y: number; z: number } | null>(null);
  const tipCaptured = useRef(false);
  useFrame(() => {
    if (tipCaptured.current) return;
    // Frost Diver fica de FORA de propósito: a trilha dela nasce no CHÃO
    // (pé do caster), a ponta do cajado ficaria flutuando na altura da mão
    // — errado pra essa skill especificamente. Só quem VOA da mão/cajado
    // usa a ponta real.
    if (!ImpactComponent || !NEEDS_WAND_TIP.has(ImpactComponent) || effect.sourceGid === undefined) return;
    const tip = anchorDeArma(effect.sourceGid);
    if (!tip) return; // ainda não montou (ex.: primeiro quadro) — tenta de novo no próximo
    tipCaptured.current = true;
    const world = new THREE.Vector3();
    tip.getWorldPosition(world);
    setCasterTipOffset({
      x: (world.x - initial.x) / cellSize,
      y: (world.y - initial.y) / cellSize,
      z: (world.z - initial.z) / cellSize,
    });
  });
  const casterOffset = casterTipOffset ?? casterOffsetFallback;
  // valor de VERDADE que já foi pro VFX (ver `net/useWorldEvents`,
  // `getSkillProjectileCount(p.level)`) — o áudio usa o MESMO número, nunca
  // um chute próprio, pra nunca divergir de quantos hits o VFX desenhou
  const resolvedHits = effect.hits ?? 5;
  /**
   * `hits` decide QUAL arquivo tocar (a faixa 1-2/3-4/.../9-10), NÃO quantas
   * vezes tocar — cada `*_hit_lvl_*.mp3` já É a sequência sonora inteira
   * daquela faixa (achado revisando o pedido: um `.mp3` de "3 hits" não é
   * "o som de 1 hit, tocado 3 vezes", é uma faixa PRÓPRIA com os 3 já
   * embutidos). O VFX ainda dispara `onHit` uma vez por estalactite/lança/
   * pulso/descarga/alma de verdade (isso não muda — é o número que decide a
   * FAIXA); esta ref é a coordenação pra só o PRIMEIRO `onHit` desta
   * instância (`VfxNode` remonta por `effect.id`, um por conjuração —
   * `key={effect.id}` no `.map` acima) tocar o arquivo, os demais são
   * ignorados. Sem isto, uma faixa "5 hits" tocaria 5 vezes seguidas por
   * cima de si mesma.
   */
  const impactAudioTocado = useRef(false);
  const onImpactHit = () => {
    if (!ImpactComponent || impactAudioTocado.current) return;
    impactAudioTocado.current = true;
    aoImpactoMultiHit(effect.skillId, resolvedHits);
  };

  return (
    <group ref={group} position={[initial.x, initial.y + 0.05, initial.z]} scale={cellSize}>
      {effect.kind === "buff" && BuffComponent ? (
        <BuffComponent areaRadius={buffInfo?.areaRadius} targetScale={targetScale} terrain={terrain} cellSize={cellSize} anchorRef={anchorRef} />
      ) : effect.kind === "buff" ? (
        <BuffRing />
      ) : ImpactComponent === SoulStrikeImpact ? (
        <SoulStrikeImpact
          damage={effect.damage}
          crit={effect.crit}
          onSelf={effect.onSelf}
          targetScale={targetScale}
          hits={effect.hits}
          casterOffsetX={casterOffset?.x}
          casterOffsetY={casterOffset?.y}
          casterOffsetZ={casterOffset?.z}
          onHit={onImpactHit}
        />
      ) : ImpactComponent === FrostDiverImpact ? (
        // sem damage/crit/onSelf/hits/onHit de propósito, mesma razão da
        // Fire Ball — burst de impacto puro, sem alvo condicional nenhum: a
        // prisão de gelo persistente vive em `FreezeBodyVfx`
        // (`net/NetEntity.tsx`), fora do ciclo de vida deste cast.
        <FrostDiverImpact
          targetScale={targetScale}
          casterOffsetX={casterOffset?.x}
          casterOffsetY={casterOffset?.y}
          casterOffsetZ={casterOffset?.z}
        />
      ) : ImpactComponent === StoneCurseImpact ? (
        // idem — a transformação em pedra persistente é tint de material
        // direto no body, não VFX (`net/NetEntity.tsx: usePetrifyMaterial`,
        // `entities/petrifyMaterial.ts`).
        <StoneCurseImpact
          targetScale={targetScale}
          casterOffsetX={casterOffset?.x}
          casterOffsetY={casterOffset?.y}
          casterOffsetZ={casterOffset?.z}
        />
      ) : ImpactComponent ? (
        <ImpactComponent
          damage={effect.damage}
          crit={effect.crit}
          onSelf={effect.onSelf}
          targetScale={targetScale}
          hits={effect.hits}
          onHit={onImpactHit}
        />
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

/**
 * Onde o efeito é desenhado: na entidade (impacto/buff) ou na célula (área).
 *
 * Só lê `gid`/`cell` (não o `VfxInstance` inteiro) — permite chamar com um
 * objeto literal mínimo pra resolver a posição de QUALQUER gid, não só o do
 * próprio efeito (`SoulStrikeImpact` usa isto pra achar o CASTER, ver
 * `casterOffset` em `VfxNode`, acima).
 */
function worldPositionOf(
  effect: Pick<VfxInstance, "gid" | "cell">,
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
