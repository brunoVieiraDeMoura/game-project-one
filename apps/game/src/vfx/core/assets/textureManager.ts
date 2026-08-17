import * as THREE from "three";

/**
 * Cache de textura por URL — item 13 do pedido: "não criar/destruir
 * texturas constantemente". Mesma técnica de `vfx/AmbientParticles.tsx:
 * textureFor` (já provada em produção), generalizada pra qualquer módulo do
 * Core pedir a mesma textura sem duplicar o `TextureLoader`.
 *
 * Textura NUNCA é descartada por cast — só quando explicitamente liberada
 * (troca de sessão/mapa), e mesmo assim só se ninguém mais referenciar.
 */
const cache = new Map<string, { texture: THREE.Texture; refCount: number }>();

export function acquireTexture(url: string): THREE.Texture {
  let entry = cache.get(url);
  if (!entry) {
    const texture = new THREE.TextureLoader().load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    entry = { texture, refCount: 0 };
    cache.set(url, entry);
  }
  entry.refCount++;
  return entry.texture;
}

/** libera UMA referência — só dispõe a textura quando ninguém mais usa (ex.:
 * todas as instâncias de todos os VFX que usavam este atlas terminaram). */
export function releaseTexture(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0) {
    entry.texture.dispose();
    cache.delete(url);
  }
}

/** só para teste: esvazia o cache incondicionalmente. */
export function resetTextureCache(): void {
  for (const entry of cache.values()) entry.texture.dispose();
  cache.clear();
}

export function textureCacheSize(): number {
  return cache.size;
}
