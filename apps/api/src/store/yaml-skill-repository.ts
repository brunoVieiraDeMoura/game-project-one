import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Skill } from "@ragnarok/game-data";
import type { SkillListQuery, SkillListResult, SkillRepository } from "./skill-repository.js";
import { queueReload } from "./mysql-item-repository.js";

/**
 * Skills editadas pelo painel, gravadas em `db/import/skill_db.yml`.
 *
 * O rAthena **não tem loader SQL para skill** (só item, mob e mob_skill), então
 * não dá para fazer como os outros módulos. O que ele tem é o `db/import/`:
 * um arquivo que SOBREPÕE entradas do db principal, casando por `Id`. É o
 * mecanismo oficial de customização — e o único jeito de editar skill sem
 * mexer nos arquivos do upstream (que a gente não toca por regra).
 *
 * Consequências assumidas:
 *  - a LISTA continua vindo do catálogo migrado (`delegate`), que tem as 1635
 *    skills; este repositório é a camada de escrita e o "por cima" da leitura;
 *  - só o que foi editado aqui vai para o YAML — o resto continua valendo do
 *    db principal;
 *  - o formato gravado é o mínimo que o rAthena aceita como override
 *    (Id/Name/Description/MaxLevel + os campos que o admin mexe). Campos que o
 *    nosso schema não representa fielmente NÃO são reescritos, para não
 *    apagar comportamento por omissão.
 */

interface SkillYamlEntry {
	Id: number;
	Name: string;
	Description: string;
	MaxLevel: number;
	[key: string]: unknown;
}

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

	/** Skills já sobrepostas, por id. */
	private async readOverrides(): Promise<Map<number, SkillYamlEntry>> {
		try {
			const raw = await readFile(this.importPath, "utf8");
			const entries = parseSkillYaml(raw);
			return new Map(entries.map((e) => [e.Id, e]));
		} catch {
			return new Map();
		}
	}

	private applyOverride(skill: Skill, entry: SkillYamlEntry | undefined): Skill {
		if (!entry) return skill;
		return {
			...skill,
			name: typeof entry.Description === "string" ? entry.Description : skill.name,
			maxLevel: typeof entry.MaxLevel === "number" ? entry.MaxLevel : skill.maxLevel,
		};
	}

	private async writeOverride(skill: Skill): Promise<void> {
		const overrides = await this.readOverrides();
		overrides.set(skill.id, {
			Id: skill.id,
			Name: skill.aegisName,
			Description: skill.name,
			MaxLevel: skill.maxLevel,
		});

		await mkdir(dirname(this.importPath), { recursive: true });
		await writeFile(this.importPath, renderSkillYaml([...overrides.values()]), "utf8");
		await queueReload("skilldb");
	}
}

/**
 * Leitor mínimo do YAML de skill.
 *
 * Não é um parser de YAML: lê só o formato que ESTE arquivo escreve (uma
 * entrada por bloco, quatro campos escalares). Trazer uma dependência de YAML
 * para reler o que nós mesmos geramos seria peso sem ganho — e um parser
 * genérico ainda perderia os comentários do rAthena na hora de reescrever.
 */
export function parseSkillYaml(raw: string): SkillYamlEntry[] {
	const entries: SkillYamlEntry[] = [];
	let current: Partial<SkillYamlEntry> | null = null;

	for (const line of raw.split(/\r?\n/)) {
		const start = line.match(/^\s*-\s*Id:\s*(\d+)/);
		if (start) {
			if (current?.Id) entries.push(current as SkillYamlEntry);
			current = { Id: Number(start[1]) };
			continue;
		}
		if (!current) continue;

		const field = line.match(/^\s+(Name|Description|MaxLevel):\s*(.+?)\s*$/);
		if (!field) continue;
		const [, key, value] = field;
		if (key === "MaxLevel") {
			current.MaxLevel = Number(value);
		} else if (key === "Name") {
			current.Name = unquote(value!);
		} else {
			current.Description = unquote(value!);
		}
	}
	if (current?.Id) entries.push(current as SkillYamlEntry);
	return entries;
}

function unquote(value: string): string {
	return value.replace(/^"(.*)"$/, "$1");
}

function quote(value: string): string {
	return `"${value.replace(/"/g, '\\"')}"`;
}

export function renderSkillYaml(entries: SkillYamlEntry[]): string {
	const body = entries
		.sort((a, b) => a.Id - b.Id)
		.map(
			(e) =>
				`  - Id: ${e.Id}\n` +
				`    Name: ${e.Name}\n` +
				`    Description: ${quote(e.Description)}\n` +
				`    MaxLevel: ${e.MaxLevel}\n`,
		)
		.join("");

	return (
		"# Gerado pelo painel admin (apps/api) — NÃO editar à mão.\n" +
		"# Sobrepõe entradas de db/re/skill_db.yml por Id; o que não estiver aqui\n" +
		"# continua valendo do arquivo original do rAthena.\n" +
		"Header:\n  Type: SKILL_DB\n  Version: 4\n\nBody:\n" +
		body
	);
}
