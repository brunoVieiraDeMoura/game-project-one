import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { RenderPixelatedPass } from "three/examples/jsm/postprocessing/RenderPixelatedPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RetroQuantizeShader, colorLevelsFor } from "./retroShader";

/**
 * FILTRO RETRÔ (16 bits) — pós-processamento puro.
 *
 * Nada de asset, material ou geometria muda: a cena 3D é renderizada normal e o
 * tratamento acontece na imagem final. Por isso dá pra ligar/desligar em runtime
 * (`gameplay.retroMode`) sem reprocessar nada.
 *
 * Pipeline:
 *   RenderPixelatedPass — renderiza numa resolução reduzida e amplia com
 *     NEAREST. Vem do próprio three (addons), e além de pixelizar ele realça
 *     bordas por normal e profundidade: sem isso os objetos "derretem" uns nos
 *     outros quando o pixel fica grande.
 *   RetroQuantizeShader — achata a cor pra N degraus por canal + dithering
 *     (só no modo "16bit"; em "pixel" fica neutro).
 *   OutputPass — tone mapping + conversão de espaço de cor, que o composer
 *     precisa fazer manualmente (o render direto do R3F faria sozinho).
 *
 * As TEXTURAS também vão pra NearestFilter enquanto o filtro está ligado —
 * textura interpolada dentro de um jogo pixelado é o que mais denuncia o
 * "3D moderno com filtro por cima". Como os glTF carregam de forma assíncrona
 * (Suspense), a varredura se repete de tempos em tempos e marca o que já
 * ajustou; ao desligar, o filtro original é restaurado.
 */
export interface RetroSettings {
  retroMode: "off" | "pixel" | "8bit" | "16bit";
  retroPixelSize: number;
  retroDither: boolean;
}

/** tamanhos de pixel oferecidos no admin (valores fixos: no meio-termo o
 * padrão fica irregular na diagonal) */
export const PIXEL_SIZES = [2, 4, 6, 8, 12, 16, 24] as const;

/**
 * Saneia o tamanho vindo da config. Um NaN aqui é fatal e silencioso: o
 * RenderPixelatedPass faz `(largura / pixelSize) | 0`, o que vira um render
 * target 0×0 e a TELA FICA PRETA. Config antiga (campo ausente) ou input
 * vazio no admin chegavam exatamente assim.
 */
export function safePixelSize(value: number): number {
  if (!Number.isFinite(value)) return 6;
  return Math.max(1, Math.min(24, Math.round(value)));
}

/** de quanto em quanto tempo procurar textura nova pra deixar pixelada */
const TEXTURE_SCAN_SECONDS = 1;

/**
 * Porta de entrada: só MONTA o composer quando o filtro está ligado.
 *
 * A separação é essencial, não cosmética: o componente de baixo registra um
 * `useFrame` com prioridade > 0, e isso desliga o render automático do R3F
 * enquanto ele existir. Com o hook registrado no modo "off" (hooks não podem
 * ser condicionais), ninguém renderizava a cena e o /play virava um retângulo
 * da cor de fundo.
 */
export function RetroFilter(props: RetroSettings) {
  if (props.retroMode === "off") return null;
  return <RetroComposer {...props} />;
}

function RetroComposer({ retroMode, retroPixelSize, retroDither }: RetroSettings) {
  const pixelSize = safePixelSize(retroPixelSize);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const rig = useMemo(() => {
    const composer = new EffectComposer(gl);
    // pixelSize 1 não pixeliza nada — nesse caso um RenderPass comum evita o
    // custo do render de normais/profundidade que o pass pixelado faz
    const pixelate =
      pixelSize > 1
        ? new RenderPixelatedPass(pixelSize, scene, camera, { normalEdgeStrength: 0.3, depthEdgeStrength: 0.4 })
        : new RenderPass(scene, camera);
    const quantize = new ShaderPass(RetroQuantizeShader);
    composer.addPass(pixelate);
    composer.addPass(quantize);
    composer.addPass(new OutputPass());
    return { composer, quantize };
    // recria quando muda o que é estrutural (modo/pixelSize); cor e dither são
    // uniforms, atualizados sem reconstruir nada
  }, [pixelSize, gl, scene, camera]);

  // uniforms de cor: mudam com o slider, sem remontar o composer
  useEffect(() => {
    const u = rig.quantize.uniforms as { levels: { value: THREE.Vector3 }; dither: { value: number } };
    const [r, g, b] = colorLevelsFor(retroMode);
    u.levels.value.set(r, g, b);
    u.dither.value = retroDither ? 1 : 0;
  }, [rig, retroMode, retroDither]);

  useEffect(() => {
    rig.composer.setSize(size.width, size.height);
    rig.composer.setPixelRatio(gl.getPixelRatio());
  }, [rig, size, gl]);

  useEffect(() => {
    return () => rig.composer.dispose();
  }, [rig]);

  // ---- texturas em NEAREST enquanto o filtro estiver ligado ----
  const touched = useRef(new Map<THREE.Texture, { mag: THREE.MagnificationTextureFilter; min: THREE.MinificationTextureFilter }>());
  const scanTimer = useRef(0);
  useEffect(() => {
    const originals = touched.current;
    // ao desligar o filtro este componente desmonta: devolve o filtro original
    // das texturas (senão o mundo continua pixelado com o filtro off)
    return () => {
      for (const [tex, f] of originals) {
        tex.magFilter = f.mag;
        tex.minFilter = f.min;
        tex.needsUpdate = true;
      }
      originals.clear();
    };
  }, []);

  useFrame((_, dt) => {
    scanTimer.current -= dt;
    if (scanTimer.current <= 0) {
      scanTimer.current = TEXTURE_SCAN_SECONDS;
      pixelateTextures(scene, touched.current);
    }
    rig.composer.render();
  }, 1); // prioridade > 0: assume o render (o R3F para de renderizar sozinho)

  return null;
}

/** deixa as texturas com filtro NEAREST, guardando o valor original */
function pixelateTextures(
  scene: THREE.Object3D,
  touched: Map<THREE.Texture, { mag: THREE.MagnificationTextureFilter; min: THREE.MinificationTextureFilter }>,
) {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      const tex = (mat as THREE.MeshStandardMaterial | undefined)?.map;
      if (!tex || touched.has(tex)) continue;
      touched.set(tex, { mag: tex.magFilter, min: tex.minFilter });
      tex.magFilter = THREE.NearestFilter;
      // mipmap nearest evita cintilação à distância sem devolver a suavização
      tex.minFilter = THREE.NearestMipmapNearestFilter;
      tex.needsUpdate = true;
    }
  });
}
