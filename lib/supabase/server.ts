import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { SUPABASE_AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import { subjectFromAccessToken } from "@/lib/supabase/middleware";

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

/**
 * A client plus the viewer, so a page's queries need not wait for the auth
 * server: `claimedId` is read from the session cookie, and `verified` checks
 * that same token with the auth server meanwhile. Only `verified` says who the
 * viewer is; queries keyed on `claimedId` stay safe because PostgREST checks
 * the token too and RLS applies.
 */
export async function createClientWithViewer(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  claimedId: string | null;
  verified: Promise<User | null>;
}> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    supabase,
    claimedId: subjectFromAccessToken(token),
    verified: token
      ? supabase.auth.getUser(token).then(({ data: { user } }) => user ?? null, () => null)
      : Promise.resolve(null),
  };
}
