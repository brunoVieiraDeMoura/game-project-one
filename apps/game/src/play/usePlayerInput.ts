import { useEffect, useRef, type MutableRefObject } from "react";
import { isTyping } from "./isTyping";

/**
 * O que resta do teclado de movimento: o PULO.
 *
 * Este hook nasceu para o WASD — mantinha o conjunto de teclas seguradas e
 * recomputava eixos contínuos por quadro, com "última tecla vence" nos pares
 * opostos. O WASD saiu do jogo (um caminho de movimento só, o clique-tile), e
 * com ele foram os eixos, o `Set` de teclas seguradas, a ordem de chegada e o
 * `useFrame` que os recomputava.
 *
 * Sobrou o Space, que é EDGE e não estado contínuo: o `play/Player` local
 * (preview do editor e demo) o consome uma vez e o zera. Não há pulo no `/play`
 * com sessão — quem manda no personagem ali é o servidor, e o rAthena não tem
 * pacote de pulo.
 *
 * O campo `skill` (Digit1) foi removido junto: ele era escrito aqui e **nunca
 * lido em lugar nenhum**. Quem dispara skill é a barra do HUD.
 */
export interface PlayerInput {
  /** pedido de pulo (edge no Space); o consumidor zera ao iniciar o pulo */
  jump: MutableRefObject<boolean>;
}

export function usePlayerInput(): PlayerInput {
  const jump = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // digitando (chat/campo de texto): a tecla é do campo, não do jogo
      if (isTyping(e.target)) return;
      if (e.repeat) return;
      if (e.code === "Space") jump.current = true; // edge; o Player consome
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  return { jump };
}
