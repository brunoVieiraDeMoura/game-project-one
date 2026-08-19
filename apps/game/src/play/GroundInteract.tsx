import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { CellLattice, TerrainQuery } from "@ragnarok/engine-core";
import { usePlayStore } from "./playStore";
import { useCombatStore } from "../combat/combatStore";
import { registrarEvento } from "../core/diagnostics/flightRecorder";
import { isolado } from "../core/diagnostics/isolamento";
import {
  MARKER_SEGS,
  TERRAIN_GROUP,
  baseDoPropClicado,
  moldarMarcador,
  nearestHit,
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


/**
 * Quantos anéis de células ao redor de um alvo bloqueado se procura uma andável.
 *
 * 4 dava conta de uma árvore ou de uma pedra, mas não de uma montanha pintada no
 * editor: clicando no miolo dela nenhum anel achava chão, o snap devolvia a
 * própria célula bloqueada e o pedido ia para o servidor assim mesmo.
 *
 * Este continua sendo só o palpite GEOMÉTRICO — ele trabalha em coordenada de
 * mundo e não conhece a grade do servidor nem o A*. Quem tem a palavra final
 * sobre ALCANÇABILIDADE é `net/moveTarget.destinoAlcancavel`, chamado no
 * `NetPlayer` com a célula já convertida: célula andável não quer dizer célula
 * que dá para alcançar (uma ilha cercada de parede é andável e inútil).
 */
const SNAP_RINGS = 10;

/** meia-largura do marcador em função do personagem (charScale × altura do modelo) */
const MARKER_OF_CHAR = 0.75;

/**
 * As quatro frames do marcador de destino, em `ui_definitiva/cursor`.
 *
 * Medido nos PNG: são o MESMO desenho (276 pixels opacos, as mesmas três cores)
 * recuado 0, 1, 2 e 1 px. É uma pulsação — a moldura respira. Por isso a ordem
 * é a do arquivo e o ciclo fecha sozinho, sem precisar de ida e volta.
 */
const MARCADOR_FRAMES = [1, 2, 3, 4].map((n) => `/assets/ui/cursor/UI_Flat_Select02a_${n}.png`);
/** quantas frames por segundo — a pulsação é lenta de propósito, não pisca */
const MARCADOR_FPS = 12;

/**
 * Quanto tempo a pulsação dura DEPOIS do clique.
 *
 * Ela é o retorno de "recebi o clique", não um enfeite permanente: pulsando o
 * tempo todo enquanto o mouse passeia, o marcador vira ruído no canto do olho e
 * deixa de significar coisa nenhuma. Duas voltas completas do ciclo bastam para
 * o olho perceber e pararem.
 */
const MARCADOR_CLIQUE_MS = (MARCADOR_FRAMES.length * 2 * 1000) / MARCADOR_FPS;

/**
 * As frames do marcador, carregadas uma vez.
 *
 * Quem troca a frame é o `useFrame` do componente, mutando `material.map` por
 * REFERÊNCIA: passar a frame por `setState` repintaria a árvore do React oito
 * vezes por segundo para animar um quadradinho no chão — o mesmo erro que o
 * cronômetro da barra de skills já evita.
 */
function useMarcadorFrames(): THREE.Texture[] {
  const texturas = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return MARCADOR_FRAMES.map((url) => {
      const t = loader.load(url);
      // pixel art: nada de interpolar. É COR (o material multiplica por ela),
      // então sRGB — e sem mipmap, que borraria a moldura de longe.
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
  }, []);
  useEffect(() => () => texturas.forEach((t) => t.dispose()), [texturas]);
  return texturas;
}

export function GroundInteract({
  worldWidth,
  worldDepth,
  centerX,
  centerZ,
  cellSize,
  terrain,
  lattice,
  markerRadius,
  hoverRef,
  assistir,
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
  /**
   * Onde o mouse aponta no chão, publicado para quem mais precisar.
   *
   * A prévia da skill de área desenha o disco NESTE ponto, e ela não pode
   * recalcular o raio por conta própria: dois raycasts por quadro para o mesmo
   * ponto, e com a chance de divergirem por um quadro. Quem já faz a conta
   * empresta o resultado.
   */
  hoverRef?: React.MutableRefObject<{ x: number; z: number } | null>;
  /**
   * Assistência de mira: dá ao clique a chance de virar ataque ou coleta.
   *
   * Devolve `true` quando resolveu — aí não há caminhada a pedir. Fica FORA
   * daqui (é o `PlayView` que a monta) porque depende do mundo do servidor e da
   * conversão de célula, coisas que este componente não conhece: ele só sabe
   * apontar o chão. É também o que mantém o preview do editor funcionando sem
   * entidade nenhuma.
   *
   * Sem parâmetro de propósito: quem ESCOLHE o alvo é o `AssistenciaDeMira`, por
   * quadro, em PIXEL de tela — o ponto do chão que este componente calculou não
   * entra na conta.
   */
  assistir?: () => boolean;
}) {
  const setMoveTarget = usePlayStore((s) => s.setMoveTarget);
  const setCombatTarget = useCombatStore((s) => s.setTarget);
  const cursor = useRef<THREE.Mesh>(null);
  const hoverLocal = useRef<{ x: number; z: number } | null>(null);
  const hover = hoverRef ?? hoverLocal;
  /**
   * Em que célula o marcador foi MOLDADO pela última vez.
   *
   * Vestir o relevo custa reescrever os 49 vértices da malha e recalcular a
   * esfera envolvente (`moldarMarcador`), e isso rodava por QUADRO — enquanto o
   * mouse está parado, ou andando dentro da mesma célula, o resultado é
   * idêntico ao do quadro anterior. O marcador só se mexe quando muda de célula,
   * então é aí que ele precisa ser remoldado.
   */
  const marcadorEm = useRef<string | null>(null);
  // trocar de mapa (ou editar o relevo, no preview) invalida a forma guardada
  useEffect(() => {
    marcadorEm.current = null;
  }, [terrain]);
  /** instante do último clique no chão — é ele que dispara a pulsação */
  const cliqueEm = useRef(Number.NEGATIVE_INFINITY);
  const marcadorFrames = useMarcadorFrames();

  const scene = useThree((s) => s.scene);
  // raycaster próprio: o do R3F é reconfigurado a cada evento
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const plano = useRef<THREE.Mesh>(null);

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
  /**
   * Os dois grupos, achados UMA vez.
   *
   * `getObjectByName` percorre o grafo inteiro, e isto rodava duas vezes por
   * evento de mouse. Os grupos são criados pelo `PlayView` e não trocam de
   * identidade enquanto a cena existe, então o resultado é guardado — com uma
   * releitura enquanto ainda não existirem (a cena monta em ordem).
   */
  const grupos = useRef<{ props?: THREE.Object3D; terreno?: THREE.Object3D }>({});
  const acharGrupos = () => {
    const g = grupos.current;
    if (!g.props) g.props = scene.getObjectByName(PROPS_GROUP);
    if (!g.terreno) g.terreno = scene.getObjectByName(TERRAIN_GROUP);
    return g;
  };

  const pontoDoRaio = (e: {
    ray: { origin: THREE.Vector3; direction: THREE.Vector3 };
    distance: number;
    point: { x: number; z: number };
  }) => {
    raycaster.set(e.ray.origin, e.ray.direction);
    raycaster.far = e.distance;
    const { props, terreno } = acharGrupos();

    const hitsProp = props ? raycaster.intersectObject(props, true).filter((h) => h.distance < e.distance) : [];
    const hitsChao = terreno ? raycaster.intersectObject(terreno, true).filter((h) => h.distance < e.distance) : [];
    const maisProximoProp = nearestHit(hitsProp);
    const maisProximoChao = nearestHit(hitsChao);
    // o chão de verdade por trás do prop — ou o plano y=0, se não achou terreno
    const alvoChao = maisProximoChao
      ? { x: maisProximoChao.point.x, z: maisProximoChao.point.z }
      : { x: e.point.x, z: e.point.z };

    /**
     * Prop na frente de tudo: o alvo é o PÉ dele, não o ponto de impacto — mas
     * só quando o clique de fato MIRA a árvore, não quando ela só estava no
     * caminho de um alvo mais longe.
     *
     * Mirar a copa de uma árvore escalada 5× acertava a folhagem a metros do
     * tronco, e o marcador saltava para uma célula que não tem relação com onde
     * se quer ir — "o square buga o direcionamento". A base do prop (a origem do
     * objeto, que é onde ele encosta no chão) é o alvo que faz sentido ALI.
     *
     * Só que dentro de floresta a copa de uma árvore qualquer cobre o raio
     * inteiro até um alvo bem mais longe (célula atrás dela, onde o jogador
     * queria ir de verdade) — sem este segundo teste, TODO clique que passasse
     * perto de uma copa virava "andar até esta árvore", mesmo mirando bem
     * depois dela ("queria ir pra trás da copa"). A regra: a base só vale se o
     * chão de verdade (mais longe, na mesma direção) está PERTO dela — senão o
     * prop só estava na frente por acaso e o clique vale para o chão.
     */
    if (maisProximoProp && (!maisProximoChao || maisProximoProp.distance <= maisProximoChao.distance)) {
      const pe = baseDoPropClicado(maisProximoProp, props);
      if (pe) {
        const dx = alvoChao.x - pe.x;
        const dz = alvoChao.z - pe.z;
        // 3 células cobre folgado a copa de qualquer árvore do catálogo
        const raioAceito = cellSize * 3;
        if (dx * dx + dz * dz <= raioAceito * raioAceito) return pe;
      }
    }
    return alvoChao;
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // clique no chão vazio deseleciona o alvo de combate (clicar num monstro é
    // capturado pelo próprio monstro antes de chegar aqui)
    setCombatTarget(null);
    // clique só move no modo clique-tile; em WASD livre é clique morto
    const p = pontoDoRaio(e);
    cliqueEm.current = performance.now();

    /**
     * Soft lock: o clique que passou RASPANDO num alvo vale como clique nele.
     *
     * Chegar aqui já quer dizer que o raio não acertou monstro nem item — a
     * hitbox deles teria capturado o evento. Só que ela é uma caixa no espaço
     * 3D, e com a câmera afastada, o bicho atrás de um prop ou andando entre o
     * apertar e o soltar do botão, o raio passa de lado; aí o clique vira
     * "andar até ali" e o personagem sai correndo em vez de bater.
     *
     * Skill de ÁREA fica de fora de propósito (`assistir` devolve `null`): ali
     * o alvo é a célula, e puxar o ponto mudaria onde a magia cai.
     */
    const assistido = assistir?.();
    if (assistido) return;

    setMoveTarget(snapAndavel(p.x, p.z));
  };

  useFrame((state) => {
    /**
     * O raio é refeito TODO quadro, a partir da câmera ATUAL — nunca guardado
     * de um evento de `pointermove` passado.
     *
     * A câmera segue o personagem (`FollowCamera`): andando, o mundo desliza
     * por BAIXO de um mouse parado na tela. Resolver o raio só quando o mouse
     * se MEXE (o que fazia antes) reusava a interseção ANTIGA — em coordenada
     * de MUNDO — quadro após quadro, e o marcador ficava colado na célula do
     * primeiro clique em vez de acompanhar o chão que está de fato sob o
     * ponteiro. `state.pointer` é a coordenada de tela (NDC) que o R3F já
     * mantém sozinho; refazer `setFromCamera` com ela é o que faz o marcador
     * "andar" com a câmera sem o jogador precisar chacoalhar o mouse.
     *
     * Continua sendo NO MÁXIMO uma resolução por quadro — a mesma característica
     * de custo que a versão anterior já tinha (dois `intersectObject`
     * recursivos), só que sem o atalho extra que gerava esta trava.
     */
    const chao = plano.current;
    if (chao) {
      /**
       * `far` tem de voltar a INFINITO antes deste teste.
       *
       * `pontoDoRaio` (chamado logo abaixo, e também pelo `onClick`) estreita
       * `raycaster.far` até a distância do que encontrou, para os sub-testes
       * contra prop/terreno — e nunca desfaz isso. `setFromCamera` só escreve
       * origem/direção do raio, não `near`/`far`; sem resetar aqui, o teste
       * contra o PLANO (que precisa alcançar o mapa inteiro) herdava o `far`
       * estreito do quadro anterior. Mover o mouse para um ponto mais LONGE
       * que aquele passava a FALHAR — o raio "acabava" antes de chegar lá —,
       * e como só acerto reescreve `far`, o erro EMPACAVA: o hover ficava
       * `null` até o ponteiro (ou a câmera, seguindo o personagem) voltar a
       * cair dentro do raio velho. Era o "mexo o mouse e o círculo da área
       * some" — parado funcionava porque o `far` não precisava crescer.
       */
      raycaster.far = Infinity;
      raycaster.setFromCamera(state.pointer, state.camera);
      const noPlano = raycaster.intersectObject(chao, false)[0];
      hover.current = noPlano
        ? pontoDoRaio({ ray: raycaster.ray, distance: noPlano.distance, point: noPlano.point })
        : null;
    }

    const c = cursor.current;
    if (!c) return;
    // isolamento (Fase C, `?iso=semCursor`): só o MARCADOR visual some — o
    // raycast de hover continua (alimenta clique-pra-andar e a mira), então
    // isto não muda gameplay, só o desenho
    if (isolado("semCursor")) {
      c.visible = false;
      return;
    }
    const h = hover.current;
    if (!h) {
      c.visible = false;
      return;
    }
    const center = snap(h.x, h.z);
    c.visible = true;
    // O marcador fica na ORIGEM e desenha em coordenada de mundo: cada vértice é
    // amostrado no terreno, então ele veste o relevo em vez de flutuar.
    c.position.set(0, 0, 0);
    // remolda só ao MUDAR de célula (ver `marcadorEm`)
    const chave = `${center.x},${center.z},${markerRadius}`;
    if (marcadorEm.current !== chave) {
      const primeira = marcadorEm.current === null;
      marcadorEm.current = chave;
      moldarMarcador(c.geometry as THREE.BufferGeometry, center.x, center.z, markerRadius, terrain);
      // só quando a geometria É REMOLDADA de verdade (troca de célula), nunca
      // por quadro — é o que a Fase B pediu para provar/descartar o cursor
      registrarEvento("cena", primeira ? "cursor:create" : "cursor:geometry-update", {
        chave,
        raio: markerRadius,
      });
    }

    /**
     * A pulsação só roda DEPOIS DE UM CLIQUE, e por pouco tempo.
     *
     * Enquanto o mouse só passeia, o marcador fica na frame parada: a animação é
     * a confirmação de "recebi o clique", e piscando o tempo todo ela deixa de
     * dizer isso. Troca a textura por referência, sem passar pelo React.
     */
    const decorrido = performance.now() - cliqueEm.current;
    const animando = decorrido < MARCADOR_CLIQUE_MS;
    const i = animando ? Math.floor(decorrido / (1000 / MARCADOR_FPS)) % marcadorFrames.length : 0;
    const frame = marcadorFrames[i];
    const mat = c.material as THREE.MeshBasicMaterial;
    if (frame && mat.map !== frame) {
      mat.map = frame;
      // trocar a textura de um material já compilado NÃO exige recompilar o
      // shader (o `map` já está declarado); só o uniform muda
      mat.needsUpdate = false;
    }
  });

  return (
    <group>
      <mesh ref={plano} rotation={[-Math.PI / 2, 0, 0]} position={[centerX, 0, centerZ]} onClick={onClick}>
        <planeGeometry args={[worldWidth, worldDepth]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* Marcador de destino: a moldura pintada de `ui_definitiva/cursor`
          (UI_Flat_Select02a), SUBDIVIDIDA para acompanhar o contorno do terreno
          — em rampa e morro um quad único atravessava a malha e sumia pela
          metade. Sem `rotation`: os vértices já são escritos em coordenada de
          mundo no useFrame. */}
      <mesh ref={cursor} visible={false}>
        <planeGeometry args={[markerRadius * 2, markerRadius * 2, MARKER_SEGS, MARKER_SEGS]} />
        <meshBasicMaterial
          map={marcadorFrames[0]}
          color="#ffffff"
          transparent
          opacity={0.95}
          depthWrite={false}
          side={THREE.DoubleSide}
          // a arte tem alpha duro; sem o corte o navegador desenha a borda
          // semitransparente por cima do chão e sobra um halo quadrado
          alphaTest={0.35}
          // mesma briga em z do `play/AimPreview`: a malha veste
          // `terrain.getHeight`, que não bate byte a byte com a altura que o
          // chão de verdade desenha, e sem folga o marcador pisca/some quadro
          // sim, quadro não — era o "square de indicação desaparece de vez em
          // quando".
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
        />
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
