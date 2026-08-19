import { useEffect } from "react";
import { useHudStore, type WindowKey } from "./hudStore";
import { isTyping } from "../play/isTyping";
import { useAimStore } from "../net/aimStore";
import { useSkillWalkStore } from "../net/skillWalkStore";
import { useSkillTargetStore } from "../net/skillTargetStore";
import { useAttackStore } from "../net/attackStore";
import { useAtaqueBasico } from "../net/ataqueBasico";
import { useWorldStore } from "../net/worldStore";
import { pararMovimentoDeAcao } from "../net/pararMovimentoDeAcao";

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
const WINDOW_BY_KEY: Record<string, WindowKey> = {
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

      // ESC, na ordem do RO: cancela a mira de skill, depois a ida até o ponto
      // da magia, depois tira o alvo, depois fecha a janela aberta, e só então
      // abre Configurações.
      if (e.code === "Escape") {
        const hud = useHudStore.getState();
        if (useAimStore.getState().skill) useAimStore.getState().cancel();
        // "escolhi o ponto (ou o alvo) e estou indo até lá" é uma ordem em
        // andamento, e ESC é como se desiste dela — o passo vem ANTES de largar
        // o alvo porque é a ordem mais recente, e ESC desfaz da mais nova para
        // a mais velha
        //
        // Desarmar a ORDEM não é o bastante: o `move:to` que a aproximação já
        // mandou continua valendo pro rAthena (ele não persegue sozinho, mas
        // também não pára sozinho — unit.cpp:3259). Sem `pararMovimentoDeAcao`
        // aqui, ESC cancelava a skill e o personagem continuava andando até o
        // clique que a tinha aberto — "cancelei e ele foi mesmo assim".
        else if (useSkillWalkStore.getState().pendente) {
          useSkillWalkStore.getState().parar();
          pararMovimentoDeAcao();
        } else if (useSkillTargetStore.getState().pendente) {
          useSkillTargetStore.getState().parar();
          pararMovimentoDeAcao();
        } else if (useAttackStore.getState().alvo && !useAtaqueBasico.getState().ativo) {
          // mesma classe de ordem (perseguir pra bater) — mesma regra.
          // Com o Ataque Básico LIGADO este `alvo` está quase sempre de pé
          // (é o próprio modo perseguindo); parar só a perseguição deixaria
          // a skill acesa sem cancelar nada — aqui ESC pula direto para
          // "tira o alvo", que já desliga o modo junto (ver
          // `net/ataqueBasico`, o `subscribe` que trata alvo nulo).
          useAttackStore.getState().parar();
          pararMovimentoDeAcao();
        } else if (useWorldStore.getState().target) useWorldStore.getState().setTarget(null);
        // fecha a de CIMA da pilha — a mais nova primeiro, como as ordens acima
        else if (!hud.closeTopWindow()) hud.toggleWindow("settings");
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
