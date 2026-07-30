import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { CHARACTER_URLS, useCharacter } from "../assets";
import { mobModel, NPC_MODEL } from "../entities/mobModels";
import { gateway } from "./gateway";
import { cellToWorld, type LegacyMapping } from "./legacyCells";
import { interpolatedCell, useWorldStore } from "./worldStore";
import { useAimStore } from "./aimStore";
import { EntityLabel } from "./EntityLabel";

/**
 * Uma entidade do servidor desenhada na cena.
 *
 * Não tem IA, não decide para onde anda e não calcula dano: só interpola entre
 * a célula de onde saiu e a célula para onde o servidor disse que vai. Todo o
 * resto (aggro, velocidade, morte, drop) é do map-server.
 */
export function NetEntityView({
  gid,
  map,
  mapping,
  charScale,
  animationSpeed,
  cellSize,
}: {
  gid: number;
  map: GameMap;
  mapping: LegacyMapping;
  charScale: number;
  animationSpeed: number;
  /** largura da célula em unidades de mundo (plaquinha e hitbox são medidas nela) */
  cellSize: number;
}) {
  const entity = useWorldStore((s) => s.entities[gid]);
  const targeted = useWorldStore((s) => s.target === gid);
  const modelInfo = entity?.kind === "npc" ? NPC_MODEL : mobModel(entity?.job ?? 0);
  const { scene, play } = useCharacter(CHARACTER_URLS[modelInfo.character], animationSpeed);
  const group = useRef<THREE.Group>(null);
  /** só o boneco gira; plaquinha e área de clique ficam paradas */
  const model = useRef<THREE.Group>(null);
  const wasMoving = useRef(false);

  useFrame(() => {
    const e = useWorldStore.getState().entities[gid];
    const g = group.current;
    if (!e || !g) return;

    const cell = interpolatedCell(e, performance.now());
    const world = cellToWorld(map, mapping, cell.x, cell.y);
    const prev = g.position;

    // Vira para onde está andando. Usa o deslocamento real do frame em vez do
    // `dir` do pacote: o rAthena só manda direção em alguns pacotes, e o
    // movimento contínuo ficaria de costas. A rotação é do MODELO, não do grupo
    // raiz — a plaquinha pendurada no raiz giraria junto com o bicho.
    if (cell.moving && model.current) {
      const dx = world.x - prev.x;
      const dz = world.z - prev.z;
      if (dx * dx + dz * dz > 1e-6) {
        model.current.rotation.y = Math.atan2(dx, dz);
      }
    }

    g.position.set(world.x, world.y, world.z);

    if (import.meta.env.DEV) {
      // onde CADA entidade foi parar no mundo — a resposta para "o servidor
      // mandou o mob mas não aparece na tela"
      const dbg = (window as unknown as { __netEntities?: Record<number, unknown> });
      dbg.__netEntities ??= {};
      dbg.__netEntities[gid] = {
        tipo: e.kind,
        job: e.job,
        celula: [+cell.x.toFixed(1), +cell.y.toFixed(1)],
        mundo: [+world.x.toFixed(1), +world.y.toFixed(1), +world.z.toFixed(1)],
        modelo: modelInfo.character,
      };
    }

    if (cell.moving !== wasMoving.current) {
      wasMoving.current = cell.moving;
      play(cell.moving ? "walk" : "idle");
    }
  });

  if (!entity) return null;

  // Altura aproximada do boneco no mundo (modelo KayKit ~1.8 em escala 1).
  const height = charScale * modelInfo.scale * 1.8;

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation();
        useWorldStore.getState().setTarget(gid);

        // Mira de skill de alvo pendente: este clique escolhe EM QUEM, e não
        // vira ataque normal — no RO o cursor de skill substitui o de ataque.
        const aiming = useAimStore.getState().skill;
        if (aiming && aiming.mode === "entity") {
          gateway().emit("skill:use", { skillId: aiming.id, level: aiming.level, targetGid: gid });
          useAimStore.getState().cancel();
          return;
        }

        // Alvejar pede a ficha ao servidor: o pacote de spawn traz só o nome, e
        // é o ACK_REQNAME que devolve HP e nível (com show_mob_info ligado) —
        // é assim que a barra do alvo se preenche.
        gateway().emit("entity:info", { gid });
        // Alvo e ataque são pedido, não decisão: quem resolve acerto, dano e
        // morte é o servidor (CZ.REQUEST_ACT → ZC.NOTIFY_ACT). Se estiver longe,
        // ele responde ATTACK_FAILURE_FOR_DISTANCE e nada acontece — não cabe
        // ao cliente adivinhar alcance.
        if (entity.kind === "mob") {
          gateway().emit("action:attack", { gid, continuous: true });
        } else if (entity.kind === "npc") {
          // clicar no NPC começa o script DELE, no servidor; o diálogo que
          // aparece é o que ele mandar (hud/NpcDialog)
          gateway().emit("npc:talk", { gid });
        }
      }}
    >
      {/* Alvo de clique: os ossos do modelo são finos e o clique quase sempre
          passava entre os braços. Um cilindro do tamanho da CÉLULA é o que o RO
          efetivamente oferece como área clicável.
          NÃO usar `visible={false}`: o raycaster do three PULA objeto invisível
          (Raycaster.intersectObject sai cedo em `object.visible === false`), e
          era por isso que clicar no mob não fazia nada. Some pelo material —
          sem escrever cor nem profundidade — e continua sendo raycastável. */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[cellSize * 0.42, cellSize * 0.42, height, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      <group ref={model} scale={charScale * modelInfo.scale}>
        <primitive object={scene} />
      </group>

      {entity.name && (
        <EntityLabel
          name={entity.name}
          level={entity.level}
          hp={entity.hp}
          maxHp={entity.maxHp}
          height={height}
          cellSize={cellSize}
          targeted={targeted}
        />
      )}
    </group>
  );
}

/** Todas as entidades do mapa, menos o próprio personagem. */
export function NetEntities({
  map,
  mapping,
  charScale,
  animationSpeed,
  cellSize,
}: {
  map: GameMap;
  mapping: LegacyMapping;
  charScale: number;
  animationSpeed: number;
  cellSize: number;
}) {
  const selfGid = useWorldStore((s) => s.selfGid);
  // Só o conjunto de gids re-renderiza a lista; posição muda em useFrame.
  const gids = useWorldStore((s) => Object.keys(s.entities).join(","));

  return (
    <>
      {gids
        .split(",")
        .filter(Boolean)
        .map(Number)
        .filter((gid) => gid !== selfGid)
        .map((gid) => (
          <NetEntityView
            key={gid}
            gid={gid}
            map={map}
            mapping={mapping}
            charScale={charScale}
            animationSpeed={animationSpeed}
            cellSize={cellSize}
          />
        ))}
    </>
  );
}
