import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";

/**
 * Onde o editor está olhando, em passos grossos.
 *
 * O terreno quadrado desenha só os pedaços perto do centro de visão (ver
 * grid/SquareTerrain) — no /play esse centro é o personagem, mas no editor é
 * para onde a câmera aponta. Como no `play/useViewCenter`, o valor só muda a
 * cada `step` unidades andadas: reconstruir a geometria dos chunks a cada frame
 * de órbita travaria o editor num mapa de 400×400.
 *
 * Sem isto, o editor desenhava o mapa INTEIRO — 160.000 células de uma vez.
 */
export function useEditorViewCenter(step: number): { center: { x: number; z: number }; radius: number } {
  const [estado, setEstado] = useState({ center: { x: 0, z: 0 }, radius: MIN_RADIUS });
  const atual = useRef(estado);

  useFrame(({ controls, camera }) => {
    // o alvo do OrbitControls é o ponto que a câmera enquadra; sem controls
    // (primeiros frames), cai na projeção da câmera no plano do chão
    const alvo = (controls as { target?: { x: number; z: number; y: number } } | null)?.target;
    const x = alvo?.x ?? camera.position.x;
    const z = alvo?.z ?? camera.position.z;
    // Quanto mais longe a câmera, mais chão precisa aparecer: afastar para ver
    // o mapa inteiro e encontrar só um retângulo de terreno ao redor do alvo é
    // pior que não cullar. O teto evita reconstruir os 169 chunks de um 400×400
    // sem necessidade.
    const distancia = Math.hypot(camera.position.x - x, camera.position.y - (alvo?.y ?? 0), camera.position.z - z);
    const radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, distancia * 0.9));

    const dx = x - atual.current.center.x;
    const dz = z - atual.current.center.z;
    const mudouCentro = dx * dx + dz * dz >= step * step;
    // o raio também é discreto: variar a cada frame de zoom refaria a geometria
    const mudouRaio = Math.abs(radius - atual.current.radius) >= step * 2;
    if (!mudouCentro && !mudouRaio) return;

    const novo = { center: { x, z }, radius };
    atual.current = novo;
    setEstado(novo);
  });

  return estado;
}

/** o mínimo desenhado ao redor do alvo, mesmo com a câmera colada */
const MIN_RADIUS = 160;
/** teto: além disto o mapa inteiro já cabe e cullar não economiza nada */
const MAX_RADIUS = 700;
