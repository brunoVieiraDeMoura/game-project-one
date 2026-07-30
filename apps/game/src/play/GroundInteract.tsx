import { useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { CellLattice, TerrainQuery } from "@ragnarok/engine-core";
import { usePlayStore } from "./playStore";
import { useCombatStore } from "../combat/combatStore";
import {
  MARKER_SEGS,
  TERRAIN_GROUP,
  baseDoProp,
  moldarMarcador,
  nearestHit,
  topmostXZ,
  type Hit,
} from "./pickGround";

/**
 * Plano invisível cobrindo o mapa: clique define destino (clique-pra-andar
 * estilo RO); movimento do mouse posiciona o marcador de destino, mostrado só
 * no modo grid e só em célula andável. Nada de setState por frame — o marcador
 * é mutado via ref.
 *
 * O marcador é QUADRADO e pouco maior que o personagem: antes era um quadrado
 * do tamanho da CÉLULA (5 unidades = ~2,5 hexágonos), que não tinha relação com
 * o tile pisado. A posição vem do MESMO `lattice` que o MovementController usa,
 * então o marcador cai exatamente onde o personagem vai parar — em mapas hex,
 * no centro do hexágono.
 */

/**
 * Nome do grupo que embrulha os props do mapa na cena.
 *
 * O plano de clique é um retângulo em y=0, então o raio do mouse ATRAVESSA a
 * árvore e acerta o chão atrás dela. Com prop escalado 5× isso caía dezenas de
 * células adiante: clicar no tronco mandava o personagem embora — parecia
 * teleporte. Testar o raio contra os props antes de aceitar o ponto do chão é o
 * que conserta, e para isso o GroundInteract precisa achar os props na cena.
 */
export const PROPS_GROUP = "map-props";


/** quantos anéis de células ao redor de um alvo bloqueado se procura uma andável */
const SNAP_RINGS = 4;

/** meia-largura do marcador em função do personagem (charScale × altura do modelo) */
const MARKER_OF_CHAR = 0.75;

export function GroundInteract({
  worldWidth,
  worldDepth,
  centerX,
  centerZ,
  cellSize,
  terrain,
  lattice,
  markerRadius,
}: {
  /** tamanho do plano de clique em UNIDADES DE MUNDO (não em células): num mapa
   * hex o mundo mede HEX_W×largura, que com hexScale 10 é 4× o `width×cellSize`
   * usado antes — o plano cobria um canto e o resto do mapa não recebia clique
   * nem movia o marcador */
  worldWidth: number;
  worldDepth: number;
  /** centro do plano no mundo */
  centerX: number;
  centerZ: number;
  cellSize: number;
  terrain: TerrainQuery;
  /** células do clique-tile; omitido = grade quadrada de `cellSize` */
  lattice?: CellLattice | undefined;
  /** meia-largura do marcador (unidades de mundo) — pouco maior que o personagem */
  markerRadius: number;
}) {
  const setMoveTarget = usePlayStore((s) => s.setMoveTarget);
  const setCombatTarget = useCombatStore((s) => s.setTarget);
  const mode = usePlayStore((s) => s.mode);
  const cursor = useRef<THREE.Mesh>(null);
  const hover = useRef<{ x: number; z: number } | null>(null);
  const scene = useThree((s) => s.scene);
  // raycaster próprio: o do R3F é reconfigurado a cada evento
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  // mesma conversão ponto→célula→centro do controller (grade quadrada default)
  const cells: CellLattice = useMemo(
    () =>
      lattice ?? {
        toCell: (x, z) => ({ cx: Math.floor(x / cellSize), cz: Math.floor(z / cellSize) }),
        center: (cx, cz) => ({ x: cx * cellSize + cellSize / 2, z: cz * cellSize + cellSize / 2 }),
      },
    [lattice, cellSize],
  );

  const snap = (x: number, z: number) => {
    const c = cells.toCell(x, z);
    return cells.center(c.cx, c.cz);
  };

  /**
   * Célula andável mais próxima do ponto — o alvo que o RO usa.
   *
   * Clicar em cima de árvore, parede ou penhasco pedia caminho para dentro do
   * obstáculo: o A* não acha rota, o servidor descarta o pedido e o clique
   * simplesmente não fazia nada. Andar até a borda do obstáculo é o que o
   * cliente oficial faz — e é o "dar a volta na árvore" que se espera.
   */
  const snapAndavel = (x: number, z: number) => {
    const alvo = snap(x, z);
    if (terrain.isWalkable(alvo.x, alvo.z)) return alvo;
    const c = cells.toCell(x, z);
    let melhor: { x: number; z: number } | null = null;
    let melhorDist = Infinity;
    for (let anel = 1; anel <= SNAP_RINGS; anel++) {
      for (let dz = -anel; dz <= anel; dz++) {
        for (let dx = -anel; dx <= anel; dx++) {
          // só a casca do anel: o interior já foi visto na volta anterior
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== anel) continue;
          const p = cells.center(c.cx + dx, c.cz + dz);
          if (!terrain.isWalkable(p.x, p.z)) continue;
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < melhorDist) {
            melhorDist = d;
            melhor = p;
          }
        }
      }
      if (melhor) return melhor;
    }
    return alvo;
  };

  /**
   * Ponto que o clique/hover realmente aponta.
   *
   * `e.point` é a interseção com o PLANO de clique, em y=0. Duas coisas podem
   * estar na frente dele e valem mais:
   *
   *  • um PROP (árvore): o raio atravessava o tronco e caía no chão atrás —
   *    dezenas de células adiante num prop escalado 5×;
   *  • o TOPO DO TERRENO: parede sobe, ravina afunda, e o relevo pintado à mão
   *    sobe mais ainda. Sobre um bloco alto, o plano de y=0 fica bem além do
   *    ponto em que o mouse está — o cursor "seguia a square de baixo".
   *
   * Vale sempre o hit mais próximo da câmera.
   */
  const pontoDoRaio = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    raycaster.set(e.ray.origin, e.ray.direction);
    raycaster.far = e.distance;
    const props = scene.getObjectByName(PROPS_GROUP);
    const terreno = scene.getObjectByName(TERRAIN_GROUP);

    const hitsProp = props ? raycaster.intersectObject(props, true).filter((h) => h.distance < e.distance) : [];
    const hitsChao = terreno ? raycaster.intersectObject(terreno, true).filter((h) => h.distance < e.distance) : [];
    const maisProximoProp = nearestHit(hitsProp);
    const maisProximoChao = nearestHit(hitsChao);

    /**
     * Prop na frente de tudo: o alvo é o PÉ dele, não o ponto de impacto.
     *
     * Mirar a copa de uma árvore escalada 5× acertava a folhagem a metros do
     * tronco, e o marcador saltava para uma célula que não tem relação com onde
     * se quer ir — "o square buga o direcionamento". A base do prop (a origem do
     * objeto, que é onde ele encosta no chão) é o alvo que faz sentido, e daí o
     * `snapAndavel` acha a célula livre ao lado.
     */
    if (maisProximoProp && (!maisProximoChao || maisProximoProp.distance <= maisProximoChao.distance)) {
      const pe = baseDoProp(maisProximoProp.object, props);
      if (pe) return pe;
    }
    const candidatos: Hit[] = [...hitsProp, ...hitsChao];
    return topmostXZ(candidatos, { x: e.point.x, z: e.point.z });
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    hover.current = pontoDoRaio(e);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // clique no chão vazio deseleciona o alvo de combate (clicar num monstro é
    // capturado pelo próprio monstro antes de chegar aqui)
    setCombatTarget(null);
    // clique só move no modo clique-tile; em WASD livre é clique morto
    if (mode !== "grid") return;
    const p = pontoDoRaio(e);
    setMoveTarget(snapAndavel(p.x, p.z));
  };

  useFrame(() => {
    const c = cursor.current;
    if (!c) return;
    const h = hover.current;
    if (mode !== "grid" || !h) {
      c.visible = false;
      return;
    }
    const center = snap(h.x, h.z);
    const walkable = terrain.isWalkable(center.x, center.z);
    c.visible = true;
    // O marcador fica na ORIGEM e desenha em coordenada de mundo: cada vértice é
    // amostrado no terreno, então ele veste o relevo em vez de flutuar.
    c.position.set(0, 0, 0);
    moldarMarcador(c.geometry as THREE.BufferGeometry, center.x, center.z, markerRadius, terrain);
    (c.material as THREE.MeshBasicMaterial).color.set(walkable ? "#4ade80" : "#ef4444");
  });

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[centerX, 0, centerZ]}
        onPointerMove={onMove}
        onClick={onClick}
      >
        <planeGeometry args={[worldWidth, worldDepth]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* Marcador de destino: quadrado pouco maior que o personagem (não do
          tamanho da célula, como era antes), SUBDIVIDIDO para poder acompanhar
          o contorno do terreno — em rampa e morro um quad único atravessava a
          malha e sumia pela metade. Sem `rotation`: os vértices já são escritos
          em coordenada de mundo no useFrame. */}
      <mesh ref={cursor} visible={false}>
        <planeGeometry args={[markerRadius * 2, markerRadius * 2, MARKER_SEGS, MARKER_SEGS]} />
        <meshBasicMaterial color="#4ade80" transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * Meia-largura do marcador de destino.
 *
 * No Ragnarok o cursor de destino cobre A CÉLULA — é ele que ensina o jogador
 * onde o passo vai cair. Por isso, em mapa de bloco, o marcador é o hexágono
 * inteiro; o tamanho do personagem só entra como piso, para o marcador não
 * sumir num mapa quadrado de célula minúscula.
 */
export function markerRadiusFor(charScale: number, charModelHeight: number, hexApothem = 0): number {
  if (hexApothem > 0) return hexApothem;
  return charScale * charModelHeight * MARKER_OF_CHAR;
}
