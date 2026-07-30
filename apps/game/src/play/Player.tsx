import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  createMovementController,
  DEFAULT_MOVEMENT_CONFIG,
  type CellLattice,
  type MovementState,
  type TerrainQuery,
} from "@ragnarok/engine-core";
import type { GameplayConfig } from "@ragnarok/game-data";
import { CHARACTER_URLS, useCharacter, type CharacterKey } from "../assets";
import { usePlayerInput } from "./usePlayerInput";
import { isTyping } from "./isTyping";
import { usePlayStore } from "./playStore";

/**
 * Player do modo LOCAL (demo, preview do editor).
 *
 * Liga o MovementController (grid/free, escolhido pelo modo do store) ao Knight
 * animado. Nada de setState por frame — posição/rotação mutadas via ref; a
 * posição de mundo é espelhada em `positionRef` pra câmera seguir.
 *
 * Não tem combate: quando há sessão no rAthena quem desenha o personagem é
 * `net/NetPlayer`, e ataque/dano são do servidor. O que sobrou aqui é
 * locomoção — que é justamente o que o editor de mapas precisa testar.
 */
export function Player({
  terrain,
  cellSize,
  start,
  characterKey = "knight",
  positionRef,
  camAzimuthRef,
  gameplay,
  lattice,
}: {
  terrain: TerrainQuery;
  /** tamanho da célula do clique-tile (hex: largura do hexágono) */
  cellSize: number;
  start: { x: number; z: number };
  characterKey?: CharacterKey;
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  /** azimute de movimento (referência do WASD); NÃO inclui o olhar temporário */
  camAzimuthRef?: React.MutableRefObject<number>;
  /** ajustes do editor do game (velocidades, pulo, física, animação) */
  gameplay: GameplayConfig;
  /** células do modo clique-tile; omitido = grade quadrada de `cellSize` */
  lattice?: CellLattice | undefined;
}) {
  const group = useRef<THREE.Group>(null);
  const { scene, play, playOnce } = useCharacter(CHARACTER_URLS[characterKey], gameplay.animationSpeed);
  const { axis, jump } = usePlayerInput();
  const mode = usePlayStore((s) => s.mode);
  const moveTarget = usePlayStore((s) => s.moveTarget);
  const setMoveTarget = usePlayStore((s) => s.setMoveTarget);
  const lastWarp = useRef(0); // seq do último warp consumido (gatilho de warp)

  // UMA velocidade de movimento pros dois modos (next-change-game.txt): o dial
  // do editor (`moveSpeed`) é em unidades de mundo/seg e já vem escalado pelo
  // hexScale; o grid é em células/seg, então é o mesmo número dividido pela
  // célula — clique-tile e WASD andam exatamente igual em qualquer escala.
  const config = useMemo(
    () => ({
      ...DEFAULT_MOVEMENT_CONFIG,
      cellSize,
      freeUnitsPerSecond: gameplay.moveSpeed,
      gridCellsPerSecond: gameplay.moveSpeed / cellSize,
      lattice,
    }),
    [cellSize, gameplay.moveSpeed, lattice],
  );
  const controller = useMemo(() => createMovementController(mode, terrain, config), [mode, terrain, config]);

  const state = useRef<MovementState>({
    position: { x: start.x, y: terrain.getHeight(start.x, start.z), z: start.z },
    heading: 0,
    moving: false,
  });

  // pulo com física de gravidade: jumpHeight + gravity (velocidade de queda)
  // controlam o arco. vy inicial = sqrt(2·g·h). Trava o loco enquanto no ar.
  const vy = useRef(0);
  const yOff = useRef(0);
  const airborne = useRef(false);
  const JUMP_ANIM_SPEED = 1.8;

  // clique-tile: 1 bloco (vizinho) = walk; mais que 1 = run. Decidido no clique.
  const prevTarget = useRef<{ x: number; z: number } | null>(null);
  const gridRun = useRef(false);

  // O ref acima só vale no PRIMEIRO render — e nesse instante a config do
  // servidor (hexScale) ainda não voltou, então `start` estava na escala
  // errada. Quando ela chega, o mapa é reescalado e o ponto de início muda de
  // lugar: sem reposicionar, o personagem fica largado onde nasceu, longe do
  // mapa novo.
  useEffect(() => {
    state.current = {
      ...state.current,
      position: { x: start.x, y: terrain.getHeight(start.x, start.z), z: start.z },
      moving: false,
      stepTarget: undefined,
    };
    setMoveTarget(null);
  }, [start.x, start.z, terrain, setMoveTarget]);

  // troca de modo/controller: descarta step em voo e alvo pendente
  useEffect(() => {
    state.current = { ...state.current, moving: false, stepTarget: undefined };
    setMoveTarget(null);
  }, [controller, setMoveTarget]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const isGrid = mode === "grid";
    const pos = state.current.position;

    // teleporte por gatilho de warp: consome 1× (por seq) e reposiciona o estado
    // interno de movimento (para o passo em voo pra não "voltar andando")
    const warp = usePlayStore.getState().warp;
    if (warp && warp.seq !== lastWarp.current) {
      lastWarp.current = warp.seq;
      pos.x = warp.x;
      pos.z = warp.z;
      pos.y = terrain.getHeight(warp.x, warp.z);
      state.current = { ...state.current, position: pos, moving: false, stepTarget: undefined };
      setMoveTarget(null);
    }

    // input de WASD (relativo ao azimute de movimento)
    let inX = 0;
    let inZ = 0;
    if (!isGrid) {
      const ax = axis.current.x;
      const az = axis.current.z;
      if (ax !== 0 || az !== 0) {
        const a = camAzimuthRef?.current ?? 0;
        const fwd = -az;
        inX = Math.cos(a) * ax + -Math.sin(a) * fwd;
        inZ = -Math.sin(a) * ax + -Math.cos(a) * fwd;
      }
    }
    const usingKeys = inX !== 0 || inZ !== 0;
    const clickTarget = isGrid ? (moveTarget ?? undefined) : undefined;
    const newClick = !!(clickTarget && clickTarget !== prevTarget.current);

    const ctrlInput = { x: inX, z: inZ, target: clickTarget };

    // walk vs run no clique-tile
    if (isGrid && clickTarget && newClick) {
      prevTarget.current = clickTarget;
      const dCells = Math.hypot(clickTarget.x - pos.x, clickTarget.z - pos.z) / cellSize;
      gridRun.current = dCells > 1.5;
    }
    if (!clickTarget) prevTarget.current = null;

    const next = controller.update(state.current, ctrlInput, dt);
    state.current = next;

    if (isGrid && clickTarget) {
      const reached = Math.hypot(next.position.x - clickTarget.x, next.position.z - clickTarget.z) < cellSize * 0.6;
      if (reached && !next.moving) setMoveTarget(null);
    }

    // pulo (física de gravidade)
    if (jump.current) {
      jump.current = false;
      if (!airborne.current) {
        airborne.current = true;
        vy.current = Math.sqrt(2 * gameplay.gravity * gameplay.jumpHeight);
        playOnce("jump", JUMP_ANIM_SPEED);
      }
    }
    if (airborne.current) {
      yOff.current += vy.current * dt;
      vy.current -= gameplay.gravity * dt;
      if (yOff.current <= 0) {
        yOff.current = 0;
        airborne.current = false;
      }
    }

    const g = group.current;
    if (g) {
      g.position.set(next.position.x, next.position.y + yOff.current, next.position.z);
      g.rotation.y = next.heading;
    }
    positionRef?.current.set(next.position.x, next.position.y, next.position.z);

    // anim: ar > locomoção > idle
    if (airborne.current) {
      // pulo rodando (one-shot)
    } else if (next.moving) {
      play(isGrid ? (gridRun.current ? "run" : "walk") : "run");
    } else {
      play("idle");
    }
  });

  return (
    <group ref={group}>
      {/* char pequeno vs hex (~1/4 do bloco) — proporção KayKit p/ usar curvas por hex.
          Escala vem da config (game-editor). Puramente visual. */}
      <group scale={gameplay.charScale}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
