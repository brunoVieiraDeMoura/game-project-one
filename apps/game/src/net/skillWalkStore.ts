import { create } from "zustand";
import { distanciaDeAtaque } from "./attackStore";

/**
 * "Vou até lá e lanço a magia" — a terceira ordem de vários quadros.
 *
 * Irmã do `attackStore` ("vou até lá bater") e do `pickupStore` ("vou até lá
 * pegar"), e existe pelo mesmo motivo: o rAthena confere a distância
 * (`battle_check_range`, battle.cpp:8226) e RECUSA — não se aproxima por você.
 * Clicar longe com uma skill de área simplesmente não fazia nada; o disco da
 * prévia ficava vermelho e o clique morria ali.
 *
 * O pedido do jogador é claro: lançar naquela célula. Então o cliente anda até
 * a borda do alcance e lança de lá, em vez de exigir que ele mesmo se posicione.
 *
 * Aqui mora só a INTENÇÃO. Quem anda é o `NetPlayer` (é ele que sabe pedir
 * caminhada) e quem resolve a magia continua sendo o servidor.
 */

export interface SkillPendente {
  skillId: number;
  level: number;
  /** só para a mensagem/depuração — o servidor não usa */
  name: string;
  /** célula do SERVIDOR onde a magia deve cair */
  x: number;
  y: number;
  /** alcance em células, já resolvido por `raioDeAlcance` */
  raio: number;
  /** quando a ordem começou; serve para desistir de um ponto inalcançável */
  desde: number;
}

interface SkillWalkState {
  pendente: SkillPendente | null;
  /** começa (ou substitui) a ida até o alcance */
  irLancar: (p: Omit<SkillPendente, "desde">) => void;
  /** cancela: ESC, clique para andar noutro lugar, WASD, ou a magia saiu */
  parar: () => void;
}

export const useSkillWalkStore = create<SkillWalkState>((set) => ({
  pendente: null,
  irLancar: (p) => set({ pendente: { ...p, desde: performance.now() } }),
  parar: () => set({ pendente: null }),
}));

/**
 * Já dá para lançar daqui?
 *
 * A conta é a MESMA do servidor: `battle_check_range` (battle.cpp:8226) chama
 * `check_distance_client_bl` para jogador, ou seja, a `distance_client` do
 * ataque. Usar um `hypot` cru daria "chegou" numa célula que o rAthena recusa —
 * e a recusa dele é SILENCIOSA, então o personagem pararia e não aconteceria
 * nada.
 *
 * Alcance 0 é "sem alcance" (`raioDeAlcance`): a skill vale de onde estiver, e
 * não há caminhada nenhuma a fazer.
 */
export function dentroDoAlcance(
  eu: { x: number; y: number },
  alvo: { x: number; y: number },
  raio: number,
): boolean {
  return raio <= 0 || distanciaDeAtaque(alvo.x - eu.x, alvo.y - eu.y) <= raio;
}

/**
 * Até onde andar para poder lançar — a célula na BORDA do alcance, na linha
 * reta entre o personagem e o ponto escolhido.
 *
 * Não serve o `celulaParaEncostar` do ataque: lá o passo é por EIXO
 * (`sign × alcance` em x e em y), o que num alcance grande sai pela diagonal e
 * cai a `raio × 1,41` do alvo — ainda fora. Com alcance 1 (arma corpo a corpo)
 * a diferença não aparece; com os 9 de uma Storm Gust, o personagem andaria,
 * recalcularia e andaria de novo, encostando aos poucos.
 *
 * Aqui a fração `raio / distância` anda ao longo do segmento, então o destino
 * cai no CÍRCULO de raio `raio` em volta do alvo, do lado de quem lança — o
 * caminho mais curto para poder soltar a magia. Arredondar para célula só
 * aproxima ainda mais (o `−0,1` da `distance_client` dá a folga).
 *
 * Devolve `null` quando já dá para lançar.
 */
export function celulaNoAlcance(
  eu: { x: number; y: number },
  alvo: { x: number; y: number },
  raio: number,
): { x: number; y: number } | null {
  if (dentroDoAlcance(eu, alvo, raio)) return null;
  const dx = eu.x - alvo.x;
  const dy = eu.y - alvo.y;
  const d = Math.hypot(dx, dy);
  // em cima do alvo e fora de alcance é impossível (d = 0 só com raio < 0, que
  // `raioDeAlcance` já converte em 0) — mas dividir por zero, nunca
  if (d === 0) return { ...alvo };
  const k = raio / d;
  return { x: Math.round(alvo.x + dx * k), y: Math.round(alvo.y + dy * k) };
}
