import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { multiHitTotalMs } from "../multiHitShared";
import { createSeededRng } from "../../core/particleMath";

/**
 * Cold Bolt (MG_COLDBOLT) — lança de gelo em CSS puro (pedido: trocar o
 * asset visual mantendo INTACTO o fluxo/timing da skill — dano, cascata,
 * cadência, posição — que já existiam antes desta troca).
 *
 * Cada estalactite é um `<Html>` do drei (DOM real, CSS real) — mesma
 * técnica que `editor/EditorScene.tsx` já usa pra rótulo 3D→tela.
 *
 * ## Por que `<Html>` continua rastreando o alvo certo
 *
 * `<Html>` não tem posição própria: ele lê a `matrixWorld` do `<group>`
 * QUE O CONTÉM, quadro a quadro, sozinho. Quem move esse grupo continua
 * sendo o MESMO mecanismo de sempre — o `useFrame` abaixo escreve
 * `groupRef.current.position` a cada quadro — e esse grupo já nasce dentro
 * do grupo de `vfx/SkillVfx.tsx` que segue a ENTIDADE. O número de dano e o
 * total ficam em `<group>` FILHOS desse mesmo grupo rastreado, só com um
 * offset local em Y (`DMG_SPAWN_Y`/`HEAD_TOP_Y`) — um deslocamento de
 * verdade no espaço 3D, não um truque de pixel de tela, então continua
 * seguindo o alvo corretamente em qualquer câmera/distância.
 *
 * ## Dano por hit: UM evento só, não dois relógios
 *
 * O dano TOTAL chega pronto (`ColdBoltImpact({ damage, crit, onSelf })`, ver
 * `net/useWorldEvents.onSkillCast`), é repartido uma vez (`splitDamage`), e
 * cada fatia nasce DENTRO do mesmo `if (!hit.current && fallLife >=
 * ICICLE_IMPACT_FRACTION)` que já disparava o flash de impacto — o MESMO
 * evento aciona flash, spikes, aro de gelo, o número individual E (no quinto
 * hit) o total. Nenhum timer paralelo.
 *
 * ## Escala proporcional ao alvo
 *
 * `targetScale` (calculado em `vfx/SkillVfx` a partir do MESMO catálogo de
 * espécie que `net/NetEntity` já usa pra desenhar o modelo — `mobModel`/
 * `classModelFor`, nunca um número novo) entra como variável CSS
 * (`--tscale`) e multiplica o tamanho do aro/flash/fragmentos — um Poring
 * (`scale: 0.7`) recebe um impacto proporcionalmente menor que um monstro
 * grande, sem duplicar tabela de tamanho nenhuma.
 */

/** teto de estalactites no nível MÁXIMO da skill — a quantidade de VERDADE
 * por lançamento vem do nível real (`getSkillProjectileCount`,
 * `vfx/mage/multiHitShared`), nunca fixa em 5 */
// teto REAL do skill_db (`rathena/db/re/skill_db.yml: HitCount`, Lv10→10),
// não mais um chute de 5 (achado da auditoria "count real" 2026-08-19).
export const ICICLE_MAX_HITS = 10;
/** ms entre o início de uma estalactite e a próxima — pedido 2026-08-19
 * (sincronizar velocidade da animação/áudio): era 200, cascata mais rápida
 * agora que o áudio de impacto toca em CADA hit real (`aoImpactoMultiHit`,
 * `audio/mage/multiHitCastAudio.ts`) — stagger menor = barragem mais
 * rápida nos dois lados, sem precisar mexer em `ICICLE_FALL_MS` (a queda de
 * CADA estalactite continua com a mesma duração/leitura, só a cadência
 * entre elas encurtou). */
export const ICICLE_STAGGER_MS = 130;
/** ms de queda de UMA estalactite, cabeça → corpo */
export const ICICLE_FALL_MS = 560;
/** fração da queda em que ela "chega" (dano/flash/spikes/aro) — o resto da
 * QUEDA é o desvanecer da própria lança; o burst pós-impacto tem o PRÓPRIO
 * orçamento de tempo, ver `DAMAGE_NUMBER_MS` */
export const ICICLE_IMPACT_FRACTION = 0.82;
/** instante (relativo ao nascimento DESTA estalactite) em que ela impacta */
const IMPACT_AT_MS = ICICLE_FALL_MS * ICICLE_IMPACT_FRACTION;
/** ms que CADA número individual leva na trajetória de cachoeira (sobe um
 * pouco, cai na diagonal, some) — maior que o stagger entre hits (140ms) de
 * propósito: os hits ficam visíveis ao mesmo tempo em algum momento, formando
 * a cascata por SOBREPOSIÇÃO de tempo, não por espalhar no espaço. */
export const DAMAGE_NUMBER_MS = 1000;
/** janela TOTAL que uma estalactite fica viva no DOM: queda + rabo do burst. */
export const ICICLE_VISIBLE_MS = IMPACT_AT_MS + DAMAGE_NUMBER_MS;
/** ms que o total amarelo fica no ar depois de disparar */
export const TOTAL_VISIBLE_MS = 1500;
/** duração da sequência inteira PARA `hits` estalactites de verdade — o
 * efeito no `vfxStore` tem que viver pelo menos isso, senão o total ou o
 * rabo do último hit são podados cedo. Mesma conta de
 * `multiHitTotalMs` (fórmula compartilhada com Fire Lance/Thunder
 * Storm/Soul Strike), só entrando com o timing próprio do gelo. */
export function icicleTotalMs(hits: number): number {
  return multiHitTotalMs(hits, ICICLE_STAGGER_MS, IMPACT_AT_MS, DAMAGE_NUMBER_MS, TOTAL_VISIBLE_MS);
}

/**
 * Reparte um dano total em `hits` fatias inteiras cuja SOMA bate
 * exatamente com o total (resto do inteiro vai pro ÚLTIMO hit) — nunca perde
 * nem inventa dano por arredondamento. O TOTAL amarelo mostra `damage` cru
 * (o mesmo valor que chegou do servidor), nunca a soma das fatias — as duas
 * coisas são o MESMO número por construção, mas ler o original em vez de
 * somar de novo é uma conta a menos que pode divergir por float.
 */
function splitDamage(total: number, hits: number): number[] {
  const base = Math.floor(total / hits);
  const resto = total - base * hits;
  return Array.from({ length: hits }, (_, i) => base + (i === hits - 1 ? resto : 0));
}

const HEAD_Y = 5.5;
const BODY_Y = 0.65;
const SPREAD_RADIUS = 0.5;
/** onde a queda termina no plano XZ — sempre o centro do alvo, sem "quase" */
const CONVERGE_RADIUS = 0;
/**
 * Altura da CABEÇA — mesma fórmula de `net/NetEntity` (`height = charScale *
 * modelInfo.scale * 1.8`, sem o `charScale` global de propósito, ver
 * `SkillVfx.targetVisualScale`): é a régua que já desenha plaquinha/barra de
 * HP no topo do bicho, reaproveitada aqui em vez de inventar uma nova.
 */
const HEAD_TOP_Y = 1.8;
/** folga do total amarelo ACIMA da cabeça — pedido explícito: "no máximo
 * ~60px", ou seja, perto, nunca flutuando longe */
const TOTAL_GAP_ABOVE_HEAD = 0.4;
/** onde a cascata dos 5 números COMEÇA — região superior do corpo (não a
 * cabeça, não o chão) */
const DMG_SPAWN_Y = 1.3;
/** deslocamento entre o spawn de um hit e o próximo — pequeno de propósito
 * (era 0.62, "coluna gigante"; agora só o bastante pra não empilhar exato,
 * a cascata de verdade é a TRAJETÓRIA de cada número, ver `cbDmgNum`) */
const DMG_STACK_STEP = 0.08;

interface IcicleSpec {
  angle: number;
  delayMs: number;
  /** fatia de dano desta estalactite (ver `splitDamage`) — `undefined` quando
   * o efeito nasceu sem `damage` (ex.: spawn antigo/teste sem payload) */
  dmg?: number;
  /** pequeno deslocamento horizontal do NÚMERO (não da lança) — só pra 5
   * números não nascerem exatamente empilhados um em cima do outro */
  dmgJitterPx: number;
  /** altura extra (mundo) deste hit na coluna — ver `DMG_STACK_STEP` */
  dmgStackY: number;
}

function buildSpecs(seed: number, hits: number, dmgSlices: number[] | undefined): IcicleSpec[] {
  const specs: IcicleSpec[] = [];
  for (let i = 0; i < hits; i++) {
    // ângulo distribuído pelo CÍRCULO INTEIRO (÷ hits, não ÷ ICICLE_MAX_HITS)
    // — com menos estalactites elas continuam espalhadas, nunca espremidas
    // num arco pequeno como se sobrasse "espaço" das que não vieram
    const angle = (i / hits) * Math.PI * 2 + seed * Math.PI * 2;
    specs.push({
      angle,
      delayMs: i * ICICLE_STAGGER_MS,
      dmg: dmgSlices?.[i],
      dmgJitterPx: (Math.random() - 0.5) * 64,
      dmgStackY: i * DMG_STACK_STEP,
    });
  }
  return specs;
}

/** grupo dos impactos — nasce, cai, some; `onHit(i)` marca cada chegada
 * pra quem quiser sincronizar (ex.: teste manual no console). */
export function ColdBoltImpact({
  onHit,
  damage,
  crit,
  onSelf,
  targetScale = 1,
  hits = ICICLE_MAX_HITS,
}: {
  onHit?: (index: number) => void;
  /** dano TOTAL da skill (já calculado pelo servidor) — repartido em `hits`
   * números, um por estalactite (ver docblock do arquivo) */
  damage?: number;
  crit?: boolean;
  onSelf?: boolean;
  /** multiplicador de tamanho do alvo (`mobModel`/`classModelFor.scale`,
   * calculado em `vfx/SkillVfx`) — escala o aro/flash/fragmentos, nunca os
   * números de dano (esses ficam grandes e fixos de propósito, legibilidade
   * não deveria depender do bicho que apanhou) */
  targetScale?: number;
  /** quantidade REAL de estalactites — vem do nível da skill
   * (`getSkillProjectileCount`, `net/useWorldEvents`), nunca fixa em 5.
   * Default só cobre chamada antiga/sem o campo (nunca deveria acontecer em
   * produção, mas mantém o componente utilizável isolado, ex. em teste). */
  hits?: number;
}) {
  useIceSpikeStyles();
  const bornAt = useRef(performance.now());
  const hitCount = Math.min(ICICLE_MAX_HITS, Math.max(1, hits));
  const dmgSlices = useMemo(
    () => (damage !== undefined && damage > 0 ? splitDamage(damage, hitCount) : undefined),
    [damage, hitCount],
  );
  const specs = useMemo(() => buildSpecs(Math.random(), hitCount, dmgSlices), [hitCount, dmgSlices]);
  const totalRef = useRef<FinalTotalHandle>(null);
  const hitsLanded = useRef(0);

  const handleHit = (i: number) => {
    onHit?.(i);
    hitsLanded.current += 1;
    if (hitsLanded.current === hitCount) totalRef.current?.trigger();
  };

  return (
    <group name="cold-bolt-impact">
      {specs.map((spec, i) => (
        <Icicle
          key={i}
          spec={spec}
          bornAt={bornAt.current}
          crit={crit ?? false}
          onSelf={onSelf ?? false}
          targetScale={targetScale}
          onHit={() => handleHit(i)}
        />
      ))}
      {dmgSlices && (
        <FinalTotal ref={totalRef} total={damage ?? 0} crit={crit ?? false} targetScale={targetScale} />
      )}
    </group>
  );
}

const FRAGMENT_COUNT = 8;

interface FragmentSpec {
  /** deslocamento final em px — calculado já em X/Y de tela, não
   * `rotate()+translate()` composto (evita girar o próprio eixo de queda) */
  fx: number;
  fy: number;
}

function buildFragments(seed: number): FragmentSpec[] {
  const out: FragmentSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < FRAGMENT_COUNT; i++) {
    const angle = ((i / FRAGMENT_COUNT) * 360 + rnd() * 24) * (Math.PI / 180);
    const dist = 60 + rnd() * 52;
    const fall = 16 + rnd() * 28;
    out.push({ fx: Math.cos(angle) * dist, fy: Math.sin(angle) * dist + fall });
  }
  return out;
}

function Icicle({
  spec,
  bornAt,
  crit,
  onSelf,
  targetScale,
  onHit,
}: {
  spec: IcicleSpec;
  bornAt: number;
  crit: boolean;
  onSelf: boolean;
  targetScale: number;
  onHit?: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const dmgWrap = useRef<HTMLDivElement>(null);
  const hit = useRef(false);
  const fragments = useMemo(() => buildFragments(Math.random() * 1000 + 1), []);

  useFrame(() => {
    const g = group.current;
    const wrapEl = wrap.current;
    const el = art.current;
    const dmgEl = dmgWrap.current;
    if (!g || !wrapEl || !el) return;
    const t = performance.now() - bornAt - spec.delayMs;
    const alive = t >= 0 && t < ICICLE_VISIBLE_MS;
    wrapEl.style.display = alive ? "block" : "none";
    if (dmgEl) dmgEl.style.display = alive ? "block" : "none";
    if (!alive) return;

    // vida da QUEDA em si, travada em 1 assim que pousa — depois disso a
    // estalactite só fica parada no ponto de impacto enquanto o burst
    // (spikes/aro/número) termina de tocar por cima (`ICICLE_VISIBLE_MS`).
    const fallLife = Math.min(1, t / ICICLE_FALL_MS);

    // MESMA matemática de queda de antes: leque de ângulos convergindo pro
    // centro (`CONVERGE_RADIUS = 0`) enquanto desce da cabeça pro corpo.
    const dirX = Math.cos(spec.angle);
    const dirZ = Math.sin(spec.angle);
    const r = SPREAD_RADIUS + (CONVERGE_RADIUS - SPREAD_RADIUS) * fallLife;
    const y = HEAD_Y + (BODY_Y - HEAD_Y) * fallLife;
    g.position.set(dirX * r, y, dirZ * r);

    // opacidade/escala mexidas direto no DOM (sem setState) — mesmo
    // princípio de nunca disparar re-render por quadro que o resto do
    // projeto segue pra objetos three; aqui o "objeto" é um <div>.
    const scale = 0.75 + fallLife * 0.3;
    el.style.transform = `scale(${scale})`;
    el.style.opacity =
      fallLife > ICICLE_IMPACT_FRACTION
        ? String(Math.max(0, 1 - (fallLife - ICICLE_IMPACT_FRACTION) / (1 - ICICLE_IMPACT_FRACTION)))
        : "1";

    if (!hit.current && fallLife >= ICICLE_IMPACT_FRACTION) {
      hit.current = true;
      // UMA classe no WRAP liga TUDO por CSS: a lança esmaga-e-some
      // (seletor filho `.cb-ice-spike`), o burst de impacto (flash/aro/
      // fragmentos) tocam junto — cada estalactite dispara o PRÓPRIO burst,
      // na PRÓPRIA posição (ela já está no centro do alvo por
      // `CONVERGE_RADIUS = 0`), sem efeito compartilhado entre as 5. O
      // número (Html separado, acima da cabeça) liga pela PRÓPRIA classe,
      // no mesmo evento.
      wrapEl.classList.add("cb-ice-wrap--impact");
      dmgEl?.classList.add("cb-ice-dmgnum--impact");
      onHit?.();
    }
  });

  useEffect(() => {
    hit.current = false;
    wrap.current?.classList.remove("cb-ice-wrap--impact");
    dmgWrap.current?.classList.remove("cb-ice-dmgnum--impact");
  }, [spec]);

  const tscaleStyle = { "--tscale": targetScale } as CSSProperties;

  return (
    <group ref={group}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={wrap} className="cb-ice-wrap" style={{ display: "none", ...tscaleStyle }}>
          <div ref={art} className="cb-ice-spike">
            <div className="cb-ice-spike__glow" />
            <div className="cb-ice-spike__body" />
          </div>
          <div className="cb-ice-hit">
            <div className="cb-ice-hit__ring" />
            <div className="cb-ice-hit__flash" />
            {fragments.map((f, i) => (
              <div key={i} className="cb-ice-hit__frag" style={{ "--fx": `${f.fx}px`, "--fy": `${f.fy}px` } as CSSProperties} />
            ))}
          </div>
        </div>
      </Html>
      {spec.dmg !== undefined && (
        <group position={[0, (DMG_SPAWN_Y + spec.dmgStackY) * targetScale, 0]}>
          <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
            <div
              ref={dmgWrap}
              className={`cb-ice-dmgnum${crit ? " cb-ice-dmgnum--crit" : ""}${onSelf ? " cb-ice-dmgnum--self" : ""}`}
              style={{ display: "none", "--dmgx": `${spec.dmgJitterPx}px` } as CSSProperties}
            >
              {spec.dmg}
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

interface FinalTotalHandle {
  trigger: () => void;
}

/**
 * Total amarelo — dispara UMA VEZ, quando `ColdBoltImpact` conta o quinto
 * `onHit` de verdade (não um timer que "acha" que os 5 hits já aconteceram).
 * `trigger()` é imperativo (`useImperativeHandle`), mesmo espírito das
 * classes ligadas por ref no resto do arquivo: nenhum re-render disparado
 * pelo evento, só a troca de `display` que já reinicia a animação CSS.
 */
const FinalTotal = forwardRef<FinalTotalHandle, { total: number; crit: boolean; targetScale: number }>(function FinalTotal(
  { total, crit, targetScale },
  ref,
) {
  const wrap = useRef<HTMLDivElement>(null);
  const triggeredAt = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    trigger: () => {
      if (triggeredAt.current === null) triggeredAt.current = performance.now();
    },
  }));

  useFrame(() => {
    const el = wrap.current;
    if (!el) return;
    if (triggeredAt.current === null) {
      el.style.display = "none";
      return;
    }
    const t = performance.now() - triggeredAt.current;
    el.style.display = t < TOTAL_VISIBLE_MS ? "block" : "none";
  });

  return (
    <group position={[0, (HEAD_TOP_Y + TOTAL_GAP_ABOVE_HEAD) * targetScale, 0]}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={wrap} className={`cb-ice-total${crit ? " cb-ice-total--crit" : ""}`} style={{ display: "none" }}>
          {total}
        </div>
      </Html>
    </group>
  );
});

/**
 * A "arte" da lança inteira: `clip-path` + gradientes + dois pseudo-elementos
 * (faceta clara de reflexo, faceta escura de sombra) num `<div>` só — sem
 * PNG/SVG novo nenhum. Injetada UMA VEZ no `<head>` (mesmo padrão de
 * `ui/cursorStore.CursorGlobalStyle`: uma tag `<style>` com id fixo) em vez
 * de um `.css` importado — este projeto não tem nenhum arquivo `.css` solto,
 * só componentes que escrevem a própria folha de estilo.
 *
 * Desenhada já apontando pra BAIXO (a ponta do `clip-path` fica embaixo) —
 * "virada pra baixo" fica embutido no desenho, sem rotação nenhuma em tempo
 * de execução.
 */
const ICE_SPIKE_STYLE_ID = "cold-bolt-ice-spike-style";
const ICE_SPIKE_CSS = `
/* .cb-ice-wrap é um ponto de ORIGEM sem tamanho próprio (width/height 0) —
   é ESSE ponto que o <Html center> centraliza no alvo. Antes, o wrap tinha
   a altura da própria lança (fluxo normal) e o Html centralizava o MEIO da
   lança no alvo — com a lança curta não dava pra notar, mas depois de
   crescer bastante o burst de impacto (filho, ancorado embaixo da lança)
   ficava visivelmente ABAIXO do alvo de verdade. Lança e burst agora são os
   DOIS position:absolute a partir do MESMO (0,0): a lança fica pendurada
   pra CIMA daqui (bottom:0), o burst nasce EXATAMENTE aqui (top:0). */
.cb-ice-wrap { position: relative; width: 0; height: 0; pointer-events: none; }
.cb-ice-spike {
  position: absolute;
  left: 50%;
  bottom: 0;
  /* centraliza por margem em PX, não por transform: a animação de
     aparecer/impacto já usa transform:scale(...) nos keyframes, e um
     transform de posição aqui seria substituído (não somado) por eles. */
  margin-left: -34px;
  width: 68px;
  height: 272px;
  transform-origin: 50% 25%;
  animation: cbSpikeAppear 110ms ease-out;
  filter: drop-shadow(0 0 12px rgba(140, 225, 255, 0.85)) drop-shadow(0 0 32px rgba(80, 180, 255, 0.55));
}
.cb-ice-spike__body {
  position: absolute;
  inset: 0;
  clip-path: polygon(50% 100%, 24% 58%, 32% 20%, 42% 0%, 58% 0%, 68% 20%, 76% 58%);
  background: linear-gradient(155deg, #f4feff 0%, #bdeeff 22%, #61c9f5 48%, #2189cf 74%, #0c4d80 100%);
  box-shadow: inset 0 0 8px rgba(255, 255, 255, 0.5);
}
.cb-ice-spike__body::before {
  content: "";
  position: absolute;
  inset: 0;
  clip-path: polygon(50% 94%, 40% 56%, 46% 22%, 50% 8%, 54% 22%);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 75%);
  mix-blend-mode: screen;
  opacity: 0.9;
}
.cb-ice-spike__body::after {
  content: "";
  position: absolute;
  inset: 0;
  clip-path: polygon(50% 100%, 60% 58%, 68% 20%, 58% 0%, 76% 58%);
  background: linear-gradient(205deg, rgba(4, 40, 70, 0.05), rgba(4, 40, 70, 0.6));
  opacity: 0.75;
}
/* sem filter:blur — já é radial-gradient (borda nasce suave); o blur(3px)
   só adicionava um degrau extra de raster por cima de um degradê que já
   desenha macio (mesma família de troca do halo do raio, ver comentário
   junto de THUNDER_CSS em ThunderStormImpact.tsx). Gradiente com um estágio
   a mais (45%) no lugar do único degrau de antes (70%) pra não perder a
   suavidade que o blur dava na transição. */
.cb-ice-spike__glow {
  position: absolute;
  left: 50%;
  top: 58%;
  width: 138%;
  height: 82%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(140, 225, 255, 0.55), rgba(140, 225, 255, 0.32) 45%, rgba(140, 225, 255, 0) 75%);
  animation: cbSpikeGlow 480ms ease-in-out infinite;
}
.cb-ice-wrap--impact .cb-ice-spike {
  animation: cbSpikeImpact 160ms ease-out forwards;
}
@keyframes cbSpikeAppear {
  from { opacity: 0; transform: scale(0.5, 0.25); }
  to { opacity: 1; transform: scale(1, 1); }
}
@keyframes cbSpikeGlow {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.95; }
}
@keyframes cbSpikeImpact {
  0% { transform: scale(1, 1); opacity: 1; }
  40% { transform: scale(1.5, 0.55); opacity: 1; }
  100% { transform: scale(1.9, 0.25); opacity: 0; }
}

/* Burst de impacto — flash, aro de gelo cristalino e fragmentos se
   espalhando. Ancorado no MESMO (0,0) do wrap — o centro real do alvo (ver
   comentário de .cb-ice-wrap acima), não mais na ponta visual da lança.
   Tamanho base pensado pra ULTRAPASSAR visualmente as laterais de um alvo
   padrão (--tscale = 1); --tscale escala pra cima/baixo por espécie
   (mobModel/classModelFor). */
.cb-ice-hit { position: absolute; left: 50%; top: 0; width: 0; height: 0; }
.cb-ice-hit__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(60px * var(--tscale, 1)); height: calc(60px * var(--tscale, 1));
  margin: calc(-30px * var(--tscale, 1)) 0 0 calc(-30px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #cdf3ff 35%, rgba(140, 225, 255, 0.6) 60%, rgba(140, 225, 255, 0) 75%);
  opacity: 0;
}
/* Aro de gelo — não um círculo genérico: border cristalino + uma camada de
   segmentos (repeating-conic-gradient mascarado numa faixa fina, ::before)
   simulando "pedaços quebrados" ao redor, sem precisar de N elementos extra. */
.cb-ice-hit__ring {
  position: absolute; left: 50%; top: 50%;
  width: calc(200px * var(--tscale, 1)); height: calc(200px * var(--tscale, 1));
  margin: calc(-100px * var(--tscale, 1)) 0 0 calc(-100px * var(--tscale, 1));
  border-radius: 50%;
  border: calc(6px * var(--tscale, 1)) solid rgba(180, 235, 255, 0.85);
  box-shadow: 0 0 36px rgba(140, 225, 255, 0.75), inset 0 0 20px rgba(180, 235, 255, 0.5);
  opacity: 0;
}
.cb-ice-hit__ring::before {
  content: "";
  position: absolute;
  inset: calc(-16px * var(--tscale, 1));
  border-radius: 50%;
  background: repeating-conic-gradient(rgba(210, 245, 255, 0.95) 0deg 5deg, transparent 5deg 24deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 10px), #fff calc(100% - 10px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 10px), #fff calc(100% - 10px));
  opacity: 0.85;
}
.cb-ice-hit__frag {
  position: absolute; left: 50%; top: 50%;
  width: calc(20px * var(--tscale, 1)); height: calc(20px * var(--tscale, 1));
  margin: calc(-10px * var(--tscale, 1)) 0 0 calc(-10px * var(--tscale, 1));
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  background: linear-gradient(160deg, #f2ffff, #a8e9ff 55%, #2f97d6);
  filter: drop-shadow(0 0 10px rgba(140, 220, 255, 0.95));
  opacity: 0;
}
.cb-ice-wrap--impact .cb-ice-hit__flash { animation: cbHitFlash 240ms ease-out forwards; }
.cb-ice-wrap--impact .cb-ice-hit__ring { animation: cbHitRing 420ms ease-out forwards; }
/* os 8 fragmentos por estalactite (.cb-ice-hit__frag, até 1200 simultâneos
   a 30 players) NÃO animam — a CSS animation neles sozinha media ~64% do
   custo de raster/GPU do impacto (medido; ring+flash+spike cobrem a
   legibilidade do impacto sem eles). Ficam parados na base opacity:0
   (regra acima) — nunca aparecem, mas continuam no DOM. */
@keyframes cbHitFlash {
  0% { opacity: 0; transform: scale(0.4); }
  20% { opacity: 1; transform: scale(1.3); }
  100% { opacity: 0; transform: scale(2.2); }
}
@keyframes cbHitRing {
  0% { opacity: 0.9; transform: scale(0.3); }
  100% { opacity: 0; transform: scale(2.1); }
}

/* Número de dano individual — cachoeira: nasce perto do topo do corpo, sobe
   um pouco, e CAI na diagonal pro mesmo lado (direita) até perto dos pés,
   sumindo no caminho. --dmgx dá uma pequena variação horizontal de largada
   (não é o que faz a cascata — quem faz é a trajetória abaixo). */
.cb-ice-dmgnum {
  position: relative;
  left: var(--dmgx, 0px);
  transform: translate(-50%, 0) scale(0.4);
  font: 800 84px/1 "Segoe UI", system-ui, sans-serif;
  color: #eafcff;
  text-shadow: 0 0 32px rgba(80, 190, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9), 0 0 56px rgba(40, 150, 230, 0.6);
  white-space: nowrap;
  opacity: 0;
  /* só visual — sem isto dava pra arrastar e selecionar o número como texto
     (o pointerEvents="none" do Html barra clique/drag que COMEÇA aqui,
     mas não impede o número de entrar numa seleção que varre por cima) */
  user-select: none;
  -webkit-user-select: none;
}
.cb-ice-dmgnum--crit {
  font-size: 108px;
  color: #fff3bf;
  text-shadow: 0 0 40px rgba(255, 214, 110, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9);
}
.cb-ice-dmgnum--self { color: #ffb4b4; }
.cb-ice-dmgnum--impact {
  animation: cbDmgNum 1000ms cubic-bezier(0.33, 0.4, 0.4, 1) forwards;
}
@keyframes cbDmgNum {
  0% { opacity: 0; transform: translate(calc(-50% + 0px), 24px) scale(0.4); }
  10% { opacity: 1; transform: translate(calc(-50% + 0px), -40px) scale(1.2); }
  22% { opacity: 1; transform: translate(calc(-50% + 8px), -56px) scale(1); }
  55% { opacity: 0.75; transform: translate(calc(-50% + 280px), 240px) scale(0.95); }
  100% { opacity: 0; transform: translate(calc(-50% + 520px), 520px) scale(0.8); }
}

/* Total amarelo/dourado — o número de MAIOR destaque da sequência inteira,
   perto (nunca longe) do topo da cabeça (posição 3D em HEAD_TOP_Y +
   TOTAL_GAP_ABOVE_HEAD, ~60px de folga). Dispara pelo evento real do 5º hit
   (FinalTotal.trigger, chamado de ColdBoltImpact) — a PRÓPRIA animação CSS
   deste elemento fica curta de propósito, pra não somar mais altura por
   cima do offset 3D que já é pequeno. */
.cb-ice-total {
  position: relative;
  transform: translate(-50%, 0) scale(0.3);
  font: 900 168px/1 "Segoe UI", system-ui, sans-serif;
  color: #ffe27a;
  text-shadow: 0 0 64px rgba(255, 200, 60, 0.95), 0 12px 0 rgba(70, 40, 0, 0.95), 0 -12px 0 rgba(70, 40, 0, 0.95),
    12px 0 0 rgba(70, 40, 0, 0.95), -12px 0 0 rgba(70, 40, 0, 0.95), 0 0 104px rgba(255, 180, 40, 0.65);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
  animation: cbTotalShow 1400ms cubic-bezier(0.16, 0.84, 0.28, 1);
}
.cb-ice-total--crit { color: #fff2b8; }
@keyframes cbTotalShow {
  0% { opacity: 0; transform: translate(-50%, 32px) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -24px) scale(1.3); }
  32% { transform: translate(-50%, -40px) scale(1.08); }
  78% { opacity: 1; transform: translate(-50%, -40px) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -88px) scale(1); }
}
`;

function useIceSpikeStyles(): void {
  useEffect(() => {
    if (document.getElementById(ICE_SPIKE_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = ICE_SPIKE_STYLE_ID;
    tag.textContent = ICE_SPIKE_CSS;
    document.head.appendChild(tag);
  }, []);
}
