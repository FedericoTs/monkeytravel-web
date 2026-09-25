// @vitest-environment node
import { describe, it, expect } from "vitest";
import { EMAIL_PREFERENCES, isMarketingOptedOut } from "./preferences";
import { NOTIFICATION_SETTING_KEY } from "./send";

/**
 * The settings page's switches are the ones the email pipeline reads.
 *
 * Until 2026-09-25 /profile/notifications offered four switches no email ever
 * read ("Weekly digest", "Proposed activities", "Comments", "Invite
 * accepted") and none for trip reminders or marketing, which most emails are.
 */

describe("email switches", () => {
  it("are exactly the categories the pipeline gates on, plus the master switch", () => {
    const gated = new Set(
      Object.values(NOTIFICATION_SETTING_KEY).filter((k): k is string => k !== null)
    );
    const switches = new Set<string>(
      EMAIL_PREFERENCES.filter((p) => p.kind !== "master").map((p) => p.key)
    );
    expect(switches).toEqual(gated);
    expect(EMAIL_PREFERENCES.filter((p) => p.kind === "master").map((p) => p.key)).toEqual([
      "emailNotifications",
    ]);
  });
});

describe("isMarketingOptedOut (the broadcast audience sync)", () => {
  it.each([
    ["nothing stored: the signup default, on", {}, false],
    ["no settings row", null, false],
    ["marketing on", { marketingNotifications: true }, false],
    ["marketing off", { marketingNotifications: false }, true],
    ["master switch off", { emailNotifications: false }, true],
    ["master off wins over marketing on", { emailNotifications: false, marketingNotifications: true }, true],
    ["only an explicit false opts out", { marketingNotifications: "false", emailNotifications: 0 }, false],
  ])("%s", (_name, settings, optedOut) => {
    expect(isMarketingOptedOut(settings)).toBe(optedOut);
  });
});
