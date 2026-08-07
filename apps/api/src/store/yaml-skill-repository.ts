import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parse as parseYamlText, stringify as stringifyYaml } from "yaml";
import {
  RawSkillYamlSchema,
  parseSkillEntry,
  reemitRawSkillYaml,
  skillToParsedEntry,
  validateSkillEntry,
  type ParsedSkillEntry,
  type RawSkillYaml,
  type Skill,
} from "@ragnarok/game-data";
import type { SkillListQuery, SkillListResult, SkillRepository } from "./skill-repository.js";
import { queueReload } from "./mysql-item-repository.js";

/**
 * Skills editadas pelo painel, gravadas em `db/import/skill_db.yml`.
 *
 * O rAthena **não tem loader SQL para skill** (só item, mob e mob_skill),
 * então não dá para fazer como os outros módulos. O que ele tem é o
 * `db/import/`: um arquivo que SOBREPÕE entradas do db principal, casando
 * por `Id` — mecanismo oficial de customização, e o único jeito de editar
 * skill sem mexer nos arquivos do upstream (regra do projeto).
 *
 * Writer schema-first (gate aprovado 2026-08-07, ver
 * `packages/game-data/src/rathena/skill-db-{yaml,mapper,validator}.ts`):
 * Parser → Mapper → Validator → Writer, nenhuma regra de serialização
 * duplicada aqui — este arquivo só ORQUESTRA as três camadas e faz I/O.
 *
 * Consequências assumidas:
 *  - a LISTA continua vindo do catálogo migrado (`delegate`, Supabase/JSON),
 *    que é a fonte de verdade pro que o admin edita e o que a dashboard
 *    mostra; este repositório é só a camada de exportação pro rAthena;
 *  - todo campo que o Mapper sabe representar é reescrito por INTEIRO a
 *    cada `update` (regra 1/2 do gate: bitset e perLevel são aditivos na
 *    leitura do rAthena — sub-conjunto não desliga nada da base, então o
 *    Writer sempre emite o conjunto completo pros campos que edita);
 *  - campo que o Mapper não sabe representar (fórmula de dano, chance/
 *    magnitude de status) NUNCA é escrito, e vira warning devolvido pra
 *    rota poder avisar o admin — nunca descartado em silêncio.
 */

export class YamlSkillRepository implements SkillRepository {
  constructor(
    /** de onde vem a lista/leitura (catálogo migrado — Supabase ou JSON) */
    private readonly delegate: SkillRepository,
    /** caminho do db/import/skill_db.yml (symlink → rathena-db-import/) */
    private readonly importPath: string,
  ) {}

  async list(query: SkillListQuery): Promise<SkillListResult> {
    const base = await this.delegate.list(query);
    const overrides = await this.readOverrides();
    if (overrides.size === 0) return base;

    return {
      ...base,
      skills: base.skills.map((skill) => this.applyOverride(skill, overrides.get(skill.id))),
    };
  }

  async get(id: number): Promise<Skill | undefined> {
    const skill = await this.delegate.get(id);
    if (!skill) return undefined;
    const overrides = await this.readOverrides();
    return this.applyOverride(skill, overrides.get(id));
  }

  async create(skill: Skill): Promise<Skill> {
    const created = await this.delegate.create(skill);
    await this.writeOverride(created);
    return created;
  }

  async update(id: number, skill: Skill): Promise<Skill | undefined> {
    const updated = await this.delegate.update(id, skill);
    if (!updated) return undefined;
    await this.writeOverride(updated);
    return updated;
  }

  async remove(id: number): Promise<boolean> {
    // Remover do catálogo NÃO remove do rAthena: apagar skill do jogo é
    // operação destrutiva que quebra árvore de classe e personagem que já
    // aprendeu. Só sai da lista do painel.
    return this.delegate.remove(id);
  }

  /** Overrides já gravados, por id — cada um validado contra o schema oficial (nunca lido "na confiança"). */
  private async readOverrides(): Promise<Map<number, RawSkillYaml>> {
    try {
      const raw = await readFile(this.importPath, "utf8");
      const doc = parseYamlText(raw) as { Body?: unknown[] } | null | undefined;
      const map = new Map<number, RawSkillYaml>();
      for (const candidate of doc?.Body ?? []) {
        const parsed = RawSkillYamlSchema.safeParse(candidate);
        if (parsed.success) map.set(parsed.data.Id, parsed.data);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  /** só o que o `applyOverride` de sempre já expunha (nome/nível máx.) — o resto do override não volta pro `Skill` porque a fonte de verdade da dashboard é o catálogo (Supabase/JSON), não o YAML de exportação. */
  private applyOverride(skill: Skill, entry: RawSkillYaml | undefined): Skill {
    if (!entry) return skill;
    return { ...skill, name: entry.Description, maxLevel: entry.MaxLevel };
  }

  /**
   * `Skill` → override completo, validado, gravado. Lança com
   * `statusCode: 400` se o Validator reprovar — o arquivo não é tocado.
   */
  async writeOverride(skill: Skill): Promise<{ warnings: string[] }> {
    const overrides = await this.readOverrides();
    const existingRaw = overrides.get(skill.id);
    const base: ParsedSkillEntry | undefined = existingRaw ? parseSkillEntry(existingRaw) : undefined;

    const { entry, warnings } = skillToParsedEntry(skill, base);

    const issues = validateSkillEntry(entry);
    if (issues.length > 0) {
      throw Object.assign(new Error(`skill_db.yml: ${issues.join("; ")}`), { statusCode: 400 });
    }

    overrides.set(skill.id, reemitRawSkillYaml(entry));

    await mkdir(dirname(this.importPath), { recursive: true });
    await writeFile(this.importPath, renderSkillDbYaml([...overrides.values()]), "utf8");
    await queueReload("skilldb");

    return { warnings };
  }
}

/**
 * Serializador de verdade (`yaml` — o mesmo pacote que já lê `skill_db.yml`
 * em `tools/legacy-migration`), não mais concatenação de string: o formato
 * anterior só sabia emitir 4 campos escalares e misturava entradas na
 * releitura quando havia bloco aninhado. `Header` idêntico ao que o
 * dispatcher (`db/skill_db.yml`) espera de um import (SKILL_DB v4).
 */
export function renderSkillDbYaml(entries: RawSkillYaml[]): string {
  const sorted = [...entries].sort((a, b) => a.Id - b.Id);
  const doc = {
    Header: { Type: "SKILL_DB", Version: 4 },
    Body: sorted,
  };
  return (
    "# Gerado pelo painel admin (apps/api) — NÃO editar à mão.\n" +
    "# Sobrepõe entradas de db/re/skill_db.yml por Id; o que não estiver aqui\n" +
    "# continua valendo do arquivo original do rAthena.\n" +
    stringifyYaml(doc, { lineWidth: 0 })
  );
}
