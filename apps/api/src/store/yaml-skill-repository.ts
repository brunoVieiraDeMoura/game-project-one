import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { parse as parseYamlText, stringify as stringifyYaml } from "yaml";
import {
  RawSkillYamlSchema,
  parseSkillEntry,
  reemitRawSkillYaml,
  skillToParsedEntry,
  validateSkillEntry,
  type ItemNameResolver,
  type ParsedSkillEntry,
  type RawSkillYaml,
  type Skill,
} from "@ragnarok/game-data";
import type { SkillListQuery, SkillListResult, SkillRepository } from "./skill-repository.js";
import type { ItemRepository } from "./item-repository.js";
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
    /** resolve itemId → aegisName pra `Requires.ItemCost`/`Requires.Equipment` (achado A21); omitido = itens não resolvidos (comportamento anterior aos testes que não exercitam esses campos) */
    private readonly itemRepository?: ItemRepository,
  ) {}

  /**
   * Cache do parse de `skill_db.yml` em memória, por mtime.
   *
   * `/skills/by-id` chama `get(id)` uma vez POR id (`routes/skills.ts`), e sem
   * isto cada chamada relia o arquivo inteiro (~200KB, 10 mil+ linhas) do zero
   * — o `yaml.parse` é síncrono, então N ids bloqueavam o event loop N vezes
   * em fila, e um lote de ~13 skills (a barra do personagem) media 13-21s de
   * verdade (achado 2026-08-14, instrumentação `[SKILL_DATA]`). `stat` é
   * barato e cobre tanto a escrita própria (`writeOverride`) quanto qualquer
   * edição externa do arquivo, sem precisar lembrar de invalidar na mão.
   */
  private overridesCache: { mtimeMs: number; data: Map<number, RawSkillYaml> } | null = null;

  /**
   * Leitura em andamento, compartilhada.
   *
   * `/by-id` chama `get(id)` uma vez por id dentro de um `Promise.all`
   * (`routes/skills.ts`) — as N chamadas disparam no MESMO tick, então sem
   * isto elas corriam juntas para o cache vazio e cada uma relia+parseava o
   * arquivo por conta própria mesmo depois do cache por mtime acima (só
   * ajuda a partir da SEGUNDA leva; a primeira, logo após subir o servidor ou
   * gravar o arquivo, ainda pagava o custo N vezes). Guardar a promise em
   * andamento faz as N chamadas concorrentes esperarem o mesmo parse.
   */
  private overridesInFlight: Promise<Map<number, RawSkillYaml>> | null = null;

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

  /**
   * `icon` não existe em `skill_db.yml` (é campo só de exibição do HUD) —
   * delega direto pro catálogo, sem passar por `writeOverride`/
   * `queueReload("skilldb")`. `applyOverride` não toca `icon`, então não há
   * risco de a leitura seguinte pisar o valor recém-gravado.
   */
  async setIcon(id: number, filename: string | null): Promise<Skill | undefined> {
    return this.delegate.setIcon?.(id, filename);
  }

  /** Overrides já gravados, por id — cada um validado contra o schema oficial (nunca lido "na confiança"). */
  private async readOverrides(): Promise<Map<number, RawSkillYaml>> {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(this.importPath)).mtimeMs;
    } catch {
      this.overridesCache = null;
      return new Map();
    }
    if (this.overridesCache && this.overridesCache.mtimeMs === mtimeMs) {
      return this.overridesCache.data;
    }
    if (this.overridesInFlight) return this.overridesInFlight;

    const load = (async () => {
      try {
        const raw = await readFile(this.importPath, "utf8");
        const doc = parseYamlText(raw) as { Body?: unknown[] } | null | undefined;
        const map = new Map<number, RawSkillYaml>();
        for (const candidate of doc?.Body ?? []) {
          const parsed = RawSkillYamlSchema.safeParse(candidate);
          if (parsed.success) map.set(parsed.data.Id, parsed.data);
        }
        this.overridesCache = { mtimeMs, data: map };
        return map;
      } catch {
        this.overridesCache = null;
        return new Map<number, RawSkillYaml>();
      } finally {
        this.overridesInFlight = null;
      }
    })();
    this.overridesInFlight = load;
    return load;
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

    const resolveItemName = await this.buildItemNameResolver(skill);
    const { entry, warnings } = skillToParsedEntry(skill, base, resolveItemName);

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

  /**
   * itemId → aegisName pros itens que ESTA skill referencia (`ItemCost` +
   * `Equipment`) — mesma necessidade de `mysqlRowToMonster`/
   * `monsterToMysqlRow` (`mysql-monster-row.ts`), mas `ItemRepository` não
   * expõe lookup em lote (só `get(id)`, `item-repository.ts:27`), diferente
   * de `MysqlMonsterRepository.itemNamesById` que consulta `item_db_re`
   * direto por SQL — daí resolver id a id, uma vez por id distinto.
   */
  private async buildItemNameResolver(skill: Skill): Promise<ItemNameResolver> {
    const ids = new Set<number>();
    for (const cost of skill.requirements?.itemsConsumed ?? []) ids.add(cost.itemId);
    for (const id of skill.requirements?.requiredEquipment ?? []) ids.add(id);
    if (ids.size === 0 || !this.itemRepository) return () => undefined;

    const repo = this.itemRepository;
    const names = new Map<number, string>();
    await Promise.all(
      [...ids].map(async (id) => {
        const item = await repo.get(id);
        if (item) names.set(id, item.aegisName);
      }),
    );
    return (id) => names.get(id);
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
