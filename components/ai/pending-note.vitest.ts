/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { showsPendingNote } from "./AIAssistantEnhanced";

/**
 * "Not saved yet: tap Save to my trip below" is true while the change waits
 * for the button. The chat used to keep it in the reply for good, under the
 * "Day 3 updated" badge the apply put there.
 */

const NOTE = 'Not saved yet: tap "Save to my trip" below to update your trip.';
const reply = (applied = false) => ({ role: "assistant" as const, pendingNote: NOTE, action: { type: "apply_draft", applied } });
const user = { role: "user" as const };

describe("showsPendingNote", () => {
  it("shows the note under the latest reply while its change waits", () => {
    expect(showsPendingNote([user, reply()], 1, true)).toBe(true);
  });

  it("drops it once the change is applied", () => {
    expect(showsPendingNote([user, reply(true)], 1, false)).toBe(false);
    expect(showsPendingNote([user, reply(true)], 1, true)).toBe(false);
  });

  it("drops it once the change is cancelled", () => {
    const cancelled = { role: "assistant" as const };
    expect(showsPendingNote([user, reply(), cancelled], 1, false)).toBe(false);
  });

  it("drops it when no change waits, so there is no button to tap", () => {
    expect(showsPendingNote([user, reply()], 1, false)).toBe(false);
  });

  it("drops it under an older reply", () => {
    expect(showsPendingNote([user, reply(), user, reply()], 1, true)).toBe(false);
    expect(showsPendingNote([user, reply(), user, reply()], 3, true)).toBe(true);
  });

  it("shows nothing for a reply without a note", () => {
    expect(showsPendingNote([user, { role: "assistant" as const }], 1, true)).toBe(false);
  });
});
