import { gateway } from "./gateway";
import { useAttackStore } from "./attackStore";
import { usePickupStore } from "./pickupStore";
import { interpolatedCell, useWorldStore } from "./worldStore";
import { dentroDoAlcance, useSkillWalkStore } from "./skillWalkStore";
import { useSkillTargetStore } from "./skillTargetStore";
import { alcanceDaSkill } from "./skillCatalog";

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
  const agora = performance.now();
  // ordem nova mata a anterior: quem manda bater desistiu de ir lançar a magia.
  // As três (bater, pegar, lançar) duram vários quadros e disputam a MESMA
  // caminhada — deixar duas de pé faria o personagem mudar de destino sozinho.
  useSkillWalkStore.getState().parar();
  useWorldStore.getState().setTarget(gid);
  // o pacote de spawn traz só o nome; HP e nível vêm do ACK_REQNAME
  gateway().emit("entity:info", { gid });
  useAttackStore.getState().perseguir({ gid, x, y, range: 1 });
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
  useSkillWalkStore.getState().parar();
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
  // bater, de pegar item e de lançar noutra célula
  useAttackStore.getState().parar();
  usePickupStore.getState().parar();
  useSkillWalkStore.getState().parar();
  useWorldStore.getState().setTarget(gid);

  const raio = alcanceDaSkill(skillId);
  const cel = interpolatedCell(alvo, performance.now());
  const eu = interpolatedCell(useWorldStore.getState().self, performance.now());

  if (dentroDoAlcance({ x: Math.round(eu.x), y: Math.round(eu.y) }, { x: Math.round(cel.x), y: Math.round(cel.y) }, raio)) {
    gateway().emit("skill:use", { skillId, level, targetGid: gid });
    return;
  }

  useSkillTargetStore.getState().irLancar({ skillId, level, name, gid, raio });
}
