import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { MapProp } from "@ragnarok/map-format";
import { propUrl } from "../props/registry";
import { useEditorStore } from "./editorStore";

/**
 * Prop do editor: modelo glTF clicável. Na ferramenta de seleção, clicar
 * seleciona e arrastar move no chão (translate). Girar/Escalar são feitos por
 * setinhas na toolbar (rotateSelected/scaleSelected), sem gizmo 3D. Selecionado
 * ganha um anel amarelo no chão.
 */
export function EditorProp({ prop, index }: { prop: MapProp; index: number }) {
  const url = propUrl(prop.assetId);
  // assetId desconhecido: nada a renderizar (não chama useGLTF com url vazia)
  if (!url) return null;
  return <EditorPropModel prop={prop} index={index} url={url} />;
}

function EditorPropModel({ prop, index, url }: { prop: MapProp; index: number; url: string }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return c;
  }, [gltf]);

  /**
   * UMA assinatura, e só do que MUDA O DESENHO.
   *
   * Eram oito `useEditorStore` por prop. Cada `set()` do store — e uma
   * pincelada faz dezenas por segundo — mandava o zustand avaliar oito
   * seletores em CADA prop do mapa; num mapa com uma floresta gerada isso é
   * dezenas de milhares de avaliações por pincelada, para desenhar o mesmo
   * quadro.
   *
   * `tool`, `camMove` e as ações não mudam nada na tela: são lidos com
   * `getState()` dentro do handler, no instante do clique, que é quando o valor
   * importa. Sobra o anel de seleção, que é o único efeito visual.
   */
  const selecao = useEditorStore((s) => (s.selected === index ? 2 : s.multi.includes(index) ? 1 : 0));
  const selected = selecao === 2;
  const inMulti = selecao === 1;

  const body = (
    <group
      position={prop.position}
      rotation={prop.rotation}
      scale={prop.scale}
      onPointerDown={(e) => {
        const st = useEditorStore.getState();
        if (st.tool !== "select" || st.camMove || e.button !== 0) return;
        e.stopPropagation();
        // Shift+clique = adiciona/remove da seleção múltipla (sem arrastar)
        if (e.nativeEvent.shiftKey) {
          st.toggleMulti(index);
        } else if (st.multi.includes(index) && st.multi.length > 1) {
          // já faz parte do lote: arrasta preservando a seleção (não chama
          // select, que zeraria multi). dragTo usa este índice como âncora.
          st.startDrag("prop", index);
        } else {
          st.select(index);
          st.startDrag("prop", index); // arrastar = mover no chão
        }
      }}
    >
      <primitive object={scene} />
    </group>
  );

  if (!selected && !inMulti) return body;

  return (
    <>
      {body}
      {/* anel de seleção no chão (amarelo = primário, azul = na seleção múltipla) */}
      <mesh position={[prop.position[0], prop.position[1] + 0.05, prop.position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.1, 1.4, 24]} />
        <meshBasicMaterial color={selected ? "#fbbf24" : "#60a5fa"} transparent opacity={0.9} depthTest={false} />
      </mesh>
    </>
  );
}
