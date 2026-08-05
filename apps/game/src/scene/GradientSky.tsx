import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { corDoCeuGLSL } from "./skyGradient.glsl";

/**
 * O céu da cena: uma cúpula centrada na câmera, colorida por ELEVAÇÃO.
 *
 * Era um degradê 2×256 num canvas usado como `scene.background`, e por isso
 * preso à TELA: girar a câmera não mudava nada (lia como papel de parede) e a
 * faixa clara ficava sempre na base do enquadramento, NUNCA em cima do
 * horizonte — daí o encontro seco entre o chão desbotado e o azul (marcação 1
 * de `Desktop/ref/background.jpg`).
 *
 * Aqui a cor sai do ângulo de elevação real (`scene/skyGradient.glsl`), a mesma
 * função que a névoa usa. Consequências:
 *
 * • a bruma clara fica EXATAMENTE onde o horizonte está, em qualquer
 *   inclinação, e o chão dissolve dentro dela;
 * • olhar para cima mostra o zênite — o céu deixa de ser chapado;
 * • geometria 100% enevoada continua idêntica ao fundo (a névoa chama a mesma
 *   função), então nenhuma silhueta reaparece.
 *
 * Custo: 1 draw call, o mesmo que o `scene.background` custava. A esfera é
 * pequena e acompanha a câmera; sem `depthTest` e desenhada primeiro
 * (`renderOrder` bem negativo), ela nunca cobre nem é coberta por nada — o raio
 * não importa, desde que a câmera esteja dentro dele.
 */
export function GradientSky({ top = "#5a8fc7", bottom = "#cfe0ee" }: { top?: string; bottom?: string }) {
  const scene = useThree((s) => s.scene);
  const malha = useRef<THREE.Mesh>(null);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
        // a névoa NÃO se aplica ao céu: ele já É a cor para onde ela desbota
        fog: false,
        vertexShader: `
varying vec3 vPosMundo;
void main() {
  vPosMundo = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
        fragmentShader: `
varying vec3 vPosMundo;
${corDoCeuGLSL(top, bottom)}
void main() {
  // seno da elevação da direção câmera → fragmento: a MESMA grandeza que o
  // shader da névoa calcula, e é isso que mantém os dois iguais
  gl_FragColor = vec4( corDoCeu( normalize( vPosMundo - cameraPosition ).y ), 1.0 );
}`,
      }),
    [top, bottom],
  );

  // o fundo antigo sai de cena: com os dois ligados, um pintaria sobre o outro
  useEffect(() => {
    const anterior = scene.background;
    scene.background = null;
    return () => {
      scene.background = anterior;
      material.dispose();
    };
  }, [scene, material]);

  // a cúpula anda com a câmera; parada na origem, andar para longe sairia dela
  useFrame(({ camera }) => {
    malha.current?.position.copy(camera.position);
  });

  return (
    <mesh ref={malha} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[10, 24, 16]} />
    </mesh>
  );
}
