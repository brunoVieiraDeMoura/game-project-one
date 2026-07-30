/**
 * Esconde a barra de rolagem NATIVA dos elementos com a classe `chat-scroll`.
 *
 * O navegador não deixa vestir a barra do sistema com imagem, então quem rola
 * com arte própria (`hud/ChatScrollbar`) precisa apagar a nativa antes. Isso
 * exige um PSEUDO-ELEMENTO (`::-webkit-scrollbar`), que estilo inline não
 * alcança — daí a única regra CSS solta do app.
 *
 * Cada tela que usa a rolagem desenhada monta este componente. Duas cópias da
 * mesma regra no documento não custam nada e evitam que uma tela dependa de
 * outra estar montada para a rolagem dela funcionar.
 */
export function ScrollbarHider() {
  return <style>{`.chat-scroll{scrollbar-width:none;-ms-overflow-style:none}.chat-scroll::-webkit-scrollbar{width:0;height:0}`}</style>;
}
