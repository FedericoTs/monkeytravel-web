/**
 * Is this auth callback someone's FIRST arrival, or a returning login?
 *
 * Both callback branches need the same answer and used to compute it
 * separately — or, in the OAuth case, not at all:
 *
 *   - The PKCE/email branch already asked this question inline to choose
 *     between `signup_email` and `email_confirmed`.
 *   - The OAuth branch never asked. It has a "new user" block that rewrites
 *     `next="/trips"` to `"/trips/new"` and emits `signup_google`, but that
 *     block is gated on `!existingProfile`, and the `on_auth_user_created`
 *     trigger inserts public.users in the SAME transaction as auth.users —
 *     so the row always exists and the block has never run for a real signup
 *     (measured 2026-09-02: 100/100 Google signups in 30 days have a
 *     public.users row and 0/100 carry the flags that block sets). Every
 *     fresh Google account therefore took the returning path and was sent to
 *     `next` verbatim, which is "/trips" for anyone who signed in from the
 *     login page.
 *
 * That was invisible until 2026-09-02, because /trips redirected zero-trip
 * users to /trips/new and quietly repaired it. Removing that redirect (#87)
 * dropped 42 of every 100 Google signups onto an empty trip list — including
 * ~20/month who had generated an itinerary signed-out and whose localStorage
 * draft only auto-restores on the wizard.
 *
 * `login_count` alone cannot answer the question: accounts predating the
 * counter still sit at 0, and a magic-link login from one of them must not
 * read as a signup. A first arrival happens within hours of the account being
 * created, so age is the second half of the test.
 */

/** An account older than this is a returning login however low its login_count. */
export const FIRST_LOGIN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface FirstLoginInput {
  /** public.users.login_count as read BEFORE this callback increments it. Undefined when no profile row was found. */
  loginCount: number | null | undefined;
  /** auth.users.created_at. */
  accountCreatedAt: string | Date | null | undefined;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * True when this callback is the account's first arrival: it has never been
 * counted in, and it was created recently enough that "never counted in"
 * means "new" rather than "predates the counter".
 */
export function isFirstLogin({ loginCount, accountCreatedAt, now = Date.now() }: FirstLoginInput): boolean {
  if ((loginCount ?? 0) !== 0) return false;
  if (!accountCreatedAt) return false;
  const createdMs = accountCreatedAt instanceof Date
    ? accountCreatedAt.getTime()
    : new Date(accountCreatedAt).getTime();
  if (!Number.isFinite(createdMs)) return false;
  const age = now - createdMs;
  // A clock skew that puts creation slightly in the future is still "just created".
  return age < FIRST_LOGIN_MAX_AGE_MS;
}

/** The trip list a first arrival should never be dropped on. */
const TRIP_LIST_PATH = "/trips";
/** Where a first arrival goes instead. */
const WIZARD_PATH = "/trips/new";

/**
 * Where to send this callback. A first arrival whose destination is the
 * (necessarily empty) trip list goes to the wizard instead; every other
 * destination is honoured exactly, so an invite link, a shared trip or a
 * deliberate `?redirect=` still wins.
 */
export function resolveAuthLanding(next: string, firstLogin: boolean): string {
  if (!firstLogin) return next;
  const path = next.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return path === TRIP_LIST_PATH ? WIZARD_PATH : next;
}
