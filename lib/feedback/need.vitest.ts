/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { NEED_ANSWERS, isNeedAnswer, latestNeedAnswers } from "./need";
import { buildNeedUrl, buildWentUrl, verifyFeedbackToken } from "./token";
import { needAnswerUrls } from "../email/reminder-cta";

/**
 * The reminders' one question before a trip: what do you still need for it?
 * Six closed answers in a fixed order, a one-tap signed link for each, and the
 * newest answer for a trip is its answer.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const TRIP = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.stubEnv("FEEDBACK_LINK_SECRET", randomBytes(32).toString("hex"));
});

describe("the answers", () => {
  it("are six, in the order they're asked", () => {
    expect(NEED_ANSWERS).toEqual(["stay", "transport", "book", "phone", "group", "set"]);
  });

  it.each([["stay", true], ["set", true], ["went", false], ["", false], [undefined, false], [1, false]])(
    "%s is an answer: %s",
    (value, expected) => {
      expect(isNeedAnswer(value)).toBe(expected);
    },
  );

  it("takes the newest answer per trip, and nothing from rows that aren't one", () => {
    const answers = latestNeedAnswers([
      { extra: { trip_id: "a", need: "book", need_note: "the Alhambra" } },
      { extra: { trip_id: "a", need: "stay" } },
      { extra: { trip_id: "b", went: "yes" } },
      { extra: { trip_id: "c", need: "maybe" } },
      { extra: { need: "stay" } },
      { extra: null },
      {},
    ]);
    expect([...answers]).toEqual([["a", "book"]]);
  });
});

describe("the one-tap links", () => {
  it("name the trip, the answer and the reminder they came from", () => {
    const url = new URL(buildNeedUrl(USER, TRIP, "transport", "weather_3d", "it", "https://monkeytravel.app"));
    expect(url.origin + url.pathname).toBe("https://monkeytravel.app/it/feedback/need");
    expect(url.searchParams.get("need")).toBe("transport");
    expect(url.searchParams.get("slot")).toBe("weather_3d");
    expect(verifyFeedbackToken(url.searchParams.get("t")!)).toEqual({ ok: true, userId: USER, tripId: TRIP });
  });

  it("have no locale in the path for English", () => {
    expect(buildNeedUrl(USER, TRIP, "stay", "confirm_1d", "en", "https://monkeytravel.app")).toMatch(
      /^https:\/\/monkeytravel\.app\/feedback\/need\?t=/,
    );
  });

  it("leave the return email's links as they were", () => {
    const url = new URL(buildWentUrl(USER, TRIP, "no", "es", "https://monkeytravel.app"));
    expect(url.origin + url.pathname).toBe("https://monkeytravel.app/es/feedback/went");
    expect([...url.searchParams.keys()]).toEqual(["t", "answer", "slot"]);
    expect(url.searchParams.get("answer")).toBe("no");
    expect(url.searchParams.get("slot")).toBe("followup_return_3d");
  });

  it("come one per answer, in order, for a reminder", () => {
    const urls = needAnswerUrls("pack_early_14d", { appUrl: "https://monkeytravel.app", locale: "pt", tripId: TRIP, userId: USER });
    expect(urls?.map((u) => u.need)).toEqual([...NEED_ANSWERS]);
    for (const { need, url } of urls!) {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/pt/feedback/need");
      expect(parsed.searchParams.get("need")).toBe(need);
      expect(parsed.searchParams.get("slot")).toBe("pack_early_14d");
    }
  });

  it("are left out when they can't be signed, rather than stopping the reminder", () => {
    vi.stubEnv("FEEDBACK_LINK_SECRET", "");
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "");
    expect(needAnswerUrls("visa_check_7d", { appUrl: "https://monkeytravel.app", locale: "en", tripId: TRIP, userId: USER })).toBeNull();
  });
});
