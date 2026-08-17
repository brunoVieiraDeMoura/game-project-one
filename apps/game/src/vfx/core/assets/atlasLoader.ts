import * as THREE from "three";
import type { AtlasMetadata } from "./atlasTypes";
import { ensureAtlasLoaded, getAtlasEntry, getLoadedAtlasMetadata } from "./manifest";
import { acquireTexture } from "./textureManager";

/**
 * Ponte entre `manifest.ts` (o QUE está registrado) e `textureManager.ts`
 * (a textura em si) — o que um renderer chama pra desenhar um frame de
 * atlas. Separado de `manifest.ts` porque este módulo conhece `THREE.Texture`
 * (three.js) e o manifest não precisa saber disso pra só guardar URLs.
 */
export interface LoadedAtlas {
  metadata: AtlasMetadata;
  texture: THREE.Texture;
}

/** síncrono — `undefined` se o atlas não está registrado OU ainda está
 * carregando (chame `ensureAtlasLoaded` antes, ou aceite o `undefined` e
 * caia no material placeholder, como `SpriteRenderer` faz). */
export function loadedAtlas(key: string): LoadedAtlas | undefined {
  const entry = getAtlasEntry(key);
  const metadata = getLoadedAtlasMetadata(key);
  if (!entry || !metadata) return undefined;
  return { metadata, texture: acquireTexture(entry.imageUrl) };
}

export { ensureAtlasLoaded };
