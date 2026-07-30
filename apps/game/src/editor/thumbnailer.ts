import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Gera miniaturas (data URL PNG) dos assets glTF pra mostrar no botão da
 * paleta. Um ÚNICO renderer offscreen compartilhado (1 contexto WebGL) renderiza
 * cada modelo uma vez e cacheia o resultado como imagem estática — nada de
 * dezenas de canvases ao vivo. Fila implícita por url (dedupe via `pending`).
 */

const SIZE = 96;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let renderer: THREE.WebGLRenderer | null = null;
let loader: GLTFLoader | null = null;

function ensure() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  if (!loader) loader = new GLTFLoader();
}

async function render(url: string): Promise<string> {
  ensure();
  const gltf = await loader!.loadAsync(url);
  const obj = gltf.scene;
  const scene = new THREE.Scene();
  scene.add(obj);
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(3, 6, 4);
  scene.add(dir);

  // enquadra a bounding box num ângulo 3/4
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  const d = maxDim * 2.1;
  cam.position.set(center.x + d * 0.7, center.y + d * 0.75, center.z + d * 0.9);
  cam.lookAt(center);

  renderer!.render(scene, cam);
  const data = renderer!.domElement.toDataURL("image/png");

  // limpa geometrias clonadas do render (mantém a textura em cache do loader)
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  scene.clear();
  return data;
}

export function getThumbnail(url: string): Promise<string> {
  const c = cache.get(url);
  if (c) return Promise.resolve(c);
  const p = pending.get(url);
  if (p) return p;
  const prom = render(url)
    .then((data) => {
      cache.set(url, data);
      pending.delete(url);
      return data;
    })
    .catch(() => {
      pending.delete(url);
      return "";
    });
  pending.set(url, prom);
  return prom;
}

/** hook: devolve a data URL da miniatura (null enquanto gera) */
export function useThumbnail(url: string | undefined): string | null {
  const [data, setData] = useState<string | null>(url ? cache.get(url) ?? null : null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    getThumbnail(url).then((d) => {
      if (alive && d) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return data;
}
