import { Suspense, useLayoutEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CHARACTER_URLS, useCharacter, type CharacterKey } from "../assets";
import { FRAME_COLORS } from "../ui/charFrame";

/**
 * Retrato do personagem no buraco do aro da placa (change.txt: "se tiver como
 * colocar o rosto do char no local do avatar").
 *
 * É o MESMO glb que anda no mundo, num canvas próprio de ~100 px enquadrado na
 * cabeça — nada de textura de rosto desenhada à mão, que sairia do ar assim que
 * o modelo por classe existir. O `idle` já toca sozinho (assets.ts), então o
 * busto respira.
 *
 * O enquadramento sai do OSSO `head` do Rig_Medium (os três chars do kit têm
 * ele em y=1.241) e não de uma fração da caixa do modelo. A caixa mente: ela é
 * a geometria em BIND POSE, e no Knight ela vai até y=2,543 — a crista do elmo
 * —, enquanto o pescoço está em 1,241. Mirar "14% abaixo do topo da caixa"
 * apontava para 2,19, ou seja, para o alto do capacete: era isso o retrato que
 * mostrava só o topo da cabeça.
 */
const FOV = 24; // lente de retrato: distorce menos o rosto que os 50° da cena
/** quanto de ombro entra abaixo do pescoço, em alturas-de-cabeça */
const OMBRO = 0.3;

function Bust({ url }: { url: string }) {
  const { scene } = useCharacter(url, 1);
  const camera = useThree((s) => s.camera);

  useLayoutEffect(() => {
    scene.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(scene);
    if (!Number.isFinite(box.max.y) || box.max.y <= box.min.y) return;

    // pescoço: origem do osso da cabeça. Sem o osso (glb de fora do kit),
    // aproxima por 2/3 da altura, que é onde ele cai nos três do kit.
    const osso = scene.getObjectByName("head");
    const pescoco = osso
      ? osso.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(0, box.min.y + (box.max.y - box.min.y) * 0.66, 0);

    const cabeca = box.max.y - pescoco.y; // topo da cabeça acima do pescoço
    const base = pescoco.y - cabeca * OMBRO;
    const alvoY = (base + box.max.y) / 2;
    const enquadra = (box.max.y - base) * 1.08; // folga nas bordas do medalhão
    const dist = enquadra / (2 * Math.tan((FOV * Math.PI) / 360));
    const az = Math.PI * 0.13; // 3/4 de leve, como a silhueta da referência

    camera.position.set(
      pescoco.x + Math.sin(az) * dist,
      alvoY,
      pescoco.z + Math.cos(az) * dist,
    );
    camera.lookAt(pescoco.x, alvoY, pescoco.z);
    camera.updateProjectionMatrix();
  }, [scene, camera]);

  return <primitive object={scene} />;
}

export function CharacterPortrait({ characterKey = "knight" }: { characterKey?: CharacterKey }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        overflow: "hidden",
        // fundo do medalhão: fica visível enquanto o glb carrega e por trás do
        // busto, para o buraco do aro nunca aparecer vazado
        background: `radial-gradient(circle at 50% 32%, #b7a68a 0%, #8d7a5f 58%, ${FRAME_COLORS.woodDark} 100%)`,
      }}
    >
      <Canvas
        camera={{ fov: FOV, near: 0.01, far: 100 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        style={{ position: "absolute", inset: 0 }}
      >
        <ambientLight intensity={1.5} />
        <directionalLight position={[2, 3, 4]} intensity={2.2} />
        <directionalLight position={[-3, 1, -2]} intensity={0.8} color="#9fb4d8" />
        <Suspense fallback={null}>
          <Bust url={CHARACTER_URLS[characterKey]} />
        </Suspense>
      </Canvas>
    </div>
  );
}
