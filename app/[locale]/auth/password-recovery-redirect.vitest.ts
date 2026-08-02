import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the invariant that made password reset silently fail for every
 * user who ever tried it (13 users, 24 recovery requests, ZERO successful
 * password changes — auth.audit_log_entries had no `user_modified` event
 * after 2025-10-14).
 *
 * The mechanism: `resetPasswordForEmail({ redirectTo })` produces a link to
 * Supabase's `/auth/v1/verify`, which consumes the token server-side and
 * 303s to `redirect_to` with the session in the URL **fragment**
 * (`#access_token=...`). Fragments are never transmitted to the server.
 *
 * So the redirect target MUST be a client-rendered page. Pointing it at a
 * route handler (`app/auth/callback/route.ts`) means the handler sees no
 * token, treats it as a failed auth, and bounces to /auth/login — where the
 * browser client quietly consumes the fragment and logs the user in without
 * ever showing the set-password form. The user is left believing the reset
 * "didn't work" because their password genuinely never changed.
 *
 * This is a source-level assertion on purpose: the failure is invisible to
 * unit tests (the code throws nothing and returns no error) and invisible to
 * a browser check unless you complete a real reset and then try the NEW
 * password on a later login.
 */

const FORGOT_PASSWORD = path.join(
  process.cwd(),
  "app",
  "[locale]",
  "auth",
  "forgot-password",
  "page.tsx"
);

const RESET_PASSWORD = path.join(
  process.cwd(),
  "app",
  "[locale]",
  "auth",
  "reset-password",
  "page.tsx"
);

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

/** The `redirectTo: ...` argument passed to resetPasswordForEmail. */
function recoveryRedirectTarget(src: string): string {
  const call = src.match(/resetPasswordForEmail\s*\([\s\S]*?\n\s*\);/);
  expect(call, "resetPasswordForEmail call not found").toBeTruthy();
  const redirect = call![0].match(/redirectTo:\s*([^\n,]+)/);
  expect(redirect, "redirectTo not found on resetPasswordForEmail").toBeTruthy();
  return redirect![1].trim();
}

describe("password recovery redirect", () => {
  const forgotSrc = read(FORGOT_PASSWORD);

  it("does not send recovery links to a server route handler", () => {
    const target = recoveryRedirectTarget(forgotSrc);
    // app/auth/callback/route.ts cannot see the URL fragment that carries
    // the recovery session. Anything landing there loses the session.
    expect(target).not.toMatch(/auth\/callback/);
  });

  it("sends recovery links to the set-new-password page", () => {
    const target = recoveryRedirectTarget(forgotSrc);
    expect(target).toMatch(/auth\/reset-password/);
  });

  it("locale-prefixes the recovery link so non-en users get their language", () => {
    const target = recoveryRedirectTarget(forgotSrc);
    // getLocaleUrl() applies the `as-needed` prefix (en bare, others /it,
    // /es, /pt). A bare window.location.origin template would dump every
    // locale onto the English page.
    expect(target).toMatch(/getLocaleUrl\(/);
  });

  it("the reset page is a client component that can read the fragment", () => {
    const resetSrc = read(RESET_PASSWORD);
    expect(resetSrc.slice(0, 200)).toMatch(/^["']use client["'];/);
  });

  it("the reset page waits for the async fragment parse before giving up", () => {
    const resetSrc = read(RESET_PASSWORD);
    // detectSessionInUrl resolves asynchronously; a bare one-shot
    // getSession() races it and renders "invalid link" for a good link.
    expect(resetSrc).toMatch(/onAuthStateChange/);
  });

  it("the reset page surfaces an expired link instead of an unusable form", () => {
    const resetSrc = read(RESET_PASSWORD);
    // Supabase reports a dead link as #error=access_denied&error_code=...
    expect(resetSrc).toMatch(/error=/);
  });
});
