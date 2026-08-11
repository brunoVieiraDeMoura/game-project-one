import { useEffect } from "react";
import { gateway, type EntitySnapshot, type HotkeySlotPayload, type InventoryItemPayload, type SkillPayload } from "./gateway";
import { useSkillBar } from "../hud/skillBarStore";
import { interpolatedCell, useWorldStore } from "./worldStore";
import { useAttackStore } from "./attackStore";
import { useSkillTargetStore } from "./skillTargetStore";
import { useSessionStore } from "./sessionStore";
import { usePlayerStore } from "./playerStore";
import { damageKind, useDamageFeed } from "./damageFeed";
import { useVfxStore } from "../vfx/vfxStore";
import { useProjectileStore, duracaoDoProjetil } from "../vfx/projectileStore";
import { useNpcStore } from "./npcStore";
import { useCastStore } from "./castStore";
import { useGroundItems } from "./GroundItems";
import { useFriendStore } from "./friendStore";
import { useLootStore } from "../hud/lootStore";
import { limparAmeacas, marcarAmeaca } from "./ameacas";
import { limparPulsosDeCombate, marcarAtaque, marcarCastRelease, marcarCastStart } from "./combatAnim";
import { amostrarRelogio, zerarRelogioDoServidor } from "./relogioDoServidor";
import { clearEquipPending, settleStatusWatch, alcanceDaArma } from "./equipmentStore";
import { useCardStore } from "./cardStore";

/**
 * Entidades e movimento vindos do servidor → worldStore.
 *
 * Separado do useGatewayEvents (que cuida de conta/personagem) porque este só
 * interessa dentro do mapa: monta com a cena e limpa ao sair, senão entidade de
 * uma sessão antiga fica pendurada no store.
 */
export function useWorldEvents(): void {
  useEffect(() => {
    const socket = gateway();
    const world = useWorldStore.getState();

    const onSpawn = (e: EntitySnapshot) => {
      world.spawn({
        gid: e.gid,
        kind: e.kind,
        job: e.job,
        name: e.name,
        x: e.x,
        y: e.y,
        dir: e.dir,
        speed: e.speed,
        hp: e.hp,
        maxHp: e.maxHp,
      });
      // Alimenta a aba "Recentes" da janela de amigos. O rAthena não tem lista
      // de "vistos por último" em pacote nenhum — quem lembra é o navegador, e
      // só de gente (mob e NPC não entram).
      if (e.kind === "player" && e.name) useFriendStore.getState().verJogador(e.name, "cena");
    };

    const onMove = (p: {
      gid: number;
      from: { x: number; y: number };
      to: { x: number; y: number };
      speed: number;
      startTime?: number;
    }) => {
      // Todo pacote de movimento é uma amostra do relógio do servidor: são eles
      // que chegam o tempo todo, e é neles que o tick é usado. Ver
      // `net/relogioDoServidor` — a estimativa é por MEDIANA, então uma amostra
      // atrasada não a envenena.
      if (p.startTime) amostrarRelogio(p.startTime, performance.now());
      useWorldStore.getState().move(p.gid, p.from, p.to, p.speed, p.startTime);
    };
    const onStop = (p: { gid: number; x: number; y: number }) =>
      useWorldStore.getState().stop(p.gid, p.x, p.y);
    const onVanish = (p: { gid: number }) => useWorldStore.getState().vanish(p.gid);

    const onAction = (p: {
      gid: number;
      targetGid: number;
      damage: number;
      count: number;
      action: number;
    }) => {
      // action 9 (esquiva) e dano 0 = "Miss". O rAthena decide; aqui só se
      // escolhe a cor e o texto.
      const selfGid = useWorldStore.getState().selfGid;
      /**
       * O personagem batendo é a ÚNICA prova de que o ataque entrou.
       *
       * `action:attack` não tem resposta de sucesso: o servidor bate, recusa por
       * distância, ou engole o pedido no `stepaction`. Ver o golpe é o que
       * permite ao cliente parar de repetir o pedido — e não vê-lo, estando do
       * lado do alvo, é o que dispara a repetição.
       */
      if (p.gid === selfGid) useAttackStore.getState().marcarAtaqueVisto(performance.now());
      // e o contrário: quem bate em VOCÊ vira prioridade da assistência de mira
      // (ver `net/ameacas`) — o mesmo pacote, sem custo nenhum a mais
      else if (p.targetGid === selfGid) marcarAmeaca(p.gid, performance.now());
      // e o golpe é a deixa da animação de ataque de QUEM bateu — próprio
      // personagem ou qualquer outra entidade (ver `net/combatAnim`)
      marcarAtaque(p.gid, performance.now());
      /**
       * Projétil do PRÓPRIO ataque à distância.
       *
       * O rAthena não simula voo de flecha — `ZC_NOTIFY_ACT` já chega com o
       * golpe RESOLVIDO (acerto/erro/dano, tudo decidido). O "projétil
       * viajando" é só o cliente desenhando o intervalo entre o clique e o
       * impacto que já aconteceu — daí nascer aqui, no MESMO pacote que o
       * número de dano, em vez de simular um "tempo de voo" que o servidor
       * não conhece.
       *
       * Só para o PRÓPRIO personagem: é o único de quem se sabe a arma
       * equipada (`equipmentStore.alcanceDaArma`) — mob e outro jogador não
       * têm o inventário sincronizado no cliente. `> 1` é "não é corpo a
       * corpo" (Knife/Rod, sem arma nenhuma: `range` cai no piso 1 do
       * item_db/`status_calc_pc_`, status.cpp:4216).
       */
      if (p.gid === selfGid && alcanceDaArma() > 1) {
        const mundo = useWorldStore.getState();
        const alvo = mundo.entities[p.targetGid];
        if (alvo) {
          const agora = performance.now();
          const de = interpolatedCell(mundo.self, agora);
          const para = interpolatedCell(alvo, agora);
          const dist = Math.hypot(para.x - de.x, para.y - de.y);
          useProjectileStore.getState().spawn({
            fromCell: { x: de.x, y: de.y },
            toCell: { x: para.x, y: para.y },
            startedAt: agora,
            durationMs: duracaoDoProjetil(dist),
          });
        }
      }
      useDamageFeed.getState().push({
        gid: p.targetGid,
        value: p.damage,
        crit: damageKind(p.action).crit,
        miss: p.damage === 0,
        onSelf: p.targetGid === selfGid,
      });
    };
    const onName = (p: { gid: number; name: string }) => useWorldStore.getState().rename(p.gid, p.name);
    const onLevel = (p: { gid: number; level: number }) => useWorldStore.getState().setLevel(p.gid, p.level);
    const onHp = (p: { gid: number; hp: number; maxHp: number }) =>
      useWorldStore.getState().setHp(p.gid, p.hp, p.maxHp);

    const onSelfMove = (p: {
      from: { x: number; y: number };
      to: { x: number; y: number };
      startTime?: number;
    }) => {
      // o pacote do PRÓPRIO personagem também traz o tick (ZC_NOTIFY_PLAYERMOVE)
      if (p.startTime) amostrarRelogio(p.startTime, performance.now());
      useWorldStore.getState().selfMove(p.from, p.to);
    };

    // Teleporte/empurrão: o servidor pôs o personagem noutra célula sem andar.
    // Sem aplicar, o cliente continuava desenhando (e pedindo caminho a partir
    // de) uma célula onde o personagem não estava mais — depois de um @jump ou
    // de um warp de NPC, andar simplesmente parava de funcionar.
    // ZC_STOPMOVE/fixpos e teleporte chegam no MESMO evento; quem separa os dois
    // é a distância até onde o personagem está desenhado (ver `aplicarFixpos`)
    const onSelfWarp = (p: { x: number; y: number }) => useWorldStore.getState().aplicarFixpos(p.x, p.y);

    /**
     * "Longe demais para bater" — o cliente é que anda até lá.
     *
     * O rAthena persegue por conta própria só para MONSTRO (unit.cpp:3259); ao
     * jogador ele manda este pacote e desiste. Sem isso, clicar num monstro fora
     * de alcance não fazia absolutamente nada.
     */
    const onAtaqueLonge = (p: { gid: number; x: number; y: number; euX: number; euY: number; range: number }) =>
      useAttackStore.getState().perseguir(p);

    /**
     * "Sem flechas!" DO SERVIDOR — a correção autoritativa para a corrida que
     * o pré-check local (`equipmentStore.precisaDeMunicaoSemTer`, checado
     * ANTES de emitir `action:attack`) não cobre: a ÚLTIMA flecha pode ter
     * sido consumida por um golpe anterior ainda em voo quando o clique
     * seguinte já tinha passado no pré-check. `parar()` encerra a ordem —
     * sem isso `perseguirAlvo` (`NetPlayer.tsx`) reinsistiria a cada
     * `REENVIO_ATAQUE_MS`, batendo na mesma recusa pra sempre.
     */
    const onSemMunicao = () => {
      useAttackStore.getState().parar();
      useDamageFeed.getState().push({
        gid: useWorldStore.getState().selfGid,
        value: 0,
        crit: false,
        miss: false,
        onSelf: true,
        text: "Sem flechas!",
      });
    };

    // o alvo morreu ou saiu de vista: não há mais quem perseguir nem em quem castar
    const onVanishAlvo = (p: { gid: number }) => {
      if (useAttackStore.getState().alvo?.gid === p.gid) useAttackStore.getState().parar();
      if (useSkillTargetStore.getState().pendente?.gid === p.gid) useSkillTargetStore.getState().parar();
    };

    const onStat = (p: { name: string; value: number; bonus?: number }) => {
      usePlayerStore.getState().applyStat(p.name, p.value, p.bonus);
      // `speed` do rAthena é ms POR CÉLULA (150 = padrão a pé, menor = mais
      // rápido). É ele que dita a duração de cada passo na cena — sem aplicar,
      // o personagem andava sempre no valor default enquanto o servidor já
      // tinha mudado (montaria, buff de agilidade, penalidade de peso).
      if (p.name === "speed") useWorldStore.getState().setSelfSpeed(p.value);
    };
    const onStatus = (p: Record<string, number>) => usePlayerStore.getState().applyStatus(p);
    const onInvList = (p: InventoryItemPayload[]) => usePlayerStore.getState().setInventory(p);
    const onInvAdd = (p: InventoryItemPayload) => {
      usePlayerStore.getState().addItem(p);
      // e o aviso no alto da tela: sem ele, pegar coisa do chão não tinha
      // retorno nenhum — só abrindo o Alt+E dava para saber o que entrou
      useLootStore.getState().registrar(p.itemId, p.amount, performance.now());
    };
    const onInvRemove = (p: { index: number; amount: number }) =>
      usePlayerStore.getState().removeItem(p.index, p.amount);
    const onEquipResult = (p: { index: number; success: boolean; equipped: boolean; location: number }) => {
      // O pedido pode destravar mesmo em falha (senão o slot ficaria preso
      // pra sempre); o indicador de status e a ATUALIZAÇÃO do item só fazem
      // sentido quando algo realmente mudou.
      //
      // BUG achado em teste real de browser (Fase 4): o gateway já atualizava
      // o PRÓPRIO snapshot (`this.inventory` em session.ts) no ACK, mas nunca
      // mandava isso de volta pro `playerStore` — só um evento fino
      // {index,success,equipped,location}. O item ficava com `equipped`
      // errado na tela até o próximo re-sync completo (`world:ready`), porque
      // nada escrevia esses dois campos de volta no item certo.
      clearEquipPending(p.index);
      if (p.success) {
        usePlayerStore.getState().updateItemEquip(p.index, p.equipped, p.location);
        settleStatusWatch();
      }
    };

    const onCardOptions = (p: { cardIndex: number; equipIndexes: number[] }) =>
      useCardStore.getState().aplicarOpcoes(p.cardIndex, p.equipIndexes);
    const onCardResult = (p: { equipIndex: number; cardIndex: number; success: boolean; cards: number[] }) => {
      if (p.success) usePlayerStore.getState().updateItemCards(p.equipIndex, p.cards);
      useCardStore.getState().aplicarResultado(p);
    };

    const onSkills = (p: SkillPayload[]) => usePlayerStore.getState().setSkills(p);
    const onHotkeys = (p: HotkeySlotPayload[]) => useSkillBar.getState().hydrateFromServer(p);

    // VFX: 600ms é a duração dos efeitos pontuais (impacto/buff); área vive
    // até o servidor mandar sumir.
    const EFFECT_MS = 600;
    const onSkillCast = (p: {
      skillId: number;
      sourceGid: number;
      targetGid: number;
      kind: string;
      damage: number;
      action: number;
    }) => {
      // a skill SAIU: a barra de conjuração do HUD não tem mais o que contar
      if (p.sourceGid === useWorldStore.getState().selfGid) useCastStore.getState().parar();
      // e é a deixa da animação de LIBERAÇÃO — o tiro/gesto final da magia
      marcarCastRelease(p.sourceGid, performance.now());
      useVfxStore.getState().spawn({
        kind: p.kind === "buff" ? "buff" : "impact",
        skillId: p.skillId,
        gid: p.kind === "buff" ? p.sourceGid : p.targetGid,
        expiresAt: performance.now() + EFFECT_MS,
      });
      /**
       * O número de dano da skill, MESMA fonte que o ataque básico
       * (`onAction` acima) — sem isto só o flash de impacto aparecia e o
       * jogador não via QUANTO a magia bateu. `kind === "target"` é a mesma
       * distinção que o `USESKILL_ACK` já fazia lá no gateway: "buff" nunca
       * tem dano de verdade (é sempre 0), e mostrar "Miss" para uma cura seria
       * mentir.
       */
      if (p.kind === "target") {
        const selfGid = useWorldStore.getState().selfGid;
        useDamageFeed.getState().push({
          gid: p.targetGid,
          value: p.damage,
          crit: damageKind(p.action).crit,
          miss: p.damage === 0,
          onSelf: p.targetGid === selfGid,
        });
      }
    };

    const onSkillCasting = (p: { skillId: number; sourceGid: number; x: number; y: number; durationMs: number }) => {
      // barra de conjuração é só do PRÓPRIO personagem; a dos outros já vira
      // efeito na cena
      if (p.sourceGid === useWorldStore.getState().selfGid) {
        useCastStore.getState().comecar(p.skillId, p.durationMs || 0);
      }
      // a animação de conjuração vale para QUALQUER caster, não só o próprio
      // personagem — é ela que faz o gesto de "carregando a magia" na cena
      marcarCastStart(p.sourceGid, performance.now(), p.durationMs || 0);
      useVfxStore.getState().spawn({
        kind: "cast",
        skillId: p.skillId,
        // conjuração no chão tem célula; em alvo, segue quem conjura
        ...(p.x || p.y ? { cell: { x: p.x, y: p.y } } : { gid: p.sourceGid }),
        expiresAt: performance.now() + Math.max(300, p.durationMs || 0),
      });
    };

    const onSkillGround = (p: { gid: number; x: number; y: number; skillId?: number }) =>
      useVfxStore.getState().spawn({
        kind: "area",
        skillId: p.skillId ?? 0,
        cell: { x: p.x, y: p.y },
        unitGid: p.gid,
        // área não expira sozinha: quem tira é o ZC.SKILL_DISAPPEAR
        expiresAt: Number.POSITIVE_INFINITY,
      });

    const onSkillGroundGone = (p: { gid: number }) => useVfxStore.getState().removeUnit(p.gid);

    const onGroundItem = (p: {
      gid: number;
      itemId: number;
      amount: number;
      x: number;
      y: number;
      subX: number;
      subY: number;
    }) => useGroundItems.getState().put(p);
    const onGroundItemGone = (p: { gid: number }) => useGroundItems.getState().remove(p.gid);

    const onNpcDialog = (p: { gid: number; kind: string; text?: string; options?: string[] }) => {
      const npc = useNpcStore.getState();
      if (p.kind === "text") npc.say(p.gid, p.text ?? "");
      else if (p.kind === "next") npc.awaitNext(p.gid);
      else if (p.kind === "menu") npc.showMenu(p.gid, p.options ?? []);
      else npc.close();
    };

    socket.on("skill:list", onSkills);
    socket.on("hotkey:list", onHotkeys);
    socket.on("skill:cast", onSkillCast);
    socket.on("skill:casting", onSkillCasting);
    socket.on("skill:ground", onSkillGround);
    socket.on("skill:ground-gone", onSkillGroundGone);
    socket.on("npc:dialog", onNpcDialog);
    socket.on("ground:item", onGroundItem);
    socket.on("ground:item-gone", onGroundItemGone);
    socket.on("self:move", onSelfMove);
    socket.on("self:warp", onSelfWarp);
    socket.on("attack:too-far", onAtaqueLonge);
    socket.on("attack:no-ammo", onSemMunicao);
    socket.on("entity:vanish", onVanishAlvo);
    socket.on("self:stat", onStat);
    socket.on("self:status", onStatus);
    socket.on("inv:list", onInvList);
    socket.on("inv:add", onInvAdd);
    socket.on("inv:remove", onInvRemove);
    socket.on("item:equip-result", onEquipResult);
    socket.on("card:options", onCardOptions);
    socket.on("card:result", onCardResult);
    socket.on("entity:spawn", onSpawn);
    socket.on("entity:move", onMove);
    socket.on("entity:stop", onStop);
    socket.on("entity:vanish", onVanish);
    socket.on("entity:action", onAction);
    socket.on("entity:name", onName);
    socket.on("entity:level", onLevel);
    socket.on("entity:hp", onHp);

    // A cena montou: pede de novo o estado (o gateway guarda o último que
    // chegou e reenvia). O `world:ready` em si já foi mandado quando a sessão
    // entrou no mapa — ver net/useGatewayEvents.
    const enter = useSessionStore.getState().world;
    // Dentro do mapa o jogador é identificado pelo ACCOUNT id, não pelo char id
    // (no rAthena o block_list de um PC usa o account id). O `gid` do
    // world:enter é o char id, que só serve no handshake com o char-server —
    // usar ele aqui faria o próprio dano nunca ser reconhecido como "meu".
    useWorldStore.getState().setSelfGid(useSessionStore.getState().accountId);
    if (enter) {
      useWorldStore.getState().setSelfCell(enter.x, enter.y);
    }
    socket.emit("world:ready");

    return () => {
      socket.off("skill:list", onSkills);
      socket.off("hotkey:list", onHotkeys);
      socket.off("skill:cast", onSkillCast);
      socket.off("skill:casting", onSkillCasting);
      socket.off("skill:ground", onSkillGround);
      socket.off("skill:ground-gone", onSkillGroundGone);
      socket.off("npc:dialog", onNpcDialog);
      socket.off("ground:item", onGroundItem);
      socket.off("ground:item-gone", onGroundItemGone);
      socket.off("self:move", onSelfMove);
      socket.off("self:warp", onSelfWarp);
      socket.off("attack:too-far", onAtaqueLonge);
      socket.off("attack:no-ammo", onSemMunicao);
      socket.off("entity:vanish", onVanishAlvo);
      socket.off("self:stat", onStat);
      socket.off("self:status", onStatus);
      socket.off("inv:list", onInvList);
      socket.off("inv:add", onInvAdd);
      socket.off("inv:remove", onInvRemove);
      socket.off("item:equip-result", onEquipResult);
      socket.off("card:options", onCardOptions);
      socket.off("card:result", onCardResult);
      socket.off("entity:spawn", onSpawn);
      socket.off("entity:move", onMove);
      socket.off("entity:stop", onStop);
      socket.off("entity:vanish", onVanish);
      socket.off("entity:action", onAction);
      socket.off("entity:name", onName);
      socket.off("entity:level", onLevel);
      socket.off("entity:hp", onHp);
      // Só o que é da CENA some aqui. A ficha do personagem (playerStore)
      // pertence à SESSÃO e é limpa em useGatewayEvents, no fim dela: o
      // StrictMode monta/desmonta este efeito no dev, e resetar aqui apagava
      // nível/zeny/classe — que vêm uma vez só, no world:enter.
      useWorldStore.getState().clear();
      // o desvio estimado vale para ESTE map-server: reconectar (ou trocar de
      // servidor) começa outra contagem de `gettick()`, e uma estimativa velha
      // ancoraria todo trecho num instante inventado
      zerarRelogioDoServidor();
      useDamageFeed.getState().reset();
      useVfxStore.getState().reset();
      useProjectileStore.getState().reset();
      useNpcStore.getState().close();
      useGroundItems.getState().clear();
      // o gid é RECICLADO pelo servidor: guardar "quem me bateu" entre mapas
      // faria um gid velho apontar para outra criatura
      limparAmeacas();
      limparPulsosDeCombate();
    };
  }, []);
}
