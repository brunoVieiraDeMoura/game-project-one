import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import { env } from "./env.js";
import { itemRoutes } from "./routes/items.js";
import { jobClassRoutes } from "./routes/job-classes.js";
import { JsonItemRepository } from "./store/json-item-repository.js";
import { SupabaseItemRepository } from "./store/supabase-item-repository.js";
import { MysqlItemRepository } from "./store/mysql-item-repository.js";
import { MysqlMonsterRepository } from "./store/mysql-monster-repository.js";
import { MysqlUserRepository } from "./store/mysql-user-repository.js";
import { YamlSkillRepository } from "./store/yaml-skill-repository.js";
import { YamlJobClassRepository } from "./store/yaml-job-class-repository.js";
import { JobDatabaseWriter } from "./store/job-database-writer.js";
import { YamlStatusRepository } from "./store/yaml-status-repository.js";
import { hasRoDatabase } from "./store/mysql.js";
import { serverControlRoutes } from "./routes/server-control.js";
import type { ItemRepository } from "./store/item-repository.js";
import { JsonJobClassRepository } from "./store/json-job-class-repository.js";
import { SupabaseJobClassRepository } from "./store/supabase-job-class-repository.js";
import type { JobClassRepository } from "./store/job-class-repository.js";
import { skillRoutes } from "./routes/skills.js";
import { statusRoutes } from "./routes/statuses.js";
import { JsonSkillRepository } from "./store/json-skill-repository.js";
import { SupabaseSkillRepository } from "./store/supabase-skill-repository.js";
import type { SkillRepository } from "./store/skill-repository.js";
import { JsonStatusRepository } from "./store/json-status-repository.js";
import { SupabaseStatusRepository } from "./store/supabase-status-repository.js";
import type { StatusRepository } from "./store/status-repository.js";
import { monsterRoutes } from "./routes/monsters.js";
import { JsonMonsterRepository } from "./store/json-monster-repository.js";
import { SupabaseMonsterRepository } from "./store/supabase-monster-repository.js";
import type { MonsterRepository } from "./store/monster-repository.js";
import { npcRoutes } from "./routes/npcs.js";
import { JsonNpcRepository } from "./store/json-npc-repository.js";
import { SupabaseNpcRepository } from "./store/supabase-npc-repository.js";
import type { NpcRepository } from "./store/npc-repository.js";
import { serverConfigRoutes } from "./routes/server-config.js";
import { JsonServerConfigRepository } from "./store/json-server-config-repository.js";
import { SupabaseServerConfigRepository } from "./store/supabase-server-config-repository.js";
import type { ServerConfigRepository } from "./store/server-config-repository.js";
import { userRoutes } from "./routes/users.js";
import { MemoryUserRepository } from "./store/memory-user-repository.js";
import { SupabaseUserRepository } from "./store/supabase-user-repository.js";
import type { UserRepository } from "./store/user-repository.js";
import { mapRoutes } from "./routes/maps.js";
import { JsonMapRepository } from "./store/json-map-repository.js";
import { SupabaseMapRepository } from "./store/supabase-map-repository.js";
import type { MapRepository } from "./store/map-repository.js";
import { SupabaseSecurity, type SecurityContext } from "./auth/security.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const PORT = Number(process.env.PORT ?? 4000);

export interface ServerDeps {
  itemRepository?: ItemRepository;
  jobClassRepository?: JobClassRepository;
  skillRepository?: SkillRepository;
  statusRepository?: StatusRepository;
  monsterRepository?: MonsterRepository;
  npcRepository?: NpcRepository;
  serverConfigRepository?: ServerConfigRepository;
  userRepository?: UserRepository;
  mapRepository?: MapRepository;
  /** null disables auth+audit (JSON dev mode / tests); undefined = derive from env. */
  security?: SecurityContext | null;
  /** raiz de `npc/` pro Writer relocalizar o `.txt` de um NPC editado
   * (leia1.txt, integração Writer↔Admin, 2026-08-08). null desliga a
   * integração inteira (PUT vira CRUD puro, como antes dela existir) —
   * default é `join(REPO_ROOT, "rathena")`, undefined usa esse default. */
  npcScriptRoot?: string | null;
}

function defaultItemRepository(): ItemRepository {
  // Ordem de preferência: banco do rAthena > Supabase > JSON. Com o MariaDB
  // configurado, editar item no admin edita o JOGO (item_db_re) — que é o
  // ponto do módulo; o Supabase vira histórico da fase anterior.
  if (hasRoDatabase()) {
    return new MysqlItemRepository();
  }
  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    return new SupabaseItemRepository(env.supabaseUrl, env.supabaseServiceRoleKey);
  }
  return new JsonItemRepository(
    process.env.ITEMS_DATA_PATH ?? join(__dirname, "..", "data", "items.json"),
    join(REPO_ROOT, "tools", "legacy-migration", "output", "items.json"),
  );
}

function defaultJobClassRepository(skillRepository: SkillRepository): JobClassRepository {
  const catalog: JobClassRepository =
    env.supabaseUrl && env.supabaseServiceRoleKey
      ? new SupabaseJobClassRepository(env.supabaseUrl, env.supabaseServiceRoleKey)
      : new JsonJobClassRepository(
          process.env.JOB_CLASSES_DATA_PATH ?? join(__dirname, "..", "data", "job-classes.json"),
          join(REPO_ROOT, "tools", "legacy-migration", "output", "job-classes.json"),
        );

  // job_stats/job_basepoints/job_exp/job_aspd/skill_tree não têm tabela SQL
  // no rAthena — mesma situação de Skills, resolvida do mesmo jeito: o
  // catálogo acima continua sendo a lista completa, e salvar no painel
  // também escreve em db/import/ (JobDatabaseWriter) e pede @reloadpcdb
  // (scripts/wsl-setup.sh symlinka rathena-db-import/). Só DOIS arquivos
  // físicos, não cinco: o dispatcher (rathena/db/job_stats.yml:87-119) só
  // declara UM slot de import pro domínio JOB_STATS inteiro — as 4
  // categorias (peso/HP-SP/exp/ASPD) mescladas em job_stats.yml; skill_tree
  // é o loader separado de sempre, com o próprio slot.
  if (hasRoDatabase()) {
    const writer = new JobDatabaseWriter(
      {
        jobStats: join(REPO_ROOT, "rathena-db-import", "job_stats.yml"),
        skillTree: join(REPO_ROOT, "rathena-db-import", "skill_tree.yml"),
      },
      {
        // db/re — só pra validação cruzada enxergar classes NUNCA editadas
        // pelo painel (ex.: Ninja herda de Novice, que ninguém tocou ainda).
        jobStats: join(REPO_ROOT, "rathena", "db", "re", "job_stats.yml"),
        jobBasepoints: join(REPO_ROOT, "rathena", "db", "re", "job_basepoints.yml"),
        jobExp: join(REPO_ROOT, "rathena", "db", "re", "job_exp.yml"),
        jobAspd: join(REPO_ROOT, "rathena", "db", "re", "job_aspd.yml"),
        skillTree: join(REPO_ROOT, "rathena", "db", "re", "skill_tree.yml"),
      },
    );
    return new YamlJobClassRepository(catalog, skillRepository, writer);
  }
  return catalog;
}

function defaultSkillRepository(): SkillRepository {
  const catalog: SkillRepository =
    env.supabaseUrl && env.supabaseServiceRoleKey
      ? new SupabaseSkillRepository(env.supabaseUrl, env.supabaseServiceRoleKey)
      : new JsonSkillRepository(
          process.env.SKILLS_DATA_PATH ?? join(__dirname, "..", "data", "skills.json"),
          join(REPO_ROOT, "tools", "legacy-migration", "output", "skills.json"),
        );

  // Skill não tem tabela SQL no rAthena: o que o servidor lê é YAML. Com o
  // db/import ligado ao repo (scripts/wsl-setup.sh), salvar no painel escreve
  // o override e pede @reloadskilldb — o catálogo acima continua sendo a
  // lista completa.
  if (hasRoDatabase()) {
    return new YamlSkillRepository(catalog, join(REPO_ROOT, "rathena-db-import", "skill_db.yml"));
  }
  return catalog;
}

function defaultStatusRepository(skillRepository: SkillRepository): StatusRepository {
  const catalog: StatusRepository =
    env.supabaseUrl && env.supabaseServiceRoleKey
      ? new SupabaseStatusRepository(env.supabaseUrl, env.supabaseServiceRoleKey)
      : new JsonStatusRepository(
          process.env.STATUSES_DATA_PATH ?? join(__dirname, "..", "data", "statuses.json"),
          join(REPO_ROOT, "tools", "legacy-migration", "output", "statuses.json"),
        );

  // status.yml não tem tabela SQL no rAthena — mesma situação de Skills,
  // resolvida do mesmo jeito: o catálogo acima continua sendo a lista
  // completa, e salvar no painel também escreve em db/import/status.yml
  // (slot de import único, sem a divisão multi-arquivo de Classes) e pede
  // @reloadstatusdb.
  if (hasRoDatabase()) {
    return new YamlStatusRepository(catalog, skillRepository, join(REPO_ROOT, "rathena-db-import", "status.yml"));
  }
  return catalog;
}

function defaultMonsterRepository(): MonsterRepository {
  // Mesma ordem do item: banco do rAthena manda (é o que o jogo lê).
  if (hasRoDatabase()) {
    return new MysqlMonsterRepository();
  }
  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    return new SupabaseMonsterRepository(env.supabaseUrl, env.supabaseServiceRoleKey);
  }
  return new JsonMonsterRepository(
    process.env.MONSTERS_DATA_PATH ?? join(__dirname, "..", "data", "monsters.json"),
    join(REPO_ROOT, "tools", "legacy-migration", "output", "monsters.json"),
  );
}

function defaultNpcRepository(): NpcRepository {
  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    return new SupabaseNpcRepository(env.supabaseUrl, env.supabaseServiceRoleKey);
  }
  return new JsonNpcRepository(
    process.env.NPCS_DATA_PATH ?? join(__dirname, "..", "data", "npcs.json"),
    join(REPO_ROOT, "tools", "legacy-migration", "output", "npcs.json"),
  );
}

function defaultServerConfigRepository(): ServerConfigRepository {
  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    return new SupabaseServerConfigRepository(env.supabaseUrl, env.supabaseServiceRoleKey);
  }
  return new JsonServerConfigRepository(
    process.env.SERVER_CONFIG_DATA_PATH ?? join(__dirname, "..", "data", "server-config.json"),
  );
}

function defaultUserRepository(): UserRepository {
  // As contas do JOGO são as da tabela `login` do rAthena — não existe conta de
  // jogador fora dela. Com o MariaDB configurado, é ali que o /users olha.
  if (hasRoDatabase()) {
    return new MysqlUserRepository();
  }
  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    return new SupabaseUserRepository(env.supabaseUrl, env.supabaseServiceRoleKey);
  }
  // sem Supabase não há contas reais — stub vazio (dev/testes)
  return new MemoryUserRepository();
}

function defaultMapRepository(): MapRepository {
  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    return new SupabaseMapRepository(env.supabaseUrl, env.supabaseServiceRoleKey);
  }
  return new JsonMapRepository(
    process.env.MAPS_DATA_PATH ?? join(__dirname, "..", "data", "maps"),
    join(REPO_ROOT, "tools", "legacy-migration", "output", "maps"),
  );
}

function defaultSecurity(): SecurityContext | null {
  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    return new SupabaseSecurity(env.supabaseUrl, env.supabaseServiceRoleKey);
  }
  return null;
}

export async function buildServer(deps: ServerDeps = {}) {
  // bodyLimit alto: mapas grandes (ex.: 500×500 = 250k células → collision/surface
  // como arrays jsonb) passam de vários MB. Default do Fastify é 1MB → estourava
  // e resetava a conexão (browser via "Failed to fetch") ao salvar.
  const app = Fastify({ logger: true, bodyLimit: 64 * 1024 * 1024 });
  // methods explícitos: default do @fastify/cors só cobre GET/HEAD/POST,
  // o que bloqueia PUT/DELETE no preflight do browser
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });
  // Um mapa do rAthena tem 160.000 células (prt_fild08 = 400×400) e sai em
  // 1,73 MB de JSON — que comprime para ~13 KB, porque é a mesma string de
  // colisão repetida dezenas de milhares de vezes. Compressão resolve o
  // tamanho sem inventar formato binário nem paginar o mapa.
  await app.register(compress, { global: true, threshold: 1024, encodings: ["br", "gzip"] });

  const itemRepository = deps.itemRepository ?? defaultItemRepository();
  const security = deps.security === undefined ? defaultSecurity() : deps.security;
  app.log.info(`items backend: ${itemRepository.constructor.name}; auth: ${security ? "on" : "off"}`);
  if (!security) {
    app.log.warn("auth desabilitada (sem SUPABASE_URL/SERVICE_ROLE_KEY) — modo dev");
  }

  const skillRepository = deps.skillRepository ?? defaultSkillRepository();
  const jobClassRepository = deps.jobClassRepository ?? defaultJobClassRepository(skillRepository);
  const statusRepository = deps.statusRepository ?? defaultStatusRepository(skillRepository);

  app.get("/health", async () => ({ ok: true }));
  await app.register(itemRoutes(itemRepository, security), { prefix: "/items" });
  await app.register(jobClassRoutes(jobClassRepository, security), { prefix: "/job-classes" });
  await app.register(skillRoutes(skillRepository, security), { prefix: "/skills" });
  await app.register(statusRoutes(statusRepository, security), { prefix: "/statuses" });
  const monsterRepository = deps.monsterRepository ?? defaultMonsterRepository();
  await app.register(monsterRoutes(monsterRepository, security), { prefix: "/monsters" });
  const npcRepository = deps.npcRepository ?? defaultNpcRepository();
  const npcScriptRoot = deps.npcScriptRoot === undefined ? join(REPO_ROOT, "rathena") : deps.npcScriptRoot;
  await app.register(npcRoutes(npcRepository, security, npcScriptRoot), { prefix: "/npcs" });
  const serverConfigRepository = deps.serverConfigRepository ?? defaultServerConfigRepository();
  await app.register(serverConfigRoutes(serverConfigRepository, security), { prefix: "/server-config" });
  const userRepository = deps.userRepository ?? defaultUserRepository();
  await app.register(userRoutes(userRepository, security), { prefix: "/users" });
  const mapRepository = deps.mapRepository ?? defaultMapRepository();
  await app.register(mapRoutes(mapRepository, security), { prefix: "/maps" });
  // controle do servidor (recarregar bases sem reiniciar) — só existe com o
  // MariaDB do rAthena configurado
  if (hasRoDatabase()) {
    await app.register(serverControlRoutes(security), { prefix: "/server" });
  }

  return app;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("src/server.ts");
if (isMain) {
  const app = await buildServer();
  await app.listen({ port: PORT, host: "0.0.0.0" });
}
