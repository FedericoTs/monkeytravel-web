import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Adds `Secure` to the auth cookie. @supabase/ssr's defaults omit it
      // entirely — see lib/supabase/cookie-options.ts.
      cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}

/**
 * The signed-in user's id, or null. Without a session cookie auth-js answers
 * locally, so anonymous visitors pay no round trip. Never throws: a page that
 * only needs to know who is looking must not fail on an auth hiccup.
 */
export async function signedInUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}
