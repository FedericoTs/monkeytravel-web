/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  verifyRenderedEmail,
  blockingDefects,
  escapeHtmlText,
  contextLines,
} from "./verify-render";

/**
 * This module is a GATE: a blocking defect stops a real email from being sent.
 * That makes the two error directions very different in cost.
 *
 *   False negative — a broken email goes out. Cannot be recalled.
 *   False positive — a correct email is held back as `failed`. Recoverable,
 *                    but it silently drops mail a user was expecting.
 *
 * So the "correct emails pass" block below matters at least as much as the
 * "broken emails are caught" one. The multi-city case in particular is not
 * hypothetical: the first audit run reported 7 failures and all 7 were
 * correct emails whose destination contained "&".
 */

const OWN = [
  "Expect mild spring weather with occasional rain.",
  "Louvre Museum",
  "09:30",
  "Le Fumoir",
  "13:00",
  "Light rain jacket",
];

function goodEmail(overrides: Partial<Parameters<typeof verifyRenderedEmail>[0]> = {}) {
  return verifyRenderedEmail({
    subject: "Travel day — Paris",
    html: `<html><body><h1>Travel day</h1><p>Paris</p>
      <p>Louvre Museum</p><p>09:30</p>
      <a href="https://monkeytravel.app/trips/abc-123?slot=morning_of">Open</a>
      </body></html>`,
    destination: "Paris",
    ctaUrl: "https://monkeytravel.app/trips/abc-123?slot=morning_of",
    contextBlocks: [
      { label: "Today's plan", items: [{ text: "Louvre Museum", meta: "09:30" }] },
    ],
    ownStrings: OWN,
    ...overrides,
  });
}

describe("correct emails are not blocked", () => {
  it("passes a well-formed email", () => {
    expect(blockingDefects(goodEmail())).toEqual([]);
  });

  it("passes a multi-city destination containing an ampersand", () => {
    // React escapes text nodes, so the body carries "&amp;". Comparing the
    // raw string here would fail 7 of every 25 real rows.
    const dest = "Palermo, Agrigento, Syracuse & Taormina";
    const defects = goodEmail({
      destination: dest,
      subject: `Three days to ${dest}`,
      html: `<p>Three days to ${escapeHtmlText(dest)}</p>
             <a href="https://monkeytravel.app/trips/abc-123?slot=morning_of">x</a><p>Louvre Museum</p>`,
      contextBlocks: [],
    });
    expect(blockingDefects(defects)).toEqual([]);
  });

  it("passes an email with no enrichment at all", () => {
    // A third of trips have no highlights; blocks are frequently absent and
    // that is a normal, correct email.
    const defects = goodEmail({ contextBlocks: [], ownStrings: [] });
    expect(blockingDefects(defects)).toEqual([]);
  });

  it("passes a truncated line whose prefix is in the trip", () => {
    // buildContextBlocks appends "…" when it caps a string; the surviving
    // prefix is what must match.
    const defects = goodEmail({
      contextBlocks: [
        { label: "Weather", note: "Expect mild spring weather with occ…" },
      ],
    });
    expect(blockingDefects(defects)).toEqual([]);
  });

  it("treats a long subject as a warning, never a block", () => {
    const defects = goodEmail({ subject: "x".repeat(120) });
    expect(blockingDefects(defects)).toEqual([]);
    expect(defects.some((d) => d.check === "subject_long")).toBe(true);
  });
});

describe("broken emails are caught", () => {
  it("blocks an unresolved i18n key — the bug that shipped for two months", () => {
    const defects = goodEmail({
      html: "<p>tripReminderEmail.morning_of.heading</p>",
    });
    expect(blockingDefects(defects).map((d) => d.check)).toContain("poison_html");
  });

  it("blocks an unresolved key in the SUBJECT", () => {
    // Real users received these as subject lines, and two were opened.
    const defects = goodEmail({ subject: "tripReminderEmail.morning_of.heading" });
    expect(blockingDefects(defects).map((d) => d.check)).toContain("poison_subject");
  });

  it("blocks a leftover {destination} placeholder", () => {
    const defects = goodEmail({ html: "<p>Your {destination} trip</p>" });
    expect(blockingDefects(defects).map((d) => d.check)).toContain("poison_html");
  });

  it("blocks a missing prop rendered as undefined", () => {
    const defects = goodEmail({ html: "<p>Paris undefined</p>" });
    expect(blockingDefects(defects).map((d) => d.check)).toContain("poison_html");
  });

  it("blocks an empty subject", () => {
    expect(blockingDefects(goodEmail({ subject: "   " })).map((d) => d.check))
      .toContain("subject_empty");
  });

  it("blocks the 'your trip' destination fallback", () => {
    // The cron falls back to "your trip" when the title is unusable. That is
    // a data problem, not a message worth sending.
    const defects = goodEmail({ destination: "your trip" });
    expect(blockingDefects(defects).map((d) => d.check)).toContain("destination_unusable");
  });

  it("blocks when the destination never reaches the body", () => {
    const defects = goodEmail({
      html: "<p>somewhere else</p><a href='https://monkeytravel.app/trips/abc-123?slot=morning_of'>x</a>",
    });
    expect(blockingDefects(defects).map((d) => d.check)).toContain("destination_missing");
  });

  it("blocks when the CTA does not reach its target", () => {
    const defects = goodEmail({
      html: "<p>Paris</p><p>Louvre Museum</p><a href='/trips/SOMEONE-ELSE'>x</a>",
    });
    expect(blockingDefects(defects).map((d) => d.check)).toContain("cta_missing");
  });

  it("does NOT block a followup whose CTA is the wizard, not the trip", () => {
    // The regression the audit caught on live rows. followup_next_21d and
    // followup_final_45d deliberately link to the wizard — sending someone
    // back to a trip six weeks gone is a dead end — so they carry no trip id.
    // The old check demanded one, and being a BLOCKING defect it would have
    // silently killed the last two emails of every Loop 2 sequence.
    const wizard = "https://monkeytravel.app/trips/new?slot=followup_next_21d";
    const defects = verifyRenderedEmail({
      subject: "Thinking about the next one?",
      html: `<p>Thinking about the next one?</p><p>Paris</p>
             <a href="${wizard}">Plan your next trip</a>`,
      destination: "Paris",
      ctaUrl: wizard,
      contextBlocks: [],
      ownStrings: [],
    });
    expect(blockingDefects(defects)).toEqual([]);
  });
});

describe("containment — the anti-cross-contamination check", () => {
  it("blocks an activity that belongs to a different trip", () => {
    // The scenario that started all of this: a Lisbon email listing the Louvre.
    const defects = verifyRenderedEmail({
      subject: "Travel day — Lisbon",
      html: "<p>Lisbon</p><p>Louvre Museum</p><a href='https://monkeytravel.app/trips/lisbon-1?slot=morning_of'>x</a>",
      destination: "Lisbon",
      ctaUrl: "https://monkeytravel.app/trips/lisbon-1?slot=morning_of",
      contextBlocks: [
        { label: "Today's plan", items: [{ text: "Louvre Museum", meta: "09:30" }] },
      ],
      // This trip's real data — Lisbon, no Louvre anywhere.
      ownStrings: ["Time out Market", "Belém Tower", "10:00"],
    });
    const blocked = blockingDefects(defects);
    expect(blocked.map((d) => d.check)).toContain("containment");
    expect(blocked.find((d) => d.check === "containment")?.detail).toContain("Louvre");
  });

  it("blocks a note from another trip", () => {
    const defects = goodEmail({
      contextBlocks: [{ label: "Weather", note: "Expect heavy snow and polar night." }],
    });
    expect(blockingDefects(defects).map((d) => d.check)).toContain("containment");
  });

  it("checks item meta as well as item text", () => {
    // A time that is not in this trip is as wrong as a place that is not.
    const defects = goodEmail({
      contextBlocks: [
        { label: "Today's plan", items: [{ text: "Louvre Museum", meta: "23:45" }] },
      ],
    });
    expect(blockingDefects(defects).map((d) => d.check)).toContain("containment");
  });

  it("does not block when the corpus is empty and nothing was rendered", () => {
    const defects = goodEmail({ contextBlocks: [], ownStrings: [] });
    expect(blockingDefects(defects)).toEqual([]);
  });
});

describe("helpers", () => {
  it("escapeHtmlText matches how React escapes text nodes", () => {
    expect(escapeHtmlText("Paris & Amsterdam")).toBe("Paris &amp; Amsterdam");
    expect(escapeHtmlText(`<a> "q" 'p'`)).toBe("&lt;a&gt; &quot;q&quot; &#x27;p&#x27;");
  });

  it("contextLines collects every user-visible string", () => {
    expect(
      contextLines([
        { label: "W", note: "sunny" },
        { label: "P", items: [{ text: "boots" }, { text: "hat", meta: "09:00" }] },
      ])
    ).toEqual(["sunny", "boots", "hat", "09:00"]);
  });

  it("contextLines is empty for no blocks", () => {
    expect(contextLines()).toEqual([]);
    expect(contextLines([])).toEqual([]);
  });
});
