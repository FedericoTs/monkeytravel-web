import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deriveRefineSuggestions } from "./refine-suggestions";
import type { Activity, ItineraryDay } from "@/types";

/**
 * Guards the failure mode this change actually has: a message key that doesn't
 * exist renders as the raw key path in the UI ("assistant.dyn.busyDay"), which
 * is exactly the bug that shipped with wizard.anchors.cta on 2026-08-01. A
 * browser check catches it only if you happen to generate a trip that triggers
 * that particular suggestion; this catches all of them, in every locale, for
 * free.
 */

const LOCALES = ["en", "it", "es", "pt"] as const;

function messages(locale: string): Record<string, unknown> {
  const p = path.join(process.cwd(), "messages", locale, "trips.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function get(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj);
}

function act(name: string, type = "attraction"): Activity {
  return {
    name, type: type as Activity["type"], description: "", location: "",
    time_slot: "morning", start_time: "10:00", duration_minutes: 60,
    estimated_cost: { amount: 0, currency: "EUR", tier: "free" },
    tips: [], booking_required: false,
  } as Activity;
}
const day = (n: number, a: Activity[]): ItineraryDay => ({ day_number: n, date: `2026-09-0${n}`, activities: a });

/** A trip that triggers every derivation branch at once. */
const TRIGGERS_ALL: ItineraryDay[] = [
  day(1, [act("A"), act("B"), act("C"), act("D"), act("E"), act("F")]), // busy
  day(2, [act("Museum"), act("Park"), act("Gallery")]),                 // no food
  day(3, [act("Solo thing")]),                                          // light
];

describe("refine suggestion i18n coverage", () => {
  const derived = deriveRefineSuggestions(TRIGGERS_ALL, 99);

  it("the fixture actually exercises every suggestion key", () => {
    expect(new Set(derived.map((d) => d.key))).toEqual(
      new Set(["busyDay", "noFood", "lightDay"])
    );
  });

  for (const locale of LOCALES) {
    it(`${locale}: every derived key exists and declares the params the code passes`, () => {
      const m = messages(locale);
      for (const d of derived) {
        const raw = get(m, `assistant.dyn.${d.key}`);
        expect(raw, `missing assistant.dyn.${d.key} in ${locale}`).toBeTypeOf("string");
        // Every param the code supplies must appear as an ICU placeholder,
        // otherwise the value silently vanishes from the rendered string.
        // Match on the opening `{name` only: a plural is written
        // `{count, plural, ...}`, so requiring `{count}` would reject
        // perfectly correct copy.
        for (const param of Object.keys(d.params)) {
          expect(raw as string, `${locale}/${d.key} never uses {${param}}`).toMatch(
            new RegExp(`\\{\\s*${param}\\s*[},]`)
          );
        }
      }
    });

    it(`${locale}: the save nudges take a count so the plural resolves`, () => {
      const m = messages(locale);
      for (const key of ["saveHeaderNudge", "mobileSaveNudge"]) {
        const raw = get(m, `wizard.result.${key}`);
        expect(raw, `missing wizard.result.${key} in ${locale}`).toBeTypeOf("string");
        expect(raw as string).toContain("{count");
      }
    });

    it(`${locale}: the static fallback chips still exist`, () => {
      const m = messages(locale);
      for (const n of [1, 2, 3]) {
        expect(get(m, `assistant.suggest${n}`), `missing suggest${n} in ${locale}`).toBeTypeOf("string");
      }
    });
  }
});
