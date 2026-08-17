import type { AtlasMetadata } from "./atlasTypes";
import { validateAtlasMetadata } from "./atlasTypes";
import { acquireTexture } from "./textureManager";

/**
 * Registro de atlases — NASCE VAZIO (invariante leia1.txt: nenhum caminho
 * de asset é assumido, nenhum atlas fictício é criado aqui).
 *
 * ## Onde ligar o atlas definitivo quando ele existir (Fase 6)
 *
 * Quando a produção de assets definir a pasta/URL real, registrar UMA vez,
 * no module-load de um arquivo próprio (mesmo padrão de
 * `registrarPerfilEstruturalVfx`):
 *
 * ```ts
 * // vfx/core/assets/manifestEntries.ts (arquivo a CRIAR na Fase 6, não antes)
 * import { registerAtlas } from "./manifest";
 * registerAtlas("vfx_main", {
 *   metadataUrl: "/assets/vfx/atlases/vfx_main.json", // caminho real, quando existir
 *   imageUrl: "/assets/vfx/atlases/vfx_main.png",
 * });
 * ```
 *
 * Depois disso, uma `VfxDefinition` troca `renderer:"dom"` por
 * `renderer:"sprite"` + `atlas:"vfx_main"` + `animation:{...}` — nenhuma
 * outra linha de código muda (nem em `manager.ts`, nem em skill nenhuma).
 *
 * Até lá, `manifest.ts` fica vazio e `getAtlasEntry()` sempre devolve
 * `undefined` — é o estado ESPERADO, não um bug.
 */

export interface AtlasManifestEntry {
  metadataUrl: string;
  imageUrl: string;
}

interface LoadedAtlas {
  entry: AtlasManifestEntry;
  metadata: AtlasMetadata | null;
  loading: Promise<AtlasMetadata> | null;
}

const manifest = new Map<string, LoadedAtlas>();

export function registerAtlas(key: string, entry: AtlasManifestEntry): void {
  manifest.set(key, { entry, metadata: null, loading: null });
}

export function getAtlasEntry(key: string): AtlasManifestEntry | undefined {
  return manifest.get(key)?.entry;
}

export function listAtlasKeys(): readonly string[] {
  return [...manifest.keys()];
}

/** metadata já resolvido, se o `fetch` já terminou — `undefined` enquanto
 * carrega ou se a chave nunca foi registrada. Renderers consultam isto
 * antes de desenhar; sem metadata, caem no material placeholder de
 * validação (nunca travam esperando). */
export function getLoadedAtlasMetadata(key: string): AtlasMetadata | undefined {
  return manifest.get(key)?.metadata ?? undefined;
}

/** dispara o carregamento (metadata JSON + textura) se ainda não começou.
 * Idempotente — chamar de novo enquanto carrega devolve a MESMA promise. */
export async function ensureAtlasLoaded(key: string): Promise<AtlasMetadata> {
  const loaded = manifest.get(key);
  if (!loaded) throw new Error(`vfx atlas "${key}" não registrado em manifest.ts`);
  if (loaded.metadata) return loaded.metadata;
  if (loaded.loading) return loaded.loading;

  loaded.loading = fetch(loaded.entry.metadataUrl)
    .then((r) => r.json())
    .then((raw) => {
      const metadata = validateAtlasMetadata(raw);
      loaded.metadata = metadata;
      acquireTexture(loaded.entry.imageUrl);
      return metadata;
    });
  return loaded.loading;
}

/** só para teste: limpa o registro inteiro. */
export function resetAtlasManifest(): void {
  manifest.clear();
}
