import { distanciaDeAtaque } from "./attackStore";

/**
 * Alcance de skill, e quem está dentro dele.
 *
 * Mora aqui, e não dentro do `AimPreview`, porque agora são DOIS lados usando a
 * mesma resposta: a prévia pinta a área de vermelho quando está fora, e o
 * `NetPlayer` decide se anda antes de lançar. Se as duas contas divergissem, o
 * disco ficaria vermelho e o personagem lançaria mesmo assim (ou o contrário) —
 * é a mesma classe de falha muda de `max_walk_path` divergindo entre cliente e
 * servidor.
 */

/**
 * Alcance da skill em CÉLULAS, tratando as duas convenções do rAthena.
 *
 * Negativo quer dizer "o alcance da arma" e não uma distância; zero numa skill
 * usada no próprio personagem é ausência de alcance. Nos dois casos devolve 0, e
 * 0 significa "sem restrição de alcance a desenhar nem a respeitar" — inventar
 * um número seria mentir sobre o que o servidor aceita.
 */
export function raioDeAlcance(range: number | undefined): number {
  return range !== undefined && range > 0 ? range : 0;
}

/**
 * A célula alvo está ao alcance da skill?
 *
 * A distância é a `distanciaDeAtaque` — a `distance_client` do rAthena
 * (path.cpp:510), circular e com o bônus de −0,1 —, e não Chebyshev, porque é
 * ela que o `battle_check_range` usa para pedido vindo do cliente
 * (`check_distance_client_bl`, battle.cpp:8226). Usar Chebyshev pintaria de
 * vermelho uma célula que o servidor aceitaria, bem na borda, que é onde o
 * jogador olha.
 */
export function skillNoAlcance(
  eu: { x: number; y: number },
  alvo: { x: number; y: number },
  raio: number,
): boolean {
  if (raio <= 0) return true; // sem alcance declarado, o servidor não recusa por distância
  return distanciaDeAtaque(alvo.x - eu.x, alvo.y - eu.y) <= raio;
}
