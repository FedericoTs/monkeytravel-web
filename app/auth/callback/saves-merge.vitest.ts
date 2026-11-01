import { describe, it, expect, vi, beforeEach } from "vitest";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Signing in moves the trips this browser saved anonymously onto the account,
 * then drops the saver cookie. A step that fails keeps the cookie, so the next
 * sign-in tries again instead of leaving those saves behind.
 */

const verifyOtp = vi.fn();
const deleteCookie = vi.fn();
let failing: "owned" | "rekey" | null;
let log: FakeQuery[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { verifyOtp, exchangeCodeForSession: vi.fn() },
    from: () => {
      const chain = {
        select: () => chain,
        update: () => chain,
        eq: () => chain,
        single: async () => ({ data: { id: "u1", onboarding_completed: true, welcome_completed: true, login_count: 4 }, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase((q) => {
      if (q.table !== "trip_saves") return { data: null, error: null };
      if (q.op === "select" && eqOf(q, "user_id")) {
        return failing === "owned" ? { data: null, error: { message: "timeout" } } : { data: [{ trip_id: "t-mine" }], error: null };
      }
      if (q.op === "select") return { data: [], error: null };
      if (q.op === "update") return failing === "rekey" ? { data: null, error: { message: "timeout" } } : { data: [{ trip_id: "t-saved" }], error: null };
      return { data: null, error: null };
    });
    log = fake.log;
    return fake.client;
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_saver_cookie" ? { value: "saver-1" } : undefined),
    delete: deleteCookie,
  }),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/analytics/wizard-event-server", () => ({ logWizardStepServer: vi.fn() }));
vi.mock("@/lib/explore/counters", () => ({ runTripCounter: vi.fn() }));

import { GET } from "./route";

const signIn = () => GET(new Request("https://monkeytravel.app/auth/callback?token_hash=h&type=magiclink&locale=en&next=%2Ftrips"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  verifyOtp.mockResolvedValue({ data: { user: { id: "u1", created_at: "2025-01-01T00:00:00Z" } }, error: null });
  failing = null;
  log = [];
});

describe("the anonymous saves merge at sign-in", () => {
  it("moves the saves onto the account, then drops the cookie", async () => {
    await signIn();
    expect(log.some((q) => q.table === "trip_saves" && q.op === "update")).toBe(true);
    expect(deleteCookie).toHaveBeenCalledWith("mt_saver_cookie");
  });

  it("keeps the cookie when the account's saves can't be read, and moves nothing", async () => {
    failing = "owned";
    await signIn();
    expect(log.some((q) => q.table === "trip_saves" && q.op === "update")).toBe(false);
    expect(deleteCookie).not.toHaveBeenCalled();
  });

  it("keeps the cookie when the move itself fails", async () => {
    failing = "rekey";
    await signIn();
    expect(deleteCookie).not.toHaveBeenCalled();
  });
});
