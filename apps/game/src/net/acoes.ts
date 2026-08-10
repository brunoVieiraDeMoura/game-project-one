import { gateway } from "./gateway";
import { useAttackStore } from "./attackStore";
import { usePickupStore } from "./pickupStore";
import { interpolatedCell, useWorldStore } from "./worldStore";
import { dentroDoAlcance, useSkillWalkStore } from "./skillWalkStore";
import { useSkillTargetStore } from "./skillTargetStore";
import { alcanceEfetivoDaSkill } from "./skillCatalog";
import { useAtaqueBasico } from "./ataqueBasico";
import { alcanceDaArma, precisaDeMunicaoSemTer } from "./equipmentStore";
import { useDamageFeed } from "./damageFeed";

/**
 * O que um clique MANDA fazer — num lugar só.
 *
 * Existem dois caminhos até a mesma ordem: clicar em cima do monstro (a hitbox
 * dele recebe o evento) e clicar PERTO dele (a assistência de mira decide, em
 * `play/aimAssist`). Se cada um montasse a sequência por conta própria, os dois
 * divergiriam no primeiro ajuste — e a diferença apareceria como "às vezes ele
 * ataca, às vezes só anda", que é exatamente o tipo de bug que não se reproduz.
 */

/**
 * Ataca um monstro: seleciona, pede a ficha e abre a ordem de aproximação.
 *
 * A ordem nasce aqui, e não só quando o servidor recusa por distância, para que
 * ela sobreviva se o alvo andar depois do primeiro golpe (ver `attackStore`).
 * Quem decide acerto, dano e morte continua sendo o map-server.
 */
export function atacar(gid: number, x: number, y: number): void {
  /**
   * SEM MUNIÇÃO NÃO ANDA — nem seleciona, nem persegue, nem pede nada.
   *
   * O rAthena só descobriria isso no servidor (silencioso, ou via
   * `clif_arrow_fail(ARROWFAIL_NO_AMMO)` só no instante do golpe — que nunca
   * chega, porque o cliente nem entra em alcance sem munição pra atirar). Do
   * lado de cá não faz sentido esperar esse round-trip: o inventário já diz,
   * na hora do clique, se há flecha equipada — perguntar ao servidor só pra
   * descobrir o óbvio faria o personagem correr até o mob pra então ficar
   * plantado sem atacar, que era exatamente o defeito relatado.
   */
  if (precisaDeMunicaoSemTer()) {
    useDamageFeed.getState().push({
      gid: useWorldStore.getState().selfGid,
      value: 0,
      crit: false,
      miss: false,
      onSelf: true,
      text: "Sem flechas!",
    });
    return;
  }

  const agora = performance.now();
  // ordem nova mata a anterior: quem manda bater desistiu de ir lançar a magia.
  // As três (bater, pegar, lançar) duram vários quadros e disputam a MESMA
  // caminhada — deixar duas de pé faria o personagem mudar de destino sozinho.
  useSkillWalkStore.getState().parar();
  useWorldStore.getState().setTarget(gid);
  // o pacote de spawn traz só o nome; HP e nível vêm do ACK_REQNAME
  gateway().emit("entity:info", { gid });
  /**
   * `alcanceDaArma()` já É o alcance de verdade (`playerStore.stats.
   * atkRange`, o `SP_ATTACKRANGE` que o rAthena manda — ver o comentário do
   * campo). Não é mais um palpite corrigido depois: antes deste campo
   * existir, o primeiro clique assumia só o `item_db.range` da arma (sem
   * Vulture's Eye/carta/buff), então um Hunter com passiva chegava a ANDAR
   * até dentro do alcance base antes de `attack:too-far` corrigir no
   * round-trip seguinte — o "vira corpo a corpo por um instante" que não é
   * o comportamento de um arqueiro. `attackStore.perseguir` continua sendo
   * chamado de novo por `attack:too-far` como rede de segurança (mira
   * errada por qualquer outro motivo), mas deixa de ser a ÚNICA fonte.
   */
  useAttackStore.getState().perseguir({ gid, x, y, range: alcanceDaArma() });
  useAttackStore.getState().marcarPedido(agora);
  gateway().emit("action:attack", { gid, continuous: true });
}

/**
 * Vai até o item e pega.
 *
 * `CZ.ITEM_PICKUP` só vale coladinho — o rAthena confere a distância em
 * `pc_takeitem` e recusa em silêncio de longe. Quem anda é o `NetPlayer`.
 */
export function pegar(gid: number, x: number, y: number): void {
  // idem `castarEmAlvo`: pegar item é ordem nova, mata perseguição de ataque
  // (senão o Ataque Básico rearma sozinho ao ver o alvo mudar, ver abaixo)
  useAtaqueBasico.getState().desligar();
  useAttackStore.getState().parar();
  useSkillWalkStore.getState().parar();
  useSkillTargetStore.getState().parar();
  usePickupStore.getState().buscar({ gid, x, y });
}

/**
 * Lança uma skill de ALVO (Bash, Firebolt, Cold Bolt…) num monstro — e anda
 * até o alcance primeiro, se precisar.
 *
 * `CZ.USE_SKILL` sofre a MESMA recusa silenciosa que `action:attack`
 * (`battle_check_range`, battle.cpp:8226): mandar o pedido de longe não fazia
 * nada, porque o rAthena não se aproxima por você. Já dentro do alcance, o
 * pedido sai na hora — a caminhada só entra quando falta.
 */
export function castarEmAlvo(skillId: number, level: number, name: string, gid: number): void {
  const alvo = useWorldStore.getState().entities[gid];
  if (!alvo) return;

  // ordem nova mata as outras três: quem manda castar num alvo desistiu de
  // bater, de pegar item e de lançar noutra célula. O Ataque Básico tem que
  // desligar ANTES do `setTarget`: ele reage a troca de alvo rearmando a
  // perseguição de ataque (`ataqueBasico.ts`), e sem isto castar skill com o
  // alvo mudando (Tab, novo clique) religava o combo corpo-a-corpo por baixo —
  // era o "anda até o monstro morto pra atacar" depois de a skill matar.
  useAtaqueBasico.getState().desligar();
  useAttackStore.getState().parar();
  usePickupStore.getState().parar();
  useSkillWalkStore.getState().parar();
  useWorldStore.getState().setTarget(gid);

  const raio = alcanceEfetivoDaSkill(skillId);
  const cel = interpolatedCell(alvo, performance.now());
  const eu = interpolatedCell(useWorldStore.getState().self, performance.now());

  if (dentroDoAlcance({ x: Math.round(eu.x), y: Math.round(eu.y) }, { x: Math.round(cel.x), y: Math.round(cel.y) }, raio)) {
    gateway().emit("skill:use", { skillId, level, targetGid: gid });
    return;
  }

  useSkillTargetStore.getState().irLancar({ skillId, level, name, gid, raio });
}
