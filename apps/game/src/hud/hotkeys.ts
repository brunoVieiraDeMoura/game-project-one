import { useEffect } from "react";
import { useHudStore, type WindowKey } from "./hudStore";
import { isTyping } from "../play/isTyping";
import { useAimStore } from "../net/aimStore";
import { useWorldStore } from "../net/worldStore";

/**
 * Atalhos das janelas, no mesmo caminho de dedo do Ragnarok original.
 *
 * O RO abre janela com Alt + letra, e a letra é a mesma há vinte anos — quem
 * jogou não quer reaprender. A ESTILIZAÇÃO é nossa; o caminho de acesso é o
 * dele (tenta-entender.txt §7).
 *
 *   Alt+A  status        Alt+E  inventário     Alt+S  habilidades
 *   Alt+Q  equipamento   Alt+Z  party/amigos   Alt+M  mapa
 *   Alt+U  quests        Alt+O  configuração
 *
 * Equipamento e status são a MESMA janela aqui (a nossa mostra os dois lados),
 * então Alt+Q e Alt+A caem no mesmo lugar de propósito.
 */
const WINDOW_BY_KEY: Record<string, Exclude<WindowKey, null>> = {
  KeyA: "status",
  KeyQ: "status",
  KeyE: "inventory",
  KeyS: "skills",
  KeyZ: "friends",
  KeyM: "map",
  KeyU: "quests",
  KeyO: "settings",
};

export function useHudHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // digitando no chat/campo de texto? o atalho não existe.
      if (isTyping(e.target)) return;

      // ESC, na ordem do RO: cancela a mira de skill, depois tira o alvo,
      // depois fecha a janela aberta, e só então abre Configurações.
      if (e.code === "Escape") {
        const hud = useHudStore.getState();
        if (useAimStore.getState().skill) useAimStore.getState().cancel();
        else if (useWorldStore.getState().target) useWorldStore.getState().setTarget(null);
        else if (hud.openWindow) hud.setWindow(null);
        else hud.toggleWindow("settings");
        return;
      }

      if (!e.altKey || e.ctrlKey || e.metaKey) return;

      const target = WINDOW_BY_KEY[e.code];
      if (!target) return;

      // Alt+letra é atalho de menu no navegador; sem o preventDefault o Firefox
      // rouba a tecla.
      e.preventDefault();
      useHudStore.getState().toggleWindow(target);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
