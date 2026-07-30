import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import type { GameplayConfig } from "@ragnarok/game-data";
import { CHARACTER_URLS, useCharacter, type CharacterKey } from "../assets";
import { usePlayerInput } from "../play/usePlayerInput";
import { usePlayStore } from "../play/playStore";
import { gateway } from "./gateway";
import { cellToWorld, worldToCell, type LegacyMapping } from "./legacyCells";
import { interpolatedCell, serverPath, useWorldStore } from "./worldStore";
import { MAX_WALK_PATH_DEFAULT } from "./pathfind";
import { usePlayerStore } from "./playerStore";
import { useAimStore } from "./aimStore";
import { SelfBars } from "./SelfBars";

/**
 * O personagem do jogador com o SERVIDOR mandando.
 *
 * A diferença para o Player local (play/Player.tsx) é de autoridade: aqui o
 * cliente não move ninguém, ele PEDE (CZ.REQUEST_MOVE via gateway) e desenha o
 * caminho que o map-server confirmou. Se o servidor discordar, o próximo
 * ZC.NOTIFY_PLAYERMOVE reposiciona — é o rubber-band clássico do RO.
 *
 * Duas formas de pedir, o mesmo pacote no fim:
 *  • clique no chão (modo tile do RO) → a célula clicada;
 *  • WASD → a célula à frente na direção da câmera, re-pedida enquanto a tecla
 *    estiver segurada. É assim que se faz WASD num servidor que só entende
 *    "ande até a célula X,Y".
 */
export function NetPlayer({
  map,
  mapping,
  gameplay,
  positionRef,
  camAzimuthRef,
  characterKey = "knight",
  cellSize,
}: {
  map: GameMap;
  mapping: LegacyMapping;
  gameplay: GameplayConfig;
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  camAzimuthRef?: React.MutableRefObject<number>;
  characterKey?: CharacterKey;
  /** largura da célula em unidades de mundo (barras, passo do WASD e marcador) */
  cellSize: number;
}) {
  const group = useRef<THREE.Group>(null);
  /** só o boneco gira; o que fica no grupo raiz não acompanha a virada */
  const model = useRef<THREE.Group>(null);
  const { scene, play } = useCharacter(CHARACTER_URLS[characterKey], gameplay.animationSpeed);
  const { axis } = usePlayerInput();
  const moveTarget = usePlayStore((s) => s.moveTarget);
  const setMoveTarget = usePlayStore((s) => s.setMoveTarget);
  const wasMoving = useRef(false);
  const lastRequest = useRef(0);
  const lastCell = useRef<{ x: number; y: number } | null>(null);
  /** destino final quando ele está além do alcance de um pedido só (ver abaixo) */
  const destinoFinal = useRef<{ x: number; y: number } | null>(null);

  /** Quantas células à frente o WASD mira. Perto demais e o passo fica picado. */
  const WASD_LOOKAHEAD = 4;
  /** O roBrowser limita a 200 ms entre pedidos de caminhada; o servidor ignora spam. */
  const REQUEST_INTERVAL_MS = 200;
  /** maior trecho que se pede de uma vez (ver `pedirMovimento`) */
  const TRECHO_MAX = MAX_WALK_PATH_DEFAULT - 1;

  /**
   * Pede para andar até a célula, quebrando o pedido quando for longe demais.
   *
   * O rAthena recusa em SILÊNCIO qualquer caminho acima de
   * `battle_config.max_walk_path` (17 por padrão, unit.cpp:860) — clicar longe
   * simplesmente não fazia nada, e era isso que limitava o alcance do clique.
   * Aqui o cliente calcula o mesmo caminho que o servidor calcularia, manda o
   * trecho que cabe e guarda o resto para pedir quando chegar.
   *
   * A margem de uma célula existe porque quem refaz a conta é o SERVIDOR, a
   * partir da célula onde ELE acha que o personagem está — que pode estar uma à
   * frente da que o cliente desenha.
   */
  const pedirMovimento = (destino: { x: number; y: number }) => {
    const de = interpolatedCell(useWorldStore.getState().self, performance.now());
    const origem = { x: Math.round(de.x), y: Math.round(de.y) };
    const caminho = serverPath(origem, destino);
    if (caminho && caminho.length > TRECHO_MAX) {
      const trecho = caminho[TRECHO_MAX - 1]!;
      // Só encadeia se o trecho APROXIMA. Sem isso, um destino que o A* nunca
      // alcança (célula de árvore, ilha cercada de parede) fazia o cliente pedir
      // 16 células a cada chegada, para sempre e mudando de rota — o personagem
      // saía vagando sozinho pelo mapa.
      const antes = Math.max(Math.abs(destino.x - origem.x), Math.abs(destino.y - origem.y));
      const depois = Math.max(Math.abs(destino.x - trecho.x), Math.abs(destino.y - trecho.y));
      destinoFinal.current = depois < antes ? destino : null;
      gateway().emit("move:to", trecho);
      return;
    }
    destinoFinal.current = null;
    gateway().emit("move:to", destino);
  };

  // Clique no chão: o GroundInteract já converteu para posição de mundo; aqui
  // vira célula do servidor e vai como pedido.
  useEffect(() => {
    if (!moveTarget) return;
    const cell = worldToCell(map, mapping, moveTarget.x, moveTarget.z);

    // Mirando uma skill de área? O clique aponta a magia em vez de andar — é o
    // segundo passo do fluxo do RO (escolhe a skill, depois o lugar).
    const aiming = useAimStore.getState().skill;
    if (aiming && aiming.mode === "ground") {
      gateway().emit("skill:use-ground", {
        skillId: aiming.id,
        level: aiming.level,
        x: cell.x,
        y: cell.y,
      });
      useAimStore.getState().cancel();
    } else {
      pedirMovimento(cell);
    }

    setMoveTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveTarget, map, mapping, setMoveTarget]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;

    const self = useWorldStore.getState().self;
    const now = performance.now();
    const cell = interpolatedCell(self, now);
    const world = cellToWorld(map, mapping, cell.x, cell.y);

    // A rotação vai no grupo do MODELO, nunca no grupo raiz: as barras de HP/SP
    // penduradas aqui girariam junto com o boneco (o Billboard do drei compensa
    // o pai com a matriz do frame anterior, então a barra cambaleava a cada
    // curva). Raiz posiciona, filho olha para onde anda.
    const dx = world.x - g.position.x;
    const dz = world.z - g.position.z;
    if (cell.moving && dx * dx + dz * dz > 1e-6 && model.current) {
      model.current.rotation.y = Math.atan2(dx, dz);
    }

    g.position.set(world.x, world.y, world.z);
    positionRef?.current.set(world.x, world.y, world.z);

    if (cell.moving !== wasMoving.current) {
      wasMoving.current = cell.moving;
      play(cell.moving ? "run" : "idle");
    }

    // Chegou ao fim de um trecho e ainda falta caminho? Pede o próximo. É o que
    // faz o clique em qualquer ponto da tela funcionar, mesmo além das 32
    // células que o servidor aceita por pedido.
    if (!cell.moving && destinoFinal.current) {
      const alvo = destinoFinal.current;
      if (Math.round(cell.x) === alvo.x && Math.round(cell.y) === alvo.y) {
        destinoFinal.current = null;
      } else if (now - lastRequest.current > REQUEST_INTERVAL_MS) {
        lastRequest.current = now;
        pedirMovimento(alvo);
      }
    }

    // WASD → pedido de caminhada na direção da câmera.
    const ax = axis.current.x;
    const az = axis.current.z;
    if (ax === 0 && az === 0) {
      lastCell.current = null;
      return;
    }
    // teclado assume o controle: o destino guardado do clique morre aqui
    destinoFinal.current = null;
    if (now - lastRequest.current < REQUEST_INTERVAL_MS) return;

    const a = camAzimuthRef?.current ?? 0;
    const fwd = -az;
    const dirX = Math.cos(a) * ax + -Math.sin(a) * fwd;
    const dirZ = -Math.sin(a) * ax + -Math.cos(a) * fwd;
    const len = Math.hypot(dirX, dirZ) || 1;

    // Anda em unidades de MUNDO e só então converte: assim o passo tem o mesmo
    // tamanho em qualquer escala (a célula do servidor não muda, o mundo sim).
    // A medida é a célula DESENHADA, não o `map.cellSize` do arquivo — este vale
    // 5 e nada tem a ver com o tamanho do mundo, o que fazia o WASD mirar 2,5×
    // mais longe que o pretendido e andar diferente do clique.
    const step = cellSize * WASD_LOOKAHEAD;
    const target = worldToCell(map, mapping, world.x + (dirX / len) * step, world.z + (dirZ / len) * step);

    if (lastCell.current && lastCell.current.x === target.x && lastCell.current.y === target.y) {
      return;
    }
    lastCell.current = target;
    lastRequest.current = now;
    gateway().emit("move:to", target);
  });

  return (
    <group ref={group}>
      <group ref={model} scale={gameplay.charScale}>
        <primitive object={scene} />
      </group>
      {/* barras de HP/SP embaixo do personagem, como no RO — FORA do grupo que
          gira, senão viram junto com o boneco a cada mudança de direção */}
      <SelfBars cellSize={cellSize} />
    </group>
  );
}
