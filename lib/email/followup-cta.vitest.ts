import { describe, it, expect, afterEach } from "vitest";
import { postTripCtaUrl } from "./followup-cta";

const OPTS = { tripUrl: "https://monkeytravel.app/trips/abc?slot=followup_return_3d", appUrl: "https://monkeytravel.app", userId: "user-123", locale: "en" };

const savedFb = process.env.FEEDBACK_LINK_SECRET;
const savedUnsub = process.env.EMAIL_UNSUBSCRIBE_SECRET;
afterEach(() => {
  if (savedFb === undefined) delete process.env.FEEDBACK_LINK_SECRET; else process.env.FEEDBACK_LINK_SECRET = savedFb;
  if (savedUnsub === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET; else process.env.EMAIL_UNSUBSCRIBE_SECRET = savedUnsub;
});

describe("postTripCtaUrl", () => {
  it("sends the later slots to the wizard (no secret needed)", () => {
    for (const slot of ["followup_next_21d", "followup_final_45d", "followup_dormant"] as const) {
      expect(postTripCtaUrl(slot, OPTS)).toBe(`https://monkeytravel.app/trips/new?slot=${slot}`);
    }
  });

  it("sends followup_return_3d to the feedback survey when the link secret is set", () => {
    process.env.FEEDBACK_LINK_SECRET = "0123456789abcdef0123456789abcdef";
    const url = postTripCtaUrl("followup_return_3d", OPTS);
    expect(url).toMatch(/^https:\/\/monkeytravel\.app\/feedback\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("localizes the feedback path", () => {
    process.env.FEEDBACK_LINK_SECRET = "0123456789abcdef0123456789abcdef";
    expect(postTripCtaUrl("followup_return_3d", { ...OPTS, locale: "es" })).toContain("/es/feedback/");
  });

  it("falls back to the trip URL if the link secret is unavailable (never fails a send)", () => {
    delete process.env.FEEDBACK_LINK_SECRET;
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    expect(postTripCtaUrl("followup_return_3d", OPTS)).toBe(OPTS.tripUrl);
  });
});
