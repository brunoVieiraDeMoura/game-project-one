import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { CSSProperties } from "react";
import { anchorDeArma } from "../../../entities/weaponAnchors";
import { createSeededRng } from "../../core/particleMath";

/**
 * Cold Bolt (MG_COLDBOLT) — partículas de gelo no CASTER, CSS puro. Cobre os
 * dois primeiros estágios do pedido:
 *
 *  1. "Partículas durante o cast" — a nuvem de cristais some/aparece gradual
 *     (`life < FADE_IN_FRAC`) e orbita/sobe em loop enquanto a conjuração
 *     está de pé.
 *  2. "Burst quando a skill sai do caster" — nos últimos instantes da vida
 *     do efeito (`RELEASE_FRAC`), a classe `--release` liga: os cristais que
 *     estavam orbitando ESPALHAM pra fora e um flash branco/azul estoura no
 *     centro.
 *
 * Por que os dois estágios vivem no MESMO componente/timer, em vez de dois
 * VFX separados: este efeito nasce em `skill:casting` (`net/useWorldEvents`)
 * com `expiresAt = now + durationMs` — `durationMs` é o tempo de conjuração
 * REAL que o rAthena mandou, e `skill:cast` (a liberação de verdade) chega
 * bem perto desse instante já por CONSTRUÇÃO (é o mesmo `durationMs` que
 * fecha a barra de cast do HUD, `net/castStore`). Reaproveitar esse relógio
 * pro burst final é system, não invenção: não existe pacote nenhum "liberou
 * a skill NO CASTER" separado do dano — inventar um novo campo/estado só pra
 * cravar o burst no frame exato seria adicionar um mecanismo de rede que o
 * pedido explicitamente disse pra não mexer ("não alterar o sistema de
 * cast"). Se o cast for INTERROMPIDO, o efeito ainda expira e a "liberação"
 * toca sem dano nenhum atrás — mesma imprecisão cosmética que o
 * `AreaDisc` genérico (visual "melhor esforço", não fonte de verdade) já
 * tinha antes desta troca.
 *
 * Posição: NA PONTA DO CAJADO, não no centro do personagem.
 *
 * `entities/EquippedWeapons` já é quem monta a arma no handslot certo — a
 * ponta dela agora vive registrada em `entities/weaponAnchors` como um
 * `THREE.Object3D` de verdade, filho da própria arma (medido pela bounding
 * box real da malha, não chutado). A cada quadro este componente lê
 * `anchorDeArma(sourceGid).getWorldPosition(...)` e escreve o resultado no
 * PRÓPRIO `<group>` — a mesma técnica de "grupo reposicionado por quadro"
 * que `ColdBoltImpact` já usa pra seguir o alvo, só que a fonte da posição
 * aqui é a ANIMAÇÃO DA MÃO (idle/cast/andar), não a célula do servidor.
 * Câmera girando, personagem virando, mão balançando no idle — tudo
 * embutido na `matrixWorld` do osso, sem duplicar nenhuma conta aqui.
 *
 * `x,y,z` (posição da CÉLULA, a mesma que `SkillVfx.VfxNode` já calculava
 * pra "cast") continuam existindo como FALLBACK — se a arma ainda não
 * montou (`anchorDeArma` devolve `undefined`, ex.: primeiro quadro depois
 * de entrar no mapa) ou se o caster por algum motivo não tem arma
 * registrada, o efeito nasce no peito do personagem em vez de sumir.
 */

const FADE_IN_FRAC = 0.22;
const RELEASE_FRAC = 0.86;
const PARTICLE_COUNT = 9;
/** altura acima do pé do caster onde a nuvem paira — por volta do peito/mãos */
const CLOUD_Y = 1.05;

interface ParticleSpec {
  angleDeg: number;
  radiusPx: number;
  risePx: number;
  durMs: number;
  delayMs: number;
}

function buildParticles(seed: number): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    out.push({
      angleDeg: (i / PARTICLE_COUNT) * 360 + rnd() * 40,
      radiusPx: 22 + rnd() * 18,
      // metade sobe bastante (flocos subindo), metade quase não sai da órbita —
      // "algumas partículas devem subir, outras orbitar" sem duas listas
      // separadas, só variando o próprio parâmetro
      risePx: i % 2 === 0 ? 22 + rnd() * 14 : 4 + rnd() * 6,
      durMs: 900 + rnd() * 500,
      delayMs: rnd() * 500,
    });
  }
  return out;
}

export function ColdBoltCastFrost({
  x,
  y,
  z,
  sourceGid,
  expiresAt,
}: {
  /** posição da célula do caster — só usada como FALLBACK (ver docblock) */
  x: number;
  y: number;
  z: number;
  /** dono da arma — chave de `entities/weaponAnchors` */
  sourceGid: number;
  expiresAt: number;
}) {
  useCastFrostStyles();
  const born = useRef(performance.now());
  const total = Math.max(200, expiresAt - born.current);
  const particles = useMemo(() => buildParticles(Math.random() * 1000 + 1), []);
  const group = useRef<THREE.Group>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const released = useRef(false);
  const worldPos = useRef(new THREE.Vector3());

  useFrame(() => {
    const g = group.current;
    const el = wrap.current;
    if (!g || !el) return;

    const tip = anchorDeArma(sourceGid);
    if (tip) {
      tip.getWorldPosition(worldPos.current);
      g.position.copy(worldPos.current);
    } else {
      // arma ainda não montou (ou caster sem arma) — fica no peito, não some
      g.position.set(x, y + CLOUD_Y, z);
    }

    const t = performance.now() - born.current;
    const life = Math.min(1, t / total);
    el.style.opacity = life < FADE_IN_FRAC ? String(life / FADE_IN_FRAC) : "1";
    if (!released.current && life >= RELEASE_FRAC) {
      released.current = true;
      el.classList.add("cb-cast-frost--release");
    }
  });

  return (
    <group ref={group}>
      {/*
       * `occlude` LIGADO (raycast contra a cena inteira, drei padrão de
       * `occlude={true}`): sem isto o efeito é DOM puro por cima de tudo,
       * sempre visível — atravessava o personagem de trás. Com oclusão real,
       * um raio câmera→ponta-do-cajado é testado contra a cena a cada
       * quadro: geometria mais perto que a ponta esconde o efeito (visto de
       * trás, o corpo entra na frente), nada mais perto deixa passar (visto
       * de frente, o efeito fica por cima) — é profundidade de verdade, não
       * uma ordem de camada fixa, então os dois casos saem do MESMO
       * mecanismo. `TIP_EPSILON` em `EquippedWeapons` evita o cajado se
       * auto-ocluir por ruído numérico na própria ponta.
       */}
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude pointerEvents="none">
        <div ref={wrap} className="cb-cast-frost">
          <div className="cb-cast-frost__glow" />
          {particles.map((p, i) => (
            <div
              key={i}
              className="cb-cast-frost__crystal"
              style={
                {
                  "--angle": `${p.angleDeg}deg`,
                  "--radius": `${p.radiusPx}px`,
                  "--rise": `${p.risePx}px`,
                  "--pdur": `${p.durMs}ms`,
                  "--pdelay": `${p.delayMs}ms`,
                } as CSSProperties
              }
            />
          ))}
          <div className="cb-cast-frost__burst" />
        </div>
      </Html>
    </group>
  );
}

const CAST_FROST_STYLE_ID = "cold-bolt-cast-frost-style";
const CAST_FROST_CSS = `
.cb-cast-frost { position: relative; width: 4px; height: 4px; pointer-events: none; }
.cb-cast-frost__glow {
  position: absolute; left: 50%; top: 50%; width: 108px; height: 108px;
  margin: -54px 0 0 -54px; border-radius: 50%;
  background: radial-gradient(circle, rgba(150, 225, 255, 0.38), rgba(150, 225, 255, 0) 72%);
  animation: cbCastGlow 900ms ease-in-out infinite;
}
.cb-cast-frost__crystal {
  position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px;
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  background: linear-gradient(160deg, #f2ffff 0%, #a8e9ff 55%, #3aa8e0 100%);
  filter: drop-shadow(0 0 4px rgba(140, 220, 255, 0.9));
  opacity: 0;
  transform-origin: center;
  animation: cbCastOrbit var(--pdur) ease-in-out var(--pdelay) infinite;
}
.cb-cast-frost--release .cb-cast-frost__crystal {
  animation: cbCastScatter 320ms ease-out forwards;
}
.cb-cast-frost__burst {
  position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px;
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #a8e9ff 45%, rgba(150, 225, 255, 0) 72%);
  opacity: 0;
}
.cb-cast-frost--release .cb-cast-frost__burst {
  animation: cbCastBurst 300ms ease-out forwards;
}
@keyframes cbCastGlow {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 0.9; transform: scale(1.15); }
}
@keyframes cbCastOrbit {
  0% {
    opacity: 0;
    transform: rotate(var(--angle)) translateX(var(--radius)) rotate(calc(var(--angle) * -1)) translateY(0) scale(0.5);
  }
  18% { opacity: 1; }
  100% {
    opacity: 0.15;
    transform: rotate(calc(var(--angle) + 130deg)) translateX(var(--radius)) rotate(calc((var(--angle) + 130deg) * -1))
      translateY(calc(-1 * var(--rise))) scale(0.95);
  }
}
@keyframes cbCastScatter {
  0% { opacity: 1; transform: rotate(var(--angle)) translateX(var(--radius)) rotate(calc(var(--angle) * -1)) scale(0.9); }
  100% {
    opacity: 0;
    transform: rotate(var(--angle)) translateX(calc(var(--radius) * 3.4)) rotate(calc(var(--angle) * -1)) scale(0.3);
  }
}
@keyframes cbCastBurst {
  0% { opacity: 0; transform: scale(0.3); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: scale(5.5); }
}
`;

function useCastFrostStyles(): void {
  useEffect(() => {
    if (document.getElementById(CAST_FROST_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = CAST_FROST_STYLE_ID;
    tag.textContent = CAST_FROST_CSS;
    document.head.appendChild(tag);
  }, []);
}
