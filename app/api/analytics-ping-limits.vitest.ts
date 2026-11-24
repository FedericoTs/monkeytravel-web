/** @vitest-environment node */
/**
 * The pings that come with every page count on each instance, leaving Redis's
 * monthly command allowance to the limits that guard spend and to the plans
 * kept for recovery. The wizard's and the funnel's events keep their shared
 * counts.
 */
import { describe, expect, it, vi } from "vitest";

const made = new Map<string, unknown>();
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: (namespace: string, _limit: number, _windowMs?: number, options?: unknown) => {
    made.set(namespace, options);
    const answer = async () => ({ allowed: true, remaining: 1 });
    return { check: answer, checkKey: answer };
  },
}));

describe("the limits on analytics pings", () => {
  it("count the pings that come with every page on each instance", async () => {
    await import("@/app/api/consent-event/route");
    await import("@/app/api/page-engaged/route");
    await import("@/app/api/page-view/route");
    for (const name of ["consent-event", "page-engaged", "page-view"]) {
      expect(made.get(`${name}-ip`), name).toEqual({ shared: false });
      expect(made.get(`${name}-session`), name).toEqual({ shared: false });
    }
  });

  it("keep the wizard's and the funnel's counts shared", async () => {
    await import("@/app/api/wizard-event/route");
    await import("@/app/api/funnel-event/route");
    for (const name of ["wizard-event", "funnel-event"]) {
      expect(made.has(`${name}-ip`) && made.has(`${name}-session`), name).toBe(true);
      expect(made.get(`${name}-ip`), name).toBeUndefined();
      expect(made.get(`${name}-session`), name).toBeUndefined();
    }
  });
});
