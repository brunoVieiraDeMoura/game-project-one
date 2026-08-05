import { Canvas } from "@react-three/fiber";
import { OrbitControls, Sky } from "@react-three/drei";
import { Physics, RigidBody } from "@react-three/rapier";
import { Suspense } from "react";
import { useMap } from "../map/useMap";
import { MapTerrain } from "../map/MapTerrain";

/**
 * Spectator/observer mode (soul.txt §6): câmera livre sobre o mundo, sem
 * login. Carrega um GameMap real da API (@ragnarok/map-format) e renderiza a
 * colisão via MapTerrain; enquanto carrega (ou se falhar) mostra o plano de
 * referência pra cena/física/câmera ficarem sempre verificáveis.
 */
const DEFAULT_MAP = new URLSearchParams(window.location.search).get("map") ?? "prontera";

function ReferencePlane() {
  return (
    <RigidBody type="fixed" colliders="cuboid">
      <mesh receiveShadow position={[0, -0.5, 0]}>
        <boxGeometry args={[100, 1, 100]} />
        <meshStandardMaterial color="#3f5e3f" />
      </mesh>
    </RigidBody>
  );
}

export function SpectatorView() {
  const { map, error } = useMap(DEFAULT_MAP);
  // câmera afastada o bastante pra enquadrar o maior lado do mapa
  const span = map ? Math.max(map.size.width, map.size.height) * map.cellSize : 100;

  return (
    <>
      <Canvas camera={{ position: [span * 0.6, span * 0.7, span * 0.6], fov: 50, far: span * 4 }} shadows>
        <Suspense fallback={null}>
          <Sky sunPosition={[100, 80, 20]} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[span, span, span / 2]} intensity={1.2} castShadow />
          <Physics>{map ? <MapTerrain map={map} fisica /> : <ReferencePlane />}</Physics>
          <OrbitControls makeDefault target={map ? [span / 2, 0, span / 2] : [0, 0, 0]} />
        </Suspense>
      </Canvas>
      <div style={{ position: "absolute", top: 8, left: 8, font: "12px monospace", color: "#ddd", textShadow: "0 1px 2px #000" }}>
        {error ? `mapa: erro (${error}) — plano de referência` : map ? `mapa: ${map.name} (${map.size.width}×${map.size.height})` : "carregando mapa..."}
      </div>
    </>
  );
}
