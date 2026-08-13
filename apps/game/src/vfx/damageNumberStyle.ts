import { useEffect } from "react";

/**
 * Tipografia ÚNICA de todo número/mensagem de combate do jogo — pedido
 * explícito: "muda a tipografia de todos os hits e skills pra ficar igual a
 * tipografia do cold bolt". Não é o MESMO componente do Cold Bolt
 * (`vfx/mage/cold-bolt/ColdBoltImpact`, que tem coreografia própria — 5
 * hits em cascata, total separado): é o mesmo VOCABULÁRIO visual (fonte
 * pesada, contorno grosso por `text-shadow` empilhado, glow colorido) — só
 * que aplicado ao popup ÚNICO que `net/NetDamageNumbers` já desenha pra
 * QUALQUER hit/skill do jogo.
 *
 * Regra de cor (prioridade: crítico > skill > básico):
 *  - `.dmg-num--crit`  vermelho, fonte MAIOR (a base já é bold; crítico não
 *    fica só "mais bold", fica maior) + tremida (`dmgNumCrit`).
 *  - `.dmg-num--skill` amarelo/dourado — qualquer dano de skill.
 *  - `.dmg-num--hit`   branco — ataque básico.
 *  - `.dmg-num--warn`  âmbar — mensagem de combate que não é número
 *    ("Miss", "Sem flechas!"). Mesma técnica de contorno/glow, cor própria
 *    de aviso (nem dano nem crítico).
 */
const DAMAGE_NUMBER_STYLE_ID = "damage-number-style";
const DAMAGE_NUMBER_CSS = `
.dmg-num {
  position: relative;
  transform: translate(-50%, 0) scale(0.5);
  font: 800 90px/1 "Segoe UI", system-ui, sans-serif;
  white-space: nowrap;
  opacity: 0;
  text-shadow: 0 2px 0 #000, 0 -2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 1px 1px 0 #000, -1px -1px 0 #000;
  animation: dmgNumRise 900ms ease-out forwards;
  /* só visual — sem isto dava pra arrastar e selecionar o número como texto */
  user-select: none;
  -webkit-user-select: none;
}
.dmg-num--skill {
  color: #ffe27a;
  /* mesmo tamanho do total amarelo do Cold Bolt (vfx/mage/cold-bolt/ColdBoltImpact, .cb-ice-total) */
  font-size: 168px;
  font-weight: 900;
  text-shadow: 0 2px 0 #402a00, 0 -2px 0 #402a00, 2px 0 0 #402a00, -2px 0 0 #402a00, 0 0 12px rgba(255, 200, 60, 0.85);
}
.dmg-num--hit {
  color: #ffffff;
  /* base (90px) + 40% */
  font-size: 126px;
  text-shadow: 0 2px 0 #000, 0 -2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 0 8px rgba(255, 255, 255, 0.5);
}
.dmg-num--crit {
  color: #ff4d4d;
  font-size: 138px;
  font-weight: 900;
  text-shadow: 0 3px 0 #3a0000, 0 -3px 0 #3a0000, 3px 0 0 #3a0000, -3px 0 0 #3a0000, 0 0 16px rgba(255, 60, 60, 0.9);
  animation: dmgNumCrit 900ms ease-out forwards;
}
.dmg-num--warn {
  color: #fbbf24;
  font-size: 48px;
  text-shadow: 0 2px 0 #3a2900, 0 -2px 0 #3a2900, 2px 0 0 #3a2900, -2px 0 0 #3a2900;
}
@keyframes dmgNumRise {
  0% { opacity: 0; transform: translate(-50%, 10px) scale(0.5); }
  15% { opacity: 1; transform: translate(-50%, -4px) scale(1.1); }
  30% { transform: translate(-50%, -10px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -46px) scale(0.96); }
}
/* Crítico: a MESMA subida, mas sai da reta — tremida lateral + leve giro
   que vai se acomodando enquanto sobe, em vez de uma linha reta. */
@keyframes dmgNumCrit {
  0% { opacity: 0; transform: translate(-50%, 10px) scale(0.5) rotate(0deg); }
  15% { opacity: 1; transform: translate(-58%, -6px) scale(1.3) rotate(-9deg); }
  30% { transform: translate(-42%, -14px) scale(1.18) rotate(8deg); }
  45% { transform: translate(-54%, -22px) scale(1.1) rotate(-5deg); }
  60% { transform: translate(-48%, -30px) scale(1.05) rotate(3deg); }
  100% { opacity: 0; transform: translate(-50%, -54px) scale(1) rotate(0deg); }
}
`;

export function useDamageNumberStyles(): void {
  useEffect(() => {
    if (document.getElementById(DAMAGE_NUMBER_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = DAMAGE_NUMBER_STYLE_ID;
    tag.textContent = DAMAGE_NUMBER_CSS;
    document.head.appendChild(tag);
  }, []);
}
