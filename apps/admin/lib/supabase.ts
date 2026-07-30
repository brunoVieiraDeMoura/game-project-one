import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Browser client (anon key — client-safe; RLS fechado, banco só é acessado
 * pela API). Usado apenas para autenticação: login → access token → Bearer
 * nas chamadas à API. null quando env ausente = modo dev sem auth (espelha
 * a API com auth off).
 */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
