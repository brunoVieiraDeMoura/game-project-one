import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Céu com o skybox real (Kenney, `assets-new/sky` → `public/assets/sky`), no
 * lugar do degradê procedural (`GradientSky`).
 *
 * `skybox-day.png` é um PANORAMA EQUIRRETANGULAR (4096×2048, proporção 2:1 —
 * conferido abrindo o arquivo, não é layout de cubemap em cruz nem 6 faces
 * separadas). Isso torna a integração o caminho mais barato possível: vira
 * `scene.background` direto, sem geometria própria, sem shader próprio, sem
 * passe de render extra — o three desenha o fundo com uma malha interna dele,
 * o MESMO mecanismo que já existia antes do `GradientSky` trocar tudo por um
 * shader (ver o comentário de `GradientSky.tsx`: "custo: 1 draw call, o mesmo
 * que `scene.background` custava"). Aqui o custo é esse 1 draw call, só que
 * amostrando uma textura em vez de rodar `corDoCeuGLSL` por fragmento.
 *
 * `scene.environment` fica de fora de propósito — isso ligaria reflexo de
 * ambiente em todo material PBR da cena (pedido explícito do teste: nenhuma
 * reflexão em tempo real).
 */
const SKY_URL = "/assets/sky/skybox-day.png";

let cache: THREE.Texture | null = null;
function carregarTextura(): THREE.Texture {
  if (cache) return cache;
  const tex = new THREE.TextureLoader().load(SKY_URL);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache = tex;
  return tex;
}

export function TexturedSky() {
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const anterior = scene.background;
    scene.background = carregarTextura();
    return () => {
      scene.background = anterior;
    };
  }, [scene]);

  return null;
}
