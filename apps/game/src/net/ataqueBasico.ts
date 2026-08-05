import { create } from "zustand";
import { atacar } from "./acoes";
import { useAttackStore } from "./attackStore";
import { useWorldStore } from "./worldStore";
import type { SkillPayload } from "./gateway";

/**
 * ATAQUE BÁSICO — a skill que liga o auto-ataque.
 *
 * Ligada, o personagem vai até o alvo e bate até uma destas três coisas:
 * o alvo MORRER, o jogador CLICAR FORA dele, ou a skill ser DESLIGADA. As três
 * desligam a habilidade — é o pedido, e é também o comportamento do RO, onde o
 * ataque contínuo é um modo e não um comando avulso.
 *
 * Vale para corpo a corpo e para distância sem nenhuma distinção: quem decide
 * alcance, acerto e dano é o servidor (`unit_attack`), e o cliente só mantém a
 * ORDEM de pé. É a mesma ordem de vários quadros que o clique no mob já cria
 * (`net/acoes.atacar` + `attackStore`); a skill apenas a torna PERSISTENTE
 * através das trocas de alvo.
 *
 * ## Por que um id NEGATIVO
 *
 * A barra de habilidades guarda id de skill por slot, e o rAthena usa ids
 * positivos. Um id negativo não colide com skill nenhuma dele agora nem depois,
 * e ainda torna a origem óbvia na leitura: número negativo na barra é coisa do
 * cliente.
 */
export const ATAQUE_BASICO_ID = -1;

/**
 * A entrada de skill que a barra enxerga.
 *
 * Tem a forma de `SkillPayload` de propósito: assim ela entra na mesma lista das
 * skills do servidor e todo o resto da barra (arrastar, trocar de slot,
 * persistir, desenhar) funciona sem um caminho especial. `spCost: 0` e
 * `upgradable: false` porque nada disso se aplica — não é uma skill do rAthena.
 */
export const ATAQUE_BASICO: SkillPayload = {
  id: ATAQUE_BASICO_ID,
  name: "Ataque Básico",
  level: 1,
  spCost: 0,
  range: 0,
  upgradable: false,
};

interface AtaqueBasicoState {
  ativo: boolean;
  alternar: () => void;
  desligar: () => void;
}

export const useAtaqueBasico = create<AtaqueBasicoState>((set) => ({
  ativo: false,
  alternar: () => set((s) => ({ ativo: !s.ativo })),
  desligar: () => set((s) => (s.ativo ? { ativo: false } : s)),
}));

/** manda bater no alvo que estiver selecionado, se houver um vivo */
export function baterNoAlvo(): void {
  const mundo = useWorldStore.getState();
  const gid = mundo.target;
  if (gid === null) return;
  const alvo = mundo.entities[gid];
  if (!alvo || alvo.kind !== "mob") return;
  atacar(gid, alvo.x, alvo.y);
}

/**
 * As reações da skill, fora do React.
 *
 * Mora num `subscribe` do store do mundo — como o cursor da mira em
 * `net/aimStore` — porque isto não desenha nada: é uma regra que precisa valer
 * enquanto a sessão existir, e não enquanto um componente estiver montado.
 *
 * Duas reações, e as duas são sobre a TROCA de alvo:
 *
 *  • alvo novo (clique ou Tab) com a skill ligada → persegue e bate nele. É o
 *    que faz o Tab virar combate sem mais nenhum comando;
 *  • alvo SUMIU (morreu, ou saiu de vista) → a skill se desliga sozinha, que é
 *    a regra "até matar o alvo". Quem limpa o alvo nesse caso é o `vanish` do
 *    `worldStore`, então não há evento novo a escutar.
 */
useWorldStore.subscribe((estado, anterior) => {
  if (estado.target === anterior.target) return;
  if (!useAtaqueBasico.getState().ativo) return;

  if (estado.target === null) {
    useAtaqueBasico.getState().desligar();
    useAttackStore.getState().parar();
    return;
  }
  baterNoAlvo();
});
