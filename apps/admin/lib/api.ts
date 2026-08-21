import type {
  Account,
  AdminAuditEntry,
  Element,
  Item,
  ItemSubType,
  ItemType,
  JobClass,
  LoginHistoryEntry,
  Monster,
  Npc,
  NpcKind,
  NpcOrigin,
  ServerConfig,
  Skill,
  StatusCategory,
  StatusEffectDef,
  StatusGroup,
} from "@ragnarok/game-data";
import type { GameMap } from "@ragnarok/map-format";
import { supabase } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ItemListResponse {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401 && supabase && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("401: sessão expirada — redirecionando pro login");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      // recusa do Writer/sync de NPC (PUT /npcs/:id): `error` é só o
      // discriminante curto ("writer-refused"/"stale-source"/"not-editable"/
      // "operational") — o MOTIVO de verdade está em `message`. Sem isto o
      // Admin mostrava "422: writer-refused" sem dizer POR QUÊ (achado
      // testando o fluxo real contra um NPC com comentário protegido).
      if (typeof body.message === "string") {
        detail = body.message;
      } else {
        detail = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
      }
    } catch {
      // keep statusText
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export interface ItemListParams {
  page: number;
  pageSize: number;
  search?: string;
  type?: ItemType;
  subType?: ItemSubType;
}

export function listItems(p: ItemListParams): Promise<ItemListResponse> {
  const params = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) });
  if (p.search?.trim()) params.set("search", p.search.trim());
  if (p.type) params.set("type", p.type);
  if (p.subType) params.set("subType", p.subType);
  return fetch(`${API_URL}/items?${params}`).then((r) => handle<ItemListResponse>(r));
}

export function getItem(id: number): Promise<Item> {
  return fetch(`${API_URL}/items/${id}`).then((r) => handle<Item>(r));
}

export async function createItem(item: Item): Promise<Item> {
  const res = await fetch(`${API_URL}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(item),
  });
  return handle<Item>(res);
}

export async function updateItem(id: number, item: Item): Promise<Item> {
  const res = await fetch(`${API_URL}/items/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(item),
  });
  return handle<Item>(res);
}

export async function deleteItem(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/items/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return handle<{ ok: boolean }>(res);
}

/** upload de ícone (`POST /items/:id/icon`) — sem `Content-Type` de propósito:
 * o browser monta o boundary do multipart sozinho a partir do `FormData`. */
export async function uploadItemIcon(id: number, file: File): Promise<Item> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_URL}/items/${id}/icon`, {
    method: "POST",
    headers: await authHeaders(),
    body,
  });
  return handle<Item>(res);
}

export async function removeItemIcon(id: number): Promise<Item> {
  const res = await fetch(`${API_URL}/items/${id}/icon`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return handle<Item>(res);
}

export interface JobClassListResponse {
  jobClasses: JobClass[];
  total: number;
  page: number;
  pageSize: number;
}

export function listJobClasses(page: number, pageSize: number, search: string): Promise<JobClassListResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search.trim()) params.set("search", search.trim());
  return fetch(`${API_URL}/job-classes?${params}`).then((r) => handle<JobClassListResponse>(r));
}

export function getJobClass(id: number): Promise<JobClass> {
  return fetch(`${API_URL}/job-classes/${id}`).then((r) => handle<JobClass>(r));
}

export async function createJobClass(jobClass: JobClass): Promise<JobClass> {
  const res = await fetch(`${API_URL}/job-classes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(jobClass),
  });
  return handle<JobClass>(res);
}

export async function updateJobClass(id: number, jobClass: JobClass): Promise<JobClass> {
  const res = await fetch(`${API_URL}/job-classes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(jobClass),
  });
  return handle<JobClass>(res);
}

export async function deleteJobClass(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/job-classes/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return handle<{ ok: boolean }>(res);
}

export interface SkillListResponse {
  skills: Skill[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SkillListParams {
  page: number;
  pageSize: number;
  search?: string;
  /** prefixos crus do aegisName (ex. ["SM","KN"]) — ver skillClassFilterOptions() */
  classPrefix?: string[];
}

export function listSkills(p: SkillListParams): Promise<SkillListResponse> {
  const params = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) });
  if (p.search?.trim()) params.set("search", p.search.trim());
  if (p.classPrefix && p.classPrefix.length > 0) params.set("classPrefix", p.classPrefix.join(","));
  return fetch(`${API_URL}/skills?${params}`).then((r) => handle<SkillListResponse>(r));
}

export function getSkill(id: number): Promise<Skill> {
  return fetch(`${API_URL}/skills/${id}`).then((r) => handle<Skill>(r));
}

export async function createSkill(skill: Skill): Promise<Skill> {
  const res = await fetch(`${API_URL}/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(skill),
  });
  return handle<Skill>(res);
}

export async function updateSkill(id: number, skill: Skill): Promise<Skill> {
  const res = await fetch(`${API_URL}/skills/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(skill),
  });
  return handle<Skill>(res);
}

export async function deleteSkill(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/skills/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return handle<{ ok: boolean }>(res);
}

export async function uploadSkillIcon(id: number, file: File): Promise<Skill> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_URL}/skills/${id}/icon`, {
    method: "POST",
    headers: await authHeaders(),
    body,
  });
  return handle<Skill>(res);
}

export async function removeSkillIcon(id: number): Promise<Skill> {
  const res = await fetch(`${API_URL}/skills/${id}/icon`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return handle<Skill>(res);
}

export interface StatusListResponse {
  statuses: StatusEffectDef[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StatusListParams {
  page: number;
  pageSize: number;
  search?: string;
  category?: StatusCategory;
  group?: StatusGroup;
}

export function listStatuses(p: StatusListParams): Promise<StatusListResponse> {
  const params = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) });
  if (p.search?.trim()) params.set("search", p.search.trim());
  if (p.category) params.set("category", p.category);
  if (p.group) params.set("group", p.group);
  return fetch(`${API_URL}/statuses?${params}`).then((r) => handle<StatusListResponse>(r));
}

/** catálogo inteiro pro dropdown do form de skills (soul §5.3) */
export function listAllStatuses(): Promise<StatusListResponse> {
  return fetch(`${API_URL}/statuses?pageSize=2000`).then((r) => handle<StatusListResponse>(r));
}

export function getStatus(id: string): Promise<StatusEffectDef> {
  return fetch(`${API_URL}/statuses/${id}`).then((r) => handle<StatusEffectDef>(r));
}

export async function createStatus(status: StatusEffectDef): Promise<StatusEffectDef> {
  const res = await fetch(`${API_URL}/statuses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(status),
  });
  return handle<StatusEffectDef>(res);
}

export async function updateStatus(id: string, status: StatusEffectDef): Promise<StatusEffectDef> {
  const res = await fetch(`${API_URL}/statuses/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(status),
  });
  return handle<StatusEffectDef>(res);
}

export async function deleteStatus(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/statuses/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return handle<{ ok: boolean }>(res);
}

export interface MonsterListResponse {
  monsters: Monster[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MonsterListParams {
  page: number;
  pageSize: number;
  search?: string;
  dropsItem?: number;
  levelMin?: number;
  levelMax?: number;
  element?: Element;
}

export function listMonsters(p: MonsterListParams): Promise<MonsterListResponse> {
  const params = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) });
  if (p.search?.trim()) params.set("search", p.search.trim());
  if (p.dropsItem !== undefined) params.set("dropsItem", String(p.dropsItem));
  if (p.levelMin !== undefined) params.set("levelMin", String(p.levelMin));
  if (p.levelMax !== undefined) params.set("levelMax", String(p.levelMax));
  if (p.element) params.set("element", p.element);
  return fetch(`${API_URL}/monsters?${params}`).then((r) => handle<MonsterListResponse>(r));
}

export function getMonster(id: number): Promise<Monster> {
  return fetch(`${API_URL}/monsters/${id}`).then((r) => handle<Monster>(r));
}

/** achado A23: sob backend MySQL, `spawns[]` não tem write-path
 * (`mysql-monster-row.ts` não tem coluna pra isso) — o form usa isto pra
 * avisar/travar a seção em vez de deixar a edição sumir em silêncio. */
export function getMonsterCapabilities(): Promise<{ spawnsWritable: boolean }> {
  return fetch(`${API_URL}/monsters/capabilities`).then((r) => handle<{ spawnsWritable: boolean }>(r));
}

export async function createMonster(monster: Monster): Promise<Monster> {
  const res = await fetch(`${API_URL}/monsters`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(monster),
  });
  return handle<Monster>(res);
}

export async function updateMonster(id: number, monster: Monster): Promise<Monster> {
  const res = await fetch(`${API_URL}/monsters/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(monster),
  });
  return handle<Monster>(res);
}

export async function deleteMonster(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/monsters/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return handle<{ ok: boolean }>(res);
}

export interface NpcListResponse {
  npcs: Npc[];
  total: number;
  page: number;
  pageSize: number;
}

/** @deprecated use `NpcKind` de @ragnarok/game-data */
export type NpcKindFilter = NpcKind;

export interface NpcListParams {
  page: number;
  pageSize: number;
  search?: string;
  kind?: NpcKind;
  mapId?: string;
  origin?: NpcOrigin;
}

export function listNpcs(p: NpcListParams): Promise<NpcListResponse> {
  const params = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) });
  if (p.search?.trim()) params.set("search", p.search.trim());
  if (p.kind) params.set("kind", p.kind);
  if (p.mapId?.trim()) params.set("mapId", p.mapId.trim());
  if (p.origin) params.set("origin", p.origin);
  return fetch(`${API_URL}/npcs?${params}`).then((r) => handle<NpcListResponse>(r));
}

export function getNpc(id: string): Promise<Npc> {
  return fetch(`${API_URL}/npcs/${encodeURIComponent(id)}`).then((r) => handle<Npc>(r));
}

export async function createNpc(npc: Npc): Promise<Npc> {
  const res = await fetch(`${API_URL}/npcs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(npc),
  });
  return handle<Npc>(res);
}

export async function updateNpc(id: string, npc: Npc): Promise<Npc> {
  const res = await fetch(`${API_URL}/npcs/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(npc),
  });
  return handle<Npc>(res);
}

export async function deleteNpc(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/npcs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return handle<{ ok: boolean }>(res);
}

export function getServerConfig(): Promise<ServerConfig> {
  return fetch(`${API_URL}/server-config`).then((r) => handle<ServerConfig>(r));
}

export async function updateServerConfig(
  config: Omit<ServerConfig, "version" | "updatedAt">,
): Promise<ServerConfig> {
  const res = await fetch(`${API_URL}/server-config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(config),
  });
  return handle<ServerConfig>(res);
}

// ---- Usuários (admin-only: header de auth em TODA chamada, inclusive GET) ----

export interface AccountListResponse {
  accounts: Account[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AccountDetail extends Account {
  loginHistory: LoginHistoryEntry[];
  banHistory: Account["ban"][];
}

export interface AuditListResponse {
  entries: AdminAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listAccounts(
  page: number,
  pageSize: number,
  search: string,
  bannedOnly = false,
): Promise<AccountListResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search.trim()) params.set("search", search.trim());
  if (bannedOnly) params.set("bannedOnly", "true");
  const res = await fetch(`${API_URL}/users?${params}`, { headers: await authHeaders() });
  return handle<AccountListResponse>(res);
}

export async function getAccount(id: number): Promise<AccountDetail> {
  const res = await fetch(`${API_URL}/users/${id}`, { headers: await authHeaders() });
  return handle<AccountDetail>(res);
}

export async function banAccount(id: number, reason: string, expiresAt: string | null): Promise<Account> {
  const res = await fetch(`${API_URL}/users/${id}/ban`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ reason, expiresAt }),
  });
  return handle<Account>(res);
}

export async function unbanAccount(id: number): Promise<Account> {
  const res = await fetch(`${API_URL}/users/${id}/unban`, {
    method: "POST",
    headers: await authHeaders(),
  });
  return handle<Account>(res);
}

export async function listAudit(
  page: number,
  pageSize: number,
  targetType?: string,
): Promise<AuditListResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (targetType?.trim()) params.set("targetType", targetType.trim());
  const res = await fetch(`${API_URL}/users/audit?${params}`, { headers: await authHeaders() });
  return handle<AuditListResponse>(res);
}

// ---- Mapas (Editor de mapas) ----

export interface MapSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  waterLevel: number | null;
  spawnCount: number;
  propCount: number;
  sourceLegacyMap?: string;
}

export interface MapListResponse {
  maps: MapSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export function listMaps(page: number, pageSize: number, search: string): Promise<MapListResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search.trim()) params.set("search", search.trim());
  return fetch(`${API_URL}/maps?${params}`).then((r) => handle<MapListResponse>(r));
}

export function getMap(id: string): Promise<GameMap> {
  return fetch(`${API_URL}/maps/${encodeURIComponent(id)}`).then((r) => handle<GameMap>(r));
}

export async function updateMap(id: string, map: GameMap): Promise<GameMap> {
  const res = await fetch(`${API_URL}/maps/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(map),
  });
  return handle<GameMap>(res);
}

/** cria um mapa novo (editor 3D "Novo mapa") — POST /maps */
export async function createMap(map: GameMap): Promise<GameMap> {
  const res = await fetch(`${API_URL}/maps`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(map),
  });
  return handle<GameMap>(res);
}

/** deleta um mapa — DELETE /maps/:id (admin) */
export async function deleteMap(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/maps/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status}`);
}

/**
 * Manda o servidor de jogo reler uma base (POST /server/reload).
 *
 * O rAthena carrega item_db/mob_db/skill_db para a memória na inicialização:
 * editar no painel muda o banco, mas o jogo em execução só enxerga depois
 * disto. A rota devolve 202 — quem aplica é um NPC do servidor, em até ~2s.
 */
export async function reloadServer(kind: "itemdb" | "mobdb" | "skilldb" | "script" | "battleconf"): Promise<void> {
  const res = await fetch(`${API_URL}/server/reload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ kind }),
  });
  if (!res.ok) throw new Error(`falha ao pedir reload (${res.status})`);
}

export interface ReloadQueueStatus {
  pending: number;
  recent: { id: number; kind: string; requested_at: string; done_at: string | null }[];
}

export async function reloadStatus(): Promise<ReloadQueueStatus> {
  const res = await fetch(`${API_URL}/server/reload`, { headers: await authHeaders() });
  return handle<ReloadQueueStatus>(res);
}
