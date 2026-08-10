import type { JobClass } from "../job-class";
import type { JobIdResolver, SkillIdResolver } from "./job-class-mapper";
import { RATHENA_JOB_NAME_LOOKUP } from "./job-names";

/**
 * Validator do domínio Classes (leia1.txt, aprovação 2026-08-07) — roda ANTES
 * de qualquer gravação nos 5 arquivos (`job_stats`/`job_basepoints`/
 * `job_exp`/`job_aspd`/`skill_tree`). Duas camadas, mesmo padrão de Skills:
 *
 * 1. `validateJobClassEntry` — estrutural, uma classe por vez, espelha o que
 *    `JobDatabase::parseBodyNode`/`SkillTreeDatabase::parseBodyNode`
 *    (pc.cpp) rejeitariam.
 * 2. `validateJobClassBatch` — cruzada (requisito 3 do leia1.txt): refs de
 *    skill, refs de classe/Inherit, loop de herança, skill fora da árvore
 *    efetiva, Id duplicado. Precisa do universo INTEIRO de classes
 *    conhecidas (as que estão sendo escritas + as que já existem nos 5
 *    arquivos e não estão sendo tocadas) — quem monta esse universo é o
 *    Writer (tem acesso a fs); o Validator só recebe a lista pronta.
 */

const RATHENA_MAX_LEVEL = 275;
const MAX_SKILL_TREE_LEVEL = 13; // MAX_SKILL_LEVEL, skill.hpp — mesmo teto de Tree[].MaxLevel/Requires[].Level

export interface JobValidationIssue {
  job: string;
  message: string;
}

export function validateJobClassEntry(jc: JobClass): string[] {
  const issues: string[] = [];

  // achado Fase 3.3 (docs/audit/fase3-testes/FASE3.3-FECHAMENTO.md): um
  // nome que não corresponde a nenhum `JOB_<nome>` real NÃO é rejeitado com
  // graça pelo loader do rAthena — ele derruba o map-server inteiro
  // (`terminate called ... check failed: ch != NONE`) ao processar
  // `job_stats.yml`. Skills/Status têm o mesmo tipo de nome livre, mas o
  // loader deles recusa a entrada sem crashar; Classes não tem essa rede de
  // segurança no C++, então tem que ter aqui.
  if (!RATHENA_JOB_NAME_LOOKUP.isValid(jc.name)) {
    issues.push(`Jobs: "${jc.name}" não corresponde a nenhum JOB_${jc.name.toUpperCase()} real (enum e_job, mmo.hpp) — o rAthena derruba o map-server inteiro ao carregar um nome de classe desconhecido, não recusa a entrada com segurança`);
  }

  if (jc.maxBaseLevel < 1 || jc.maxBaseLevel > RATHENA_MAX_LEVEL) {
    issues.push(`MaxBaseLevel ${jc.maxBaseLevel} fora de 1..${RATHENA_MAX_LEVEL} (MAX_LEVEL, map.hpp)`);
  }
  if (jc.maxJobLevel < 1 || jc.maxJobLevel > RATHENA_MAX_LEVEL) {
    issues.push(`MaxJobLevel ${jc.maxJobLevel} fora de 1..${RATHENA_MAX_LEVEL}`);
  }
  if (jc.maxWeight <= 0) issues.push(`MaxWeight ${jc.maxWeight} precisa ser positivo`);

  const seenSkillIds = new Set<number>();
  for (const s of jc.skills) {
    if (seenSkillIds.has(s.skillId)) issues.push(`skillId ${s.skillId} repetido na árvore própria (Tree duplicado)`);
    seenSkillIds.add(s.skillId);

    if (s.maxLevel > MAX_SKILL_TREE_LEVEL) {
      issues.push(`skillId ${s.skillId}: MaxLevel ${s.maxLevel} acima de ${MAX_SKILL_TREE_LEVEL} (MAX_SKILL_LEVEL)`);
    }
    for (const r of s.requires) {
      if (r.level < 0 || r.level > MAX_SKILL_TREE_LEVEL) {
        issues.push(`skillId ${s.skillId}: pré-requisito ${r.skillId} com Level ${r.level} fora de 0..${MAX_SKILL_TREE_LEVEL}`);
      }
    }
  }

  return issues;
}

function effectiveTreeSkillIds(job: JobClass, byId: Map<number, JobClass>, seen = new Set<number>()): Set<number> {
  if (seen.has(job.id)) return new Set(); // corta loop de herança (relatado à parte por detectInheritLoops)
  seen.add(job.id);
  const ids = new Set(job.skills.map((s) => s.skillId));
  for (const parentId of job.skillTreeInherit) {
    const parent = byId.get(parentId);
    if (!parent) continue;
    for (const id of effectiveTreeSkillIds(parent, byId, seen)) ids.add(id);
  }
  return ids;
}

function detectInheritLoop(startId: number, byId: Map<number, JobClass>): number[] | null {
  const path: number[] = [];
  const onPath = new Set<number>();
  const visit = (id: number): number[] | null => {
    if (onPath.has(id)) return [...path, id];
    const job = byId.get(id);
    if (!job) return null;
    onPath.add(id);
    path.push(id);
    for (const parentId of job.skillTreeInherit) {
      const cycle = visit(parentId);
      if (cycle) return cycle;
    }
    path.pop();
    onPath.delete(id);
    return null;
  };
  return visit(startId);
}

/**
 * `allKnown`: universo completo de classes válidas depois da escrita — as
 * que estão sendo alteradas (`classes`) UNIDAS com as que já existem nos 5
 * arquivos e não fazem parte deste lote. Só assim uma classe herdando de um
 * job intocado por esta edição continua resolvendo.
 */
export function validateJobClassBatch(
  classes: JobClass[],
  allKnown: JobClass[],
  jobs: JobIdResolver,
  skills: SkillIdResolver,
): JobValidationIssue[] {
  const issues: JobValidationIssue[] = [];
  const byId = new Map(allKnown.map((c) => [c.id, c]));

  // IDs duplicados — dentro do próprio lote sendo escrito.
  const seenIds = new Map<number, string>();
  const seenNames = new Map<string, number>();
  for (const jc of classes) {
    const prevByName = seenNames.get(jc.name);
    if (prevByName !== undefined && prevByName !== jc.id) {
      issues.push({ job: jc.name, message: `nome "${jc.name}" duplicado no lote (ids ${prevByName} e ${jc.id}) — colidiria na mesma chave Jobs:/Job: do YAML` });
    }
    seenNames.set(jc.name, jc.id);
    const prevById = seenIds.get(jc.id);
    if (prevById !== undefined && prevById !== jc.name) {
      issues.push({ job: jc.name, message: `id ${jc.id} duplicado no lote (também usado por "${prevById}")` });
    }
    seenIds.set(jc.id, jc.name);
  }

  for (const jc of classes) {
    // Classes existentes — parentClassId (progressão de UI).
    if (jc.parentClassId !== null) {
      const parentName = jobs.nameOf(jc.parentClassId);
      if (!parentName) {
        issues.push({ job: jc.name, message: `parentClassId ${jc.parentClassId} não corresponde a nenhum job de enum e_job` });
      } else if (!byId.has(jc.parentClassId)) {
        issues.push({ job: jc.name, message: `parentClassId ${jc.parentClassId} (${parentName}) não está entre as classes conhecidas — verifique se não é typo` });
      }
    }

    // Jobs herdados (Inherit) válidos + Classes existentes.
    for (const parentId of jc.skillTreeInherit) {
      const parentName = jobs.nameOf(parentId);
      if (!parentName) {
        issues.push({ job: jc.name, message: `skillTreeInherit referencia job id ${parentId} sem nome em enum e_job` });
        continue;
      }
      if (!byId.has(parentId)) {
        issues.push({ job: jc.name, message: `Inherit.${parentName}: job não está entre as classes conhecidas (nem no lote, nem no arquivo existente)` });
      }
    }

    // Loops de herança.
    const cycle = detectInheritLoop(jc.id, byId);
    if (cycle && cycle.length > 1) {
      const names = cycle.map((id) => byId.get(id)?.name ?? jobs.nameOf(id) ?? `#${id}`);
      issues.push({ job: jc.name, message: `loop de herança: ${names.join(" → ")}` });
    }

    // Skills existentes — todo skillId usado (Tree e Requires) tem que existir no skill_db.
    for (const s of jc.skills) {
      if (!skills.nameOf(s.skillId)) {
        issues.push({ job: jc.name, message: `skillId ${s.skillId} não existe no catálogo de skills` });
      }
      for (const r of s.requires) {
        if (!skills.nameOf(r.skillId)) {
          issues.push({ job: jc.name, message: `pré-requisito skillId ${r.skillId} (do skill ${s.skillId}) não existe no catálogo de skills` });
        }
      }
    }

    // Referências entre árvores de skills / skills inexistentes na árvore:
    // todo pré-requisito precisa ser um skill que ESTA classe (ou algum
    // ancestral do Inherit) realmente ensina — senão o requisito é
    // inatingível (o jogador nunca teria de onde tirar o pré-requisito).
    const effective = effectiveTreeSkillIds(jc, byId);
    for (const s of jc.skills) {
      for (const r of s.requires) {
        if (skills.nameOf(r.skillId) && !effective.has(r.skillId)) {
          issues.push({
            job: jc.name,
            message: `skill ${s.skillId} exige ${r.skillId}, mas ${r.skillId} não está na árvore própria nem herdada desta classe (requisito inatingível)`,
          });
        }
      }
    }
  }

  return issues;
}
