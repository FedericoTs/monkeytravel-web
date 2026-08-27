/**
 * Last-line correctness checks on a rendered lifecycle email.
 *
 * Runs in TWO places, from this one definition:
 *
 *   1. app/api/cron/scheduled-notifications — inline, immediately before
 *      dispatch. A blocking defect means the row is marked `failed` and
 *      NOT sent. This is the gate that cannot be skipped or forgotten.
 *   2. scripts/audit-queued-emails.mts — over every pending row, so the
 *      same verdict is visible before a deploy rather than after a send.
 *
 * WHY SHARED AND NOT DUPLICATED
 * -----------------------------
 * The subject rule lived in three copies and drifted within an hour: the
 * fix landed in send.ts while the review script kept mailing a subject the
 * product could no longer produce. A checker that reimplements what it
 * checks proves only that two copies of a mistake agree. So the audit and
 * the send path share this module, and neither owns a private copy.
 *
 * WHY BLOCKING RATHER THAN LOGGING
 * --------------------------------
 * The precedent is already in this codebase: assertTranslated refuses to
 * send an email carrying an unresolved i18n key, because for two months
 * those went out looking like "tripReminderEmail.morning_of.heading" and
 * every layer reported success. A row held back as `failed` stays visible
 * and can be retried once the cause is fixed. A bad email cannot be recalled.
 */

import type { ContextBlock } from "./trip-context";

export type DefectSeverity = "block" | "warn";

export interface RenderDefect {
  check: string;
  detail: string;
  severity: DefectSeverity;
}

export interface VerifyRenderInput {
  subject: string;
  html: string;
  /** The destination as it was rendered into the email. */
  destination: string;
  /** Used to prove the CTA links back to the right trip. */
  tripId: string;
  contextBlocks?: ContextBlock[];
  /**
   * Every enrichment string belonging to THIS trip — the weather note, the
   * highlights, the packing list, the day-one activity names and times.
   * Containment is checked against these, so a line borrowed from any other
   * trip is caught.
   */
  ownStrings: string[];
}

/**
 * Substrings that must never survive into a delivered email.
 *
 * The i18n key prefixes are the ones that actually shipped to real inboxes
 * for two months. `undefined` / `[object Object]` / `NaN` catch a prop that
 * silently went missing — the itinerary is model-generated, so that is a
 * live risk rather than a theoretical one.
 */
const POISON = [
  "tripReminderEmail.",
  "tripFollowupEmail.",
  "emailContext.",
  "{destination}",
  "undefined",
  "[object Object]",
  "NaN",
];

/**
 * React escapes text nodes on render, so a destination containing "&" — every
 * multi-city trip, e.g. "Palermo, Agrigento, Syracuse & Taormina" — appears
 * in the HTML as "&amp;". Searching for the raw string reports a missing
 * destination on a perfectly correct email; that false positive cost a whole
 * debugging pass the first time the audit ran.
 */
export function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Every user-visible string the enrichment put into the email. */
export function contextLines(blocks?: ContextBlock[]): string[] {
  if (!blocks?.length) return [];
  const out: string[] = [];
  for (const b of blocks) {
    if (b.note) out.push(b.note);
    for (const item of b.items ?? []) {
      out.push(item.text);
      if (item.meta) out.push(item.meta);
    }
  }
  return out;
}

/**
 * ~70 characters is where Gmail desktop cuts and mobile is tighter still.
 * 78 is the honest "the reader will not see the end of this" line.
 */
const SUBJECT_TRUNCATES_AT = 78;

export function verifyRenderedEmail(input: VerifyRenderInput): RenderDefect[] {
  const defects: RenderDefect[] = [];
  const block = (check: string, detail: string) =>
    defects.push({ check, detail, severity: "block" });
  const warn = (check: string, detail: string) =>
    defects.push({ check, detail, severity: "warn" });

  if (!input.subject.trim()) {
    block("subject_empty", "no subject");
  }
  if (input.subject.length > SUBJECT_TRUNCATES_AT) {
    // A long subject is ugly, not wrong — it must never hold back a send.
    warn(
      "subject_long",
      `${input.subject.length} chars, will truncate: "${input.subject}"`
    );
  }

  for (const p of POISON) {
    if (input.html.includes(p)) {
      block("poison_html", `body contains ${JSON.stringify(p)}`);
    }
    if (input.subject.includes(p)) {
      block("poison_subject", `subject contains ${JSON.stringify(p)}`);
    }
  }

  if (!input.destination.trim() || input.destination === "your trip") {
    block("destination_unusable", `destination is ${JSON.stringify(input.destination)}`);
  } else if (!input.html.includes(escapeHtmlText(input.destination))) {
    // The destination must reach the READER, not merely the props.
    block("destination_missing", `"${input.destination}" never appears in the body`);
  }

  if (input.tripId && !input.html.includes(input.tripId)) {
    block("link_missing", "no link back to this trip");
  }

  // CONTAINMENT — the check that answers "are we mixing trips up".
  //
  // Compared against the trip's own field VALUES rather than a JSON dump of
  // the row: JSON.stringify escapes embedded quotes, so a weather note
  // containing one would never "contain" its own text.
  const corpus = input.ownStrings.filter(Boolean).join(" ");
  for (const line of contextLines(input.contextBlocks)) {
    // Truncation appends "…"; compare the surviving prefix.
    const probe = line.replace(/…$/, "").trim();
    if (probe && !corpus.includes(probe)) {
      block(
        "containment",
        `"${probe.slice(0, 60)}" is not in this trip's own data`
      );
    }
  }

  return defects;
}

/** Defects severe enough to hold the email back. */
export function blockingDefects(defects: RenderDefect[]): RenderDefect[] {
  return defects.filter((d) => d.severity === "block");
}

/** One-line summary for a log line or a `skipped_reason` column. */
export function summarizeDefects(defects: RenderDefect[]): string {
  return defects.map((d) => `${d.check}: ${d.detail}`).join("; ");
}
