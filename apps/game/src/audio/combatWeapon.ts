import { usePlayerStore } from "../net/playerStore";
import { equippedBySlot } from "../net/equipmentStore";
import { useItemCatalog } from "../net/itemCatalog";
import { isArcherClass, isSwordmanClass } from "../entities/classModels";
import { playOneShot } from "./oneShotPool";

/**
 * Efeitos de ARMA/skill, POR CLASSE — irmão de `audio/combatVoice`, mesmo
 * desenho de registro (uma entrada autocontida por classe em `CLASSES`),
 * mesmo pool de áudio (`oneShotPool`). Chamado pelos MESMOS eventos reais
 * (`net/useWorldEvents`: `entity:action` pro ataque básico, `skill:cast` pra
 * skill), nunca por render/timer.
 */
interface EfeitosDeClasse {
  souDaClasse: (jobId: number | undefined | null) => boolean;
  /** som de acerto normal — recebe o `ItemSubType` da arma equipada (a
   * classe decide se usa isso ou ignora, ex.: Arqueiro só tem arco) */
  acerto: (subtipoDaArma: string | undefined) => string | undefined;
  /** ausente = sem asset de crítico neste lote — um golpe crítico cai no
   * `acerto` normal em vez de inventar um som */
  critico?: string;
  erro: string;
  /** ausente = sem asset de buff — `efeitoDeSkill("buff", ...)` não toca nada */
  buff?: string;
  /** ausente = sem asset de skill de dano — idem, `efeitoDeSkill("target", ...)` não toca nada */
  skillDeDano?: (skillId: number) => string;
}

/**
 * Placeholder até existir asset POR skill (pedido explícito: "não criar ainda
 * um sistema específico por ID de skill"). O ponto de troca futuro é só
 * ESTA função — quando os assets `skill_<id>` existirem, ela vira um
 * `Record<number, string>`/fallback aqui dentro; nada fora dela muda.
 */
function faixaDaSkillDeDanoDoEspadachim(_skillId: number): string {
  return "/assets/audio/combat/swordman/weapon/skill-aoe-1.mp3";
}

const CLASSES: EfeitosDeClasse[] = [
  {
    souDaClasse: isSwordmanClass,
    acerto: (subtipo) => {
      if (subtipo === "2h_sword") return "/assets/audio/combat/swordman/weapon/basic-attack-two-hand-sword.mp3";
      if (subtipo === "1h_sword") return "/assets/audio/combat/swordman/weapon/basic-attack-one-hand-sword.mp3";
      return undefined; // arma desconhecida/não-espada: sem som de arma, só a voz
    },
    critico: "/assets/audio/combat/swordman/weapon/critical-hit.mp3",
    erro: "/assets/audio/combat/swordman/weapon/miss.mp3",
    buff: "/assets/audio/combat/swordman/weapon/buff-damage-1.mp3",
    skillDeDano: faixaDaSkillDeDanoDoEspadachim,
  },
  {
    souDaClasse: isArcherClass,
    // Arqueiro só empunha arco (`classModels.CLASS_MODEL.archer`), então o
    // acerto normal não depende de subtipo — um som só, sempre.
    acerto: () => "/assets/audio/combat/archer/weapon/basic-attack-bow.mp3",
    // sem `critico`/`buff`/`skillDeDano`: o lote de assets do Arqueiro só
    // trouxe acerto normal + erro — nenhum som tocado nesses casos, em vez
    // de reaproveitar o do Espadachim.
    erro: "/assets/audio/combat/archer/weapon/miss.mp3",
  },
];

function classeAtual(): EfeitosDeClasse | undefined {
  const jobId = usePlayerStore.getState().stats.class;
  return CLASSES.find((c) => c.souDaClasse(jobId));
}

/**
 * Subtipo da arma equipada agora — `ItemSubType` do catálogo
 * (`packages/game-data`, já migrado do `item_db`: `"1h_sword"`/`"2h_sword"`),
 * NUNCA um segundo palpite. `undefined` quando não há arma, ou quando o
 * catálogo ainda não respondeu (`ensure` pede pro próximo golpe já saber —
 * ver `net/itemCatalog`).
 */
function subtipoDaArmaEquipada(): string | undefined {
  const arma = equippedBySlot(usePlayerStore.getState().inventory).weapon;
  if (!arma) return undefined;
  const info = useItemCatalog.getState().byId[arma.itemId];
  if (!info) {
    useItemCatalog.getState().ensure([arma.itemId]);
    return undefined;
  }
  return info.subType;
}

/**
 * Ataque básico — chamar do `entity:action` com `p.gid === selfGid`
 * (o mesmo evento que já dispara `audio/combatVoice.vozDeAtaque`, a voz é
 * INDEPENDENTE do efeito da arma, os dois tocam juntos).
 *
 * Prioridade (mesma ordem do pedido): erro > crítico > normal. Crítico NUNCA
 * soma com o som normal da arma. Sem crítico configurado pra classe, cai no
 * acerto normal (não fica mudo).
 */
export function efeitoDeAtaqueBasico(damage: number, crit: boolean): void {
  const c = classeAtual();
  if (!c) return;
  if (damage === 0) {
    playOneShot(c.erro);
    return;
  }
  if (crit && c.critico) {
    playOneShot(c.critico);
    return;
  }
  const som = c.acerto(subtipoDaArmaEquipada());
  if (som) playOneShot(som);
}

/**
 * Skill — chamar do `skill:cast` com `p.sourceGid === selfGid`. `kind` é o
 * MESMO campo que `net/useWorldEvents` já usa pra separar buff de dano
 * (`p.kind === "buff"`), não uma segunda classificação.
 */
export function efeitoDeSkill(kind: "target" | "buff", skillId: number): void {
  const c = classeAtual();
  if (!c) return;
  if (kind === "buff") {
    if (c.buff) playOneShot(c.buff);
    return;
  }
  if (c.skillDeDano) playOneShot(c.skillDeDano(skillId));
}
