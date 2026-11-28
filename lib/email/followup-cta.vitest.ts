import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { join } from "path";
import { NEXT_TRIP_LEAD_DAYS, didNotGoUrl, nextTripMonth, postTripCtaUrl } from "./followup-cta";
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
  process.env.FEEDBACK_LINK_SECRET = randomBytes(32).toString("hex");
};

describe("postTripCtaUrl", () => {
  it("sends the later slots to the guide for the month a next trip would fall in, in their language (no secret needed)", () => {
    const now = new Date("2026-11-25T08:00:00Z"); // 45 days on: 9 January
    for (const slot of ["followup_next_21d", "followup_final_45d", "followup_dormant"] as const) {
      expect(postTripCtaUrl(slot, { ...OPTS, now })).toBe(`https://monkeytravel.app/blog/where-to-go-in-january?slot=${slot}`);
    }
    expect(postTripCtaUrl("followup_next_21d", { ...OPTS, locale: "es", now })).toBe(
      "https://monkeytravel.app/es/blog/where-to-go-in-january?slot=followup_next_21d",
    );
    expect(postTripCtaUrl("followup_final_45d", { ...OPTS, locale: "pt", now })).toContain("/pt/blog/where-to-go-in-january?slot=");
    // A language without guides gets the English one.
    expect(postTripCtaUrl("followup_next_21d", { ...OPTS, locale: "fr", now })).toBe(
      "https://monkeytravel.app/blog/where-to-go-in-january?slot=followup_next_21d",
    );
  });

  it("points at a guide that exists, for every month and language", () => {
    for (let month = 0; month < 12; month++) {
      const now = new Date(Date.UTC(2027, month, 10) - NEXT_TRIP_LEAD_DAYS * 86_400_000);
      for (const locale of ["en", "es", "it", "pt"]) {
        const url = new URL(postTripCtaUrl("followup_next_21d", { ...OPTS, locale, now }));
        const slug = url.pathname.split("/").pop()!;
        const file = locale === "en" ? join("content", "blog", `${slug}.md`) : join("content", "blog", locale, `${slug}.md`);
        expect(existsSync(join(process.cwd(), file)), file).toBe(true);
      }
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

describe("nextTripMonth", () => {
  it("is the month 45 days on, in UTC", () => {
    expect(nextTripMonth(new Date("2026-11-25T08:00:00Z"))).toBe(0); // 9 January
    expect(nextTripMonth(new Date("2026-12-20T12:00:00Z"))).toBe(1); // 3 February
    expect(nextTripMonth(new Date("2027-05-17T23:59:00Z"))).toBe(6); // 1 July
    // 1 March at 02:00 UTC is still 28 February west of Greenwich: the month is UTC's.
    expect(nextTripMonth(new Date("2027-01-15T02:00:00Z"))).toBe(2);
  });
});

describe("the later followups' words", () => {
  it.each(["en", "es", "it", "pt"])("%s: name the month, and the button names its guide", async (locale) => {
    const messages = (await import(`../../messages/${locale}/common.json`)).default as {
      tripFollowupEmail: Record<string, { body: string; cta: string }>;
    };
    for (const slot of ["followup_next_21d", "followup_final_45d", "followup_dormant"]) {
      expect(messages.tripFollowupEmail[slot].body, `${locale} ${slot} body`).toContain("{month}");
      expect(messages.tripFollowupEmail[slot].cta, `${locale} ${slot} cta`).toContain("{month}");
    }
  });
});
