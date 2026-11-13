import { afterEach, describe, expect, it, vi } from "vitest";
import type { Activity, ItineraryDay } from "@/types";

/**
 * Free-form edits on a saved trip go through the wizard's edit engine. These
 * pin which messages go to it, what the saved trip keeps when a day is
 * rewritten, and how the engine's reply is adapted to this page.
 */

const assistTrip = vi.fn();
vi.mock("./engine", () => ({ assistTrip: (input: unknown) => assistTrip(input) }));

const { conversationTurns, mergeTripEdits, proposedChange, proposeTripEdits, readDisplayCurrency, readWaitingChange, waitingLines } = await import("./trip-edits");

const act = (id: string, name: string, extra: Partial<Activity> = {}): Activity =>
  ({
    id,
    name,
    type: "attraction",
    time_slot: "morning",
    start_time: "09:00",
    duration_minutes: 90,
    description: `${name}: the long description the saved trip holds, with tips and history.`,
    location: "Centre",
    image_url: `https://img.example/${id}.jpg`,
    coordinates: { lat: 53.34, lng: -6.26 },
    address: `${name} Street 1`,
    estimated_cost: { amount: 10, currency: "EUR", tier: "budget" },
    ...extra,
  }) as Activity;

const trip = (): ItineraryDay[] => [
  { day_number: 1, date: "2027-03-11", theme: "Arrival", activities: [act("a1", "Trinity College"), act("a2", "Temple Bar", { start_time: "20:00", time_slot: "evening" })] },
  { day_number: 2, date: "2027-03-12", theme: "Museums", activities: [act("b1", "National Gallery"), act("b2", "Grafton Street", { start_time: "14:00", time_slot: "afternoon" })] },
  { day_number: 3, date: "2027-03-13", theme: "Coast", activities: [act("c1", "Howth Cliff Walk")] },
];

const engineActivity = (name: string, start: string, slot: "morning" | "afternoon" | "evening") =>
  ({
    name,
    type: "nightlife",
    time_slot: slot,
    start_time: start,
    duration_minutes: 120,
    description: "Short.",
    location: "Centre",
    estimated_cost: { amount: 15, currency: "EUR", tier: "budget" },
    tips: [],
    booking_required: false,
  }) as Activity;

afterEach(() => assistTrip.mockReset());

describe("readDisplayCurrency: the page's currency, when sane", () => {
  it("takes a currency code and a positive rate", () => {
    expect(readDisplayCurrency({ currency: "USD", rate: 1.08 })).toEqual({ currency: "USD", rate: 1.08 });
  });

  it("ignores anything else", () => {
    for (const raw of [undefined, null, "USD", { currency: "usd", rate: 1 }, { currency: "USD", rate: 0 }, { currency: "USD", rate: "1" }, { currency: "DOLLARS", rate: 1 }]) {
      expect(readDisplayCurrency(raw), JSON.stringify(raw)).toBeUndefined();
    }
  });

  it("is handed to the engine, so the reply's figures match the page", async () => {
    assistTrip.mockResolvedValue({ reply: "About 120 USD.", edits: [], meta: { model: "m", costUsd: 0, generationTimeMs: 1 } });
    await proposeTripEdits({ message: "how much is day 1?", destination: "Dublin", tripTitle: "Dublin", days: [], locale: "en", history: [], display: { currency: "USD", rate: 1.08 } });
    expect(assistTrip).toHaveBeenCalledWith(expect.objectContaining({ display: { currency: "USD", rate: 1.08 } }));
  });
});

describe("conversationTurns", () => {
  it("passes the last six turns with text, and before them the traveller's own messages, oldest first", () => {
    const messages = [
      { role: "system", content: "x" },
      ...Array.from({ length: 7 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` })),
      { role: "assistant", content: "  " },
    ];
    expect(conversationTurns(messages)).toEqual([
      { role: "user", text: "m0" },
      { role: "assistant", text: "m1" },
      { role: "user", text: "m2" },
      { role: "assistant", text: "m3" },
      { role: "user", text: "m4" },
      { role: "assistant", text: "m5" },
      { role: "user", text: "m6" },
    ]);
    expect(conversationTurns(undefined)).toEqual([]);
  });

  it("keeps what the traveller said long ago, up to ten messages", () => {
    const messages = [
      { role: "user", content: "We land at 23:00 on day 1" },
      ...Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "user" : "assistant", content: `m${i}` })),
    ];
    const turns = conversationTurns(messages);
    expect(turns).toHaveLength(16);
    expect(turns.slice(0, 10).every((t) => t.role === "user")).toBe(true);
    expect(turns.slice(-6).map((t) => t.text)).toEqual(["m24", "m25", "m26", "m27", "m28", "m29"]);
    expect(conversationTurns(messages.slice(0, 9))[0]).toEqual({ role: "user", text: "We land at 23:00 on day 1" });
  });
});

describe("mergeTripEdits: the saved trip keeps what it holds", () => {
  it("keeps a saved activity whole and moves only its time; a new one is added with an id", () => {
    const days = trip();
    const [day1] = mergeTripEdits(days, [
      {
        day_number: 1,
        summary: "Wigwam in the evening.",
        theme: "Arrival and a night out",
        activities: [
          engineActivity("Trinity College", "10:00", "morning"),
          engineActivity("Temple Bar", "19:00", "evening"),
          engineActivity("Wigwam", "22:00", "evening"),
        ],
      },
    ]);

    expect(day1.day_number).toBe(1);
    expect(day1.date).toBe("2027-03-11");
    expect(day1.theme).toBe("Arrival and a night out");

    const [trinity, temple, wigwam] = day1.activities;
    expect(trinity).toEqual({ ...days[0].activities[0], start_time: "10:00", time_slot: "morning", duration_minutes: 120 });
    expect(temple.id).toBe("a2");
    expect(temple.description).toBe(days[0].activities[1].description);
    expect(temple.image_url).toBe("https://img.example/a2.jpg");
    expect(temple.start_time).toBe("19:00");

    expect(wigwam.name).toBe("Wigwam");
    expect(wigwam.id).toMatch(/^edit-1-2-wigwam/);
    expect(wigwam.description).toBe("Short.");
  });

  it("returns only the edited days, and an activity moved between them keeps its id and details", () => {
    const days = trip();
    const out = mergeTripEdits(days, [
      { day_number: 1, summary: "", activities: [engineActivity("Trinity College", "09:00", "morning"), engineActivity("Grafton Street", "15:00", "afternoon")] },
      { day_number: 2, summary: "", activities: [engineActivity("National Gallery", "10:00", "morning"), engineActivity("Temple Bar", "20:00", "evening")] },
    ]);
    expect(out.map((d) => d.day_number)).toEqual([1, 2]);
    const grafton = out[0].activities[1];
    expect(grafton.id).toBe("b2");
    expect(grafton.address).toBe("Grafton Street Street 1");
    expect(out[1].activities[1].id).toBe("a2");
    const ids = out.flatMap((d) => d.activities.map((a) => a.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The engine puts a day's fixed plan back as stored; the change to save keeps it so.
  it("keeps a fixed plan whole, as the save expects it", () => {
    const days = trip();
    const flight = act("anchor-f1", "Flight to London", { locked: true, anchor_id: "f1", start_time: "18:00", time_slot: "evening", duration_minutes: 120 });
    days[1].activities.push(flight);
    const [day2] = mergeTripEdits(days, [
      { day_number: 2, summary: "", activities: [engineActivity("National Gallery", "10:00", "morning"), engineActivity("Little Museum of Dublin", "14:00", "afternoon"), flight] },
    ]);
    expect(day2.activities.map((a) => a.name)).toEqual(["National Gallery", "Little Museum of Dublin", "Flight to London"]);
    expect(day2.activities[2]).toEqual(flight);
  });
});

describe("proposeTripEdits", () => {
  const input = {
    message: "add nightclubs on nights 1 and 3",
    destination: "Dublin, Ireland",
    tripTitle: "Dublin Trip",
    days: trip(),
    startDate: "2027-03-11",
    endDate: "2027-03-13",
    locale: "en",
    history: [{ role: "user" as const, text: "Add nightclubs" }],
  };
  const meta = { model: "gemini-2.5-flash", costUsd: 0.001, generationTimeMs: 900 };

  it("asks the engine with the history and no wizard lead, and labels each day's summary", async () => {
    assistTrip.mockResolvedValue({
      reply: "Ready: nightclubs on nights 1 and 3.",
      edits: [
        {
          day_number: 1,
          summary: "Wigwam after dinner.",
          activities: [
            engineActivity("Trinity College", "09:00", "morning"),
            engineActivity("Temple Bar", "20:00", "evening"),
            engineActivity("Wigwam", "22:00", "evening"),
          ],
        },
        {
          day_number: 3,
          summary: "Index late.",
          activities: [engineActivity("Howth Cliff Walk", "10:00", "morning"), engineActivity("Index", "23:00", "evening")],
        },
      ],
      meta,
    });
    const out = await proposeTripEdits(input);
    // A proposal waiting for this page's button, which the route's lead names.
    // Only the owner adds days, and the engine is told when this traveller can't.
    expect(assistTrip).toHaveBeenCalledWith(
      expect.objectContaining({ autoApply: false, ownLead: true, canAddDays: false, history: input.history, locale: "en" }),
    );
    expect(out?.revisedDays.map((d) => d.day_number)).toEqual([1, 3]);
    expect(out?.summary).toBe("Day 1: Wigwam after dinner. Day 3: Index late.");
    expect(out?.reply).toBe("Ready: nightclubs on nights 1 and 3.");
  });

  const longer = {
    reply: "Here is a new Day 4 and a lighter Day 2.",
    edits: [
      { day_number: 2, summary: "Lighter.", activities: [engineActivity("National Gallery", "10:00", "morning")] },
      { day_number: 4, summary: "New day.", activities: [engineActivity("Malahide Castle", "10:00", "morning")] },
    ],
    tripLength: 4,
    meta,
  };

  // "Add 7 more days" must add them, not only say so.
  it("adds the owner's new days after the last one, dated, with ids", async () => {
    assistTrip.mockResolvedValue(longer);
    const out = await proposeTripEdits({ ...input, canAddDays: true });
    expect(out?.revisedDays.map((d) => [d.day_number, d.date])).toEqual([
      [2, "2027-03-12"],
      [4, "2027-03-14"],
    ]);
    expect(out?.tripLength).toBe(4);
    const [malahide] = out!.revisedDays[1].activities;
    expect(malahide.name).toBe("Malahide Castle");
    expect(malahide.id).toMatch(/^act_/);
    expect(out?.reply).toBe("Here is a new Day 4 and a lighter Day 2.");
    expect(out?.summary).toBe("Day 2: Lighter. Day 4: New day. Leaves out: Grafton Street.");
  });

  it("keeps the trip's length for an editor: new days are dropped and the reply says only the owner adds them", async () => {
    assistTrip.mockResolvedValue(longer);
    const out = await proposeTripEdits({ ...input, locale: "it" });
    expect(out?.revisedDays.map((d) => d.day_number)).toEqual([2]);
    expect(out?.tripLength).toBeUndefined();
    // The reply also covers Day 2's change, which stands, so it stays.
    expect(out?.reply).toBe(
      "Here is a new Day 4 and a lighter Day 2.\n\nSolo il proprietario del viaggio può aggiungere giorni, quindi il viaggio resta di 3 giorni. Idee per quei giorni, da proporgli:\n- Giorno 4: New day."
    );
    expect(out?.summary).toBe("Giorno 2: Lighter. Lascia fuori: Grafton Street.");
  });

  // The ideas themselves, not "Here are some ideas" with none after it.
  it("answers an editor who only asked for more days with the ideas for them", async () => {
    assistTrip.mockResolvedValue({
      ...longer,
      reply: "Happy to add two more days! Here are some ideas for Day 4 and Day 5.",
      edits: [
        { day_number: 4, summary: "Malahide Castle and the coast.", activities: [engineActivity("Malahide Castle", "10:00", "morning")] },
        { day_number: 5, summary: "", activities: [engineActivity("Glendalough", "09:00", "morning")] },
      ],
      tripLength: 5,
    });
    const out = await proposeTripEdits(input);
    expect(out?.revisedDays).toEqual([]);
    expect(out?.reply).toBe(
      "Only the trip owner can add days, so the trip stays at 3 days. Ideas for those days, to suggest to them:\n- Day 4: Malahide Castle and the coast.\n- Day 5: Glendalough"
    );
  });

  it("keeps the trip's length when the change would shorten it", async () => {
    assistTrip.mockResolvedValue({ ...longer, reply: "Two days are enough.", edits: [longer.edits[0]], tripLength: 2 });
    const out = await proposeTripEdits({ ...input, locale: "it", canAddDays: true });
    expect(out?.revisedDays.map((d) => d.day_number)).toEqual([2]);
    expect(out?.reply).toContain("Il viaggio resta di 3 giorni");
  });

  it("names a saved activity the change takes out, even when the reply calls it an addition", async () => {
    assistTrip.mockResolvedValue({
      reply: "I've added The Winding Stair to Day 2.",
      edits: [
        {
          day_number: 2,
          summary: "Added The Winding Stair for dinner.",
          activities: [engineActivity("National Gallery", "10:00", "morning"), engineActivity("The Winding Stair", "19:30", "evening")],
        },
      ],
      meta,
    });
    const out = await proposeTripEdits({ ...input, message: "Suggest a great local restaurant to add" });
    expect(out?.summary).toBe("Day 2: Added The Winding Stair for dinner. Leaves out: Grafton Street.");
  });

  it("leaves out nothing when activities only move between days", async () => {
    assistTrip.mockResolvedValue({
      reply: "Days 1 and 2 swapped.",
      edits: [
        { day_number: 1, summary: "Museums first.", activities: [engineActivity("National Gallery", "10:00", "morning"), engineActivity("Grafton Street", "14:00", "afternoon")] },
        { day_number: 2, summary: "Arrival plan.", activities: [engineActivity("Trinity College", "09:00", "morning"), engineActivity("Temple Bar", "20:00", "evening")] },
      ],
      meta,
    });
    const out = await proposeTripEdits({ ...input, message: "Switch days 1 & 2" });
    expect(out?.summary).toBe("Day 1: Museums first. Day 2: Arrival plan.");
  });

  it("hands a currency request to the page, which switches to it", async () => {
    assistTrip.mockResolvedValue({ reply: "Done: prices now show in USD.", edits: [], currency: "USD", meta });
    expect(await proposeTripEdits({ ...input, message: "show prices in dollars" })).toEqual({
      reply: "Done: prices now show in USD.",
      revisedDays: [],
      summary: "",
      currency: "USD",
      meta,
    });
  });

  it("returns an answer with no days when nothing needs to change", async () => {
    assistTrip.mockResolvedValue({ reply: "Which nights would you like?", edits: [], meta });
    const out = await proposeTripEdits(input);
    expect(out).toEqual({ reply: "Which nights would you like?", revisedDays: [], summary: "", meta });
  });
});

// A traveller had five restaurants waiting on a card, asked for "the others too",
// and the next card held only the others: the five were never saved.
describe("a change still waiting for its button", () => {
  const meta = { model: "m", costUsd: 0.001, generationTimeMs: 5 };
  const base = { message: "add the others too", destination: "Dublin", tripTitle: "Dublin", days: trip(), locale: "en", history: [] };
  // Day 2 as the waiting card would save it: a restaurant in, Grafton Street out.
  const waitingDay2 = (): ItineraryDay => ({
    ...trip()[1],
    activities: [trip()[1].activities[0], act("w1", "The Winding Stair", { start_time: "19:30", time_slot: "evening" })],
  });
  const waiting = () => ({ days: [waitingDay2()], reason: "Day 2: The Winding Stair for dinner." });
  const wigwamOnDay1 = {
    day_number: 1,
    summary: "Wigwam late.",
    activities: [engineActivity("Trinity College", "09:00", "morning"), engineActivity("Temple Bar", "20:00", "evening"), engineActivity("Wigwam", "22:00", "evening")],
  };

  it("is in the plan the engine reads, with what it does", async () => {
    assistTrip.mockResolvedValue({ reply: "Wigwam on day 1.", edits: [wigwamOnDay1], meta });
    await proposeTripEdits({ ...base, waiting: waiting() });
    const asked = assistTrip.mock.calls[0][0];
    expect(asked.days[1].activities.map((a: Activity) => a.name)).toEqual(["National Gallery", "The Winding Stair"]);
    expect(asked.days[0]).toEqual(trip()[0]);
    expect(asked.unsaved).toEqual(["Day 2: adds The Winding Stair; takes out Grafton Street"]);
  });

  it("stays in the new change, under what this reply changes, and the reply says so", async () => {
    assistTrip.mockResolvedValue({ reply: "Wigwam on day 1.", edits: [wigwamOnDay1], meta });
    const out = await proposeTripEdits({ ...base, waiting: waiting() });
    expect(out?.revisedDays.map((d) => d.day_number)).toEqual([1, 2]);
    expect(out?.revisedDays[1]).toEqual(waitingDay2());
    expect(out?.waitingKept).toBe(true);
    expect(out?.reply).toBe("Wigwam on day 1. (This also keeps the earlier change, which was not saved yet.)");
    expect(out?.summary).toBe("Day 2: The Winding Stair for dinner. Day 1: Wigwam late. Leaves out: Grafton Street.");
  });

  it("is rewritten where this reply changes its day, and the saved activities it puts back keep what they hold", async () => {
    assistTrip.mockResolvedValue({
      reply: "Grafton Street is back, and the dinner stays.",
      edits: [{ day_number: 2, summary: "Both.", activities: [engineActivity("National Gallery", "10:00", "morning"), engineActivity("Grafton Street", "14:00", "afternoon"), engineActivity("The Winding Stair", "19:30", "evening")] }],
      meta,
    });
    const out = await proposeTripEdits({ ...base, message: "keep Grafton Street too", waiting: waiting() });
    expect(out?.revisedDays.map((d) => d.day_number)).toEqual([2]);
    const [gallery, grafton, stair] = out!.revisedDays[0].activities;
    expect([gallery.id, grafton.id, grafton.address]).toEqual(["b1", "b2", "Grafton Street Street 1"]);
    expect(stair.name).toBe("The Winding Stair");
    expect(out?.waitingKept).toBe(true);
    // Its day is this reply's own: no note about an earlier change.
    expect(out?.reply).toBe("Grafton Street is back, and the dinner stays.");
  });

  it("stays on its card when the reply only answers", async () => {
    assistTrip.mockResolvedValue({ reply: "It opens at noon.", edits: [], meta });
    const out = await proposeTripEdits({ ...base, message: "when does it open?", waiting: waiting() });
    expect(out?.revisedDays).toEqual([waitingDay2()]);
    expect(out?.waitingKept).toBe(true);
    expect(out?.reply).toBe("It opens at noon.");
  });

  it("goes when the reply puts its day back as it was saved", async () => {
    assistTrip.mockResolvedValue({
      reply: "Back as it was.",
      edits: [{ day_number: 2, summary: "As before.", activities: [engineActivity("National Gallery", "09:00", "morning"), engineActivity("Grafton Street", "14:00", "afternoon")] }],
      meta,
    });
    const out = await proposeTripEdits({ ...base, message: "forget that dinner", waiting: waiting() });
    expect(out?.revisedDays).toEqual([]);
    expect(out?.waitingKept).toBeUndefined();
  });

  it("is read from the request only for days this trip has, with names", () => {
    expect(readWaitingChange(undefined, 3)).toBeUndefined();
    expect(readWaitingChange({ days: "x" }, 3)).toBeUndefined();
    expect(readWaitingChange({ days: [{ day_number: 9, activities: [] }] }, 3)).toBeUndefined();
    expect(readWaitingChange({ days: [{ day_number: 2, activities: [{ name: 5 }] }] }, 3)).toBeUndefined();
    const ok = readWaitingChange({ days: [waitingDay2(), { day_number: 0, activities: [] }], reason: "r".repeat(700) }, 3);
    expect(ok?.days.map((d) => d.day_number)).toEqual([2]);
    expect(ok?.reason).toHaveLength(600);
  });

  it("says a day whose activities only move changes times", () => {
    const moved = { ...trip()[2], activities: [act("c1", "Howth Cliff Walk", { start_time: "11:00" })] };
    expect(waitingLines(trip(), [moved])).toEqual(["Day 3: changes times"]);
  });
});

describe("proposedChange: the proposal as the change waiting for the user's confirm", () => {
  const meta = { model: "m", costUsd: 0.001, generationTimeMs: 5 };
  const proposal = (revisedDays: ItineraryDay[]) => ({ reply: "Ready.", revisedDays, summary: "", meta });
  const where = { destination: "Paris, France", endDate: "2027-03-13" };

  it("is one multi-day change from the first revised day, with no new end date when the trip keeps its days", () => {
    const day2 = { ...trip()[1], activities: [act("b1", "National Gallery"), engineActivity("Wigwam", "22:00", "evening")] };
    const day3 = { ...trip()[2], theme: "Coast walk" };
    expect(proposedChange(proposal([day2, day3]), { days: trip(), ...where })).toEqual({
      type: "apply_draft",
      applied: false,
      dayNumber: 2,
      dayCount: 2,
      revisedDays: [{ ...day2, activities: [day2.activities[0], { ...day2.activities[1], coordinates: expect.any(Object) }] }, day3],
    });
  });

  it("places an activity with no coordinates near the destination", () => {
    const day2 = { ...trip()[1], activities: [engineActivity("Wigwam", "22:00", "evening")] };
    const point = proposedChange(proposal([day2]), { days: trip(), ...where })!.revisedDays![0].activities[0].coordinates!;
    expect(point.lat).toBeCloseTo(48.8566, 1);
    expect(point.lng).toBeCloseTo(2.3522, 1);
  });

  it("moves the trip's end date to the last new day", () => {
    const day4 = { day_number: 4, date: "2027-03-14", activities: [act("d1", "Malahide Castle")] };
    const day5 = { day_number: 5, date: "2027-03-15", activities: [act("e1", "Dalkey")] };
    const change = proposedChange(proposal([trip()[2], day4, day5]), { days: trip(), ...where });
    expect(change).toMatchObject({ dayNumber: 3, dayCount: 3, newEndDate: "2027-03-15" });
  });

  it("moves the end date only for new days, not for a changed day dated after it", () => {
    const day3 = { ...trip()[2], theme: "Coast walk" };
    expect(proposedChange(proposal([day3]), { days: trip(), destination: where.destination, endDate: "2027-03-12" })).not.toHaveProperty("newEndDate");
  });

  it("keeps the end date when the new day falls within it, or has no date", () => {
    const within = { day_number: 4, date: "2027-03-12", activities: [act("d1", "Malahide Castle")] };
    const undated = { day_number: 4, date: "", activities: [act("d1", "Malahide Castle")] };
    expect(proposedChange(proposal([within]), { days: trip(), ...where })).not.toHaveProperty("newEndDate");
    expect(proposedChange(proposal([undated]), { days: trip(), ...where })).not.toHaveProperty("newEndDate");
  });

  it("is nothing when no day changes, and leaves the trip's days as they were", () => {
    const days = trip();
    const before = JSON.stringify(days);
    expect(proposedChange(proposal([]), { days, ...where })).toBeUndefined();
    proposedChange(proposal([{ day_number: 4, date: "2027-03-14", activities: [engineActivity("Wigwam", "22:00", "evening")] }]), { days, ...where });
    expect(JSON.stringify(days)).toBe(before);
  });
});
