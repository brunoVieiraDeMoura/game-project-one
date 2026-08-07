import type { JobClass } from "@ragnarok/game-data";
import type { JobClassListQuery, JobClassListResult, JobClassRepository } from "./job-class-repository.js";
import type { SkillRepository } from "./skill-repository.js";
import { JobDatabaseWriter, jobResolverFromCatalog, skillResolverFromCatalog } from "./job-database-writer.js";

/**
 * Classes editadas pelo painel, gravadas nos 5 arquivos `db/import/`
 * (`job_stats`/`job_basepoints`/`job_exp`/`job_aspd`/`skill_tree`.yml) via
 * `JobDatabaseWriter` — mesmo papel que `YamlSkillRepository` tem pra
 * skills: a LISTA continua vindo do catálogo (`delegate`, Supabase/JSON,
 * fonte de verdade da dashboard); este repositório só orquestra a
 * exportação pro rAthena depois de `create`/`update`.
 */
export class YamlJobClassRepository implements JobClassRepository {
  constructor(
    private readonly delegate: JobClassRepository,
    private readonly skillRepository: SkillRepository,
    private readonly writer: JobDatabaseWriter,
  ) {}

  list(query: JobClassListQuery): Promise<JobClassListResult> {
    return this.delegate.list(query);
  }

  get(id: number): Promise<JobClass | undefined> {
    return this.delegate.get(id);
  }

  async create(jobClass: JobClass): Promise<JobClass> {
    const created = await this.delegate.create(jobClass);
    await this.writeToServer(created);
    return created;
  }

  async update(id: number, jobClass: JobClass): Promise<JobClass | undefined> {
    const updated = await this.delegate.update(id, jobClass);
    if (!updated) return undefined;
    await this.writeToServer(updated);
    return updated;
  }

  async remove(id: number): Promise<boolean> {
    // mesma regra do Skills: apagar do catálogo não mexe no servidor —
    // remover classe é destrutivo (personagem existente ficaria órfão).
    return this.delegate.remove(id);
  }

  private async writeToServer(jc: JobClass): Promise<void> {
    const { jobClasses } = await this.delegate.list({ page: 1, pageSize: 100_000 });
    const jobs = jobResolverFromCatalog(jobClasses);
    const { skills: allSkills } = await this.skillRepository.list({ page: 1, pageSize: 100_000 });
    const skills = skillResolverFromCatalog(allSkills);
    await this.writer.writeClasses([jc], jobs, skills);
  }
}
