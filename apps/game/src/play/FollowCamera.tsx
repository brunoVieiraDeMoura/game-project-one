import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePlayStore } from "./playStore";
import { CLICK_SLOP_PX, DOUBLE_CLICK_MS, NORTH_AZIMUTH, SNAP_EASE, shortestTurn } from "./cameraNorth";

/**
 * Câmera 3ª pessoa que segue o player. Dois controles de rotação:
 *
 * - Botão DIREITO arrasta → gira o AZIMUTE DE MOVIMENTO (`azimuthRef`,
 *   compartilhado): muda pra onde a câmera olha E a referência do WASD.
 * - Botão ESQUERDO arrasta (só no modo WASD livre) → "olhar" TEMPORÁRIO: gira
 *   só a visão, sem mexer no WASD; ao soltar, volta suave pra trás da direção
 *   de movimento (offset → 0).
 *
 * - DOIS cliques com o direito (sem arrastar) → volta a câmera para o NORTE,
 *   como o cliente oficial: é o jeito de se reorientar depois de girar a visão.
 *
 * Menu de contexto do navegador desabilitado no canvas. Scroll = zoom (agora
 * dá pra afastar bem mais). Posição do player lida de um ref (sem estado/frame).
 */

export function FollowCamera({
  targetRef,
  azimuthRef,
  distance = 13,
  maxZoom = 7,
  rotateSpeed = 0.006,
  targetHeight = 0,
}: {
  targetRef: React.MutableRefObject<THREE.Vector3>;
  azimuthRef: React.MutableRefObject<number>;
  /** raio base do follow (editor do game) */
  distance?: number;
  /** multiplicador máx do scroll (editor do game) */
  maxZoom?: number;
  /** sensibilidade de rotação (editor do game) */
  rotateSpeed?: number;
  /** altura do personagem: a câmera mira no CORPO, não no pé. Sem isso ele
   * fica colado na borda de baixo da tela quando a câmera afasta (mundo com
   * hexScale alto), que é a sensação de "descentralizada". */
  targetHeight?: number;
}) {
  const { camera, gl } = useThree();
  const dist = useRef(1);
  const pitch = useRef(0.52);
  const lookYaw = useRef(0); // olhar temporário (esquerdo); volta a 0 ao soltar
  const leftDragging = useRef(false);
  /** azimute de destino do "voltar ao norte"; null = ninguém pediu */
  const snapAz = useRef<number | null>(null);
  const desired = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const aim = useRef(new THREE.Vector3()); // alvo do frame (evita alocar por frame)
  // lidos dentro dos handlers de evento; refs pra não re-registrar os listeners
  const rot = useRef(rotateSpeed);
  rot.current = rotateSpeed;
  const maxZ = useRef(maxZoom);
  maxZ.current = maxZoom;

  useEffect(() => {
    const el = gl.domElement;
    let rightDrag = false;
    let lastX = 0;
    let lastY = 0;
    // duplo-clique com o direito: só conta se o botão não foi usado para GIRAR
    let arrastou = 0;
    let ultimoClique = 0;

    const onContext = (e: Event) => e.preventDefault();
    const onDown = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (e.button === 2) {
        rightDrag = true;
        arrastou = 0;
      }
      // esquerdo só olha no modo WASD livre
      else if (e.button === 0 && usePlayStore.getState().mode === "free") leftDragging.current = true;
    };
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (rightDrag) {
        arrastou += Math.abs(dx) + Math.abs(dy);
        azimuthRef.current -= dx * rot.current; // muda movimento + câmera
        pitch.current = THREE.MathUtils.clamp(pitch.current + dy * rot.current * 0.83, 0.15, 1.45);
      } else if (leftDragging.current) {
        lookYaw.current -= dx * rot.current; // só visão
        pitch.current = THREE.MathUtils.clamp(pitch.current + dy * rot.current * 0.83, 0.15, 1.45);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 2) {
        rightDrag = false;
        // Girar a visão é arrastar com o direito, então um duplo-clique só vale
        // se o ponteiro praticamente não andou — senão duas rotações rápidas
        // seguidas jogariam a câmera para o norte no meio do movimento.
        if (arrastou <= CLICK_SLOP_PX) {
          const agora = performance.now();
          if (agora - ultimoClique < DOUBLE_CLICK_MS) {
            snapAz.current = NORTH_AZIMUTH;
            ultimoClique = 0; // três cliques não viram dois duplos
          } else {
            ultimoClique = agora;
          }
        }
      }
      if (e.button === 0) leftDragging.current = false; // solta → lookYaw volta a 0
    };
    const onWheel = (e: WheelEvent) => {
      dist.current = THREE.MathUtils.clamp(dist.current + e.deltaY * 0.0015, 0.4, maxZ.current);
    };

    el.addEventListener("contextmenu", onContext);
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("contextmenu", onContext);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [gl, azimuthRef]);

  useFrame(() => {
    // Voltar ao norte gira o AZIMUTE, não a posição.
    //
    // Escrever `azimuthRef` de uma vez faria a `lerp` de posição interpolar em
    // LINHA RETA entre os dois pontos da órbita — a câmera atravessaria o
    // personagem e o terreno. Aproximando o ângulo, ela descreve o arco.
    if (snapAz.current != null) {
      const delta = shortestTurn(azimuthRef.current, snapAz.current);
      if (Math.abs(delta) < 0.01) {
        azimuthRef.current = snapAz.current;
        snapAz.current = null;
      } else {
        azimuthRef.current += delta * SNAP_EASE;
      }
    }
    // ao soltar o esquerdo, o olhar temporário volta suave pra 0 (atrás do movimento)
    if (!leftDragging.current) lookYaw.current = THREE.MathUtils.lerp(lookYaw.current, 0, 0.12);

    const az = azimuthRef.current + lookYaw.current; // visão = movimento + olhar
    const t = targetRef.current;
    const ty = t.y + targetHeight * 0.5; // meio do corpo
    const r = distance * dist.current;
    const cosP = Math.cos(pitch.current);
    desired.current.set(
      t.x + r * cosP * Math.sin(az),
      ty + r * Math.sin(pitch.current),
      t.z + r * cosP * Math.cos(az),
    );
    camera.position.lerp(desired.current, 0.15);
    aim.current.set(t.x, ty, t.z);
    look.current.lerp(aim.current, 0.25);
    camera.lookAt(look.current);
  });

  return null;
}
