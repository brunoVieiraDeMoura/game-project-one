/**
 * O teclado do jogo (WASD, 1..9, atalhos de janela) é IGNORADO enquanto o foco
 * está num campo de texto — digitar "wasd" no chat não pode fazer o personagem
 * andar, nem "1" ligar/desligar o Basic Attack.
 *
 * Checa o alvo do evento E o `document.activeElement`: o alvo cobre o caso do
 * evento que já nasceu no input, o activeElement cobre listener global em
 * `window` (que recebe o evento por bubbling com target = input, mas também
 * eventos sintéticos/redirecionados).
 */
function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}

export function isTyping(target?: EventTarget | null): boolean {
  if (typeof document === "undefined") return false;
  if (target instanceof Element && isEditable(target)) return true;
  return isEditable(document.activeElement);
}
