import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SkillSchema, prefixOf, type Skill } from "@ragnarok/game-data";
import type { SkillListQuery, SkillListResult, SkillRepository } from "./skill-repository";

/** Dev-mode store — same shape as JsonItemRepository. */
export class JsonSkillRepository implements SkillRepository {
  private skills = new Map<number, Skill>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataPath: string,
    seedPath?: string,
  ) {
    const source = existsSync(dataPath) ? dataPath : seedPath && existsSync(seedPath) ? seedPath : null;
    if (source) {
      const raw = JSON.parse(readFileSync(source, "utf-8")) as unknown[];
      for (const entry of raw) {
        const parsed = SkillSchema.safeParse(entry);
        if (parsed.success) this.skills.set(parsed.data.id, parsed.data);
      }
    }
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      void this.persistNow();
    }, 500);
  }

  async persistNow(): Promise<void> {
    mkdirSync(dirname(this.dataPath), { recursive: true });
    await writeFile(this.dataPath, JSON.stringify([...this.skills.values()], null, 1), "utf-8");
  }

  async list({ page, pageSize, search, classPrefix }: SkillListQuery): Promise<SkillListResult> {
    let all = [...this.skills.values()];
    if (classPrefix && classPrefix.length > 0) {
      const set = new Set(classPrefix);
      all = all.filter((s) => set.has(prefixOf(s.aegisName)));
    }
    if (search) {
      const q = search.toLowerCase();
      all = all.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.aegisName.toLowerCase().includes(q) ||
          String(s.id) === q,
      );
    }
    all.sort((a, b) => a.id - b.id);
    const total = all.length;
    const start = (page - 1) * pageSize;
    return { skills: all.slice(start, start + pageSize), total, page, pageSize };
  }

  async get(id: number): Promise<Skill | undefined> {
    return this.skills.get(id);
  }

  async create(skill: Skill): Promise<Skill> {
    if (this.skills.has(skill.id)) {
      throw Object.assign(new Error(`skill ${skill.id} already exists`), { statusCode: 409 });
    }
    this.skills.set(skill.id, skill);
    this.schedulePersist();
    return skill;
  }

  async update(id: number, skill: Skill): Promise<Skill | undefined> {
    if (!this.skills.has(id)) return undefined;
    if (skill.id !== id && this.skills.has(skill.id)) {
      throw Object.assign(new Error(`skill ${skill.id} already exists`), { statusCode: 409 });
    }
    this.skills.delete(id);
    this.skills.set(skill.id, skill);
    this.schedulePersist();
    return skill;
  }

  async remove(id: number): Promise<boolean> {
    const existed = this.skills.delete(id);
    if (existed) this.schedulePersist();
    return existed;
  }

  async setIcon(id: number, filename: string | null): Promise<Skill | undefined> {
    const skill = this.skills.get(id);
    if (!skill) return undefined;
    const updated = { ...skill, icon: filename ?? undefined };
    this.skills.set(id, updated);
    this.schedulePersist();
    return updated;
  }
}
