/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { tripReminderSubject } from "./templates/TripReminder";

/**
 * The trip-reminder subject rule.
 *
 * renderTemplate builds it as `${heading} — ${destination}`, which is right
 * for four of the five slots and wrong for weather_3d, whose heading already
 * IS "Three days to {destination}" in every locale. That produced:
 *
 *   "Three days to Palermo, Agrigento, Syracuse & Taormina
 *    — Palermo, Agrigento, Syracuse & Taormina"        (95 chars)
 *
 * Measured on the live queue before the fix: 27 of 699 subjects overran the
 * ~78 characters a mail client will actually show, and every one of the worst
 * was this duplication on a multi-city trip. After: 3, all of them one user's
 * genuinely long five-city title.
 *
 * The guard is `heading.includes(destination)`. These tests pin the property
 * it protects rather than the implementation, so a future copy change that
 * moves {destination} into another slot's heading stays covered.
 */

const LOCALES = ["en", "es", "it", "pt"] as const;
const SLOTS = [
  "pack_early_14d",
  "visa_check_7d",
  "weather_3d",
  "confirm_1d",
  "morning_of",
] as const;

const ROOT = join(__dirname, "..", "..");

function reminderCopy(locale: string) {
  return JSON.parse(
    readFileSync(join(ROOT, "messages", locale, "common.json"), "utf8")
  ).tripReminderEmail;
}

/**
 * The REAL builder, imported — not a local reimplementation. A test that
 * copies the rule it is testing passes happily while the shipped rule rots,
 * which is the exact failure this file exists to prevent.
 */
function subjectFor(heading: string, destination: string): string {
  return tripReminderSubject({ heading, destination });
}

describe("trip reminder subject", () => {
  const DEST = "Palermo, Agrigento, Syracuse & Taormina";

  for (const locale of LOCALES) {
    it(`${locale}: no slot prints the destination twice`, () => {
      const copy = reminderCopy(locale);
      for (const slot of SLOTS) {
        const heading = copy[slot].heading.replace(/\{destination\}/g, DEST);
        const subject = subjectFor(heading, DEST);
        const occurrences = subject.split(DEST).length - 1;
        expect(occurrences, `${locale}/${slot} → "${subject}"`).toBeLessThanOrEqual(1);
      }
    });

    it(`${locale}: every slot still names the destination somewhere`, () => {
      // The guard must not have removed it altogether — a reminder that never
      // says where you are going is worse than a long subject.
      const copy = reminderCopy(locale);
      for (const slot of SLOTS) {
        const heading = copy[slot].heading.replace(/\{destination\}/g, DEST);
        expect(subjectFor(heading, DEST), `${locale}/${slot}`).toContain(DEST);
      }
    });

    it(`${locale}: weather_3d is the slot that needs the guard`, () => {
      // Documents WHY the guard exists. If a copy edit ever removes
      // {destination} from this heading, this fails and tells the next person
      // the guard may no longer be load-bearing.
      expect(reminderCopy(locale).weather_3d.heading).toContain("{destination}");
    });
  }

  it("appends the destination for a heading that lacks it", () => {
    expect(subjectFor("Travel day", "Lisbon")).toBe("Travel day — Lisbon");
  });

  it("leaves a heading that already carries it untouched", () => {
    expect(subjectFor("Three days to Lisbon", "Lisbon")).toBe("Three days to Lisbon");
  });
});

describe("one definition, used everywhere", () => {
  // The rule lived in three places — send.ts, the audit script and the review
  // script — and drifted within an hour: the guard was added to send.ts only,
  // so a review set went out reading "Three days to Paris — Paris", a subject
  // the product can no longer produce. These pin the consolidation.
  const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

  it.each([
    ["lib/email/send.ts", ["lib", "email", "send.ts"]],
    ["scripts/audit-queued-emails.mts", ["scripts", "audit-queued-emails.mts"]],
    ["scripts/send-test-emails.mts", ["scripts", "send-test-emails.mts"]],
  ])("%s uses the shared tripReminderSubject", (_label, parts) => {
    expect(read(...parts)).toContain("tripReminderSubject");
  });

  it.each([
    ["lib/email/send.ts", ["lib", "email", "send.ts"]],
    ["scripts/audit-queued-emails.mts", ["scripts", "audit-queued-emails.mts"]],
    ["scripts/send-test-emails.mts", ["scripts", "send-test-emails.mts"]],
  ])("%s does not re-implement the rule locally", (_label, parts) => {
    // The inlined form, in any of its spellings. TripReminder.tsx itself is
    // excluded — it is where the rule legitimately lives.
    const src = read(...parts);
    expect(src).not.toMatch(/heading\.includes\((?:props\.)?destination\)/);
    expect(src).not.toMatch(/\$\{heading\}\s*—\s*\$\{destination\}/);
  });
});
