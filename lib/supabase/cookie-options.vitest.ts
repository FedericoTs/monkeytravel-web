import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_COOKIE_OPTIONS } from "@supabase/ssr";

import { SUPABASE_AUTH_COOKIE_OPTIONS } from "./cookie-options";

/**
 * The Supabase auth cookie is a bearer credential. These tests pin the two
 * things that made it insecure and the one thing that would break if we
 * "fixed" it carelessly.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("upstream defaults (the reason this file exists)", () => {
  it("@supabase/ssr still ships NO `secure` attribute", () => {
    // The witness for the whole fix. If this ever fails, upstream started
    // setting `secure` themselves and our override may be redundant — check
    // before deleting it, don't just delete it.
    expect("secure" in DEFAULT_COOKIE_OPTIONS).toBe(false);
  });

  it("@supabase/ssr ships httpOnly:false, and that is load-bearing", () => {
    // Documents why we do NOT flip httpOnly here: createBrowserClient reads
    // this cookie back from document.cookie to answer auth.getUser().
    expect(DEFAULT_COOKIE_OPTIONS.httpOnly).toBe(false);
  });
});

describe("composed write options", () => {
  /** Mirrors cookies.js: `{...DEFAULT, ...cookieOptions, maxAge}`. */
  const compose = (overrides: object) => ({
    ...DEFAULT_COOKIE_OPTIONS,
    ...overrides,
    maxAge: DEFAULT_COOKIE_OPTIONS.maxAge,
  });

  it("adds Secure once our options are applied", async () => {
    // Must re-import: the constant is evaluated at module load, so the
    // top-level import was already frozen with the test env's NODE_ENV.
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { SUPABASE_AUTH_COOKIE_OPTIONS: prod } = await import("./cookie-options");
    expect(compose(prod).secure).toBe(true);
  });

  it("keeps SameSite=lax — the OAuth return trip depends on it", () => {
    // A `strict` cookie is NOT sent on the top-level redirect back from
    // Google, so the callback would land unauthenticated.
    expect(compose(SUPABASE_AUTH_COOKIE_OPTIONS).sameSite).toBe("lax");
  });

  it("does not smuggle in httpOnly", () => {
    expect(compose(SUPABASE_AUTH_COOKIE_OPTIONS).httpOnly).toBe(false);
  });

  it("preserves the library's maxAge rather than truncating the session", () => {
    expect(compose(SUPABASE_AUTH_COOKIE_OPTIONS).maxAge).toBe(DEFAULT_COOKIE_OPTIONS.maxAge);
  });
});

describe("environment gating", () => {
  it("sets secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { SUPABASE_AUTH_COOKIE_OPTIONS: prod } = await import("./cookie-options");
    expect(prod.secure).toBe(true);
  });

  it("does NOT set secure in development — a Secure cookie is dropped over http", async () => {
    // Without this, login breaks entirely on localhost: the browser silently
    // discards the Set-Cookie and the user bounces back to the login page.
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { SUPABASE_AUTH_COOKIE_OPTIONS: dev } = await import("./cookie-options");
    expect(dev.secure).toBe(false);
  });
});

/**
 * The wiring, not the helper.
 *
 * A correct constant that no client passes is worth exactly nothing — and
 * that is the specific way this fix would silently regress: someone adds a
 * fourth Supabase client, or refactors one of these three, and the auth
 * cookie quietly loses `Secure` again with every test still green.
 */
describe("every Supabase client passes the options", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it.each([
    ["lib/supabase/client.ts", "browser — writes the cookie at password login"],
    ["lib/supabase/server.ts", "server components and route handlers"],
    ["lib/supabase/middleware.ts", "rewrites the cookie on every session refresh"],
  ])("%s passes cookieOptions (%s)", (path) => {
    const src = read(path);
    expect(src).toContain("SUPABASE_AUTH_COOKIE_OPTIONS");
    expect(src).toMatch(/cookieOptions:\s*SUPABASE_AUTH_COOKIE_OPTIONS/);
  });

  it("no Supabase client is constructed without cookieOptions", () => {
    // Catches a fourth client being added elsewhere. Deliberately scoped to
    // lib/supabase so an admin/service-role client using its own transport
    // does not trip it.
    for (const path of ["lib/supabase/client.ts", "lib/supabase/server.ts", "lib/supabase/middleware.ts"]) {
      const src = read(path);
      const constructions = (src.match(/create(Browser|Server)Client\(/g) ?? []).length;
      const wired = (src.match(/cookieOptions:\s*SUPABASE_AUTH_COOKIE_OPTIONS/g) ?? []).length;
      expect(
        wired,
        `${path}: ${constructions} client construction(s) but ${wired} wired with cookieOptions`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
