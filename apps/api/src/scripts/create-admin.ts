import { createClient } from "@supabase/supabase-js";
import { env } from "../env.js";

/**
 * Bootstrap do primeiro admin:
 *   pnpm --filter @ragnarok/api create:admin <email> <senha> [username]
 *
 * Cria usuário no Supabase Auth (email confirmado) + linha em accounts com
 * group_level 99. Idempotente: reaproveita auth user existente e faz upsert
 * da account por username.
 */

const [email, password, usernameArg] = process.argv.slice(2);
if (!email || !password) {
  console.error("uso: create:admin <email> <senha> [username]");
  process.exit(1);
}
const username = usernameArg ?? email.split("@")[0]!;

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes em apps/api/.env");
  process.exit(1);
}

const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let userId: string;
const { data: created, error: createError } = await client.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (createError) {
  // já existe → localizar por email (idempotência)
  const { data: list, error: listError } = await client.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (listError || !existing) {
    console.error(`falha ao criar auth user: ${createError.message}`);
    process.exit(1);
  }
  userId = existing.id;
  console.log(`auth user já existia (${userId}) — atualizando senha`);
  const { error: pwError } = await client.auth.admin.updateUserById(userId, { password });
  if (pwError) {
    console.error(`falha ao atualizar senha: ${pwError.message}`);
    process.exit(1);
  }
} else {
  userId = created.user.id;
  console.log(`auth user criado (${userId})`);
}

const { error: accountError } = await client.from("accounts").upsert(
  { username, email, group_level: 99, auth_user_id: userId },
  { onConflict: "username" },
);
if (accountError) {
  console.error(`falha ao gravar account: ${accountError.message}`);
  process.exit(1);
}

console.log(`admin pronto: ${username} <${email}> group_level=99`);
