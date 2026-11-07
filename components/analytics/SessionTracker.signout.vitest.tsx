import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * A page load with no session forgets the person PostHog last knew in this
 * browser, whichever route signed them out, and looks nobody up.
 */

const posthog = vi.hoisted(() => ({ identifyUser: vi.fn(), forgetSignedOutPerson: vi.fn() }));
const createClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/analytics", () => ({ trackUserReturn: vi.fn(), setUserId: vi.fn(), setUserPropertiesEnhanced: vi.fn() }));
vi.mock("@/lib/posthog", () => posthog);
vi.mock("@/lib/supabase/session-cookie", () => ({ hasSessionCookie: () => false }));
vi.mock("@/lib/supabase/client", () => ({ createClient }));

const { default: SessionTracker } = await import("./SessionTracker");

beforeEach(() => {
  vi.clearAllMocks();
  window.requestIdleCallback = ((callback: IdleRequestCallback) => {
    callback({} as IdleDeadline);
    return 1;
  }) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = () => {};
});

describe("a page load with no session", () => {
  it("forgets the signed-in person PostHog last knew, and looks nobody up", async () => {
    render(<SessionTracker />);
    await vi.waitFor(() => expect(posthog.forgetSignedOutPerson).toHaveBeenCalledOnce());
    expect(createClient).not.toHaveBeenCalled();
    expect(posthog.identifyUser).not.toHaveBeenCalled();
  });
});
