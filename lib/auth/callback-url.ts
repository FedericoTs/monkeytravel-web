import { isSafeNext } from "@/lib/security/safe-next";

/**
 * Where auth providers send people back to, and how the return trip is read.
 *
 * There is exactly one callback route, `app/auth/callback/route.ts`, and it is
 * not under `[locale]`. The UI language travels as a `locale` query param
 * instead, and the callback puts the prefix back on the page it lands on.
 *
 * WHY THIS MODULE EXISTS (2026-09-24)
 *
 * The save-trip prompt built `${origin}/${locale}/auth/callback?next=...` for
 * every language but English. No route matches that path, and middleware only
 * exempted the unprefixed one from i18n routing, so every es/it/pt sign-in
 * that started from the save prompt ended on a 404:
 *   - Google: the `?code=` was never exchanged. Supabase had already created
 *     the account, but no session was set. 46 sessions hit the 404 between
 *     2026-06-07 and 2026-09-24. One Portuguese user retried and ended up
 *     with two accounts.
 *   - Emailed link: the send-email hook turned the whole redirect URL into
 *     `next`, so the callback signed the user in and then redirected to
 *     `/pt/auth/callback?next=...`, which is the same 404.
 *
 * The emailed link was broken in English too. `next` became
 * `/auth/callback?next=/trips/new`, the callback ran a second time with no
 * code, and a signed-in user was sent to /auth/login?error=auth_incomplete.
 * In the page-view log that shows as `/auth/callback > /auth/callback >
 * /auth/login`: 3 of the 10 link sign-ins in the 60 days to 2026-09-24.
 * Referred email signups did the same, because the signup page's
 * emailRedirectTo is also a callback URL.
 *
 * So there are three things here:
 *   - build the callback URL one way, unprefixed (buildAuthCallbackUrl);
 *   - unwrap a `next` that is itself a callback URL (unwrapCallbackNext);
 *   - prefix a landing path at most once (localizePath).
 */

export const AUTH_CALLBACK_PATH = "/auth/callback";

/** Must match lib/i18n/routing.ts `locales` (a test enforces it). */
export const AUTH_LOCALES = ["en", "es", "it", "pt"] as const;
export type AuthLocale = (typeof AUTH_LOCALES)[number];
const DEFAULT_LOCALE: AuthLocale = "en";

const LOCALE_PREFIX = /^\/(en|es|it|pt)(?=[/?#]|$)/;

/** A supported locale, or undefined. Accepts "pt-BR" style values. */
export function normalizeAuthLocale(raw: unknown): AuthLocale | undefined {
  if (typeof raw !== "string") return undefined;
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return (AUTH_LOCALES as readonly string[]).includes(base) ? (base as AuthLocale) : undefined;
}

/** "/pt/trips/new?x=1" → { locale: "pt", rest: "/trips/new?x=1" }. */
export function splitLocalePrefix(path: string): { locale: AuthLocale | null; rest: string } {
  const match = path.match(LOCALE_PREFIX);
  if (!match) return { locale: null, rest: path };
  const rest = path.slice(match[0].length);
  return { locale: match[1] as AuthLocale, rest: rest.startsWith("/") ? rest : `/${rest}` };
}

function isCallbackRoute(pathWithQuery: string): boolean {
  const pathname = splitLocalePrefix(pathWithQuery).rest.split(/[?#]/)[0];
  return pathname === AUTH_CALLBACK_PATH || pathname === `${AUTH_CALLBACK_PATH}/`;
}

/**
 * Put the locale prefix on a landing path, at most once.
 *
 * The callback used to prefix unconditionally. So a `next` that already had a
 * prefix, like the invite page's `/pt/invite/<token>`, became `/pt/pt/...`
 * whenever the locale param was also pt.
 */
export function localizePath(path: string, locale: string | null | undefined): string {
  if (splitLocalePrefix(path).locale) return path;
  const l = normalizeAuthLocale(locale);
  if (!l || l === DEFAULT_LOCALE) return path;
  return `/${l}${path}`;
}

/**
 * The URL to hand Supabase as `redirectTo` / `emailRedirectTo`.
 *
 * Always the unprefixed route; the language goes in `locale`. `next` is the
 * UNprefixed destination: the callback adds the prefix.
 */
export function buildAuthCallbackUrl(
  origin: string,
  { next, locale }: { next: string; locale: string },
): string {
  const url = new URL(AUTH_CALLBACK_PATH, origin);
  url.searchParams.set("next", next);
  const l = normalizeAuthLocale(locale);
  if (l) url.searchParams.set("locale", l);
  return url.toString();
}

/**
 * If `next` is itself a callback URL, return what that URL was carrying.
 *
 * Returns the innermost non-callback destination (or null when the chain ends
 * without one) and the first locale found along the way: an explicit `locale`
 * param or a path prefix. Every hop's `next` goes through isSafeNext, so a
 * nested URL cannot smuggle out an absolute or protocol-relative target.
 */
export function unwrapCallbackNext(next: string): {
  next: string | null;
  locale: AuthLocale | undefined;
} {
  let current = next;
  let locale: AuthLocale | undefined;
  // Real nesting is one level deep; the limit only stops a crafted loop.
  for (let hop = 0; hop < 4; hop++) {
    const { locale: prefix, rest } = splitLocalePrefix(current);
    if (!isCallbackRoute(current)) {
      return { next: current, locale: locale ?? prefix ?? undefined };
    }
    const query = rest.includes("?") ? rest.slice(rest.indexOf("?") + 1).split("#")[0] : "";
    const params = new URLSearchParams(query);
    locale = locale ?? normalizeAuthLocale(params.get("locale")) ?? prefix ?? undefined;
    const inner = params.get("next");
    if (!isSafeNext(inner)) return { next: null, locale };
    current = inner;
  }
  return { next: null, locale };
}

/**
 * Middleware: `/pt/auth/callback?code=...` → `/auth/callback?code=...&locale=pt`.
 *
 * Keeps every query param, so a code still waiting in the browser is
 * redeemed. The PKCE verifier cookie is set on "/" of the same origin, so it
 * survives the hop. Returns null for any other path.
 */
export function unprefixedCallbackUrl(requestUrl: URL): URL | null {
  const { locale, rest } = splitLocalePrefix(requestUrl.pathname);
  if (!locale) return null;
  if (rest !== AUTH_CALLBACK_PATH && rest !== `${AUTH_CALLBACK_PATH}/`) return null;
  const target = new URL(requestUrl.toString());
  target.pathname = AUTH_CALLBACK_PATH;
  if (!normalizeAuthLocale(target.searchParams.get("locale"))) {
    target.searchParams.set("locale", locale);
  }
  return target;
}

/**
 * Send-email hook: read what the sign-in's redirect URL was asking for.
 *
 * `redirectTo` is what the client passed to Supabase. It is often a callback
 * URL itself (the save prompt, the signup page with a referral), and the hook
 * must lift that URL's `next` and `locale` out instead of nesting the whole
 * URL as the new link's `next`. Returns nothing for a foreign origin.
 */
export function callbackIntentFromRedirect(
  redirectTo: string | undefined,
  appUrl: string,
): { next?: string; ref?: string; locale?: AuthLocale } {
  if (!redirectTo) return {};
  let target: URL;
  let appOrigin: string;
  try {
    target = new URL(redirectTo, appUrl);
    appOrigin = new URL(appUrl).origin;
  } catch {
    return {};
  }
  if (target.origin !== appOrigin) return {};

  const ref = target.searchParams.get("ref") || undefined;
  target.searchParams.delete("ref");
  const qs = target.searchParams.toString();
  const unwrapped = unwrapCallbackNext(target.pathname + (qs ? `?${qs}` : ""));
  // "/" carries no intent, and the callback already routes brand-new users
  // to /trips/new on its own.
  const next = unwrapped.next && unwrapped.next !== "/" ? unwrapped.next : undefined;
  return {
    ...(next && { next }),
    ...(ref && { ref }),
    ...(unwrapped.locale && { locale: unwrapped.locale }),
  };
}
