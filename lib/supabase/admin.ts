import { createClient } from "@supabase/supabase-js";

/**
 * Create a Supabase admin client with service role key
 * This client bypasses RLS and can perform admin operations like creating users
 *
 * WARNING: Only use this in secure server-side contexts with proper admin authentication
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin credentials");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
