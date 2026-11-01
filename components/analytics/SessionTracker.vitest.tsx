import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * SessionTracker sets the signed-in person's analytics properties from what it
 * reads. A refused read must not reset them to defaults (a pro account to
 * "free", a power user to "new"), so that page load sends nothing.
 */

const analytics = vi.hoisted(() => ({
  trackSessionStart: vi.fn(),
  trackUserReturn: vi.fn(),
  setUserId: vi.fn(),
  setUserPropertiesEnhanced: vi.fn(),
}));
const posthog = vi.hoisted(() => ({ identifyUser: vi.fn() }));
let refusing: string | null = null;

const answer = (q: FakeQuery): { data: unknown; error: unknown; count?: number } => {
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
  vi.clearAllMocks();
  window.requestIdleCallback = ((callback: IdleRequestCallback) => {
    callback({} as IdleDeadline);
    return 1;
  }) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = () => {};
});

describe("SessionTracker", () => {
  it("sets the person's properties from what it read", async () => {
    render(<SessionTracker />);
    await vi.waitFor(() => expect(posthog.identifyUser).toHaveBeenCalled());
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
    render(<SessionTracker />);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith("[SessionTracker] read failed:", "timeout"));
    expect(posthog.identifyUser).not.toHaveBeenCalled();
    expect(analytics.setUserPropertiesEnhanced).not.toHaveBeenCalled();
    expect(analytics.trackSessionStart).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
