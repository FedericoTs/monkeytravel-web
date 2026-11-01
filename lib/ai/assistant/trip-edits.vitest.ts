import { afterEach, describe, expect, it, vi } from "vitest";
import type { Activity, ItineraryDay } from "@/types";

/**
 * Free-form edits on a saved trip go through the wizard's edit engine. These
 * pin which messages go to it, what the saved trip keeps when a day is
 * rewritten, and how the engine's reply is adapted to this page.
 */

const assistTrip = vi.fn();
vi.mock("./engine", () => ({ assistTrip: (input: unknown) => assistTrip(input) }));

const { conversationTurns, mergeTripEdits, proposeTripEdits, readDisplayCurrency } = await import("./trip-edits");

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

  it("leaves a currency request to the chat: only the wizard switches currency", async () => {
    assistTrip.mockResolvedValue({ reply: "Prices now in USD.", edits: [], currency: "USD", meta });
    expect(await proposeTripEdits({ ...input, message: "show prices in dollars" })).toBeNull();
  });

  it("returns an answer with no days when nothing needs to change", async () => {
    assistTrip.mockResolvedValue({ reply: "Which nights would you like?", edits: [], meta });
    const out = await proposeTripEdits(input);
    expect(out).toEqual({ reply: "Which nights would you like?", revisedDays: [], summary: "", meta });
  });
});
