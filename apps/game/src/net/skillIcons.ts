/**
 * URL do ícone de skill, a partir do NOME DE ARQUIVO do catálogo
 * (`net/skillCatalog.SkillInfo.icon`) — subido pelo admin em `/skills/:id`
 * (`POST /skills/:id/icon`, Painel 3000) e servido de `public/assets/skills/`.
 *
 * Sem `icon` no catálogo (skill nunca ganhou upload), quem chama cai sozinho
 * no quadrado por seed — mesma convenção de `net/itemIcons.ts`.
 */
export function skillIconUrl(icon: string | undefined): string | undefined {
  return icon ? `/assets/skills/${icon}` : undefined;
}
