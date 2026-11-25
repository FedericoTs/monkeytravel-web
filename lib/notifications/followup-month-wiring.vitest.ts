/** @vitest-environment node */
/**
 * The later followups name the month their guide is for ({month}), and next-intl prints a key path for a placeholder
 * it isn't given. The cron (slot-email.ts) and the audit that vets what it will send (scripts/audit-queued-emails.mts)
 * both name it, from the same next-trip month (lib/email/followup-cta.ts), and hand it to the heading, the body and
 * the button. Asserted against the source: building an email needs the database.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8").replace(/\r/g, "");
const NAMES_THE_MONTH = /new Intl\.DateTimeFormat\(locale, \{ month: "long", timeZone: "UTC" \}\)\.format\(\s*new Date\(Date\.UTC\(2000, (?:FC\.)?nextTripMonth\((?:now|new Date\(\))\), 15\)\),?\s*\)/;

describe("the month the later followups name", () => {
  it("is named by the cron and given to the heading, the body and the button", () => {
    const src = read("lib/notifications/slot-email.ts");
    expect(src).toMatch(NAMES_THE_MONTH);
    expect(src).toContain('t("heading", { destination, month })');
    expect(src).toContain('t("body", { destination, endDate, month })');
    expect(src).toContain('followup ? t("cta", { month }) : ctaT("cta")');
  });

  it("is named the same way by the audit", () => {
    const src = read("scripts/audit-queued-emails.mts");
    expect(src).toMatch(NAMES_THE_MONTH);
    expect(src).toContain('t("heading", { destination, month })');
    expect(src).toContain("endDate: formatDayMonth(trip.end_date, locale), month })");
    expect(src).toContain('isFollowup(row.slot) ? t("cta", { month }) : rootT("cta")');
  });
});
