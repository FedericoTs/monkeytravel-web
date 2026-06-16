import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getTrialEndDate } from "@/lib/trial";
import { safeNextOrDefault } from "@/lib/security/safe-next";
import type { EmailOtpType } from "@supabase/supabase-js";

const SAVER_COOKIE_NAME = "mt_saver_cookie";

/**
 * Build a redirect response that explicitly tells crawlers not to index
 * the callback URL.
 *
 * Why: GSC showed 45 organic landings on /auth/callback over 30 days,
 * meaning Google had indexed magic-link URLs leaked via email or social
 * shares. This is a privacy/UX problem (the page is a one-shot OAuth/PKCE
 * exchanger; landing there cold gets you "Could not authenticate") AND a
 * crawl-budget waste. /auth/callback is at app/auth/callback/route.ts,
 * outside the [locale]/auth layout that already carries
 * `robots: { index: false, follow: false }` — route handlers don't use
 * Metadata, so we set the header on the response instead.
 */
function noIndexRedirect(url: string): NextResponse {
  const response = NextResponse.redirect(url);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

/**
 * Read the first-touch UTM source captured by middleware.
 *
 * Returns null when there's no cookie OR the value looks malformed.
 * Used by both auth paths (PKCE + OAuth) to stamp
 * `users.acquisition_source` at profile-create time so partner-
 * reporting queries can answer "how many users came from Hostelworld".
 *
 * Middleware sets the cookie via captureUtmCookies (middleware.ts).
 */
async function readUtmSource(): Promise<string | null> {
  try {
    const store = await cookies();
    const raw = store.get("mt_utm_source")?.value;
    if (!raw) return null;
    // Match the middleware's whitelist for defence in depth.
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    return cleaned || null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // CRITICAL: never trust `next` as a redirect target without validation.
  // safeNextOrDefault rejects absolute URLs, protocol-relative URLs,
  // backslash variants, and CR/LF injection — the OAuth callback is a
  // post-auth surface where an open-redirect equals high-trust phishing.
  // See lib/security/safe-next.ts.
  const next = safeNextOrDefault(searchParams.get("next"), "/trips");
  const fromOnboarding = searchParams.get("from_onboarding") === "true";
  const referralCode = searchParams.get("ref");
  const locale = searchParams.get("locale") || "en";

  // Helper to build locale-prefixed URLs
  const getLocalePath = (path: string) => {
    if (locale === "en") {
      return path;
    }
    return `/${locale}${path}`;
  };

  const supabase = await createClient();

  // Handle email confirmation/magic link tokens (PKCE flow)
  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type,
    });

    if (!error && data.user) {
      // SPECIAL CASE: Password recovery - redirect to reset password page
      // The user is now authenticated with a session, so they can set a new password
      if (type === "recovery") {
        return noIndexRedirect(`${origin}${getLocalePath("/auth/reset-password")}`);
      }

      // Check if user profile exists
      // NOTE: capture `error` here. On a transient Supabase failure we
      // previously silently treated the returning user as a brand-new
      // signup (existingProfile === null), routing them to /trips/new
      // instead of `next=` and skipping the login_count bump.
      // PGRST116 = "no rows returned" from .single() — that's the
      // legitimate new-user path; anything else is a real error.
      const { data: existingProfile, error: selectError } = await supabase
        .from("users")
        .select("id, onboarding_completed, welcome_completed, login_count")
        .eq("id", data.user.id)
        .single();

      if (selectError && selectError.code !== "PGRST116") {
        const userId = data.user.id;
        console.error("[Auth Callback] users SELECT failed (PKCE):", selectError.message);
        import("@sentry/nextjs")
          .then((Sentry) => {
            Sentry.captureException?.(selectError, {
              tags: {
                source: "auth-callback",
                step: "select-existing-user",
                flow: "pkce",
                user_id: userId,
              },
            });
          })
          .catch(() => {
            /* Sentry not available — console.error above is the fallback */
          });
        return noIndexRedirect(
          `${origin}${getLocalePath("/auth/login?error=profile_lookup_failed")}`,
        );
      }

      // Email confirmation for new signup - profile was already created during signup
      // Just redirect them appropriately based on welcome/onboarding status
      // IMPORTANT: Preserve the original redirect URL so user returns to their intended destination
      const finalRedirect = next !== "/trips" ? next : "/trips/new"; // Prefer trips/new for new users

      if (existingProfile) {
        // Increment login_count for returning users (email confirmation/magic link)
        const { error: updateError } = await supabase
          .from("users")
          .update({
            login_count: ((existingProfile as { login_count?: number }).login_count || 0) + 1,
            // Auto-complete welcome and onboarding for users who haven't yet
            ...(!existingProfile.welcome_completed && { welcome_completed: true }),
            ...(!existingProfile.onboarding_completed && { onboarding_completed: true }),
          })
          .eq("id", data.user.id);

        if (updateError) {
          console.error("[Auth Callback] Failed to update user:", updateError.message);
        }

        // Re-key any anonymous (cookie-saved) bookmarks to this account
        // so the user's bookmark list survives signup. Best-effort.
        await mergeAnonymousSaves(data.user.id);

        // Skip welcome and onboarding — go straight to intended destination
        const separator = finalRedirect.includes("?") ? "&" : "?";
        return noIndexRedirect(`${origin}${getLocalePath(finalRedirect)}${separator}auth_event=email_confirmed`);
      }

      // Fallback: profile doesn't exist yet (edge case) - go straight to trips/new
      await mergeAnonymousSaves(data.user.id);
      return noIndexRedirect(`${origin}${getLocalePath(`${finalRedirect}?auth_event=email_confirmed`)}`);
    }

    // Token verification failed
    console.error("[Auth Callback] Token verification failed:", error?.message);

    // Provide more specific error messages
    const errorMessage = type === "recovery"
      ? "Password reset link is invalid or expired. Please request a new one."
      : error?.message || "Email confirmation failed";

    const redirectPath = type === "recovery"
      ? `/auth/forgot-password?error=${encodeURIComponent(errorMessage)}`
      : `/auth/login?error=${encodeURIComponent(errorMessage)}`;

    return noIndexRedirect(`${origin}${getLocalePath(redirectPath)}`);
  }

  // Handle OAuth code exchange
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Check if user profile exists, if not create one (for OAuth users)
      // NOTE: capture `error` here. Without it, a transient Supabase failure
      // returned existingProfile=null and silently flipped a returning user
      // into the new-user upsert branch (resetting trial dates, free trips,
      // preferences). PGRST116 = "no rows returned" = legitimate new user.
      const { data: existingProfile, error: selectError } = await supabase
        .from("users")
        .select("id, login_count, profile_completed")
        .eq("id", data.user.id)
        .single();

      if (selectError && selectError.code !== "PGRST116") {
        const userId = data.user.id;
        console.error("[Auth Callback] users SELECT failed (OAuth):", selectError.message);
        import("@sentry/nextjs")
          .then((Sentry) => {
            Sentry.captureException?.(selectError, {
              tags: {
                source: "auth-callback",
                step: "select-existing-user",
                flow: "oauth",
                user_id: userId,
              },
            });
          })
          .catch(() => {
            /* Sentry not available — console.error above is the fallback */
          });
        return noIndexRedirect(
          `${origin}${getLocalePath("/auth/login?error=profile_lookup_failed")}`,
        );
      }

      // Track whether this is a new user (signup) or returning user (login)
      const isNewUser = !existingProfile;

      if (isNewUser) {
        // Create profile for OAuth user
        const displayName =
          data.user.user_metadata?.full_name ||
          data.user.user_metadata?.name ||
          data.user.email?.split("@")[0] ||
          "User";

        // Acquisition source — captured from the mt_utm_source cookie
        // set by middleware when the user first arrived with a
        // `?utm_source=…` query. First-touch wins; never overwritten.
        // Used for partner reporting (e.g. "users from Hostelworld").
        const acquisitionSource = await readUtmSource();

        // Check if user already completed onboarding before signup
        // If from_onboarding=true, they completed anonymous onboarding first
        const onboardingCompleted = fromOnboarding;
        // Give all new users 2 free generations so they experience value before
        // hitting the beta code gate. Previously: 1 if from onboarding, 0 otherwise
        // — meaning most users were blocked immediately on their first attempt.
        const freeTripsRemaining = 2;

        // Capture `error` here. Previously this upsert was fire-and-forget:
        // if RLS rejected the row or the network blipped, the user proceeded
        // to /trips/new with NO users row — silently breaking paywall, usage
        // limits, notifications, and trial enforcement until they re-signed in.
        const { error: upsertError } = await supabase.from("users").upsert({
          id: data.user.id,
          email: data.user.email,
          display_name: displayName,
          avatar_url: data.user.user_metadata?.avatar_url || null,
          // UI language at signup time — drives the language we email them
          // in. `locale` comes from the OAuth callback query param the
          // signup/login pages append.
          preferred_language: locale,
          preferences: {}, // Will be filled by complete-profile page if from onboarding
          onboarding_completed: true, // Skip onboarding — users can personalize later in profile settings
          free_trips_remaining: freeTripsRemaining,
          welcome_completed: true, // Skip welcome gate — go straight to trip creation
          trial_ends_at: getTrialEndDate().toISOString(), // 7-day trial for existing feature
          is_pro: false,
          privacy_settings: {
            showLocation: false,
            showRealName: true,
            privateProfile: false,
            showTripHistory: false,
            showActivityStatus: true,
            allowLocationTracking: false,
            disableFriendRequests: false,
          },
          notification_settings: {
            dealAlerts: true,
            quietHoursEnd: 8,
            tripReminders: true,
            quietHoursStart: 22,
            pushNotifications: true,
            emailNotifications: true,
            socialNotifications: true,
            marketingNotifications: true, // opt-out: subscribed by default; false is written ONLY on an explicit unsubscribe, making it a reliable opt-out signal
          },
          // Add referral code if present
          ...(referralCode && { referred_by_code: referralCode }),
          // Add acquisition source if first-touch UTM cookie was set
          ...(acquisitionSource && { acquisition_source: acquisitionSource }),
        });

        if (upsertError) {
          const userId = data.user.id;
          console.error("[Auth Callback] users upsert failed (OAuth):", upsertError.message);
          import("@sentry/nextjs")
            .then((Sentry) => {
              Sentry.captureException?.(upsertError, {
                tags: {
                  source: "auth-callback",
                  step: "oauth-profile-upsert",
                  flow: "oauth",
                  user_id: userId,
                },
              });
            })
            .catch(() => {
              /* Sentry not available — console.error above is the fallback */
            });
          return noIndexRedirect(
            `${origin}${getLocalePath("/auth/login?error=profile_creation_failed")}`,
          );
        }

        // Re-key any anonymous (cookie-saved) bookmarks to this brand-
        // new account so the user's bookmark list survives signup.
        await mergeAnonymousSaves(data.user.id);

        // Skip welcome gate and onboarding — go straight to trip creation
        // Users can personalize their experience later in profile settings
        const finalRedirect = next !== "/trips" ? next : "/trips/new";

        if (fromOnboarding) {
          // User completed onboarding before signup - transfer preferences then go to trip creation
          const completeProfileUrl = `/auth/complete-profile?redirect=${encodeURIComponent(finalRedirect)}&auth_event=signup_google`;
          return noIndexRedirect(`${origin}${getLocalePath(completeProfileUrl)}`);
        } else {
          // New user — straight to trip creation, no gates
          const separator = finalRedirect.includes("?") ? "&" : "?";
          return noIndexRedirect(`${origin}${getLocalePath(finalRedirect)}${separator}auth_event=signup_google`);
        }
      }

      // Returning users - increment login count and go to destination
      const { error: updateError } = await supabase
        .from("users")
        .update({
          login_count: ((existingProfile as { login_count?: number }).login_count || 0) + 1,
        })
        .eq("id", data.user.id);

      if (updateError) {
        console.error("[Auth Callback] Failed to increment login_count (OAuth):", updateError.message);
      }

      // Returning user — they may have saved trips anonymously on this
      // device before logging back in (e.g. signed out, browsed, signed
      // back in). Merge those into their account.
      await mergeAnonymousSaves(data.user.id);

      const separator = next.includes("?") ? "&" : "?";
      const trackingParam = "auth_event=login_google";
      return noIndexRedirect(`${origin}${getLocalePath(next)}${separator}${trackingParam}`);
    }
  }

  // Return the user to an error page with instructions
  return noIndexRedirect(`${origin}${getLocalePath("/auth/login?error=Could not authenticate")}`);
}

/**
 * Merge any anonymous (cookie-keyed) trip_saves into the authenticated
 * account that just signed up / signed in.
 *
 * Background: trip_saves has a CHECK constraint that exactly ONE of
 * (user_id, saver_cookie_id) is set. Anon visitors save via the
 * mt_saver_cookie; when they later create an account, those rows are
 * still keyed by cookie and orphaned from their new user_id — meaning
 * their bookmark list silently empties on signup.
 *
 * Strategy (handles the dup-trip edge case — user already saved the
 * same trip authenticated on another device, which would violate the
 * UNIQUE(trip_id, user_id) constraint on re-key):
 *   1. Find cookie-saved trip_ids that the user ALREADY has under
 *      user_id (would conflict on UPDATE).
 *   2. DELETE those duplicate cookie rows.
 *   3. UPDATE the remaining cookie rows to swap saver_cookie_id →
 *      user_id.
 *   4. Clear the cookie — it's no longer the source of truth.
 *
 * Uses the service-role client because anon rows are invisible under
 * the new user's RLS context. Wrapped in try/catch — a merge failure
 * must NOT block auth (they can re-save manually).
 */
async function mergeAnonymousSaves(userId: string): Promise<void> {
  let cookieValue: string | undefined;
  let cookieStore: Awaited<ReturnType<typeof cookies>>;
  try {
    cookieStore = await cookies();
    cookieValue = cookieStore.get(SAVER_COOKIE_NAME)?.value;
  } catch {
    return;
  }
  if (!cookieValue) return;

  try {
    const admin = createAdminClient();

    // 1. Trips the user already has under user_id
    const { data: ownedRows } = await admin
      .from("trip_saves")
      .select("trip_id")
      .eq("user_id", userId);
    const ownedTripIds = (ownedRows ?? [])
      .map((r) => (r as { trip_id: string }).trip_id)
      .filter(Boolean);

    // 2. Cookie-saved trips that overlap with owned → would violate
    //    UNIQUE(trip_id, user_id) on re-key. Delete them.
    if (ownedTripIds.length > 0) {
      const { data: dupes } = await admin
        .from("trip_saves")
        .select("trip_id")
        .eq("saver_cookie_id", cookieValue)
        .in("trip_id", ownedTripIds);
      const dupeIds = (dupes ?? [])
        .map((r) => (r as { trip_id: string }).trip_id)
        .filter(Boolean);
      if (dupeIds.length > 0) {
        await admin
          .from("trip_saves")
          .delete()
          .eq("saver_cookie_id", cookieValue)
          .in("trip_id", dupeIds);
      }
    }

    // 3. Re-key remaining cookie rows to the user.
    await admin
      .from("trip_saves")
      .update({ user_id: userId, saver_cookie_id: null })
      .eq("saver_cookie_id", cookieValue);

    // 4. Cookie no longer needed. Best-effort — Next strict mode may
    //    reject cookie writes from a request handler in some paths.
    try {
      cookieStore.delete(SAVER_COOKIE_NAME);
    } catch {
      /* non-fatal */
    }
  } catch (err) {
    // Never fail auth on a merge failure. Worst case: the user can
    // re-save the trips manually.
    console.error("[auth-callback] anon save merge failed:", err);
  }
}
