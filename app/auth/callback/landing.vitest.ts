import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Where the callback sends someone after a successful sign-in.
 *
 * Two ways this went wrong before 2026-09-24:
 *   - `next` could itself be a callback URL (the send-email hook nested it).
 *     The route redirected into a second callback with no code, and a
 *     signed-in user landed on /auth/login?error=auth_incomplete.
 *   - The locale prefix was added unconditionally, so a `next` that already
 *     carried one became /pt/pt/...
 * Supabase is mocked; the route's own redirect logic runs for real.
 */

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
const profile = { id: "u1", onboarding_completed: true, welcome_completed: true, login_count: 4, profile_completed: true };

function usersTable() {
  const chain = {
    select: () => chain,
    update: () => chain,
    eq: () => chain,
    single: async () => ({ data: profile, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { verifyOtp, exchangeCodeForSession },
    from: () => usersTable(),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: vi.fn() }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, delete: () => {} }),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});
vi.mock("@/lib/analytics/wizard-event-server", () => ({ logWizardStepServer: vi.fn() }));
vi.mock("@/lib/explore/counters", () => ({ runTripCounter: vi.fn() }));

import { GET } from "./route";

const APP = "https://monkeytravel.app";
// An account from long before the test, so this is a returning login.
const user = { id: "u1", created_at: "2025-01-01T00:00:00Z" };

async function landing(query: string): Promise<URL> {
  const res = await GET(new Request(`${APP}/auth/callback?${query}`));
  expect(res.status).toBeGreaterThanOrEqual(300);
  expect(res.status).toBeLessThan(400);
  return new URL(res.headers.get("location")!);
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({ data: { user }, error: null });
  exchangeCodeForSession.mockResolvedValue({ data: { user }, error: null });
});

describe("an emailed link whose next is itself a callback URL", () => {
  it("lands on the destination, not on a second callback", async () => {
    const nested = encodeURIComponent("/auth/callback?next=%2Ftrips%2Fnew");
    const url = await landing(`token_hash=h&type=magiclink&locale=en&next=${nested}`);
    expect(url.pathname).toBe("/trips/new");
  });

  it("lands a Portuguese link on the Portuguese page (the old 404)", async () => {
    // Links emailed before the fix: the hook set locale=en from an account
    // with no stored language, but the sign-in started on a /pt/ page. The
    // page is the better signal.
    const nested = encodeURIComponent("/pt/auth/callback?next=%2Ftrips%2Fnew");
    const url = await landing(`token_hash=h&type=magiclink&locale=en&next=${nested}`);
    expect(url.pathname).toBe("/pt/trips/new");
  });

  it("takes the language from the link when next names none", async () => {
    const url = await landing(`token_hash=h&type=magiclink&locale=it&next=%2Ftrips%2Fnew`);
    expect(url.pathname).toBe("/it/trips/new");
  });
});

describe("locale prefix", () => {
  it("is added once for an unprefixed next", async () => {
    const url = await landing(`code=c&next=%2Ftrips%2Fnew&locale=pt`);
    expect(url.pathname).toBe("/pt/trips/new");
  });

  it("is not doubled when next already has one (invite links)", async () => {
    const url = await landing(`token_hash=h&type=magiclink&locale=pt&next=${encodeURIComponent("/pt/invite/tok")}`);
    expect(url.pathname).toBe("/pt/invite/tok");
  });

  it("ignores a locale the site does not serve", async () => {
    const url = await landing(`code=c&next=%2Ftrips%2Fnew&locale=${encodeURIComponent("/evil")}`);
    expect(url.origin).toBe(APP);
    expect(url.pathname).toBe("/trips/new");
  });
});

describe("safety", () => {
  it("still refuses an off-site next, nested or not", async () => {
    // The origin is always the callback's own, so assert the path: a refused
    // next falls back to /trips rather than carrying the payload along.
    for (const next of [
      "https://evil.com",
      `/auth/callback?next=${encodeURIComponent("//evil.com")}`,
      `/pt/auth/callback?next=${encodeURIComponent("https://evil.com")}`,
    ]) {
      const url = await landing(`code=c&locale=en&next=${encodeURIComponent(next)}`);
      expect(url.origin).toBe(APP);
      expect(url.pathname).toMatch(/^(\/pt)?\/trips$/);
      expect(url.href).not.toContain("evil");
    }
  });
});
