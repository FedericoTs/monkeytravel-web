import { describe, it, expect, afterEach } from "vitest";
import { didNotGoUrl, postTripCtaUrl } from "./followup-cta";
import { verifyFeedbackToken } from "../feedback/token";

const OPTS = {
  tripUrl: "https://monkeytravel.app/trips/abc?slot=followup_return_3d",
  appUrl: "https://monkeytravel.app",
  userId: "user-123",
  locale: "en",
  tripId: "abc",
};

const savedFb = process.env.FEEDBACK_LINK_SECRET;
const savedUnsub = process.env.EMAIL_UNSUBSCRIBE_SECRET;
afterEach(() => {
  if (savedFb === undefined) delete process.env.FEEDBACK_LINK_SECRET; else process.env.FEEDBACK_LINK_SECRET = savedFb;
  if (savedUnsub === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET; else process.env.EMAIL_UNSUBSCRIBE_SECRET = savedUnsub;
});

const withSecret = () => {
  process.env.FEEDBACK_LINK_SECRET = "0123456789abcdef0123456789abcdef";
};

describe("postTripCtaUrl", () => {
  it("sends the later slots to the wizard (no secret needed)", () => {
    for (const slot of ["followup_next_21d", "followup_final_45d", "followup_dormant"] as const) {
      expect(postTripCtaUrl(slot, OPTS)).toBe(`https://monkeytravel.app/trips/new?slot=${slot}`);
    }
  });

  it("makes followup_return_3d's two buttons the two answers, about this trip", () => {
    withSecret();
    const urls = { yes: postTripCtaUrl("followup_return_3d", OPTS), no: didNotGoUrl(OPTS)! };
    for (const [answer, raw] of Object.entries(urls)) {
      const url = new URL(raw);
      expect(url.origin + url.pathname).toBe("https://monkeytravel.app/feedback/went");
      expect(url.searchParams.get("answer")).toBe(answer);
      expect(url.searchParams.get("slot")).toBe("followup_return_3d");
      expect(verifyFeedbackToken(url.searchParams.get("t")!)).toEqual({ ok: true, userId: "user-123", tripId: "abc" });
    }
  });

  it("localizes the answers' path", () => {
    withSecret();
    expect(postTripCtaUrl("followup_return_3d", { ...OPTS, locale: "es" })).toContain("/es/feedback/went?");
    expect(didNotGoUrl({ ...OPTS, locale: "it" })).toContain("/it/feedback/went?");
  });

  it("opens the trip, with one button, if the link secret is unavailable (never fails a send)", () => {
    delete process.env.FEEDBACK_LINK_SECRET;
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    expect(postTripCtaUrl("followup_return_3d", OPTS)).toBe(OPTS.tripUrl);
    expect(didNotGoUrl(OPTS)).toBeNull();
  });
});
