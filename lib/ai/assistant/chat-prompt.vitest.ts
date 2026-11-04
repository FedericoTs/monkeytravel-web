import { describe, expect, it } from "vitest";
import type { ItineraryDay } from "@/types";
import type { AssistantMessage } from "./thread";
import { chatPrompt, turnContext, type TripContext } from "./chat-prompt";

/**
 * What the trip assistant's chat model is told on a turn: whether this turn's
 * change failed, waits for the user's confirm, or changed nothing, then the
 * trip, the last messages of the thread and the user's message.
 */

const none = { failure: undefined, action: undefined, buttonLabel: "", unmappedDayNumbers: [], note: undefined };
const draft = { type: "apply_draft" as const, applied: false, pending: true, dayNumber: 1, dayCount: 2 };

describe("a turn's context", () => {
  it("says first that a change did not happen, and why", () => {
    const context = turnContext({ ...none, failure: "This trip has no itinerary days yet", action: draft, note: "ignored" });
    expect(context).toContain("IMPORTANT - THE CHANGE DID NOT HAPPEN.");
    expect(context).toContain("Reason: This trip has no itinerary days yet");
    expect(context).not.toContain("ignored");
  });

  it("names the button a prepared change waits for, and the draft's days it could not read", () => {
    const context = turnContext({ ...none, action: draft, buttonLabel: "Apply change", unmappedDayNumbers: [2, 4] });
    expect(context).toContain('"Apply change"');
    expect(context).toContain("NOTHING HAS BEEN SAVED");
    expect(context).toContain("Days 2, 4 could not be read from the draft and are unchanged");
  });

  it("passes a note on when nothing changed, and says nothing otherwise", () => {
    expect(turnContext({ ...none, note: "Only the trip owner can add days." })).toBe("\nNOTE: Only the trip owner can add days.");
    expect(turnContext(none)).toBe("");
  });
});

describe("a chat turn's prompt", () => {
  const tripContext: TripContext = {
    id: "t1",
    title: "Dublin Trip",
    destination: "Dublin, Ireland",
    startDate: "2027-03-11",
    endDate: "2027-03-13",
    itinerary: [{ day_number: 1, date: "2027-03-11", activities: [] }] as unknown as ItineraryDay[],
    dayCount: 1,
    activityCount: 0,
  };
  const said = (role: "user" | "assistant", content: string): AssistantMessage => ({ role, content, timestamp: "2026-11-04T12:00:00Z" });

  it("carries the thread's last four messages, then the user's", () => {
    const thread = ["one", "two", "three", "four", "five"].map((w, i) => said(i % 2 ? "assistant" : "user", w));
    const prompt = chatPrompt({ tripContext, language: "en", turn: "\nNOTE: x", thread, message: "Make day 1 cheaper" });
    expect(prompt).toContain("\nNOTE: x\n");
    expect(prompt).toContain("Recent conversation:\nAssistant: two\nUser: three\nAssistant: four\nUser: five\n");
    expect(prompt).not.toContain("User: one");
    expect(prompt.endsWith("User: Make day 1 cheaper\n\nRespond with valid JSON only.")).toBe(true);
  });

  it("has no conversation section for a new thread, and asks for the user's language", () => {
    const prompt = chatPrompt({ tripContext, language: "it", turn: "", thread: [], message: "Ciao" });
    expect(prompt).not.toContain("Recent conversation");
    expect(prompt).toContain("Rispondi COMPLETAMENTE in italiano");
    expect(prompt).toContain("REPLY LANGUAGE");
  });
});
