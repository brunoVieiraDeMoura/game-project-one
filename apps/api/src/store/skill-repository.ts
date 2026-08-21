import type { Skill } from "@ragnarok/game-data";

export interface SkillListQuery {
  page: number;
  pageSize: number;
  /** name/aegisName substring or numeric id */
  search?: string | undefined;
  /** filtro por classe: lista de prefixos crus do aegisName (ex. ["SM","KN"]) — nunca rótulo/tier */
  classPrefix?: string[] | undefined;
}

export interface SkillListResult {
  skills: Skill[];
  total: number;
  page: number;
  pageSize: number;
}

/** Storage abstraction for the Skills module — same pattern as ItemRepository. */
export interface SkillRepository {
  list(query: SkillListQuery): Promise<SkillListResult>;
  get(id: number): Promise<Skill | undefined>;
  create(skill: Skill): Promise<Skill>;
  update(id: number, skill: Skill): Promise<Skill | undefined>;
  remove(id: number): Promise<boolean>;
  /**
   * Grava só o nome do arquivo do ícone (rota dedicada `POST/DELETE
   * /skills/:id/icon`) — fora do `update()` de propósito: `icon` é um campo
   * só de exibição do HUD, não existe em `skill_db.yml`, então gravá-lo não
   * pode disparar `writeOverride`/`@reloadskilldb` como um `update()`
   * qualquer dispararia (ver `YamlSkillRepository.setIcon`). `undefined` =
   * backend não suporta upload.
   */
  setIcon?(id: number, filename: string | null): Promise<Skill | undefined>;
}
