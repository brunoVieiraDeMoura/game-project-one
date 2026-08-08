import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parse as parseYamlText, stringify as stringifyYaml } from "yaml";
import {
  StatusDocSchema,
  RawStatusSchema,
  statusToRawEntry,
  applyStatusOverride,
  validateStatusEntry,
  validateStatusBatch,
  type RawStatus,
  type StatusDoc,
  type StatusEffectDef,
} from "@ragnarok/game-data";
import type { StatusListQuery, StatusListResult, StatusRepository } from "./status-repository.js";
import type { SkillRepository } from "./skill-repository.js";
import { skillResolverFromCatalog } from "./job-database-writer.js";
import { queueReload } from "./mysql-item-repository.js";

/**
 * Status editados pelo painel, gravados em `db/import/status.yml` — mesmo
 * papel que `YamlSkillRepository` tem pra skills (slot de import ÚNICO,
 * igual skill_db.yml, sem a armadilha multi-arquivo de Classes).
 *
 * Pipeline schema-first (leia1.txt, aprovação Mapper/Validator/Writer
 * 2026-08-07): Parser → Mapper → Validator → Writer, nenhuma regra de
 * serialização duplicada aqui — só orquestra + I/O. Mesmo rigor de
 * `JobDatabaseWriter` (round-trip, diff, backup, escrita atômica) mesmo
 * sendo um arquivo só, porque foi pedido explicitamente pra Status também.
 */

export interface StatusDiffEntry {
  status: string;
  changedFields: string[];
}

function diffEntry(before: RawStatus | undefined, after: RawStatus): string[] {
  const changed: string[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  keys.delete("Status");
  for (const k of keys) {
    const a = JSON.stringify((before as Record<string, unknown> | undefined)?.[k]);
    const b = JSON.stringify((after as Record<string, unknown>)[k]);
    if (a !== b) changed.push(k);
  }
  return changed;
}

function renderStatusYaml(entries: RawStatus[]): string {
  const sorted = [...entries].sort((a, b) => a.Status.localeCompare(b.Status));
  const doc = { Header: { Type: "STATUS_DB", Version: 4 }, Body: sorted };
  return (
    "# Gerado pelo painel admin (apps/api) — NÃO editar à mão.\n" +
    "# Sobrepõe entradas de status.yml por Status; o que não estiver aqui\n" +
    "# continua valendo do arquivo original do rAthena.\n" +
    stringifyYaml(doc, { lineWidth: 0 })
  );
}

async function readDoc(path: string): Promise<StatusDoc> {
  try {
    const raw = await readFile(path, "utf8");
    return StatusDocSchema.parse(parseYamlText(raw));
  } catch {
    return { Header: { Type: "STATUS_DB", Version: 4 }, Body: [] };
  }
}

async function backupIfExists(path: string): Promise<void> {
  try {
    const content = await readFile(path, "utf8");
    await writeFile(`${path}.bak`, content, "utf8");
  } catch {
    /* primeiro write — sem base pra fazer backup */
  }
}

export class YamlStatusRepository implements StatusRepository {
  constructor(
    /** de onde vem a lista/leitura (catálogo migrado — Supabase ou JSON) */
    private readonly delegate: StatusRepository,
    /** pra validação cruzada de DurationLookup (skill existe?) */
    private readonly skillRepository: SkillRepository,
    /** caminho do db/import/status.yml (symlink → rathena-db-import/) */
    private readonly importPath: string,
  ) {}

  async list(query: StatusListQuery): Promise<StatusListResult> {
    const base = await this.delegate.list(query);
    const doc = await readDoc(this.importPath);
    if (doc.Body.length === 0) return base;
    const byId = new Map(doc.Body.map((e) => [e.Status.toLowerCase(), e]));
    return {
      ...base,
      statuses: base.statuses.map((s) => applyStatusOverride(s, byId.get(s.id))),
    };
  }

  async get(id: string): Promise<StatusEffectDef | undefined> {
    const status = await this.delegate.get(id);
    if (!status) return undefined;
    const doc = await readDoc(this.importPath);
    const entry = doc.Body.find((e) => e.Status.toLowerCase() === id.toLowerCase());
    return applyStatusOverride(status, entry);
  }

  async create(status: StatusEffectDef): Promise<StatusEffectDef> {
    const created = await this.delegate.create(status);
    await this.writeToServer(created);
    return created;
  }

  async update(id: string, status: StatusEffectDef): Promise<StatusEffectDef | undefined> {
    const updated = await this.delegate.update(id, status);
    if (!updated) return undefined;
    await this.writeToServer(updated);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    // mesma regra de Skills/Classes: apagar do catálogo não mexe no
    // servidor — status em uso (por skill/item/monstro) é destrutivo demais
    // pra apagar em cascata.
    return this.delegate.remove(id);
  }

  private async writeToServer(status: StatusEffectDef): Promise<{ warnings: string[]; diff: StatusDiffEntry[] }> {
    // 1) validação estrutural — antes de tocar em qualquer arquivo.
    const structuralIssues = validateStatusEntry(status);
    if (structuralIssues.length > 0) {
      throw Object.assign(new Error(`status.yml: ${structuralIssues.join("; ")}`), { statusCode: 400 });
    }

    // 2) universo pra validação cruzada — o catálogo INTEIRO (não há
    //    "arquivo base separado" aqui, status.yml é um slot de import só).
    const { statuses: allStatuses } = await this.delegate.list({ page: 1, pageSize: 100_000 });
    const knownIds = new Set(allStatuses.map((s) => s.id));
    const { skills } = await this.skillRepository.list({ page: 1, pageSize: 100_000 });
    const skillResolver = skillResolverFromCatalog(skills);

    const crossIssues = validateStatusBatch([status], knownIds, skillResolver);
    if (crossIssues.length > 0) {
      throw Object.assign(
        new Error(`status.yml (validação cruzada): ${crossIssues.map((i) => i.message).join("; ")}`),
        { statusCode: 400 },
      );
    }

    // 3) lê o override existente — é o "base" pra preservar Script e
    //    pra saber quais referências Fail/EndOnStart/etc. precisam virar
    //    `false` se o admin removeu (requisito 4 / catálogo ilimitado).
    const doc = await readDoc(this.importPath);
    const byId = new Map(doc.Body.map((e) => [e.Status.toLowerCase(), e]));
    const before = byId.get(status.id);

    const { entry, warnings } = statusToRawEntry(status, before);
    const issues = RawStatusSchema.safeParse(entry);
    if (!issues.success) {
      throw Object.assign(new Error(`status.yml: mapeamento inválido: ${issues.error.message}`), { statusCode: 500 });
    }

    const diff: StatusDiffEntry[] = [{ status: status.id, changedFields: diffEntry(before, entry) }];
    byId.set(status.id, entry);

    // 4) re-renderiza o documento INTEIRO e prova round-trip — ainda sem
    //    tocar em nenhum arquivo real.
    const rendered = renderStatusYaml([...byId.values()]);
    const reparsed = StatusDocSchema.safeParse(parseYamlText(rendered));
    if (!reparsed.success) {
      throw Object.assign(
        new Error(`round-trip falhou em status.yml: ${JSON.stringify(reparsed.error.issues.slice(0, 3))}`),
        { statusCode: 500 },
      );
    }

    // 5) só agora: backup + escrita atômica (tmp + rename).
    await mkdir(dirname(this.importPath), { recursive: true });
    await backupIfExists(this.importPath);
    const tmp = `${this.importPath}.tmp`;
    try {
      await writeFile(tmp, rendered, "utf8");
      await rename(tmp, this.importPath);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }

    await queueReload("statusdb");

    return { warnings, diff };
  }
}
