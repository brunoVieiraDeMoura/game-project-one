import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { isTyping } from "./isTyping";

/**
 * Entrada de movimento por ESTADO CONTÍNUO das teclas (não reação a eventos):
 * mantém o conjunto de teclas seguradas e recomputa os eixos a cada frame no
 * useFrame. Isso evita depender da ordem de chegada de keydown/keyup e faz o
 * estado (idle/andando/direção) refletir na hora o que está pressionado.
 *
 * W (pra frente / tela adentro) = z-; A = x-; D = x+; S = z+.
 * "Última tecla vence" nos pares opostos (segurar A + apertar D vira pra
 * direita na hora). keyups perdidos (blur/alt-tab) são zerados no blur.
 */
export interface PlayerInput {
  /** eixos contínuos -1..1 (lido por frame) */
  axis: MutableRefObject<{ x: number; z: number }>;
  /** pedido de pulo (edge no Space); o consumidor zera ao iniciar o pulo */
  jump: MutableRefObject<boolean>;
  /** pedido de skill (edge na tecla 1); o consumidor zera ao usar */
  skill: MutableRefObject<boolean>;
}

export function usePlayerInput(): PlayerInput {
  const axis = useRef({ x: 0, z: 0 });
  const jump = useRef(false);
  const skill = useRef(false);
  const held = useRef(new Set<string>());
  const order = useRef(new Map<string, number>());
  const seq = useRef(0);

  useEffect(() => {
    const clear = () => {
      held.current.clear();
      order.current.clear();
    };
    const down = (e: KeyboardEvent) => {
      // digitando (chat/campo de texto): nada de andar/pular/skill. Solta o que
      // estava segurado antes do foco, senão o personagem sai andando sozinho.
      if (isTyping(e.target)) {
        clear();
        return;
      }
      if (e.repeat) return;
      if (e.code === "Space") jump.current = true; // edge; Player consome
      if (e.code === "Digit1") skill.current = true; // skill por hotkey
      if (!held.current.has(e.code)) {
        held.current.add(e.code);
        order.current.set(e.code, ++seq.current);
      }
    };
    const up = (e: KeyboardEvent) => {
      held.current.delete(e.code);
      order.current.delete(e.code);
    };
    // clicar num input com tecla segurada nunca manda keyup: zera no foco
    const onFocusIn = (e: FocusEvent) => isTyping(e.target) && clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    window.addEventListener("focusin", onFocusIn);
    document.addEventListener("visibilitychange", () => document.hidden && clear());
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      window.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  // par oposto: a tecla pressionada mais recentemente ganha
  const resolve = (negCodes: string[], posCodes: string[]): number => {
    const h = held.current;
    const o = order.current;
    const negT = Math.max(0, ...negCodes.filter((c) => h.has(c)).map((c) => o.get(c) ?? 0));
    const posT = Math.max(0, ...posCodes.filter((c) => h.has(c)).map((c) => o.get(c) ?? 0));
    if (negT === 0 && posT === 0) return 0;
    return posT >= negT ? 1 : -1;
  };

  // polling por frame: estado contínuo, sem lag de ordem de eventos
  useFrame(() => {
    axis.current.x = resolve(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]);
    axis.current.z = resolve(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]);
  });

  return { axis, jump, skill };
}
