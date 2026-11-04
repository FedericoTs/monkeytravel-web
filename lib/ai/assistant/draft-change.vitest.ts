// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * A plan the traveller pasted ("Day 1: …, Day 2: …") is mapped onto the trip's
 * days by the model, and becomes one change to confirm. The days it doesn't
 * cover stay as they are. A trip built around fixed plans is not rewritten
 * from a draft.
 */

vi.mock("@/lib/ai/cache-metrics", () => ({ logCacheMetrics: vi.fn() }));
vi.mock("@/lib/trip/coordinate-fallback", () => ({ validateAndFixCoordinates: (days: unknown) => days }));

const { prepareDraftChange } = await import("./draft-change");

const act = (name: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${name}`, name, type: "attraction", start_time: "09:00", duration_minutes: 90, location: "Centre", ...extra,
});
const trip = () =>
  [
    { day_number: 1, date: "2027-03-11", activities: [act("Trinity College")] },
    { day_number: 2, date: "2027-03-12", activities: [act("National Gallery")] },
    { day_number: 3, date: "2027-03-13", activities: [act("Grafton Street")] },
  ] as unknown as ItineraryDay[];
const mappedDays = {
  revisedDays: [
    { day_number: 1, theme: "Old town", activities: [{ name: "Trinity College", type: "attraction", start_time: "09:00", duration_minutes: 90 }, { name: "Dublin Castle", type: "attraction", start_time: "11:00", duration_minutes: 60 }] },
    { day_number: 3, theme: "Coast", activities: [{ name: "Howth Cliff Walk", type: "nature", start_time: "10:00", duration_minutes: 120 }] },
  ],
  unmappedDayNumbers: [2],
};

let prompts: string[];
let reply: () => string;
const genAI = {
  getGenerativeModel: () => ({
    generateContent: async (prompt: string) => {
      prompts.push(prompt);
      return { response: { text: reply, usageMetadata: {} } };
    },
  }),
} as never;
const DRAFT = ["Use my draft:", "Day 1: Trinity College, Dublin Castle", "Day 3: Howth Cliff Walk"].join(String.fromCharCode(10));
const map = (days = trip(), language: "en" | "it" = "en") =>
  prepareDraftChange({ days, destination: "Dublin, Ireland", message: DRAFT, language, genAI });

beforeEach(() => {
  prompts = [];
  reply = () => JSON.stringify(mappedDays);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a pasted draft", () => {
  it("becomes the days it covers, with the days it doesn't listed", async () => {
    const { action, unmapped, error, note } = await map();
    expect(error).toBeUndefined();
    expect(note).toBeUndefined();
    expect(unmapped).toEqual([2]);
    expect(action).toMatchObject({ type: "apply_draft", applied: false, dayNumber: 1, dayCount: 2 });
    expect(action?.revisedDays?.map((d) => [d.day_number, d.activities.map((a) => a.name)])).toEqual([
      [1, ["Trinity College", "Dublin Castle"]],
      [3, ["Howth Cliff Walk"]],
    ]);
  });

  it("is mapped onto the trip's own days, in the trip's language", async () => {
    await map(trip(), "it");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("You are revising a 3-day trip itinerary for Dublin, Ireland");
    expect(prompts[0]).toContain('"name": "National Gallery"');
    expect(prompts[0]).toContain(DRAFT);
    expect(prompts[0]).toContain("Rispondi COMPLETAMENTE in italiano");
  });

  it("asks the user to label the days when none could be mapped", async () => {
    reply = () => JSON.stringify({ revisedDays: [], unmappedDayNumbers: [], note: "not a draft" });
    const { action, note } = await map();
    expect(action).toBeUndefined();
    expect(note).toMatch(/none of its days could be mapped/);
  });

  it("gives a plain reason when the model answers without JSON, or not at all, and logs the error's own text", async () => {
    const reason = "The pasted draft could not be matched to the trip's days just now";
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    reply = () => "I cannot help with that";
    expect((await map()).error).toBe(reason);
    reply = () => {
      throw new Error("model down");
    };
    expect((await map()).error).toBe(reason);
    const log = logged.mock.calls.flat().map(String).join(" ");
    expect(log).toContain("Draft mapping returned no JSON");
    expect(log).toContain("model down");
  });
});

describe("no draft is mapped", () => {
  it("onto a trip without days", async () => {
    expect((await map([])).error).toBe("This trip has no itinerary days yet, so there is nothing to revise");
    expect(prompts).toEqual([]);
  });

  it("onto a trip built around fixed plans, which are named", async () => {
    const days = trip();
    (days[1].activities[0] as { locked?: boolean }).locked = true;
    const { error, unmapped } = await map(days);
    expect(error).toMatch(/^This trip is built around fixed plans \(National Gallery\), so I won't rewrite it wholesale/);
    expect(unmapped).toEqual([]);
    expect(prompts).toEqual([]);
  });
});
