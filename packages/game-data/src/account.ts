import { z } from "zod";

/**
 * Accounts + admin auditing (soul.txt §5.8). Mirrors rAthena `login`
 * table relationships (account → chars) in readable form.
 */

export const AccountBanSchema = z.object({
  reason: z.string().min(1),
  bannedAt: z.string(),
  /** null = permanent */
  expiresAt: z.string().nullable(),
  bannedByAccountId: z.number().int(),
});

export const AccountSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1),
  email: z.string().email().optional(),
  groupLevel: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable().default(null),
  ban: AccountBanSchema.nullable().default(null),
  characterIds: z.array(z.number().int()).default([]),
});
export type Account = z.infer<typeof AccountSchema>;

export const LoginHistoryEntrySchema = z.object({
  accountId: z.number().int(),
  at: z.string(),
  ip: z.string(),
});
export type LoginHistoryEntry = z.infer<typeof LoginHistoryEntrySchema>;

export const AdminAuditEntrySchema = z.object({
  id: z.number().int(),
  actorAccountId: z.number().int(),
  action: z.string(), // e.g. "ban", "unban", "item.update"
  targetType: z.string(), // "account" | "item" | "monster" | ...
  targetId: z.string(),
  reason: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  at: z.string(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>;
