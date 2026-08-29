/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import { readFileSync } from "fs";
import { join } from "path";
import { forecastMessage, type TripForecast } from "./trip-forecast";

/**
 * Renders the weather line from the REAL message files, in every locale we
 * ship, against every shape a forecast can take.
 *
 * The unit tests above prove the rule picks the right message key. They say
 * nothing about what that key resolves to, and this is where the defects were:
 *
 *   "-8–-1°C"              a tight en dash beside a minus sign
 *   "rain on 4 of days"    ICU swaps the WHOLE placeholder for the plural
 *                          branch, so a branch written without `#` drops the
 *                          number — silently, in three of four locales
 *   "1 of 1 days"          no pluralisation at all
 *
 * None of them threw, and next-intl does not throw on a bad message either —
 * it substitutes the key path and carries on. So only rendering and reading
 * the output catches this class of bug.
 */

const LOCALES = ["en", "es", "it", "pt"] as const;

const SHAPES: Array<{ name: string; fc: TripForecast }> = [
  { name: "warm and dry", fc: { minC: 22, maxC: 32, days: 5, wetDays: 0, firstDay: null } },
  { name: "wet", fc: { minC: 15, maxC: 33, days: 6, wetDays: 4, firstDay: null } },
  { name: "below zero, one day", fc: { minC: -8, maxC: -1, days: 1, wetDays: 1, firstDay: null } },
  { name: "straddling zero", fc: { minC: -3, maxC: 4, days: 3, wetDays: 2, firstDay: null } },
  { name: "flat single day", fc: { minC: 3, maxC: 3, days: 1, wetDays: 0, firstDay: null } },
];

function line(locale: string, fc: TripForecast): string {
  const messages = {
    common: JSON.parse(
      readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8")
    ),
  };
  const t = createTranslator({ locale, messages, namespace: "common.emailContext" });
  const msg = forecastMessage(fc);
  return t(msg.key as never, msg.values as never);
}

describe.each(LOCALES)("weather copy renders in %s", (locale) => {
  it.each(SHAPES)("$name", ({ fc }) => {
    const out = line(locale, fc);

    // next-intl substitutes the key path instead of throwing on a bad message.
    expect(out).not.toContain("emailContext.");
    // An unconsumed placeholder means the message and the values disagree.
    expect(out).not.toMatch(/\{[a-z]+/i);

    // The temperatures must survive.
    expect(out).toContain(String(fc.maxC));
    expect(out).toContain(String(fc.minC));

    // A minus sign must never sit directly against the range dash.
    expect(out).not.toContain("–-");

    // Both counts must survive the plural branch.
    if (fc.wetDays > 0) {
      expect(out).toContain(String(fc.wetDays));
      expect(out).toContain(String(fc.days));
    }

    // No stray double spaces from a mis-assembled message.
    expect(out).not.toMatch(/\s{2,}/);
  });

  it("says something different when it will rain", () => {
    // Guards against both keys accidentally pointing at the same copy — the
    // whole reason there are two messages instead of one.
    const dry = line(locale, { minC: 10, maxC: 20, days: 4, wetDays: 0, firstDay: null });
    const wet = line(locale, { minC: 10, maxC: 20, days: 4, wetDays: 2, firstDay: null });
    expect(dry).not.toBe(wet);
  });

  it("pluralises: one wet day does not read as several", () => {
    const one = line(locale, { minC: 10, maxC: 20, days: 1, wetDays: 1, firstDay: null });
    const many = line(locale, { minC: 10, maxC: 20, days: 5, wetDays: 3, firstDay: null });
    // The two must not use an identical word for the day unit, which is what
    // "1 of 1 days" looked like before ICU plurals went in.
    expect(one).not.toBe(many);
    const unit = (s: string) => s.replace(/[\d\s°C.–-]/g, "");
    expect(unit(one)).not.toBe(unit(many));
  });
});
