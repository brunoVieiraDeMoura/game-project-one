/**
 * Mapa do rAthena → mapa 3D que o representa.
 *
 * Desde que os mapas passaram a ser gerados do `map_cache.dat` no tamanho real
 * (`prt_fild08` = 400×400, uma célula do servidor por célula do mundo), a regra
 * normal é a IDENTIDADE: o mapa 3D tem o mesmo id do mapa legado. Quem não
 * existir ainda no acervo cai no erro de "sem mapa 3D" — o cliente avisa em vez
 * de desenhar o mapa errado.
 *
 * O apelido continua existindo para os mapas AUTORADOS à mão no editor, que têm
 * id próprio e cobrem só um pedaço da grade do servidor. Nesses, a janela vem no
 * próprio mapa (`legacy.origin`), não aqui.
 */
export const LEGACY_MAP_TO_3D: Record<string, string> = {};

export function map3dFor(legacyMapName: string): string | null {
  return LEGACY_MAP_TO_3D[legacyMapName] ?? legacyMapName;
}
