/**
 * Céus disponíveis — `assets-new/sky/Skyboxes` (Kenney) → `public/assets/sky`.
 * 5 arquivos reais, todos panorama equirretangular 4096×2048 (conferido
 * abrindo um deles — ver `TexturedSky.tsx`). Fonte única de verdade dos
 * nomes: o editor (admin) lista este catálogo pelo dropdown, o `GameMap.sky.
 * skyId` guarda só a CHAVE, nunca o arquivo — trocar o PNG de lugar não
 * quebra mapa salvo, só este arquivo.
 */
export interface SkyOption {
  id: string;
  label: string;
  url: string;
}

export const SKY_CATALOG: SkyOption[] = [
  { id: "day", label: "Dia", url: "/assets/sky/skybox-day.png" },
  { id: "morning", label: "Manhã", url: "/assets/sky/skybox-morning.png" },
  { id: "night", label: "Noite", url: "/assets/sky/skybox-night.png" },
  { id: "alien", label: "Alienígena", url: "/assets/sky/skybox-alien.png" },
  { id: "space", label: "Espaço", url: "/assets/sky/skybox-space.png" },
];

const BY_ID = new Map(SKY_CATALOG.map((s) => [s.id, s]));

/** url do céu — chave desconhecida cai no "day" (nunca quebra render) */
export function skyUrlFor(skyId: string | undefined): string {
  return (skyId && BY_ID.get(skyId)?.url) || BY_ID.get("day")!.url;
}
