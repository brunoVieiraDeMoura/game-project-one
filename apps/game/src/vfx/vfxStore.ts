import { create } from "zustand";
import { useSkillCatalog } from "../net/skillCatalog";
import { marcarVfxCancel, marcarVfxEnd, marcarVfxStart } from "../core/diagnostics/vfxProbe";
import { resolveMigratedVfxId, resetMigratedVfx, spawnMigratedVfx, stopMigratedVfxByUnit } from "./migratedVfxBridge";
import { clearPendingMultiHitShards } from "./mage/multiHitShardImpact";
import { clearPendingFireLanceHits } from "./mage/fire-lance/fireLanceMultiHit";
import { clearPendingColdBoltHits } from "./mage/cold-bolt/coldBoltMultiHit";
import { clearPendingLightBoltHits } from "./mage/light-bolt/lightBoltMultiHit";
// side effect: registra as `VfxDefinition`/bindings do VFX Core — precisa
// rodar ANTES do primeiro `spawn()` real (mesmo motivo de `skillCatalog`
// já ser importado aqui: este módulo é o ponto de entrada de rede).
import "./skillVfxBindings";

/**
 * Efeitos visuais de skill vindos do servidor.
 *
 * O projeto ainda não tem arte de efeito por skill (o RO original usa .str
 * animados, que não existem aqui). Então o desenho é genérico e derivado do que
 * o pacote diz — área, buff ou impacto — e a identidade visual entra depois,
 * trocando o registro em `skillVfx.ts`. O que NÃO se faz é inventar
 * comportamento: duração, alvo e posição são do rAthena.
 *
 * ## Ponto central da auditoria de performance de VFX (leia1.txt)
 *
 * `spawn`/`prune`/`removeUnit`/`reset` são a ÚNICA porta de entrada e saída
 * do MODELO de um VFX — toda skill do jogo passa por aqui, sem exceção. É
 * por isso que o VFX_START/VFX_END do `core/diagnostics/vfxProbe.ts` mora
 * NESTAS quatro funções, e não espalhado pelos 18 componentes de
 * `vfx/mage/**`: instrumentar aqui cobre toda skill de uma vez, presente e
 * futura, sem precisar lembrar de tocar num arquivo novo cada vez que uma
 * skill nova ganha VFX próprio.
 */

export type VfxKind = "impact" | "buff" | "area" | "cast";

export interface VfxInstance {
  id: number;
  kind: VfxKind;
  skillId: number;
  /** entidade onde o efeito nasce (impacto/buff) */
  gid?: number;
  /** célula do servidor (área/cast no chão) */
  cell?: { x: number; y: number };
  /** ms — quando expira; efeitos de área vivem até o servidor mandar sumir */
  expiresAt: number;
  /** gid da unidade de skill no chão (para casar com o "sumiu") */
  unitGid?: number;
  /**
   * Dano TOTAL da skill — só preenchido quando quem desenha o efeito precisa
   * repartir/mostrar o número por hit em vez do genérico `damageFeed`
   * (ex.: `vfx/mage/cold-bolt/ColdBoltImpact`, 5 estalactites → 5 números). Ausente em todo
   * resto do jogo, que continua passando pelo `damageFeed` de sempre.
   */
  damage?: number;
  crit?: boolean;
  onSelf?: boolean;
  /**
   * Quantidade REAL de hits/projéteis pro nível de quem lançou (Cold Bolt,
   * Fire Lance, Thunder Storm, Soul Strike — `getSkillProjectileCount`,
   * `vfx/mage/multiHitShared`). Ausente = quem desenha usa o próprio
   * default (5, o teto de cada skill).
   */
  hits?: number;
  /** dono da skill (`p.sourceGid` do `skill:cast`) — só as skills que
   * PRECISAM saber de onde o efeito partiu usam isto (ex.: Soul Strike, os
   * projéteis voam do caster até o alvo); Cold Bolt/Fire Lance/Thunder
   * Storm nascem em cima do alvo e nunca leem este campo. */
  sourceGid?: number;
}

interface VfxState {
  effects: VfxInstance[];
  spawn: (effect: Omit<VfxInstance, "id">) => void;
  removeUnit: (unitGid: number) => void;
  prune: (now: number) => void;
  reset: () => void;
}

let nextId = 1;

/** margem generosa acima da latência normal de fetch (API local) — só
 * existe pra desistir de esperar o catálogo quando a API está fora do ar,
 * nunca pra ser o caminho comum (o retry por `subscribe()` resolve bem
 * antes disto em condições normais). */
const VFX_SPAWN_RETRY_TIMEOUT_MS = 2000;

export const useVfxStore = create<VfxState>((set) => ({
  effects: [],

  /**
   * `kind: "buff"` é um status de pé no caster (Oráculo etc.) — no máximo UMA
   * instância viva por (skillId, gid). Sem isto, castar a mesma skill de novo
   * ANTES do buff anterior expirar empilhava um `VfxNode` (`key={effect.id}`
   * novo) por cima do antigo: cada um com seu próprio `useFrame`/`<Html>`, e
   * os dois ficavam rodando juntos até o primeiro expirar sozinho — daí a
   * animação "dobrada" no recast. A instância antiga é removida do array
   * ANTES da nova entrar; como o React desmonta o `VfxNode` de quem some
   * (nenhum listener/timer manual nesses componentes, só `useFrame`/refs,
   * limpos pelo próprio unmount), isto já É o cancelamento+cleanup — a nova
   * instância nasce do zero (novo `id`, `born = performance.now()` do
   * remonte) no lugar de tentar "reiniciar" o componente antigo no lugar.
   * Kinds transitórios (`impact`/`cast`/`area`) ficam de fora de propósito:
   * cada evento deles É um acontecimento distinto (um hit, um `skill:ground`
   * por célula) — várias instâncias simultâneas ali são o comportamento
   * CERTO, não um bug (ex.: dois impactos de Cold Bolt quase juntos).
   */
  spawn: (effect) => {
    /**
     * Ponte pro VFX Core (leia1.txt — padronização Skills/VFX). Skill
     * migrada (Fase 3+, `vfx/skillVfxBindings.ts`) NUNCA entra no array
     * `effects` — `vfx/SkillVfx.tsx` (o dispatcher legado) nunca chega a
     * ver essas skills, e quem desenha é `vfx/core/VfxRoot.tsx`. A
     * instrumentação (`marcarVfxStart`/`marcarVfxEnd`/`marcarVfxPulse`)
     * continua acontecendo — só que de dentro de `vfx/core/manager.ts`
     * (`vfx/core/lifecycle.ts`), não daqui.
     */
    /**
     * Decide UMA VEZ, com o `aegisName` que tiver na mão no instante da
     * chamada — nunca reentra em `spawn()` (evitaria loop: se o catálogo
     * ainda estiver `undefined` no timeout de desistência, reentrar em
     * `spawn()` cairia de novo no bloco de espera abaixo, agendando outro
     * timeout pra sempre em vez de desistir de verdade).
     */
    const commit = (aegisName: string | undefined) => {
      const migratedVfxId = resolveMigratedVfxId(aegisName, effect.kind);
      if (migratedVfxId) {
        spawnMigratedVfx(migratedVfxId, effect);
        return;
      }
      set((s) => {
      const effects =
        effect.kind === "buff"
          ? s.effects.filter((e) => {
              // CANCELADA (recast), não terminou por conta própria — ver
              // docblock de `marcarVfxCancel` no vfxProbe
              const veiaFora = e.kind === "buff" && e.skillId === effect.skillId && e.gid === effect.gid;
              if (veiaFora) marcarVfxCancel(e.id, "recast");
              return !veiaFora;
            })
          : s.effects;
      const id = nextId++;
      const infoCatalogo = useSkillCatalog.getState().byId[effect.skillId];
      marcarVfxStart({
        instanceId: id,
        skillId: effect.skillId,
        skillName: infoCatalogo?.name,
        // nome Aegis (`MG_FIREWALL`) — identificador ESTÁVEL do VFX,
        // disponível no MESMO instante em que `vfx/SkillVfx.tsx` decide
        // qual componente desenhar (mesmo campo do catálogo, mesma
        // fonte). Ausente quando o catálogo ainda não respondeu pra
        // este `skillId` nesta sessão — cai no fallback `skill-<id>`
        // dentro do próprio `vfxProbe` (mesma lacuna honesta de sempre).
        vfxId: infoCatalogo?.aegisName,
        kind: effect.kind,
        expectedDurationMs: Number.isFinite(effect.expiresAt) ? Math.max(0, effect.expiresAt - performance.now()) : null,
        // "cast"/"buff" nascem no CASTER (`effect.gid`); "impact" pousa no
        // ALVO (`effect.gid`) e o caster, quando existe, é `sourceGid`
        // (ver `vfx/SkillVfx.tsx`, mesma leitura que o dispatcher já faz)
        casterGid: effect.kind === "cast" || effect.kind === "buff" ? effect.gid : effect.sourceGid,
        targetGid: effect.kind === "impact" ? effect.gid : undefined,
      });
      return { effects: [...effects, { ...effect, id }] };
      });
    };

    const aegisName = useSkillCatalog.getState().byId[effect.skillId]?.aegisName;
    if (aegisName !== undefined) {
      commit(aegisName);
      return;
    }

    /**
     * Corrida catálogo×primeiro cast (achado real, auditoria "Congelar
     * ainda usa o antigo" 2026-08-18 — NÃO específico de Frost, afeta as
     * 11 skills migradas igualmente): `useSkillCatalog` só sabe o
     * `aegisName` depois de um fetch assíncrono; no PRIMEIRO cast de
     * qualquer `skillId` nunca visto nesta sessão, esse fetch não teve
     * como já ter resolvido (foi disparado no MESMO instante síncrono,
     * em `net/useWorldEvents.ts`). Sem este bloco, `commit(undefined)`
     * rodaria na hora, `resolveMigratedVfxId` voltaria `undefined`, e a
     * instância cairia pro array `effects[]` (o dispatcher LEGADO) DE
     * FORMA PERMANENTE — nada reavalia depois, então mesmo quando o
     * catálogo resolve um instante depois, esta instância específica já
     * nasceu comprometida com o renderer errado. Em dev, reload de
     * página zera o catálogo — testar uma skill logo depois bate nisto
     * SEMPRE, não é race rara.
     *
     * Em vez de comprometer a instância agora, espera o catálogo
     * resolver (retry único) e só ENTÃO chama `commit`; se não resolver a
     * tempo (API fora do ar), desiste depois de `VFX_SPAWN_RETRY_TIMEOUT_MS`
     * e chama `commit(undefined)` — mesmo resultado de hoje (legado), só
     * que como decisão FINAL depois de dar chance real ao catálogo, nunca
     * como primeiro palpite.
     */
    useSkillCatalog.getState().ensure([effect.skillId]);
    let unsubscribe: (() => void) | undefined;
    const timeoutId = setTimeout(() => {
      unsubscribe?.();
      commit(useSkillCatalog.getState().byId[effect.skillId]?.aegisName);
    }, VFX_SPAWN_RETRY_TIMEOUT_MS);
    unsubscribe = useSkillCatalog.subscribe((s) => {
      const resolved = s.byId[effect.skillId]?.aegisName;
      if (resolved === undefined) return;
      clearTimeout(timeoutId);
      unsubscribe?.();
      commit(resolved);
    });
  },

  removeUnit: (unitGid) => {
    // migrada ou não — inofensivo pra quem nunca registrou este `unitGid`
    // (`Map.delete` de uma chave ausente não faz nada, ver `migratedVfxBridge`)
    stopMigratedVfxByUnit(unitGid);
    set((s) => {
      const saem = s.effects.filter((e) => e.unitGid === unitGid);
      for (const e of saem) marcarVfxEnd(e.id);
      return { effects: s.effects.filter((e) => e.unitGid !== unitGid) };
    });
  },

  prune: (now) =>
    set((s) => {
      // Efeito de área não expira sozinho (expiresAt = Infinity): quem manda
      // sumir é o servidor, com ZC.SKILL_DISAPPEAR.
      //
      // Chamado todo quadro (`SkillVfx`, `useFrame`) — `.filter` alocaria um
      // array NOVO 60× por segundo mesmo quando nada expirou (o caso comum:
      // a maioria dos efeitos vive 600ms–4s e o jogo passa a maior parte do
      // tempo sem nenhum vencendo naquele quadro exato). O `.some` abaixo é
      // a MESMA verificação sem alocar — só entra no `.filter` quando existe
      // de fato algo pra tirar.
      if (!s.effects.some((e) => e.expiresAt <= now)) return s;
      const saem = s.effects.filter((e) => e.expiresAt <= now);
      for (const e of saem) marcarVfxEnd(e.id);
      return { effects: s.effects.filter((e) => e.expiresAt > now) };
    }),

  reset: () => {
    resetMigratedVfx();
    clearPendingMultiHitShards();
    clearPendingFireLanceHits();
    clearPendingColdBoltHits();
    clearPendingLightBoltHits();
    set((s) => {
      // CANCELADA (sessão/mapa trocou) — nenhuma dessas instâncias
      // terminou por conta própria, foram derrubadas de fora
      for (const e of s.effects) marcarVfxCancel(e.id, "reset");
      return { effects: [] };
    });
  },
}));

// espelho no console (mesmo espírito do __world/__netEntities): sem isso,
// depurar "o efeito nasceu?" vira olhar pixel na tela
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __vfx?: () => unknown }).__vfx = () =>
    useVfxStore.getState().effects.map((e) => ({
      tipo: e.kind,
      skill: e.skillId,
      gid: e.gid,
      celula: e.cell,
      hits: e.hits,
      sourceGid: e.sourceGid,
    }));
}
