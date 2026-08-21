/**
 * URL do ícone de item, a partir do NOME DE ARQUIVO do catálogo
 * (`net/itemCatalog.ItemInfo.icon`) — subido pelo admin em `/items/:id`
 * (`POST /items/:id/icon`, Painel 3000) e servido de `public/assets/items/`.
 *
 * Sem `icon` no catálogo (item nunca ganhou upload), quem chama cai sozinho
 * no quadrado por seed — `IconSquare.imageSrc` undefined é exatamente esse
 * caso (`ui/rpg.tsx`).
 */
export function itemIconUrl(icon: string | undefined): string | undefined {
  return icon ? `/assets/items/${icon}` : undefined;
}
