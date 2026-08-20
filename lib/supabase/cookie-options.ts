/**
 * Cookie attributes for the Supabase auth cookies (`sb-<ref>-auth-token`).
 *
 * WHY THIS FILE EXISTS
 *
 * `@supabase/ssr` ships these defaults (utils/constants.js, v0.8.0):
 *
 *     { path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 days }
 *
 * Note what is missing: `secure`. Until this file existed no
 * `cookieOptions` was passed anywhere in the app, so the session token — a
 * bearer credential — was written with NO Secure attribute by all three
 * clients (browser, server, middleware). A cookie without `Secure` is
 * eligible to be transmitted over plain http.
 *
 * At write time the library composes options as:
 *
 *     { ...DEFAULT_COOKIE_OPTIONS, ...options?.cookieOptions, maxAge }
 *
 * so anything set here wins over the defaults, on both the server clients
 * (real `Set-Cookie` headers) and the browser client (`document.cookie`).
 *
 * WHY `httpOnly` IS NOT SET HERE
 *
 * Not an oversight, and not something a flag can fix. `createBrowserClient`
 * stores the session in `document.cookie` and reads it back to answer
 * `auth.getUser()` / `onAuthStateChange`. Marking the cookie HttpOnly makes
 * it invisible to JavaScript, which is exactly the point — and also breaks
 * every client-side auth read in the app, including the global
 * `components/auth/AuthProvider.tsx` context and the password-recovery flow
 * in `app/[locale]/auth/reset-password/page.tsx`.
 *
 * Setting it here would ALSO be quietly asymmetric: browsers refuse to honour
 * HttpOnly from `document.cookie`, so the browser client would keep writing a
 * readable cookie while the server rewrote it as unreadable on the next
 * refresh — auth that works until it doesn't.
 *
 * Getting HttpOnly means making the server the only writer of the session:
 * move `signInWithPassword` to a server action, and feed client components
 * their user from server-rendered state instead of `auth.getUser()`. OAuth
 * and magic-link already exchange server-side in `app/auth/callback/route.ts`,
 * so that migration is tractable — but it is a change to the auth flows, not
 * a cookie attribute, and it is tracked separately.
 */

/**
 * `secure` is gated on the environment because a Secure cookie is silently
 * DROPPED over plain http — setting it unconditionally would break login on
 * localhost. Production is https-only (HSTS preload), so real sessions always
 * carry it.
 *
 * `sameSite: "lax"` and `path: "/"` restate the library defaults on purpose:
 * they are load-bearing (lax is what lets the OAuth redirect back from Google
 * carry the cookie) and should not silently change if upstream defaults move.
 */
export const SUPABASE_AUTH_COOKIE_OPTIONS = {
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;
