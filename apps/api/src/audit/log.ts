import type { AdminIdentity, SecurityContext } from "../auth/security.js";
import { diffFields, type FieldChange } from "./diff.js";

/**
 * Ponte genérica entre uma rota admin e `admin_audit_log` (Supabase, schema
 * já existente — `supabase/migrations/20260717000001_initial.sql`). Não cria
 * tabela nova: `payload` já é `jsonb` livre, então a estrutura pedida pela
 * auditoria (entidade/campo/valorAnterior/valorNovo) mora dentro dele.
 * `target_type`/`target_id`/`action`/`actor_account_id`/`at` (colunas de
 * verdade) cobrem entidade/id/ação/admin/timestamp.
 *
 * Chamado do PONTO em que a persistência já foi confirmada (depois de
 * `repo.create`/`repo.update`/`repo.remove` retornar com sucesso) — nunca
 * antes. Se a persistência falhar, a rota nem chega a chamar isto, então não
 * existe log de sucesso para uma escrita que não aconteceu (PARTE 14).
 */

export interface AuditPayload {
  entityName: string;
  source: string;
  /** presente só em update — omitido (sem log nenhum) quando `changes` fica vazio */
  changes?: FieldChange[];
  /** presente em create/delete — snapshot do registro no momento da ação */
  snapshot?: unknown;
}

interface AuditTarget {
  security: SecurityContext | null;
  admin: AdminIdentity | null;
  targetType: string;
  targetId: string;
  source: string;
}

export async function logCreate(target: AuditTarget, entityName: string, snapshot: unknown): Promise<void> {
  const { security, admin, targetType, targetId, source } = target;
  if (!admin || !security) return;
  const payload: AuditPayload = { entityName, source, snapshot };
  await security.audit({ actor: admin, action: "create", targetType, targetId, payload });
}

/** Só grava se `before`/`after` realmente diferem em algum campo — uma
 * edição que salva o mesmo valor (PARTE 10) não deve gerar linha nenhuma. */
export async function logUpdate(
  target: AuditTarget,
  entityName: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): Promise<void> {
  const { security, admin, targetType, targetId, source } = target;
  if (!admin || !security) return;
  const changes = diffFields(before, after);
  if (changes.length === 0) return;
  const payload: AuditPayload = { entityName, source, changes };
  await security.audit({ actor: admin, action: "update", targetType, targetId, payload });
}

export async function logDelete(target: AuditTarget, entityName: string, snapshot: unknown): Promise<void> {
  const { security, admin, targetType, targetId, source } = target;
  if (!admin || !security) return;
  const payload: AuditPayload = { entityName, source, snapshot };
  await security.audit({ actor: admin, action: "delete", targetType, targetId, payload });
}
