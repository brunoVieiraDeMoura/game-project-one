import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDamageFeed } from "../net/damageFeed";

/**
 * Cold Bolt (MG_COLDBOLT) — teste de efeito 2D-em-3D (leia1.txt, "testando pra
 * ver se fica bom"): `assets-new/skill_effects/mage/cold_bolt` (6 gifs de
 * gelo Kenney/RO-like, só os 5 primeiros usados aqui) →
 * `public/assets/skill_effects/mage/cold_bolt`.
 *
 * Pedido: 5 estalactites caindo da CABEÇA até o CORPO do alvo, cada uma de um
 * ângulo diferente, todas viradas pra baixo, sempre terminando no CENTRO do
 * alvo. Aqui:
 *  • "ângulo diferente" é POSIÇÃO — 5 pontos de partida num leque ao redor do
 *    alvo (`buildSpecs`), convergindo pra `x=0,z=0` (`CONVERGE_RADIUS = 0`)
 *    exatamente na chegada — nunca um "quase centro".
 *  • "virada pra baixo" é a arte em si: sem rotação nenhuma no sprite
 *    (`mat.rotation` fica 0 sempre) — a diferença de ângulo NÃO gira o
 *    desenho, só move de onde ele cai.
 *  • CADA estalactite passa pela sequência `icebolt_1..5` ao longo da própria
 *    queda (`frameIdx = floor(life * 5)`) — não é a animação PRÓPRIA do gif
 *    (o navegador nem chega a rodar: `TextureLoader` só lê o primeiro quadro
 *    de cada arquivo), é o CLIENTE avançando o quadro certo no tempo certo,
 *    do mesmo jeito que troca de clip de animação em `useCharacter`.
 *
 * `ICICLE_*` são exportadas porque `net/useWorldEvents` precisa da MESMA
 * cadência pra escalonar os números de dano (1000 5x pra um total de 5000) —
 * duas constantes divergentes fariam o número "chegar" fora de hora do
 * impacto visual.
 */

const FRAME_COUNT = 5;
const FRAME_URLS = Array.from({ length: FRAME_COUNT }, (_, i) => `/assets/skill_effects/mage/cold_bolt/icebolt_${i + 1}.gif`);

const textureCache = new Map<string, THREE.Texture>();
function frameTexture(url: string): THREE.Texture {
  let t = textureCache.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(url, t);
  }
  return t;
}
const FRAME_TEXTURES = FRAME_URLS.map(frameTexture);

export const ICICLE_HITS = 5;
/** ms entre o início de uma estalactite e a próxima */
export const ICICLE_STAGGER_MS = 140;
/** ms de queda de UMA estalactite, cabeça → corpo (percorre os 5 quadros) */
export const ICICLE_FALL_MS = 560;
/** fração da queda em que ela "chega" (dano/flash) — o resto é o desvanecer */
export const ICICLE_IMPACT_FRACTION = 0.82;
/** duração da sequência inteira (última estalactite incluída) — o efeito no
 * `vfxStore` tem que viver pelo menos isso, senão a última cai fora do ar
 * (poda por `expiresAt` antes do quinto impacto acontecer) */
export const ICICLE_TOTAL_MS = (ICICLE_HITS - 1) * ICICLE_STAGGER_MS + ICICLE_FALL_MS;

/**
 * Escalona um dano total em `ICICLE_HITS` números flutuantes, casados no
 * tempo com o impacto de cada estalactite: 5000 de dano vira 1000 cinco
 * vezes, um a cada chegada.
 *
 * O rAthena manda UM `damage` só por `skill:cast` (o protocolo deste projeto
 * não desmembra os hits de Cold Bolt em pacotes separados) — dividir aqui é
 * só REDESENHAR um número que já chegou fechado do servidor, igual ao resto
 * fecha (nunca inventa nem deriva o total, só o timing de exibição). Sobra do
 * resto do inteiro vai pro ÚLTIMO hit, pra soma bater com o total.
 */
export function emitirDanoEmCascata(gid: number, total: number, crit: boolean, onSelf: boolean): void {
  const base = Math.floor(total / ICICLE_HITS);
  const resto = total - base * ICICLE_HITS;
  for (let i = 0; i < ICICLE_HITS; i++) {
    const valor = base + (i === ICICLE_HITS - 1 ? resto : 0);
    const atrasoMs = i * ICICLE_STAGGER_MS + ICICLE_FALL_MS * ICICLE_IMPACT_FRACTION;
    setTimeout(() => {
      useDamageFeed.getState().push({ gid, value: valor, crit, miss: false, onSelf });
    }, atrasoMs);
  }
}

const HEAD_Y = 5.5;
const BODY_Y = 0.65;
const SPREAD_RADIUS = 0.5;
/** onde a queda termina no plano XZ — sempre o centro do alvo, sem "quase" */
const CONVERGE_RADIUS = 0;

interface IcicleSpec {
  angle: number;
  delayMs: number;
}

function buildSpecs(seed: number): IcicleSpec[] {
  const specs: IcicleSpec[] = [];
  for (let i = 0; i < ICICLE_HITS; i++) {
    const angle = (i / ICICLE_HITS) * Math.PI * 2 + seed * Math.PI * 2;
    specs.push({ angle, delayMs: i * ICICLE_STAGGER_MS });
  }
  return specs;
}

/** grupo dos 5 impactos — nasce, cai, some; `onHit(i)` marca cada chegada
 * pra quem quiser sincronizar (ex.: teste manual no console). */
export function ColdBoltImpact({ onHit }: { onHit?: (index: number) => void }) {
  const bornAt = useRef(performance.now());
  const specs = useMemo(() => buildSpecs(Math.random()), []);
  return (
    <group name="cold-bolt-impact">
      {specs.map((spec, i) => (
        <Icicle key={i} spec={spec} bornAt={bornAt.current} onHit={onHit ? () => onHit(i) : undefined} />
      ))}
    </group>
  );
}

function Icicle({ spec, bornAt, onHit }: { spec: IcicleSpec; bornAt: number; onHit?: () => void }) {
  const sprite = useRef<THREE.Sprite>(null);
  const hit = useRef(false);

  useFrame(() => {
    const s = sprite.current;
    if (!s) return;
    const t = performance.now() - bornAt - spec.delayMs;
    if (t < 0 || t >= ICICLE_FALL_MS) {
      s.visible = false;
      return;
    }
    const life = t / ICICLE_FALL_MS;
    s.visible = true;

    const dirX = Math.cos(spec.angle);
    const dirZ = Math.sin(spec.angle);
    const r = SPREAD_RADIUS + (CONVERGE_RADIUS - SPREAD_RADIUS) * life;
    const y = HEAD_Y + (BODY_Y - HEAD_Y) * life;
    s.position.set(dirX * r, y, dirZ * r);
    s.scale.setScalar(0.5 + life * 0.3);

    const mat = s.material as THREE.SpriteMaterial;
    // sempre virada pra baixo: a diferença de ângulo é POSIÇÃO (de onde cai),
    // nunca rotação do desenho. A ARTE em si nasce deitada (ponta pra
    // direita) — -90° (sentido horário, convenção CCW do three) endireita
    // a ponta pra baixo pra todo mundo, de uma vez só.
    mat.rotation = -Math.PI / 2;
    const frameIdx = Math.min(FRAME_COUNT - 1, Math.floor(life * FRAME_COUNT));
    if (mat.map !== FRAME_TEXTURES[frameIdx]) mat.map = FRAME_TEXTURES[frameIdx]!;
    mat.opacity = life > ICICLE_IMPACT_FRACTION ? Math.max(0, 1 - (life - ICICLE_IMPACT_FRACTION) / (1 - ICICLE_IMPACT_FRACTION)) : 1;

    if (!hit.current && life >= ICICLE_IMPACT_FRACTION) {
      hit.current = true;
      onHit?.();
    }
  });

  useEffect(() => {
    hit.current = false;
  }, [spec]);

  return (
    <sprite ref={sprite} visible={false}>
      <spriteMaterial map={FRAME_TEXTURES[0]} transparent depthWrite={false} depthTest={false} blending={THREE.NormalBlending} />
    </sprite>
  );
}
