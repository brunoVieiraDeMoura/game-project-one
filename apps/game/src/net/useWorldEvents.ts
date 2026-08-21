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
import { useEntityCastStore } from "./entityCastStore";
import { useGroundItems } from "./GroundItems";
import { useFriendStore } from "./friendStore";
import { useLootStore } from "../hud/lootStore";
import { limparAmeacas, marcarAmeaca } from "./ameacas";
import { limparPulsosDeCombate, marcarAtaque, marcarCastRelease, marcarCastStart } from "./combatAnim";
import { vozDeAtaque, vozDeConjuracao, vozDeDano } from "../audio/combatVoice";
import { efeitoDeAtaqueBasico, efeitoDeSkill } from "../audio/combatWeapon";
import { aoComecarCastMultiHit, aoConcluirCastDeChao, aoLiberarCastMultiHit } from "../audio/mage/multiHitCastAudio";
import {
  aoComecarCastProjetil,
  aoLiberarCastProjetil,
  aoImpactoProjetilAtrasado,
  aoAparecerAreaDeChao,
  aoPararAreaDeChao,
  aoIniciarBuffComDuracao,
  aoConfirmarPetrificar,
} from "../audio/mage/otherSkillsAudio";
import { OPT1_STONEWAIT } from "./entityOption";
import { aoAparecerItemNoChao, aoGanharItem, registrarMorteDeMonstro } from "../audio/itemSfx";
import { pegandoItem } from "./pickupStore";
import { amostrarRelogio, zerarRelogioDoServidor } from "./relogioDoServidor";
import { clearEquipPending, settleStatusWatch, alcanceDaArma } from "./equipmentStore";
import { useCardStore } from "./cardStore";
import { useSkillCatalog } from "./skillCatalog";
import { useItemCatalog } from "./itemCatalog";
import { useMonsterCatalog } from "./monsterCatalog";
import {
  useStatusStore,
  SELF_TRACKED_BUFF_SKILLS,
  BODY_STATE_LOCKING_VALUES,
  bodyStateEfstId,
  HEALTH_STATE_LOCKING_BITS,
  healthStateEfstId,
} from "./statusStore";
import { MULTI_HIT_DURATION_MS, MULTI_HIT_SHARD_VFX } from "../vfx/mage/multiHitRegistry";
import { spawnMultiHitShards, shardColorForElement } from "../vfx/mage/multiHitShardImpact";
import { spawnFireLanceHits } from "../vfx/mage/fire-lance/fireLanceMultiHit";
import { fireLanceQualityTier } from "../vfx/mage/fire-lance/fireLanceRenderMode";
import { spawnColdBoltHits } from "../vfx/mage/cold-bolt/coldBoltMultiHit";
import { coldBoltQualityTier } from "../vfx/mage/cold-bolt/coldBoltRenderMode";
import { spawnLightBoltHits } from "../vfx/mage/light-bolt/lightBoltMultiHit";
import { lightBoltQualityTier } from "../vfx/mage/light-bolt/lightBoltRenderMode";
import { spawnSoulStrikeHits } from "../vfx/mage/soul-strike/soulStrikeMultiHit";
import { soulStrikeQualityTier } from "../vfx/mage/soul-strike/soulStrikeRenderMode";
import { IMPACT_VFX_DURATION_MS, BUFF_VFX_AEGIS } from "../vfx/mage/vfxDurationOverrides";
import { getSkillProjectileCount } from "../vfx/mage/multiHitShared";
import { classifyHit } from "../vfx/core/hitVfxResolver";
import { spawnCombatHitVfx, spawnCombatHitImpacts } from "../vfx/combat/combatHitVfx";
import { spawnGhostDomeBlock } from "../vfx/mage/ghost-dome/ghostDomeBlockReaction";

/** EFST_POSTDELAY — `tools/legacy-migration/output/efst.json:48` ("46":
 * "EFST_POSTDELAY"), tabela testada (âncoras do enum C real). Ver uso em
 * `onStatusStart` abaixo. */
const EFST_POSTDELAY = 46;

/** constante do rAthena p/ Cold Bolt — mesma usada em `vfx/SkillVfx` pra
 * escolher o visual das 5 estalactites em vez do flash genérico */
const AEGIS_COLD_BOLT = "MG_COLDBOLT";

/**
 * `__testarColdBolt(gid, dano, nivel)` / `__testarFireLance(...)` /
 * `__testarThunderStorm(...)` / `__testarSoulStrike(...)` no console —
 * visualizar o efeito sem precisar lançar a skill de verdade contra um
 * monstro (leia1.txt, "testando pra ver se fica bom"). `gid` tem que ser
 * uma entidade JÁ no `worldStore` (`__world()` lista as vivas) — o VFX se
 * posiciona por `gid`, igual a um impacto de verdade. `nivel` (1-10, default
 * 10) testa a regra de quantidade por nível (`getSkillProjectileCount`) sem
 * precisar subir a skill de verdade. Mesmo espírito do `__vfx`/`__dano`/
 * `__skillsReset`.
 */
function testarSkillMultiHit(aegis: string, gid: number, dano: number, nivel: number): void {
  const skillId = Object.values(useSkillCatalog.getState().byId).find((s) => s.aegisName === aegis)?.id ?? 14;
  useSkillCatalog.getState().ensure([skillId]);
  const hits = getSkillProjectileCount(nivel);
  useVfxStore.getState().spawn({
    kind: "impact",
    skillId,
    gid,
    // sourceGid = o PRÓPRIO personagem: só a Soul Strike lê este campo (pra
    // saber de onde as almas partem), as outras três ignoram
    sourceGid: useWorldStore.getState().selfGid,
    expiresAt: performance.now() + (MULTI_HIT_DURATION_MS[aegis]?.(hits) ?? 3000) + 100,
    damage: dano,
    crit: false,
    onSelf: false,
    hits,
  });
}

/**
 * `__testarFireBall(gid, dano)` / `__testarFrostDiver(gid, dano)` no
 * console — auditoria "origem do DOM real /play" (2026-08-19): as duas
 * únicas skills desta lista de 7 sem helper de teste ainda (não são
 * multi-hit, então `testarSkillMultiHit` não serve — número vai pelo
 * `damageFeed` genérico, não por cascata própria). Mesmo espírito dos 5
 * helpers acima: `kind:"impact"` direto no `vfxStore`, sem depender de
 * rede/gateway.
 */
function testarSkillHitUnico(aegis: string, gid: number, dano: number): void {
  const skillId = Object.values(useSkillCatalog.getState().byId).find((s) => s.aegisName === aegis)?.id ?? 17;
  useSkillCatalog.getState().ensure([skillId]);
  useVfxStore.getState().spawn({
    kind: "impact",
    skillId,
    gid,
    sourceGid: useWorldStore.getState().selfGid,
    expiresAt: performance.now() + 4000,
  });
  useDamageFeed.getState().push({ gid, value: dano, crit: false, miss: false, onSelf: false, skill: true });
}

/**
 * TEMP DEBUG (investigação "Ghost Dome não aparece") — `window.__debugGhostDome()`
 * no console. Spawna uma unidade de área DE VERDADE (mesmo `vfxStore.spawn`
 * que `onSkillGround` chama pra um `skill:ground` real) na célula do
 * PRÓPRIO jogador — passa pelo MESMO `SkillVfx.tsx` → `AREA_VFX` →
 * `GhostDomeCell` que o Safety Wall real usa, sem depender de rede/gateway
 * nenhum. Se isto aparecer na tela, o VFX em si está OK e o problema é
 * upstream (evento nunca chega). Se isto NÃO aparecer, o problema é no
 * próprio componente/render.
 */
function debugGhostDome(): void {
  const skillId = Object.values(useSkillCatalog.getState().byId).find((s) => s.aegisName === "MG_SAFETYWALL")?.id ?? 12;
  useSkillCatalog.getState().ensure([skillId]);
  const self = useWorldStore.getState().self;
  const cell = { x: Math.round(self.x), y: Math.round(self.y) };
  const unitGid = -Math.floor(Math.random() * 1_000_000) - 1; // negativo: nunca colide com gid real do servidor
  useVfxStore.getState().spawn({
    kind: "area",
    skillId,
    cell,
    unitGid,
    expiresAt: Number.POSITIVE_INFINITY,
  });
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  const w = window as unknown as {
    __testarColdBolt?: (gid: number, dano?: number, nivel?: number) => void;
    __testarFireLance?: (gid: number, dano?: number, nivel?: number) => void;
    __testarThunderStorm?: (gid: number, dano?: number, nivel?: number) => void;
    __testarLightBolt?: (gid: number, dano?: number, nivel?: number) => void;
    __testarSoulStrike?: (gid: number, dano?: number, nivel?: number) => void;
    __testarFireBall?: (gid: number, dano?: number) => void;
    __testarFrostDiver?: (gid: number, dano?: number) => void;
    __debugGhostDome?: () => void;
  };
  w.__testarColdBolt = (gid, dano = 5000, nivel = 10) => testarSkillMultiHit(AEGIS_COLD_BOLT, gid, dano, nivel);
  w.__testarFireLance = (gid, dano = 5000, nivel = 10) => testarSkillMultiHit("MG_FIREBOLT", gid, dano, nivel);
  w.__testarThunderStorm = (gid, dano = 5000, nivel = 10) => testarSkillMultiHit("MG_THUNDERSTORM", gid, dano, nivel);
  w.__testarLightBolt = (gid, dano = 5000, nivel = 10) => testarSkillMultiHit("MG_LIGHTNINGBOLT", gid, dano, nivel);
  w.__testarSoulStrike = (gid, dano = 5000, nivel = 10) => testarSkillMultiHit("MG_SOULSTRIKE", gid, dano, nivel);
  w.__testarFireBall = (gid, dano = 5000) => testarSkillHitUnico("MG_FIREBALL", gid, dano);
  w.__testarFrostDiver = (gid, dano = 5000) => testarSkillHitUnico("MG_FROSTDIVER", gid, dano);
  w.__debugGhostDome = debugGhostDome;
}

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
      // Pré-carrega o catálogo da ESPÉCIE (nome/nível/elemento/raça/tamanho),
      // não só do gid individual: a primeira instância de cada mobId visto
      // no mapa já busca por todos — mirar outro mob da mesma espécie depois
      // (Poring → Lunatic → Poring) reaproveita, `ensure` é idempotente.
      if (e.kind === "mob") useMonsterCatalog.getState().ensure([e.job]);
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
    const onVanish = (p: { gid: number; reason: number }) => {
      /**
       * `reason === 1` é `CLR_DEAD` (`rathena/src/map/clif.hpp: enum clr_type`)
       * — morte de verdade, não saída de vista/teleporte/logout. Captura
       * ANTES de `vanish()` apagar a entidade: é a única chance de saber o
       * `job` (mobId) e a célula onde ele morreu, que é o dado que
       * `audio/itemSfx` usa pra correlacionar um drop raro ao monstro que o
       * gerou (ver o comentário lá — não existe um id de origem no pacote de
       * drop em si).
       */
      const CLR_DEAD = 1;
      if (p.reason === CLR_DEAD) {
        const entidade = useWorldStore.getState().entities[p.gid];
        if (entidade && entidade.kind === "mob") {
          registrarMorteDeMonstro(entidade.job, entidade.x, entidade.y);
        }
      }
      useWorldStore.getState().vanish(p.gid);
      // entidade saiu do alcance de visão/morreu: os efeitos dela também não
      // fazem mais sentido retidos (se ela voltar a aparecer, `status:start`/
      // `MSG_STATE_CHANGE5` reenvia o que ainda estiver ativo)
      useStatusStore.getState().clearGid(p.gid);
      // idem pro cast em andamento — sem isto um `gid` reciclado nasceria
      // com a barra de skill do mob ANTERIOR "castando" alguma coisa
      useEntityCastStore.getState().clearGid(p.gid);
    };

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
      // MESMO byte real que `onSkillCast` usa (`e_damage_type`) — calculado
      // uma vez, reusado pelo áudio/número/VFX abaixo (auditoria "Combat
      // Hit VFX genérico" 2026-08-19).
      const crit = damageKind(p.action).crit;
      /**
       * O personagem batendo é a ÚNICA prova de que o ataque entrou.
       *
       * `action:attack` não tem resposta de sucesso: o servidor bate, recusa por
       * distância, ou engole o pedido no `stepaction`. Ver o golpe é o que
       * permite ao cliente parar de repetir o pedido — e não vê-lo, estando do
       * lado do alvo, é o que dispara a repetição.
       */
      if (p.gid === selfGid) {
        useAttackStore.getState().marcarAtaqueVisto(performance.now());
        /**
         * Áudio de combate (`audio/combatVoice`/`combatWeapon`, uma entrada
         * por classe — Espadachim e Arqueiro hoje) — MESMO evento que já
         * prova "foi o meu ataque", nenhum listener novo.
         *
         * Mesmo guard de `NetPlayer` pro pulso de ataque atrasado (ver
         * `pickupStore.pegandoItem`): um `action:attack` já em voo no
         * servidor (`stepaction`) pode resolver DEPOIS de `buscarItem` já ter
         * mandado `item:pickup` — sem o guard, pegar item no meio de um
         * combate tocava a voz/som de ataque (inclusive "erro"/miss, se o
         * golpe atrasado deu `damage === 0`) por cima do som de coleta.
         */
        if (!pegandoItem(performance.now())) {
          vozDeAtaque();
          efeitoDeAtaqueBasico(p.damage, crit);
        }
      }
      // e o contrário: quem bate em VOCÊ vira prioridade da assistência de mira
      // (ver `net/ameacas`) — o mesmo pacote, sem custo nenhum a mais
      else if (p.targetGid === selfGid) {
        marcarAmeaca(p.gid, performance.now());
        // dano de VERDADE, não esquiva/erro contra você (`damage === 0` não é
        // "levar dano" — é o oponente errando)
        if (p.damage > 0) vozDeDano();
      }
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
        crit,
        miss: p.damage === 0,
        onSelf: p.targetGid === selfGid,
        skill: false,
      });
      /**
       * Combat Hit VFX genérico (auditoria "fechar Normal/Single/Critical",
       * 2026-08-19) — NORMAL/SINGLE_HIT/CRITICAL/MULTI_HIT/MULTI_HIT_
       * CRITICAL do ataque básico, via `hitVfxResolver.classifyHit` (MESMO
       * `count`/`action` reais que decidem áudio/número acima, nunca um
       * segundo cálculo). Ataque básico NÃO tem `skillId`/elemento — cor
       * cai no neutro (`shardColorForElement(undefined)`), nunca inventado.
       * Gate igual ao resto: só em hit de verdade (`p.damage>0`), "Miss"
       * continua só o texto de sempre.
       */
      if (p.damage > 0) {
        const classification = classifyHit(p.count, 1, crit);
        const color = shardColorForElement(undefined);
        if (classification.multiplicity === "single") {
          spawnCombatHitVfx({ targetGid: p.targetGid, color, critical: crit });
        } else {
          spawnCombatHitImpacts({ targetGid: p.targetGid, hits: classification.hits, color, critical: crit });
        }
      }
    };
    const onName = (p: { gid: number; name: string }) => useWorldStore.getState().rename(p.gid, p.name);
    const onLevel = (p: { gid: number; level: number }) => useWorldStore.getState().setLevel(p.gid, p.level);
    const onHp = (p: { gid: number; hp: number; maxHp: number }) =>
      useWorldStore.getState().setHp(p.gid, p.hp, p.maxHp);
    const onOption = (p: { gid: number; opt1: number; opt2: number }) => {
      // `opt1` — enum de posição ÚNICA (petrificado/congelado/atordoado/
      // dormindo/…), 100% autoritativo do servidor; só espelha aqui, sem
      // inventar duração (`ZC_STATE_CHANGE` não carrega nenhuma). Limpa os
      // pseudo-ids de body-state antes de aplicar o novo — só um por vez é
      // possível, então trocar de estado (ex.: petrificando → petrificado)
      // precisa apagar o antigo primeiro.
      //
      // Petrificar (`aoConfirmarPetrificar`, `audio/mage/otherSkillsAudio`)
      // é CONDICIONAL — o alvo pode salvar contra o status (mesmo docblock
      // de `worldStore.ts: NetEntity.opt1`: "nunca assumir petrificação só
      // porque um ataque acertou") — por isso o som de confirmação só toca
      // na TRANSIÇÃO de verdade pra `OPT1_STONEWAIT`, lida ANTES de
      // `setOption` sobrescrever o valor anterior; um reenvio do MESMO
      // `opt1` (ex. outro pacote de estado chegando por outro motivo) nunca
      // dispara o som de novo.
      const opt1Anterior = useWorldStore.getState().entities[p.gid]?.opt1;
      useWorldStore.getState().setOption(p.gid, p.opt1);
      if (p.opt1 === OPT1_STONEWAIT && opt1Anterior !== OPT1_STONEWAIT) {
        aoConfirmarPetrificar();
      }

      for (const v of BODY_STATE_LOCKING_VALUES) useStatusStore.getState().end(p.gid, bodyStateEfstId(v));
      // `(BODY_STATE_LOCKING_VALUES as readonly number[]).includes`, não
      // `!== OPT1_NONE`: `OPT1_BURNING` fica de fora da lista de propósito
      // (já tem EFST_BURNT de verdade, ver `statusStore.ts`) — usar só o
      // "não é NONE" criaria o pseudo-ícone duplicado mesmo assim.
      if ((BODY_STATE_LOCKING_VALUES as readonly number[]).includes(p.opt1)) {
        useStatusStore.getState().start(p.gid, {
          efstId: bodyStateEfstId(p.opt1),
          totalMs: 0,
          remainMs: 0,
          val1: 0,
          val2: 0,
          val3: 0,
        });
      }

      // `opt2`/healthState — BITMASK, diferente de `opt1`: vários bits
      // simultâneos, então cada bit é ligado/desligado INDEPENDENTE dos
      // outros (nunca "apaga tudo e reaplica um só", que é a regra do
      // `opt1` acima). O pacote manda o bitmask CHEIO a cada mudança
      // (`clif_changeoption_target`: `p.healthState = sc->opt2` sempre,
      // não um diff) — comparar bit a bit contra o valor novo é seguro e
      // idempotente mesmo chamando de novo com o mesmo estado.
      for (const bit of HEALTH_STATE_LOCKING_BITS) {
        const ligado = (p.opt2 & bit) !== 0;
        const pseudoId = healthStateEfstId(bit);
        if (ligado) {
          useStatusStore.getState().start(p.gid, {
            efstId: pseudoId,
            totalMs: 0,
            remainMs: 0,
            val1: 0,
            val2: 0,
            val3: 0,
          });
        } else {
          useStatusStore.getState().end(p.gid, pseudoId);
        }
      }
    };
    const onStatusStart = (p: {
      gid: number;
      efstId: number;
      totalMs: number;
      remainMs: number;
      val1: number;
      val2: number;
      val3: number;
    }) => {
      // EFST_POSTDELAY (id 46, confirmado em `tools/legacy-migration/output/
      // efst.json:48`) NUNCA é debuff de alvo — rastreamento completo
      // (auditoria "#46 na barra" 2026-08-14): todo call-site de
      // `clif_status_change(..., EFST_POSTDELAY, ...)` em `rathena/src/map/
      // {battle,skill}.cpp` e `skills/mage/release.cpp` manda pra `src`
      // (quem agiu), nunca pra um alvo — é "você não pode agir de novo
      // ainda" (`ud->canact_tick`), o mesmo conceito que o cooldown ring do
      // `SkillBar.tsx` já mostra, só que via um pacote técnico separado. E
      // não tem `Status:` nenhum em `status.yml` mapeado pra ele — não passa
      // pelo sistema SC_*, então NUNCA vai ter nome/ícone no catálogo (o 404
      // de `/statuses/by-efst?ids=46` é awaited, não bug de API
      // desatualizada). Por isso filtra AQUI, na fronteira gateway→client,
      // antes de entrar no `statusStore` — nunca chega a virar ícone, nunca
      // gasta request de catálogo.
      if (p.efstId === EFST_POSTDELAY) return;
      useStatusStore.getState().start(p.gid, p);
    };
    const onStatusEnd = (p: { gid: number; efstId: number }) => useStatusStore.getState().end(p.gid, p.efstId);

    // Duração real de opt1/opt2 sem EFST (pacote customizado, auditoria
    // "contador de duração" 2026-08-14) — resolve pro MESMO pseudo-id que
    // `onOption` já usa (`bodyStateEfstId`/`healthStateEfstId`), pra
    // `statusStore.setDuration` correlacionar com a entrada certa
    // independente de qual dos dois pacotes chegou primeiro.
    const onStatusDuration = (p: { gid: number; bodyState: number; healthState: number; durationMs: number }) => {
      // 0 = "nenhum" nos dois campos (mesma convenção de OPT1_NONE/OPT2_NONE) —
      // bodyState tem prioridade porque nenhum dos 10 status suportados seta os dois.
      const efstId = p.bodyState !== 0 ? bodyStateEfstId(p.bodyState) : p.healthState !== 0 ? healthStateEfstId(p.healthState) : undefined;
      if (efstId === undefined) return;
      useStatusStore.getState().setDuration(p.gid, efstId, p.durationMs, p.durationMs);
    };

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
    const onSelfWarp = (p: { x: number; y: number; teleporte?: boolean }) =>
      useWorldStore.getState().aplicarFixpos(p.x, p.y, p.teleporte);

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
    const onInvList = (p: InventoryItemPayload[]) => {
      usePlayerStore.getState().setInventory(p);
      // Pré-carrega o catálogo de nomes/metadados ASSIM QUE a lista chega do
      // rAthena — não quando o Alt+E (ou o Alt+Q, que lê o mesmo catálogo para
      // os equipados) monta pela primeira vez. `ensure` já deduplica contra o
      // que estiver pendente/conhecido, então este pedido e o que o
      // InventoryWindow/StatusWindow ainda disparam no próprio `useEffect`
      // não batem duas vezes na API — o segundo só confirma que já tem tudo.
      useItemCatalog.getState().ensure(p.map((it) => it.itemId));
    };
    const onInvAdd = (p: InventoryItemPayload) => {
      usePlayerStore.getState().addItem(p);
      // e o aviso no alto da tela: sem ele, pegar coisa do chão não tinha
      // retorno nenhum — só abrindo o Alt+E dava para saber o que entrou
      useLootStore.getState().registrar(p.itemId, p.amount, performance.now());
      // SFX de coleta — só toca se houver um `item:pickup` recente pendente
      // (ver `audio/itemSfx.aoGanharItem`); outra origem de `inv:add` não
      // acende o pedido, então não soa.
      aoGanharItem();
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

    const onSkills = (p: SkillPayload[]) => {
      usePlayerStore.getState().setSkills(p);
      // Mesma ideia do `onInvList`: pré-carrega o skill_db (nome, tipo de
      // alvo, custo/alcance/recarga por nível) assim que o ZC.SKILLINFO_LIST
      // chega, para o Alt+S e a SkillBar acharem o catálogo já quente. `niveis`
      // vai junto para os campos `perLevel` resolverem no nível que o
      // personagem TEM, não no 1 — sem isto o primeiro `ensure` a chegar
      // (este) travaria o catálogo no nível 1 para sempre, e o que o
      // `SkillsWindow` pede depois (com o nível certo) não reconsultaria a API,
      // porque `ensure` só busca o que falta.
      const niveis: Record<number, number> = {};
      for (const sk of p) niveis[sk.id] = sk.level;
      useSkillCatalog.getState().ensure(p.map((sk) => sk.id), niveis);
    };
    const onHotkeys = (p: HotkeySlotPayload[]) => useSkillBar.getState().hydrateFromServer(p);

    // VFX: 600ms é a duração dos efeitos pontuais (impacto/buff); área vive
    // até o servidor mandar sumir.
    const EFFECT_MS = 600;
    const onSkillCast = (p: {
      skillId: number;
      level: number;
      sourceGid: number;
      targetGid: number;
      kind: string;
      damage: number;
      action: number;
      count: number;
    }) => {
      // a skill SAIU: a barra de conjuração do HUD não tem mais o que contar
      const souEu = p.sourceGid === useWorldStore.getState().selfGid;
      if (souEu) {
        useCastStore.getState().parar();
        // áudio de combate (Espadachim) — só a PRÓPRIA skill do jogador, nunca
        // a de outro personagem por perto; `p.kind` é o mesmo campo que
        // decide buff×dano duas linhas abaixo, não uma segunda classificação
        efeitoDeSkill(p.kind === "buff" ? "buff" : "target", p.skillId);
        // grito de conjuração (Mago) — QUALQUER skill, não só as com efeito
        // de arma configurado; ver `audio/combatVoice.vozDeConjuracao`.
        // EXCETO skill de alvo no CHÃO (`target === "ground"`, ex. Thunder
        // Storm): pra essas, este `skill:cast` é o pacote de ACERTO
        // (rathena: default de `skill_attack`, mesmo `clif_skill_damage`/
        // 0x114 de Cold Bolt/Fire Bolt), que pode chegar MAIS DE UMA VEZ por
        // conjuração (um por alvo atingido) — a voz já tocou UMA vez no
        // `onSkillGroundCast` (a liberação de verdade); tocar de novo aqui
        // duplicaria o grito por acerto.
        const skillTarget = useSkillCatalog.getState().byId[p.skillId]?.target;
        if (skillTarget !== "ground") vozDeConjuracao();
      }
      /**
       * Cold Bolt/Fire Bolt: liberação + impacto 500ms depois. Thunder Storm
       * (chão): este PRÓPRIO evento já É a confirmação de acerto — toca na
       * hora, uma vez por conjuração mesmo com N acertos. Ver
       * `audio/mage/multiHitCastAudio`.
       *
       * Chamada FORA do `if (souEu)` de propósito — achado em teste real
       * (leia1.txt, log do navegador): pra skill de CHÃO (Thunder Storm), o
       * `skill:cast` de ACERTO chega com `sourceGid` que NÃO bate com
       * `selfGid` mesmo sendo a PRÓPRIA conjuração do jogador (rAthena:
       * `clif_skill_damage(*dsrc, ...)` no `default:` de `skill_attack`
       * reporta um `dsrc` diferente do caster pra esse tipo de dispatch —
       * confirmado com um cast real, `sourceGid=8270` vs `selfGid` do
       * personagem). Cold Bolt/Fire Bolt não têm esse problema (`sourceGid`
       * sempre bate, testado). `aoLiberarCastMultiHit` recebe `souEu` e usa
       * ele só no branch de ALVO (onde é confiável); o branch de CHÃO ignora
       * `souEu` e confia na liberação pendente — essa sim só é armada pelo
       * NOSSO `skill:ground-cast`, que É corretamente self-gated (confirmado
       * no mesmo teste: `skill:ground-cast` chegou com `sourceGid === selfGid`).
       */
      aoLiberarCastMultiHit(p.skillId, souEu);
      // Fire Ball/Frost Diver/Stone Curse: mesma liberação de loop, grupo
      // próprio (`audio/mage/otherSkillsAudio`); o impacto delas é atrasado
      // pro instante em que o VFX explode, nunca na liberação — QUALQUER
      // caster, mesmo motivo do multi-hit acima.
      aoLiberarCastProjetil(p.skillId, souEu);
      aoImpactoProjetilAtrasado(p.skillId);
      // e é a deixa da animação de LIBERAÇÃO — o tiro/gesto final da magia
      marcarCastRelease(p.sourceGid, performance.now());
      // idem pra UI (barra de skill do MOB na `TargetFrame`) — mesmo `gid`,
      // preocupação diferente da animação 3D (ver `net/entityCastStore.ts`)
      useEntityCastStore.getState().release(p.sourceGid);
      // aquece o catálogo pro `aegisName` abaixo — na primeira vez que
      // QUALQUER personagem lança uma skill nunca vista, este cast ainda
      // cai no flash genérico (fetch é assíncrono); o próximo já acerta
      useSkillCatalog.getState().ensure([p.skillId]);
      // Cold Bolt/Fire Lance/Thunder Storm precisam da sequência inteira no
      // ar (5 hits escalonados, ver `vfx/mage/multiHitRegistry`) — o
      // `EFFECT_MS` genérico do flash pontual (600ms) poda o último hit
      // antes dele cair.
      //
      // Gate primário É o `hitType` REAL do servidor (`skill_db.yml: Hit:
      // Multi_Hit`, migrado até `net/skillCatalog.ts` — auditoria multi-hit
      // 2026-08-17): "esta skill é do tipo Multi Hit?" deixa de ser uma
      // lista de nomes Aegis adivinhada e passa a ser dado real. Segundo
      // gate (`multiHitDurationFn`) sobrevive como "temos uma PALETA de
      // timing visual registrada pra ela" — uma skill nova que o servidor
      // marcar Multi_Hit mas ainda sem paleta cai pro número genérico
      // (`damageFeed`) em vez de quebrar.
      const skillInfo = useSkillCatalog.getState().byId[p.skillId];
      const aegis = skillInfo?.aegisName;
      const multiHitDurationFn = aegis !== undefined ? MULTI_HIT_DURATION_MS[aegis] : undefined;
      const isMultiHit = p.kind !== "buff" && skillInfo?.hitType === "multi_hit" && multiHitDurationFn !== undefined;
      // Fire Ball (1 hit só, fora da cascata multi-hit) ainda precisa de mais
      // tempo que o flash de 600ms — bola viajando até o alvo antes de
      // explodir. Ver `vfx/mage/vfxDurationOverrides`.
      const impactOverrideMs = !isMultiHit && p.kind !== "buff" && aegis !== undefined ? IMPACT_VFX_DURATION_MS[aegis] : undefined;
      // Oráculo/Sight: VFX próprio precisa ficar de pé pela duração REAL do
      // buff, não o flash genérico — mesmo `durationMs` que o rAthena aplicou.
      const isCustomBuffVfx = p.kind === "buff" && aegis !== undefined && BUFF_VFX_AEGIS.has(aegis);
      const buffDurationMs = isCustomBuffVfx ? useSkillCatalog.getState().byId[p.skillId]?.durationMs || EFFECT_MS : EFFECT_MS;
      // Oráculo/Sight: loop de duration próprio, SÓ o buff do PRÓPRIO
      // personagem (`souEu`) — mesma duração real que já anima o VFX acima,
      // nunca um número novo. Ver `audio/mage/otherSkillsAudio` grupo 3.
      if (souEu && isCustomBuffVfx) {
        aoIniciarBuffComDuracao(p.skillId, buffDurationMs);
      }
      /**
       * Crítico — MESMO byte real (`action`/`e_damage_type`) que
       * `onAction` já usa; movido pra antes de `hits` porque a
       * classificação abaixo precisa das duas dimensões juntas (auditoria
       * "Hit VFX genérico" 2026-08-19: crítico é dimensão SEPARADA de
       * multiplicidade, nunca fundida). Achado desta auditoria (evidência
       * em `battle.cpp`, ver `vfx/core/hitVfxResolver.ts` docblock): pras
       * 5 skills mágicas multi-hit atuais isto é SEMPRE `false` na prática
       * — `ad.type` (dano mágico) nunca é escrito com `DMG_CRITICAL`,
       * magia não crita nesta regra. Representável no modelo mesmo assim
       * (nunca barrado em código), só inalcançável hoje sem uma skill
       * física multi-hit implementada.
       */
      const crit = damageKind(p.action).crit;
      /**
       * Quantidade REAL de hits + multiplicidade — `classifyHit` (`vfx/
       * core/hitVfxResolver.ts`) formaliza o que já era verdade desde a
       * auditoria "count real" (2026-08-19): `p.count` é o `dmg.div_` de
       * VERDADE do rAthena (`skill.cpp:3020`/`skill_get_num(skill_id,
       * level)`), não uma aproximação por nível. Fallback
       * (`getSkillProjectileCount(p.level)`) só entra se `count` vier
       * ausente/inválido — nunca em operação normal. `hits` nunca é
       * capado aqui (isso é responsabilidade de quem renderiza, ver
       * `multiHitShardImpact.ts: VISUAL_SHARD_CAP`).
       */
      const hits = classifyHit(p.count, p.level, crit).hits;
      const selfGid = useWorldStore.getState().selfGid;
      const onSelf = p.targetGid === selfGid;
      // Barra de buff/debuff pra self-buff SEM sinal de status do servidor
      // (Oráculo/Sight — `net/statusStore.SELF_TRACKED_BUFF_SKILLS`, "skills
      // ativáveis sem contador na barra" 2026-08-14): a confirmação de cast
      // (`p.kind === "buff"`, mesmo evento que já dispara o VFX próprio
      // acima) É o sinal autoritativo de que o buff começou; a duração vem
      // do skill_db (`durationMs`, dado real, nunca chutado) — só o
      // instante-fim é calculado no cliente, porque não existe outro jeito
      // de saber. `-p.skillId` nunca colide com um id EFST real (sempre >=0).
      //
      // QUALQUER caster, não só o próprio personagem ("auditoria
      // skills/monstros" 2026-08-14: mob usando a mesma skill NELE MESMO
      // precisa aparecer na barra de buff dele na `TargetFrame`) —
      // `castouEmSiMesmo` é DELIBERADAMENTE outra variável que `onSelf`:
      // `onSelf` continua significando "acertou o MEU personagem" (usado
      // logo abaixo pro `damageFeed`/cor do número), enquanto isto aqui é
      // "o caster mirou nele mesmo", verdadeiro pra um mob se buffando.
      const castouEmSiMesmo = p.targetGid === p.sourceGid;
      if (p.kind === "buff" && castouEmSiMesmo && aegis !== undefined && SELF_TRACKED_BUFF_SKILLS.has(aegis)) {
        const durationMs = useSkillCatalog.getState().byId[p.skillId]?.durationMs ?? 0;
        if (durationMs > 0) {
          useStatusStore.getState().start(p.sourceGid, {
            efstId: -p.skillId,
            totalMs: durationMs,
            remainMs: durationMs,
            val1: 0,
            val2: 0,
            val3: 0,
            selfExpire: true,
          });
        }
      }
      /**
       * O número de dano da skill, MESMA fonte que o ataque básico
       * (`onAction` acima) — sem isto só o flash de impacto aparecia e o
       * jogador não via QUANTO a magia bateu. `kind === "target"` é a mesma
       * distinção que o `USESKILL_ACK` já fazia lá no gateway: "buff" nunca
       * tem dano de verdade (é sempre 0), e mostrar "Miss" para uma cura seria
       * mentir.
       *
       * Cold Bolt NÃO passa pelo `damageFeed` (o número branco/vermelho
       * flutuante de sempre) — o total vai DENTRO do próprio efeito
       * (`damage`/`crit`/`onSelf` no `spawn` abaixo) e é `ColdBoltImpact`
       * quem desenha os 5 números, um por estalactite, no MESMO instante
       * (`onHit`) em que ela decide que aquela estalactite chegou. Nenhum
       * timer novo: é o mesmo `life >= ICICLE_IMPACT_FRACTION` que já
       * disparava o flash de impacto antes desta troca.
       */
      useVfxStore.getState().spawn({
        kind: p.kind === "buff" ? "buff" : "impact",
        skillId: p.skillId,
        gid: p.kind === "buff" ? p.sourceGid : p.targetGid,
        expiresAt:
          performance.now() +
          (isMultiHit
            ? (multiHitDurationFn?.(hits) ?? 0) + 100
            : p.kind === "buff"
              ? buffDurationMs
              : (impactOverrideMs ?? EFFECT_MS)),
        // `sourceGid` só importa pra quem lê (Soul Strike e Fire Ball, os
        // projéteis partem do caster) — sem custo pras outras, que ignoram
        // o campo. `crit`/`onSelf` agora vão pra QUALQUER impacto de alvo
        // (universal — é o que `migratedVfxBridge.toSpawnOptions` usa pra
        // resolver `scale` via `criticalScaleFor`, auditoria "Hit VFX
        // genérico" 2026-08-19); `damage`/`hits` continuam só pra quem
        // desenha o PRÓPRIO número (família multi-hit com cascata própria).
        ...(p.kind === "target" ? { sourceGid: p.sourceGid, crit, onSelf } : {}),
        ...(isMultiHit && p.kind === "target" ? { damage: p.damage, hits } : {}),
      });
      /**
       * Reconstrução visual Fire Lance/Cold Bolt (2026-08-19) — "um
       * fragmento por hit real", desacoplada do efeito acima (que só
       * carrega os NÚMEROS agora, ver `coldBoltVfxDefGpu.tsx`/
       * `fireLanceVfxDefGpu.tsx`). `hits` é o MESMO valor real já usado
       * pra tudo o resto nesta função — o VFX nunca decide quantos
       * fragmentos caem, só o `hits` que já vinha do nível da skill.
       * Gate igual ao do número genérico logo abaixo (`p.damage > 0`,
       * `p.kind==="target"`): erro (Miss) não gera fragmento nenhum, só
       * o "Miss" de sempre.
       */
      const shardVfx = isMultiHit && aegis !== undefined ? MULTI_HIT_SHARD_VFX[aegis] : undefined;
      if (shardVfx && p.kind === "target" && p.damage > 0) {
        // cor do elemento REAL da skill (`skill_db.yml: Element:`), nunca
        // uma tabela "cor por Aegis" — `crit` é o MESMO flag que já decide
        // a cor do número (auditoria "Generic Hit VFX" 2026-08-19).
        spawnMultiHitShards({
          targetGid: p.targetGid,
          hits,
          staggerMs: shardVfx.staggerMs,
          color: shardColorForElement(skillInfo?.element),
          critical: crit,
        });
      }
      /**
       * Fire Lance (reconstrução 2026-08-19-b) — SAIU do fragmento
       * genérico acima (removida de `MULTI_HIT_SHARD_VFX`), tem driver
       * PRÓPRIO agora (`fire-lance/fireLanceMultiHit.ts:
       * spawnFireLanceHits`) — mesmo gate (`p.kind==="target"`,
       * `p.damage>0`) e mesmo `hits` real, só a composição visual (losango
       * grande+stretch+trail+burst dedicado, 3 tiers) e o timing de queda
       * (`FIRE_LANCE_FALL_MS`) são próprios da skill.
       */
      if (isMultiHit && aegis === "MG_FIREBOLT" && p.kind === "target" && p.damage > 0) {
        spawnFireLanceHits({ targetGid: p.targetGid, hits, critical: crit, tier: fireLanceQualityTier() });
      }
      /**
       * Cold Bolt (reconstrução 2026-08-19-d) — MESMO tratamento de Fire
       * Lance: saiu do fragmento genérico, driver PRÓPRIO
       * (`cold-bolt/coldBoltMultiHit.ts: spawnColdBoltHits`).
       */
      if (isMultiHit && aegis === "MG_COLDBOLT" && p.kind === "target" && p.damage > 0) {
        spawnColdBoltHits({ targetGid: p.targetGid, hits, critical: crit, tier: coldBoltQualityTier() });
      }
      /**
       * Eletrocutar/Light Bolt (reconstrução 2026-08-19-f) — MESMO
       * tratamento: driver PRÓPRIO (`light-bolt/lightBoltMultiHit.ts:
       * spawnLightBoltHits`), nunca teve fragmento genérico (a composição
       * antiga era `beam` de pé, própria desde sempre — só o driver por
       * hit é novo).
       */
      if (isMultiHit && aegis === "MG_LIGHTNINGBOLT" && p.kind === "target" && p.damage > 0) {
        spawnLightBoltHits({ targetGid: p.targetGid, hits, critical: crit, tier: lightBoltQualityTier() });
      }
      /**
       * Tempestade de Raios/Thunder Storm (2026-08-19-t: "faz o mesmo
       * efeito pra Tempestade de Raios, ela é AoE mas é basicamente a
       * mesma habilidade") — MESMO driver de Eletrocutar
       * (`spawnLightBoltHits`), nenhum novo. Correto porque o servidor já
       * entrega a AoE como N eventos de alvo independentes (este bloco
       * roda uma vez POR MOB atingido), cada um com seu próprio `hits`
       * (pulsos) — exatamente a forma que Eletrocutar já consome com 1
       * alvo só. `thunderStormVfxDefGpu.tsx: THUNDER_STORM_IMPACT_GPU_DEF`
       * ficou só com os NÚMEROS (`dom`), o raio real vem daqui.
       */
      if (isMultiHit && aegis === "MG_THUNDERSTORM" && p.kind === "target" && p.damage > 0) {
        spawnLightBoltHits({ targetGid: p.targetGid, hits, critical: crit, tier: lightBoltQualityTier() });
      }
      /**
       * Esferas Espirituais/Soul Strike (reconstrução 2026-08-19-z) —
       * driver PRÓPRIO (`soul-strike/soulStrikeMultiHit.ts:
       * spawnSoulStrikeHits`), MESMO padrão das outras 4. Única diferença
       * de assinatura: passa `sourceGid` também — a esfera VOA do caster
       * até o alvo (`anchor:"caster-to-target"`, precisa da ponta do
       * cajado), diferente das outras 4 que nascem em cima do alvo.
       */
      if (isMultiHit && aegis === "MG_SOULSTRIKE" && p.kind === "target" && p.damage > 0) {
        spawnSoulStrikeHits({ sourceGid: p.sourceGid, targetGid: p.targetGid, hits, critical: crit, tier: soulStrikeQualityTier() });
      }
      // Miss (`damage === 0`) continua pelo `damageFeed` de sempre MESMO
      // nessas skills — `*Impact` só desenha número pra dano > 0
      // (`splitDamage` não faz sentido pra "errou"), então sem isto um hit
      // que erra ficava mudo: caindo sem "Miss" nenhum.
      if (p.kind === "target" && (!isMultiHit || p.damage === 0)) {
        useDamageFeed.getState().push({
          gid: p.targetGid,
          value: p.damage,
          crit,
          miss: p.damage === 0,
          onSelf,
          skill: true,
        });
      }
    };

    const onSkillCasting = (p: {
      skillId: number;
      sourceGid: number;
      targetGid: number;
      x: number;
      y: number;
      durationMs: number;
    }) => {
      // barra de conjuração é só do PRÓPRIO personagem; a dos outros já vira
      // efeito na cena
      if (p.sourceGid === useWorldStore.getState().selfGid) {
        // 0 = skill de chão/AOE (unit_skilluse_pos no servidor não tem
        // entidade nenhuma); `NetPlayer` só gira o personagem para o alvo
        // quando este campo existe
        useCastStore.getState().comecar(p.skillId, p.durationMs || 0, p.targetGid > 0 ? p.targetGid : undefined);
        // Cold Bolt/Fire Lance/Thunder Storm: som de "carregando a magia",
        // ver `audio/mage/multiHitCastAudio`
        aoComecarCastMultiHit(p.skillId);
        // Fire Ball/Frost Diver/Stone Curse: mesmo loop de "carregando",
        // grupo próprio — ver `audio/mage/otherSkillsAudio`. `durationMs`
        // real arma o teto de segurança do loop (Stone Curse: `skill:cast`
        // nunca chega quando o alvo resiste, ver docblock lá).
        aoComecarCastProjetil(p.skillId, p.durationMs || 0);
      }
      // a animação de conjuração vale para QUALQUER caster, não só o próprio
      // personagem — é ela que faz o gesto de "carregando a magia" na cena
      marcarCastStart(p.sourceGid, performance.now(), p.durationMs || 0);
      // idem pra UI (barra de skill do MOB na `TargetFrame`, "auditoria
      // skills/monstros" 2026-08-14) — QUALQUER caster, não só o próprio
      // personagem (que já tem `useCastStore.comecar` acima, sua barra
      // PRÓPRIA); `net/entityCastStore.ts` explica por que é um store
      // separado do pulso de animação (`net/combatAnim.ts`).
      useEntityCastStore.getState().start(p.sourceGid, p.skillId, p.durationMs || 0);
      useVfxStore.getState().spawn({
        kind: "cast",
        skillId: p.skillId,
        // conjuração no chão tem célula; em alvo, segue quem conjura
        ...(p.x || p.y ? { cell: { x: p.x, y: p.y } } : { gid: p.sourceGid }),
        expiresAt: performance.now() + Math.max(300, p.durationMs || 0),
      });
    };

    /**
     * Skill de alvo no CHÃO (`skill:ground-cast`, ZC.NOTIFY_GROUNDSKILL)
     * terminou de conjurar — achado auditando por que Thunder Storm nunca
     * soltava áudio/voz de liberação (leia1.txt): skill de alvo (Cold
     * Bolt/Fire Bolt) sempre confirma via `skill:cast` porque sempre há um
     * `targetGid`; skill de CHÃO (Thunder Storm) pode cair em célula vazia
     * sem acertar ninguém, e aí nenhum `skill:cast` sai — este é o único
     * sinal garantido de "terminou" pra esse tipo. Sem dano/alvo conhecido
     * (é célula, não entidade): só o que a liberação em si já cobre —
     * mesmo escopo de `onSkillCast`, sem inventar VFX/dano que o pacote não
     * carrega.
     *
     * QUANDO acerta alguém, o som de impacto sai pelo `onSkillCast` normal
     * logo abaixo — Thunder Storm usa o MESMO `skill:cast` que Cold Bolt/Fire
     * Bolt (confirmado em `rathena/src/map/skill.cpp`: sem case próprio, cai
     * no `default:` que chama `clif_skill_damage`/ZC.NOTIFY_SKILL, 0x114) —
     * não existe um pacote de "acerto de chão" separado
     * (`ZC_NOTIFY_SKILL_POSITION`/0x115 é código morto neste rAthena, nunca
     * chamado por `clif_skill_damage2`). Este handler só para o loop e ARMA
     * a espera; quem decide tocar `hit` é `aoLiberarCastMultiHit`.
     */
    const onSkillGroundCast = (p: { skillId: number; sourceGid: number; x: number; y: number }) => {
      if (p.sourceGid !== useWorldStore.getState().selfGid) return;
      useCastStore.getState().parar();
      vozDeConjuracao();
      aoConcluirCastDeChao(p.skillId);
    };

    const onSkillGround = (p: { gid: number; x: number; y: number; skillId: number }) => {
      useVfxStore.getState().spawn({
        kind: "area",
        skillId: p.skillId,
        cell: { x: p.x, y: p.y },
        unitGid: p.gid,
        // área não expira sozinha: quem tira é o ZC.SKILL_DISAPPEAR
        expiresAt: Number.POSITIVE_INFINITY,
      });
      // Fire Wall/Ghost Dome: whoosh de ignição + loop de duration (se
      // houver) — a área nasceu de verdade no mundo agora, mesmo instante do
      // VFX acima. Ver `audio/mage/otherSkillsAudio` grupo 2.
      aoAparecerAreaDeChao(p.skillId);
    };

    /**
     * Cúpula Fantasma/Safety Wall bloqueou um ataque de VERDADE — sinal
     * AUTORITATIVO do servidor (`ghost-dome-block`, `rathena-patches/0001`:
     * `battle_calc_weapon_attack()` decrementa a carga e notifica ANTES do
     * hit/miss ser decidido, então HIT e MISS disparam este evento igual —
     * `wasHit` só ajusta o tamanho do VFX). Única fonte do VFX de bloqueio —
     * não existe mais heurística "miss + célula" no client.
     */
    const onGhostDomeBlock = (p: { sourceGid: number; targetGid: number; remainingHits: number; wasHit: boolean }) => {
      spawnGhostDomeBlock(p);
    };

    const onSkillGroundGone = (p: { gid: number }) => {
      // precisa do `skillId` da área que está sumindo pra parar o loop de
      // duration certo (`skill:ground-gone` só manda o `gid` da unidade de
      // chão) — busca no próprio efeito ANTES de `removeUnit` apagá-lo.
      const skillId = useVfxStore.getState().effects.find((e) => e.unitGid === p.gid)?.skillId;
      if (skillId !== undefined) aoPararAreaDeChao(skillId);
      useVfxStore.getState().removeUnit(p.gid);
    };

    const onGroundItem = (p: {
      gid: number;
      itemId: number;
      amount: number;
      x: number;
      y: number;
      subX: number;
      subY: number;
      mobId?: number;
      freshDrop?: boolean;
    }) => {
      useGroundItems.getState().put(p);
      // drop raro — correlação com a morte de monstro mais próxima (ver
      // `audio/itemSfx.aoAparecerItemNoChao`); sem morte por perto, não toca
      aoAparecerItemNoChao(p.itemId, p.x, p.y);
    };
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
    socket.on("skill:ground-cast", onSkillGroundCast);
    socket.on("skill:ground", onSkillGround);
    socket.on("skill:ground-gone", onSkillGroundGone);
    socket.on("ghost-dome-block", onGhostDomeBlock);
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
    socket.on("entity:option", onOption);
    socket.on("entity:status-duration", onStatusDuration);
    socket.on("status:start", onStatusStart);
    socket.on("status:end", onStatusEnd);

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
    // ESTE ponto (montagem deste efeito, listeners já assinados) é o real
    // "a cena renderizou" - `world:ready` acima é reenvio de cache, o
    // primeiro já foi mandado por useGatewayEvents no instante em que a
    // sessão entra no mapa, bem antes da cena 3D existir. `world:render-ready`
    // é o sinal que o rAthena de verdade usa pra trocar a proteção-teto de
    // carregamento de agro pela contagem real de 10s (mob_aggro_immune_time
    // - ver RoSession.notifyRenderReady no gateway).
    socket.emit("world:render-ready");

    return () => {
      socket.off("skill:list", onSkills);
      socket.off("hotkey:list", onHotkeys);
      socket.off("skill:cast", onSkillCast);
      socket.off("skill:casting", onSkillCasting);
      socket.off("skill:ground-cast", onSkillGroundCast);
      socket.off("skill:ground", onSkillGround);
      socket.off("skill:ground-gone", onSkillGroundGone);
      socket.off("ghost-dome-block", onGhostDomeBlock);
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
      socket.off("entity:option", onOption);
      socket.off("entity:status-duration", onStatusDuration);
      socket.off("status:start", onStatusStart);
      socket.off("status:end", onStatusEnd);
      // Só o que é da CENA some aqui. A ficha do personagem (playerStore)
      // pertence à SESSÃO e é limpa em useGatewayEvents, no fim dela: o
      // StrictMode monta/desmonta este efeito no dev, e resetar aqui apagava
      // nível/zeny/classe — que vêm uma vez só, no world:enter.
      useWorldStore.getState().clear();
      useStatusStore.getState().clearAll();
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
