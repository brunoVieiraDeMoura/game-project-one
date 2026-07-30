import type { FastifyReply, FastifyRequest } from "fastify";
import { ADMIN_MIN_GROUP_LEVEL, type AdminIdentity, type SecurityContext } from "./security";

/**
 * Resolves the acting admin for a mutating route.
 *
 * - security null (no Supabase env — local JSON dev mode): auth disabled,
 *   returns null and the route proceeds without audit actor.
 * - otherwise: requires `Authorization: Bearer <supabase access token>` from a
 *   provisioned admin (accounts.group_level >= ADMIN_MIN_GROUP_LEVEL).
 *   Sends 401/403 and returns undefined when denied — route must bail out.
 */
export async function requireAdmin(
  security: SecurityContext | null,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AdminIdentity | null | undefined> {
  if (!security) return null;

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    await reply.code(401).send({ error: "missing bearer token" });
    return undefined;
  }

  const admin = await security.verify(token);
  if (!admin) {
    await reply.code(401).send({ error: "invalid session" });
    return undefined;
  }
  if (admin.groupLevel < ADMIN_MIN_GROUP_LEVEL) {
    await reply.code(403).send({ error: "insufficient group level" });
    return undefined;
  }
  return admin;
}
