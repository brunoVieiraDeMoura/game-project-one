import { Suspense, useEffect, useMemo, useRef } from "react";
import { OrbitControls, Line, Html } from "@react-three/drei";
import { GradientSky } from "../scene/GradientSky";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { cellIndex, type MapSpawn } from "@ragnarok/map-format";
import { HexTerrain } from "../hex/HexTerrain";
import { RetroFilter } from "../scene/RetroFilter";
import { hexToWorld, worldToHex, levelToY, setHexScale, HEX_W, HEX_V } from "../hex/hexGrid";
import { gridFor } from "../grid";
import { SquareTerrain } from "../grid/SquareTerrain";
import { EscopoOverlay } from "./EscopoOverlay";
import { useEditorViewCenter } from "./useEditorViewCenter";
import { useEditorStore, nextPropId, layerOfProp, triggerColor } from "./editorStore";
import type { MapTrigger } from "@ragnarok/map-format";
import { EditorProp } from "./EditorProp";
import { propDefaultScale, colliderForAsset, tileSurfaceFor } from "../props/registry";
import { useGameplayConfig } from "../play/useGameplayConfig";
import { TERRAIN_GROUP, nearestHit, topmostXZ } from "../play/pickGround";

/** de quanto em quanto o culling do editor recalcula (unidades de mundo) */
const EDITOR_VIEW_STEP = 24;

/**
 * Cena do editor: céu + luzes + terreno + props editáveis. Clicar num tile
 * aplica o pincel (grama/água/subir/descer) OU coloca a decoração atual (snap
 * no centro da célula + altura do nível). OrbitControls (makeDefault) orbita; o
 * gizmo dos props desabilita a órbita.
 *
 * Serve às DUAS grades: hexágonos dos mapas autorados e quadrados dos mapas
 * importados do rAthena (`gridFor`).
 */
export function EditorScene() {
  // tamanho do bloco hex (server_config.gameplay.hexScale) — síncrono no corpo
  // do render, ANTES de qualquer hexToWorld (inclusive cx/cz logo abaixo),
  // pro editor bater com o /play. Mesmo padrão do Scene do PlayView.
  const gameplay = useGameplayConfig();
  const map = useEditorStore((s) => s.map);
  // A grade DESTE mapa: hexágonos dos mapas autorados, quadrados dos mapas do
  // rAthena. Tudo que converte célula↔mundo aqui passa por ela.
  const grid = map ? gridFor(map) : null;
  const isHex = grid?.kind === "hex";
  // hexScale é do mundo hexagonal; a grade quadrada tem tamanho fixo (ver
  // grid/squareGrid.ts) e um hexScale alto jogaria o mapa do rAthena para fora
  // do alcance da câmera.
  if (isHex) setHexScale(gameplay.hexScale);
  const cellToWorld = grid?.cellToWorld ?? hexToWorld;
  const worldToCell = grid?.worldToCell ?? worldToHex;
  const cellW = grid?.cellWidth() ?? HEX_W();
  const cellD = grid?.cellDepth() ?? HEX_V();
  const levelY = grid?.levelToY ?? levelToY;
  const tool = useEditorStore((s) => s.tool);
  const currentAsset = useEditorStore((s) => s.currentAsset);
  const paintCell = useEditorStore((s) => s.paintCell);
  const beginStroke = useEditorStore((s) => s.beginStroke);
  const brush = useEditorStore((s) => s.brush);
  const beginRamp = useEditorStore((s) => s.beginRamp);
  const endRamp = useEditorStore((s) => s.endRamp);
  const addProp = useEditorStore((s) => s.addProp);
  const placeTileAsset = useEditorStore((s) => s.placeTileAsset);
  const paintProps = useEditorStore((s) => s.paintProps);
  const propPaint = useEditorStore((s) => s.propPaint);
  const addSpawn = useEditorStore((s) => s.addSpawn);
  const placePrefab = useEditorStore((s) => s.placePrefab);
  const beginArea = useEditorStore((s) => s.beginArea);
  const dragArea = useEditorStore((s) => s.dragArea);
  const commitArea = useEditorStore((s) => s.commitArea);
  const addWaypoint = useEditorStore((s) => s.addWaypoint);
  const select = useEditorStore((s) => s.select);
  const setHover = useEditorStore((s) => s.setHover);
  const camMove = useEditorStore((s) => s.camMove);
  const dragging = useEditorStore((s) => s.dragging);
  const dragTo = useEditorStore((s) => s.dragTo);
  const endDrag = useEditorStore((s) => s.endDrag);
  const focusTick = useEditorStore((s) => s.focusTick);
  const viewTick = useEditorStore((s) => s.viewTick);
  const snap = useEditorStore((s) => s.snap);
  const lighting = useEditorStore((s) => s.lighting);
  const measurePoint = useEditorStore((s) => s.measurePoint);
  const measure = useEditorStore((s) => s.measure);
  const hiddenLayers = useEditorStore((s) => s.hiddenLayers);
  /** o escopo da TopBar — sombreia o que ele deixa de fora (ver EscopoOverlay) */
  const escopoAtivo = useEditorStore((s) => s.editScope);
  const retroPreview = useEditorStore((s) => s.retroPreview);
  // visual do chão: o que está salvo no server_config, com o preview local do
  // painel Cena por cima (pra comparar atlas/cor/textura sem salvar)
  const groundPreview = useEditorStore((s) => s.groundPreview);
  const ground = useMemo(
    () => ({
      groundMode: gameplay.groundMode,
      groundColor: gameplay.groundColor,
      groundTextureScale: gameplay.groundTextureScale,
      groundTextureStrength: gameplay.groundTextureStrength,
      ...(groundPreview ?? {}),
    }),
    [gameplay.groundMode, gameplay.groundColor, gameplay.groundTextureScale, gameplay.groundTextureStrength, groundPreview],
  );
  const painting = useRef(false);
  const lastCell = useRef<string>("");
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);
  // centro/raio do que o terreno quadrado desenha (mapas do rAthena). Mais
  // generoso que no /play: aqui a câmera se afasta para ver o desenho do mapa,
  // e o raio acompanha o zoom.
  const view = useEditorViewCenter(EDITOR_VIEW_STEP);

  const cx = map ? (cellW * map.size.width) / 2 : 0;
  const cz = map ? (cellD * map.size.height) / 2 : 0;

  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // mesmo aux de DEV do /play: `__three().scene` para inspecionar/medir no console
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __three?: () => unknown }).__three = () => ({ scene, camera });
  }, [scene, camera]);
  useEffect(() => {
    if (!map) return;
    const span = Math.max(cellW * map.size.width, cellD * map.size.height);
    camera.position.set(cx, span * 0.6, cz + span * 0.55);
    camera.lookAt(cx, 0, cz);
    camera.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.id]);

  // Direção "pra frente" da câmera (XZ, normalizada) — pras setinhas do teclado
  // moverem o selecionado relativo ao que a câmera está vendo, não a um eixo
  // fixo do mundo. Atualiza a cada mudança do OrbitControls (arrastar/zoom).
  const setCamForward = useEditorStore((s) => s.setCamForward);
  useEffect(() => {
    const ctl = controlsRef.current;
    if (!ctl) return;
    const update = () => {
      const dx = ctl.target.x - camera.position.x;
      const dz = ctl.target.z - camera.position.z;
      const len = Math.hypot(dx, dz) || 1;
      setCamForward({ x: dx / len, z: dz / len });
    };
    update();
    ctl.addEventListener("change", update);
    return () => ctl.removeEventListener("change", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, setCamForward]);

  // Focar (F): enquadra a câmera no objeto/spawn selecionado
  useEffect(() => {
    if (focusTick === 0) return;
    const s = useEditorStore.getState();
    const m = s.map;
    if (!m) return;
    let pos: [number, number, number] | null = null;
    if (s.selected != null && m.props[s.selected]) pos = m.props[s.selected]!.position;
    else if (s.selectedSpawn != null && m.spawns[s.selectedSpawn]) pos = m.spawns[s.selectedSpawn]!.position;
    const ctl = controlsRef.current;
    if (!pos || !ctl) return;
    const [x, y, z] = pos;
    ctl.target.set(x, y, z);
    camera.position.set(x + 12, y + 14, z + 16);
    ctl.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  // Visões de câmera (Topo/Frente/Lado/Resetar) — enquadram o mapa inteiro
  useEffect(() => {
    if (viewTick === 0 || !map) return;
    const ctl = controlsRef.current;
    if (!ctl) return;
    const span = Math.max(cellW * map.size.width, cellD * map.size.height);
    const kind = useEditorStore.getState().viewKind;
    ctl.target.set(cx, 0, cz);
    if (kind === "top") camera.position.set(cx, span * 1.25, cz + 0.01);
    else if (kind === "front") camera.position.set(cx, span * 0.35, cz + span * 0.95);
    else if (kind === "side") camera.position.set(cx + span * 0.95, span * 0.35, cz);
    else camera.position.set(cx, span * 0.6, cz + span * 0.55); // reset
    ctl.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTick]);

  // Arrastar objeto/spawn: raycast manual da câmera. Mira o TERRENO primeiro (a
  // malha tem altura) e só cai no plano y=0 quando o raio não acerta chão nenhum
  // — projetar sempre no plano fazia o objeto arrastado deslizar para a célula do
  // chão embaixo do bloco, em vez de acompanhar o topo sob o cursor.
  useEffect(() => {
    if (!dragging || !map) return;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const pt = new THREE.Vector3();
    const onWinMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const chao = scene.getObjectByName(TERRAIN_GROUP);
      const hit = chao ? nearestHit(raycaster.intersectObject(chao, true)) : null;
      if (hit) {
        const { col, row } = worldToCell(hit.point.x, hit.point.z);
        dragTo(col, row);
      } else if (raycaster.ray.intersectPlane(plane, pt)) {
        const { col, row } = worldToCell(pt.x, pt.z);
        dragTo(col, row);
      }
    };
    const onWinUp = () => endDrag();
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    return () => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
    };
  }, [dragging, map, camera, gl, dragTo, endDrag]);

  if (!map) return null;

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    // espaço pressionado (mover câmera) OU botão não-esquerdo → não usa ferramenta
    if (camMove || e.button !== 0) return;
    const p = topmostXZ(e.intersections, e.point);
    const { col, row } = worldToCell(p.x, p.z);
    if (col < 0 || col >= map.size.width || row < 0 || row >= map.size.height) return;
    if (tool === "brush") {
      e.stopPropagation();
      beginStroke(); // 1 snapshot p/ todo o traçado (undo volta tudo de uma vez)
      painting.current = true;
      lastCell.current = `${col},${row}`;
      // rampa e grab precisam saber DE ONDE o gesto saiu: na rampa é a ponta de
      // baixo, no grab é o centro da região que vai ser puxada
      if (brush === "ramp" || brush === "grab" || brush === "ledge") beginRamp(col, row);
      paintCell(col, row);
    } else if (tool === "place" && currentAsset) {
      e.stopPropagation();
      if (tileSurfaceFor(currentAsset)) {
        // peça de CHÃO (estrada/rio/costa/rampa): substitui a superfície da
        // célula em vez de virar objeto em cima da grama. Arrastar continua
        // pintando (o onMove chama de novo por célula).
        beginStroke();
        painting.current = true;
        lastCell.current = `${col},${row}`;
        placeTileAsset(col, row, currentAsset);
      } else if (propPaint) {
        // modo pincel de vegetação: espalha ao arrastar (1 snapshot no início)
        beginStroke();
        painting.current = true;
        lastCell.current = `${col},${row}`;
        paintProps(col, row);
      } else {
        // clique único: snap = centro do hex; sem snap = ponto exato clicado
        const c = snap ? cellToWorld(col, row) : { x: p.x, z: p.z };
        const y = levelY(map.heightmap[cellIndex(map, col, row)] ?? 0);
        const sc = propDefaultScale(currentAsset);
        addProp({
          id: nextPropId(),
          assetId: currentAsset,
          position: [c.x, y, c.z],
          rotation: [0, Math.random() * Math.PI * 2, 0],
          scale: [sc, sc, sc],
          colliderType: colliderForAsset(currentAsset),
        });
      }
    } else if (tool === "spawn") {
      e.stopPropagation();
      addSpawn(col, row);
    } else if (tool === "prefab") {
      e.stopPropagation();
      placePrefab(col, row); // carimba o prefab armado no hex
    } else if (tool === "area") {
      e.stopPropagation();
      beginArea(col, row); // arrasta pra desenhar o retângulo do gatilho
      painting.current = true;
      lastCell.current = `${col},${row}`;
    } else if (tool === "path") {
      e.stopPropagation();
      addWaypoint(col, row); // adiciona waypoint à rota do NPC selecionado
    } else if (tool === "measure") {
      e.stopPropagation();
      measurePoint([e.point.x, e.point.y, e.point.z]);
    } else {
      select(null);
    }
  };

  // readout de coords/altura + pintura contínua ao arrastar (pincel)
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    // Interseção MAIS PRÓXIMA, não `e.point`: o handler está no grupo e roda uma
    // vez por objeto atingido: terreno primeiro, plano-base de y≈0 depois. Usando
    // `e.point`, a última chamada (o plano) vencia e o cursor apontava a célula
    // do CHÃO embaixo do bloco, não a do topo em que o mouse estava.
    const p = topmostXZ(e.intersections, e.point);
    const { col, row } = worldToCell(p.x, p.z);
    if (col < 0 || col >= map.size.width || row < 0 || row >= map.size.height) {
      setHover(null);
      return;
    }
    const level = map.heightmap[cellIndex(map, col, row)] ?? 0;
    setHover({ col, row, level });
    if (painting.current && !camMove) {
      const key = `${col},${row}`;
      if (tool === "area") dragArea(col, row); // retângulo segue o cursor
      // rampa e grab recalculam a região inteira a cada movimento (a base é o
      // heightmap de antes do gesto, então não acumula) — inclusive quando o
      // cursor volta pela mesma trilha, o que faz o gesto ser reversível
      else if (tool === "brush" && (brush === "ramp" || brush === "grab")) paintCell(col, row);
      else if (key !== lastCell.current) {
        lastCell.current = key;
        if (tool === "brush") paintCell(col, row);
        else if (tool === "place" && currentAsset && tileSurfaceFor(currentAsset)) placeTileAsset(col, row, currentAsset);
        else if (tool === "place" && propPaint && currentAsset) paintProps(col, row);
      }
    }
  };
  const onUp = () => {
    if (painting.current && tool === "area") commitArea(); // grava o gatilho desenhado
    painting.current = false;
    lastCell.current = "";
    endRamp(); // solta a âncora da rampa (o próximo gesto começa de outro lugar)
  };

  // posição do sol a partir de azimute/elevação (iluminação editável)
  const az = (lighting.sunAzimuth * Math.PI) / 180;
  const el = (lighting.sunElevation * Math.PI) / 180;
  const R = 140;
  const sun: [number, number, number] = [Math.cos(el) * Math.sin(az) * R, Math.sin(el) * R, Math.cos(el) * Math.cos(az) * R];
  /**
   * Props DENTRO do alcance de visão — o mesmo centro e raio que o terreno usa.
   *
   * O terreno era cullado e os props não: `map.props.map(...)` desenhava TODOS,
   * e cada um é uma cópia da cena do glTF (sem instanciar). Num mapa com
   * vegetação gerada isso é o custo dominante do editor — desenho, sombra e
   * reconciliação de React de milhares de nós que nem estão na tela.
   *
   * O raio acompanha o zoom (`useEditorViewCenter`), então afastar para ver o
   * mapa inteiro traz todos de volta: aí eles estão em cena porque estão sendo
   * OLHADOS. A folga de um chunk existe para o prop não sumir exatamente na
   * borda do chão desenhado.
   */
  const propsVisiveis = useMemo(() => {
    if (!map) return [];
    const r = view.radius + cellW * 32;
    const r2 = r * r;
    const out: { prop: (typeof map.props)[number]; index: number }[] = [];
    map.props.forEach((p, index) => {
      const layer = layerOfProp(p.assetId, p.tags?.[0] === "_gen" ? p.tags[1] : undefined);
      if (hiddenLayers.includes(layer)) return;
      const dx = p.position[0] - view.center.x;
      const dz = p.position[2] - view.center.z;
      if (dx * dx + dz * dz > r2) return;
      out.push({ prop: p, index });
    });
    return out;
  }, [map, hiddenLayers, view.center.x, view.center.z, view.radius, cellW]);

  const terrainHidden = hiddenLayers.includes("terrain");
  const spawnsHidden = hiddenLayers.includes("spawns");

  return (
    <>
      {/* fundo gradiente escuro (estúdio) — combina com a UI dark e destaca o mapa */}
      <GradientSky top="#141a26" bottom="#3a465b" />
      <ambientLight intensity={lighting.ambient} />
      {/*
        SEM `castShadow` — e isso não tira sombra nenhuma da tela.
        A luz tinha `castShadow` com `shadow-mapSize` de 2048², mas sem
        `shadow-camera` própria: o frustum padrão do three é ortográfico de ±5
        unidades em volta da ORIGEM. Num mapa de 800 unidades de lado, isso é uma
        mancha de 10 unidades no canto — ou seja, o mapa de sombra era desenhado
        inteiro a cada quadro para iluminar praticamente nada.
        Sombra de verdade aqui exigiria uma câmera de sombra acompanhando o
        centro de visão (é o que o `SunRig` do /play faz com o jogador); enquanto
        isso não existir, o certo é não pagar o passo.
      */}
      <directionalLight position={sun} intensity={lighting.sunIntensity} />

      <group onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        {/* Mapa autorado: peças hexagonais, mapa inteiro (são 32×32).
            Mapa do rAthena: malha por chunk, com culling ao redor do que a
            câmera enquadra — 400×400 = 160.000 células não cabem num frame. */}
        {/* nome é contrato com o arrasto: é nele que o raycast mira o TOPO */}
        <group name={TERRAIN_GROUP}>
          {!terrainHidden &&
            (isHex ? (
              <HexTerrain map={map} ground={ground} />
            ) : (
              <SquareTerrain map={map} center={view.center} radius={view.radius} ground={gameplay} />
            ))}
        </group>
        {/* o que o escopo deixa de fora fica sombreado — sem isso a regra é
            invisível e o pincel "não funcionando" parece bug (ver EscopoOverlay) */}
        {!terrainHidden && <EscopoOverlay map={map} escopo={escopoAtivo} />}
        {/* plano-base invisível pra capturar cliques em áreas sem tile alto */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]}>
          <planeGeometry args={[cellW * map.size.width + cellW, cellD * map.size.height + cellD]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>

      {/* props (respeitando camadas ocultas). Cada um com Suspense próprio. */}
      {propsVisiveis.map(({ prop: p, index: i }) => (
        <Suspense key={p.id} fallback={null}>
          <EditorProp prop={p} index={i} />
        </Suspense>
      ))}

      {/* marcadores de spawn (player verde, monstro vermelho, npc azul) */}
      {!spawnsHidden &&
        map.spawns.map((sp, i) => <SpawnMarker key={sp.id} spawn={sp} index={i} />)}

      {/* rotas de patrulha dos NPCs (polyline + waypoints) */}
      <NpcPaths />

      {/* gatilhos de área (boxes translúcidos coloridos por tipo) + rascunho */}
      <TriggerBoxes cellToWorld={cellToWorld} cellW={cellW} cellD={cellD} levelY={levelY} />

      {/* medição: pontos + linha + distância */}
      <MeasureViz measure={measure} />

      {/* prévia do filtro retrô — só quando ligada no painel Cena */}
      {retroPreview && (
        <RetroFilter
          retroMode={gameplay.retroMode === "off" ? "16bit" : gameplay.retroMode}
          retroPixelSize={gameplay.retroPixelSize}
          retroDither={gameplay.retroDither}
        />
      )}

      {/* botão esquerdo = ferramentas (não orbita); botão direito = girar a tela;
          com espaço pressionado, botão direito faz pan ("andar"). */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping={false}
        maxPolarAngle={Math.PI * 0.49}
        target={[cx, 0, cz]}
        enablePan
        mouseButtons={{
          LEFT: undefined as unknown as THREE.MOUSE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: camMove ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
        }}
      />
    </>
  );
}

/** marcador 3D de um spawn: cone colorido + anel de raio (mob) + seleção */
function SpawnMarker({ spawn, index }: { spawn: MapSpawn; index: number }) {
  const selectSpawn = useEditorStore((s) => s.selectSpawn);
  const startDrag = useEditorStore((s) => s.startDrag);
  const tool = useEditorStore((s) => s.tool);
  const camMove = useEditorStore((s) => s.camMove);
  const selected = useEditorStore((s) => s.selectedSpawn === index);
  const [x, y, z] = spawn.position;
  const color = spawn.kind === "player_start" ? "#22c55e" : spawn.kind === "npc" ? "#38bdf8" : spawn.kind === "road_node" ? "#d6b06a" : "#ef4444";
  const radius = spawn.radius ?? 0;
  return (
    <group
      position={[x, y, z]}
      onPointerDown={(e) => {
        if (tool !== "select" || camMove || e.button !== 0) return;
        e.stopPropagation();
        selectSpawn(index);
        startDrag("spawn", index); // arrastar spawn no chão
      }}
    >
      <mesh position={[0, 2.2, 0]}>
        <coneGeometry args={[0.9, 1.8, 6]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 1.2, 6]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* raio do spawn (mob) */}
      {radius > 0 && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius - 0.3, radius, 40]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}
      {selected && (
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.1, 1.5, 24]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.9} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

/** rotas de patrulha: pra cada NPC com path, desenha a linha começando na posição
 * do NPC e passando pelos waypoints (fecha o laço se mode="loop"), com esferas
 * numeradas. O NPC selecionado fica destacado (amarelo); os demais, apagados. */
function NpcPaths() {
  const map = useEditorStore((s) => s.map);
  const selectedSpawn = useEditorStore((s) => s.selectedSpawn);
  if (!map) return null;
  return (
    <>
      {map.spawns.map((sp, i) => {
        if (sp.kind !== "npc" || !sp.path || sp.path.points.length === 0) return null;
        const on = selectedSpawn === i;
        const col = on ? "#fbbf24" : "#38bdf8";
        const pts: [number, number, number][] = [sp.position, ...sp.path.points];
        if (sp.path.mode === "loop" && pts.length > 1) pts.push(sp.position);
        return (
          <group key={sp.id}>
            <Line points={pts} color={col} lineWidth={on ? 3 : 1.5} dashed dashSize={0.6} gapSize={0.4} transparent opacity={on ? 1 : 0.5} />
            {sp.path.points.map((wp, k) => (
              <group key={k} position={[wp[0], wp[1] + 0.4, wp[2]]}>
                <mesh>
                  <sphereGeometry args={[0.5, 12, 12]} />
                  <meshBasicMaterial color={col} transparent opacity={on ? 0.95 : 0.5} />
                </mesh>
                {on && (
                  <Html center style={{ pointerEvents: "none" }}>
                    <div style={{ background: "rgba(15,17,23,0.85)", color: "#fde68a", font: "600 10px system-ui", padding: "1px 4px", borderRadius: 4 }}>{k + 1}</div>
                  </Html>
                )}
              </group>
            ))}
          </group>
        );
      })}
    </>
  );
}

/**
 * Converte uma área de células (col,row,w,h) num box de mundo (centro +
 * tamanho + altura do terreno no centro).
 *
 * Recebe a grade do MAPA (`cellToWorld`/`cellW`/`cellD`/`levelY`) em vez de
 * importar `hexToWorld`/`HEX_W`/`HEX_V`/`levelToY` direto do mundo hexagonal:
 * era o único lugar do arquivo que fazia isso — `onDown`/`onMove`/
 * `propsVisiveis` já usam a grade certa (`gridFor(map)`, hex OU quadrada
 * conforme `terrainMode`). Num mapa importado do rAthena (`"square"`, o tipo
 * mais comum — servidor real), `HEX_W()`/`HEX_V()` dependem de `hexScale`,
 * bem diferente do `SQUARE_SIZE=2` fixo da grade quadrada (ver CLAUDE.md: "A
 * grade quadrada NÃO passa por hexScale") — a caixa do gatilho saía na
 * posição/escala erradas, mesmo com a célula gravada certa.
 *
 * Exportada só para teste (`EditorScene.areaToBox.test.ts`) — confere que a
 * caixa de fato usa a grade recebida, não uma fixa.
 */
export function areaToBox(
  map: NonNullable<ReturnType<typeof useEditorStore.getState>["map"]>,
  a: { col: number; row: number; w: number; h: number },
  cellToWorld: (col: number, row: number) => { x: number; z: number },
  cellW: number,
  cellD: number,
  levelY: (level: number) => number,
) {
  const c1 = a.col, r1 = a.row, c2 = a.col + a.w - 1, r2 = a.row + a.h - 1;
  const pts = [cellToWorld(c1, r1), cellToWorld(c2, r1), cellToWorld(c1, r2), cellToWorld(c2, r2)];
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const minX = Math.min(...xs) - cellW / 2, maxX = Math.max(...xs) + cellW / 2;
  const minZ = Math.min(...zs) - cellD / 2, maxZ = Math.max(...zs) + cellD / 2;
  const ccol = Math.round((c1 + c2) / 2), crow = Math.round((r1 + r2) / 2);
  const y = levelY(map.heightmap[cellIndex(map, ccol, crow)] ?? 0);
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, sx: maxX - minX, sz: maxZ - minZ, y };
}

/** gatilhos de área: um box translúcido por trigger (cor por tipo) + o rascunho
 * sendo desenhado. Clicar num box seleciona o trigger (edita no Inspector). */
function TriggerBoxes({
  cellToWorld,
  cellW,
  cellD,
  levelY,
}: {
  cellToWorld: (col: number, row: number) => { x: number; z: number };
  cellW: number;
  cellD: number;
  levelY: (level: number) => number;
}) {
  const map = useEditorStore((s) => s.map);
  const draft = useEditorStore((s) => s.areaDraft);
  const draftKind = useEditorStore((s) => s.triggerKind);
  const selected = useEditorStore((s) => s.selectedTrigger);
  const selectTrigger = useEditorStore((s) => s.selectTrigger);
  const camMove = useEditorStore((s) => s.camMove);
  const tool = useEditorStore((s) => s.tool);
  if (!map) return null;
  const H = 3; // altura visual do box
  return (
    <>
      {(map.triggers ?? []).map((t: MapTrigger, i) => {
        const b = areaToBox(map, t.area, cellToWorld, cellW, cellD, levelY);
        const col = triggerColor(t.kind);
        const on = selected === i;
        return (
          <group key={t.id} position={[b.cx, b.y + H / 2, b.cz]}>
            <mesh
              onPointerDown={(e) => {
                if (tool !== "select" && tool !== "area") return; // só interage fora de outras ferramentas
                if (camMove || e.button !== 0) return;
                e.stopPropagation();
                selectTrigger(i);
              }}
            >
              <boxGeometry args={[b.sx, H, b.sz]} />
              <meshBasicMaterial color={col} transparent opacity={on ? 0.35 : 0.18} depthWrite={false} />
            </mesh>
            {/* moldura */}
            <lineSegments>
              <edgesGeometry args={[new THREE.BoxGeometry(b.sx, H, b.sz)]} />
              <lineBasicMaterial color={col} transparent opacity={on ? 1 : 0.7} />
            </lineSegments>
          </group>
        );
      })}
      {/* rascunho ao vivo */}
      {draft && (() => {
        const b = areaToBox(map, draft, cellToWorld, cellW, cellD, levelY);
        const col = triggerColor(draftKind);
        return (
          <group position={[b.cx, b.y + H / 2, b.cz]}>
            <mesh>
              <boxGeometry args={[b.sx, H, b.sz]} />
              <meshBasicMaterial color={col} transparent opacity={0.3} depthWrite={false} />
            </mesh>
            <lineSegments>
              <edgesGeometry args={[new THREE.BoxGeometry(b.sx, H, b.sz)]} />
              <lineBasicMaterial color={col} />
            </lineSegments>
          </group>
        );
      })()}
    </>
  );
}

/** medição: esferas nos 2 pontos + linha + rótulo de distância */
function MeasureViz({ measure }: { measure: { a: [number, number, number] | null; b: [number, number, number] | null } }) {
  const { a, b } = measure;
  if (!a) return null;
  const dist = b ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) : 0;
  const mid: [number, number, number] = b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1, (a[2] + b[2]) / 2] : a;
  return (
    <group>
      <mesh position={a}>
        <sphereGeometry args={[0.4, 12, 12]} />
        <meshBasicMaterial color="#fbbf24" />
      </mesh>
      {b && (
        <>
          <mesh position={b}>
            <sphereGeometry args={[0.4, 12, 12]} />
            <meshBasicMaterial color="#fbbf24" />
          </mesh>
          <Line points={[a, b]} color="#fbbf24" lineWidth={2} />
          <Html position={mid} center style={{ pointerEvents: "none" }}>
            <div style={{ background: "rgba(15,17,23,0.9)", color: "#fde68a", font: "600 11px system-ui", padding: "2px 6px", borderRadius: 5, whiteSpace: "nowrap" }}>
              {dist.toFixed(1)} un
            </div>
          </Html>
        </>
      )}
    </group>
  );
}
