import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * SessionTracker sets the signed-in person's analytics properties from what it
 * reads. A refused read must not reset them to defaults (a pro account to
 * "free", a power user to "new"), so that page load sends nothing.
 */

const analytics = vi.hoisted(() => ({
  trackUserReturn: vi.fn(),
  setUserId: vi.fn(),
  setUserPropertiesEnhanced: vi.fn(),
}));
const posthog = vi.hoisted(() => ({ identifyUser: vi.fn(), forgetSignedOutPerson: vi.fn() }));
let refusing: string | null = null;
const updates: FakeQuery[] = [];

const answer = (q: FakeQuery): { data: unknown; error: unknown; count?: number } => {
  if (q.op === "update") {
    updates.push(q);
    return { data: null, error: null };
  }
  if (q.table === refusing) return { data: null, error: { code: "57014", message: "timeout" } };
  if (q.table === "users") {
    return {
      data: { created_at: "2026-01-01T00:00:00Z", onboarding_completed: true, subscription_tier: "pro", referral_tier: 1, preferred_language: "it" },
      error: null,
    };
  }
  if (q.table === "trips") return { data: null, count: 6, error: null };
  return { data: null, error: null };
};

vi.mock("@/lib/analytics", () => analytics);
vi.mock("@/lib/posthog", () => posthog);
vi.mock("@/lib/supabase/session-cookie", () => ({ hasSessionCookie: () => true }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    ...fakeSupabase(answer).client,
    auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "ana@example.com", user_metadata: {} } } }) },
  }),
}));

const { default: SessionTracker } = await import("./SessionTracker");

beforeEach(() => {
  refusing = null;
  updates.length = 0;
  document.documentElement.lang = "";
  vi.clearAllMocks();
  window.requestIdleCallback = ((callback: IdleRequestCallback) => {
    callback({} as IdleDeadline);
    return 1;
  }) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = () => {};
});

describe("the language a person uses the app in", () => {
  const seen = async () => {
    render(<SessionTracker />);
    await vi.waitFor(() => expect(posthog.identifyUser).toHaveBeenCalled());
  };

  it("is remembered when it isn't the stored one", async () => {
    document.documentElement.lang = "pt";
    await seen();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ table: "users", value: { preferred_language: "pt" } });
  });

  it("writes nothing when it is the stored one", async () => {
    document.documentElement.lang = "it";
    await seen();
    expect(updates).toHaveLength(0);
  });

  it("writes nothing for a language the column doesn't take", async () => {
    document.documentElement.lang = "de";
    await seen();
    expect(updates).toHaveLength(0);
  });

  it("writes nothing when the profile couldn't be read", async () => {
    document.documentElement.lang = "pt";
    refusing = "users";
    render(<SessionTracker />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(updates).toHaveLength(0);
  });
});

describe("SessionTracker", () => {
  it("sets the person's properties from what it read", async () => {
    render(<SessionTracker />);
    await vi.waitFor(() => expect(posthog.identifyUser).toHaveBeenCalled());
    expect(posthog.forgetSignedOutPerson).not.toHaveBeenCalled();
    expect(posthog.identifyUser.mock.calls[0][1]).toMatchObject({
      subscription_tier: "pro",
      preferred_language: "it",
      trips_created: 6,
      user_stage: "power_user",
    });
  });

  it.each(["users", "trips", "user_tester_access"])("sends no properties when the %s read is refused", async (table) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    refusing = table;
    localStorage.setItem("mt_last_visit", String(Date.now() - 2 * 24 * 60 * 60 * 1000));
    render(<SessionTracker />);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith("[SessionTracker] read failed:", "timeout"));
    expect(posthog.identifyUser).not.toHaveBeenCalled();
    expect(analytics.setUserPropertiesEnhanced).not.toHaveBeenCalled();
    expect(analytics.trackUserReturn).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
