import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Background gradiente da cena (topo → horizonte). Substitui o <Sky> fogado
 * (que virava cinza uniforme além do fog) e evita o clear branco/cinza padrão.
 * Setar a `bottom` igual à cor do fog dá horizonte contínuo (sem emenda).
 */
export function GradientSky({ top = "#5a8fc7", bottom = "#cfe0ee" }: { top?: string; bottom?: string }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    const grd = ctx.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, top);
    grd.addColorStop(1, bottom);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const prev = scene.background;
    scene.background = tex;
    return () => {
      scene.background = prev;
      tex.dispose();
    };
  }, [scene, top, bottom]);
  return null;
}
