import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { skyUrlFor } from "./skyCatalog";

/**
 * Céu com skybox real (Kenney, `assets-new/sky` → `public/assets/sky`), no
 * lugar do degradê procedural (`GradientSky`). Qual arquivo usar vem de
 * `map.sky.skyId` (painel "Camadas & Luz" do editor) — ver `scene/
 * skyCatalog.ts` pra lista completa e resolução de chave desconhecida.
 *
 * Todo skybox do catálogo é PANORAMA EQUIRRETANGULAR (4096×2048, proporção
 * 2:1 — conferido abrindo um deles, não é layout de cubemap em cruz nem 6
 * faces separadas). Isso torna a integração o caminho mais barato possível:
 * vira `scene.background` direto, sem geometria própria, sem shader próprio,
 * sem passe de render extra — o three desenha o fundo com uma malha interna
 * dele, o MESMO mecanismo que já existia antes do `GradientSky` trocar tudo
 * por um shader (ver o comentário de `GradientSky.tsx`: "custo: 1 draw call,
 * o mesmo que `scene.background` custava"). Aqui o custo é esse 1 draw call,
 * só que amostrando uma textura em vez de rodar `corDoCeuGLSL` por fragmento.
 *
 * `scene.environment` fica de fora de propósito — isso ligaria reflexo de
 * ambiente em todo material PBR da cena (pedido explícito do teste: nenhuma
 * reflexão em tempo real).
 */
const cache = new Map<string, THREE.Texture>();
function carregarTextura(url: string): THREE.Texture {
  let tex = cache.get(url);
  if (tex) return tex;
  tex = new THREE.TextureLoader().load(url);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(url, tex);
  return tex;
}

export function TexturedSky({ skyId }: { skyId?: string }) {
  const scene = useThree((s) => s.scene);
  const url = skyUrlFor(skyId);

  useEffect(() => {
    const anterior = scene.background;
    scene.background = carregarTextura(url);
    return () => {
      scene.background = anterior;
    };
  }, [scene, url]);

  return null;
}
