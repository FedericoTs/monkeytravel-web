/**
 * How a person arrived at /trips/new step 1 — derived ONCE from values
 * latched on the wizard's first render, never from live auth state.
 *
 * Why latched: components/analytics/AuthEventTracker.tsx strips ?auth_event
 * with history.replaceState as soon as auth resolves, and useSearchParams
 * follows, so a live read a few hundred milliseconds later sees nothing. And
 * why not auth state: isAuthenticated resolves asynchronously after
 * hydration — keying the h1 on it would paint one heading and swap to
 * another, which is both a layout shift and a lie to anyone who read the
 * first one.
 *
 * Pure functions so the branching is unit-tested without rendering the
 * 4,700-line wizard.
 */

export type MastheadVariant = "cold" | "firstRun" | "prefill";

export type WizardEntryState =
  | "fresh_signup"
  | "blog_prefill"
  | "claimed"
  | "authed"
  | "cold_anon";

/**
 * The auth_event values that mean "this account was created moments ago".
 * app/auth/callback/route.ts emits signup_email only for a FIRST email
 * confirmation (login_count 0 and the account under a week old); a returning
 * magic-link login carries email_confirmed and a returning Google login
 * login_google — neither is a first run.
 */
const FIRST_RUN_AUTH_EVENTS: ReadonlySet<string> = new Set(["signup_email", "signup_google"]);

export function isFirstRunAuthEvent(authEvent: string | null | undefined): boolean {
  return Boolean(authEvent && FIRST_RUN_AUTH_EVENTS.has(authEvent));
}

/** First run wins over prefill: a fresh account arriving via an article is still a fresh account. */
export function pickMastheadVariant(input: {
  authEventAtMount: string | null | undefined;
  prefillAtMount: boolean;
}): MastheadVariant {
  if (isFirstRunAuthEvent(input.authEventAtMount)) return "firstRun";
  if (input.prefillAtMount) return "prefill";
  return "cold";
}

/** The PostHog super-property value that lets every wizard event be sliced by arrival. */
export function deriveEntryState(input: {
  authEventAtMount: string | null | undefined;
  prefillAtMount: boolean;
  claimedTripId: string | null;
  isAuthenticated: boolean | null;
}): WizardEntryState {
  if (isFirstRunAuthEvent(input.authEventAtMount)) return "fresh_signup";
  if (input.prefillAtMount) return "blog_prefill";
  if (input.claimedTripId) return "claimed";
  if (input.isAuthenticated) return "authed";
  return "cold_anon";
}

/**
 * Resolve the step-1 variant from its three levers, most specific first:
 * a ?step1= query override (QA), the env force (covers ad-blocked browsers,
 * needs a redeploy), then the PostHog flag — where an UNRESOLVED value is ON.
 * The flag is a kill switch: only an explicit false turns the classic branch
 * on, so a blocked SDK or a slow flag fetch never flashes the old layout at
 * the 90%.
 */
export function resolveEditorialStep1(input: {
  queryOverride: string | null;
  envForce: string | undefined;
  flagValue: boolean | undefined;
}): boolean {
  if (input.queryOverride === "classic") return false;
  if (input.queryOverride === "editorial") return true;
  if (input.envForce === "classic") return false;
  return input.flagValue !== false;
}
