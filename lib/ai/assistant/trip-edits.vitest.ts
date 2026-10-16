import { afterEach, describe, expect, it, vi } from "vitest";
import type { Activity, ItineraryDay } from "@/types";

/**
 * Free-form edits on a saved trip go through the wizard's edit engine. These
 * pin which messages go to it, what the saved trip keeps when a day is
 * rewritten, and how the engine's reply is adapted to this page.
 */

const assistTrip = vi.fn();
vi.mock("@/lib/ai/assistant-anon", () => ({ assistTrip: (input: unknown) => assistTrip(input) }));

const { conversationTurns, isPlainQuestion, mergeTripEdits, proposeTripEdits } = await import("./trip-edits");

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

describe("isPlainQuestion: which messages stay with the chat", () => {
  it("keeps questions with no change in them", () => {
    for (const q of [
      "What time does the Guinness Storehouse open?",
      "How far is Howth from the centre?",
      "What's the address of the hotel?",
      "¿Qué hay cerca de Temple Bar?",
      "Cosa c'è da vedere a Trastevere?",
      "Quanto costa il biglietto?",
      "Onde fica o castelo?",
      "Is it safe to walk at night?",
    ]) {
      expect(isPlainQuestion(q), q).toBe(true);
    }
  });

  it("sends every ask for a change to the engine, however it is phrased", () => {
    for (const m of [
      "adding Wigwam to Day 3",
      "you can add them on the 2nd, 4th and 6th night",
      "Add more nightlife activities (pubs, clubs)",
      "Keep the classics, but make it more fun for 22 year olds. Add nightclubs",
      "Do not replace just add",
      "Can you add a museum on day 2?",
      "Could we swap days 1 and 2?",
      "Walking time/taxi time should be inbetween the activities for day 2, day 3",
      "Day 3 feels packed",
      "I would prefer walking",
      "Puoi aggiungere un museo il giorno 3?",
      "¿Puedes quitar el museo del día 2?",
      "Pode trocar o jantar do dia 1?",
    ]) {
      expect(isPlainQuestion(m), m).toBe(false);
    }
  });
});

describe("conversationTurns", () => {
  it("passes the last six turns with text, oldest first", () => {
    const messages = [
      { role: "system", content: "x" },
      ...Array.from({ length: 7 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` })),
      { role: "assistant", content: "  " },
    ];
    expect(conversationTurns(messages)).toEqual([
      { role: "assistant", text: "m1" },
      { role: "user", text: "m2" },
      { role: "assistant", text: "m3" },
      { role: "user", text: "m4" },
      { role: "assistant", text: "m5" },
      { role: "user", text: "m6" },
    ]);
    expect(conversationTurns(undefined)).toEqual([]);
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
        { day_number: 1, summary: "Wigwam after dinner.", activities: [engineActivity("Wigwam", "22:00", "evening")] },
        { day_number: 3, summary: "Index late.", activities: [engineActivity("Index", "23:00", "evening")] },
      ],
      edit: null,
      meta,
    });
    const out = await proposeTripEdits(input);
    expect(assistTrip).toHaveBeenCalledWith(expect.objectContaining({ autoApply: true, history: input.history, locale: "en" }));
    expect(out?.revisedDays.map((d) => d.day_number)).toEqual([1, 3]);
    expect(out?.summary).toBe("Day 1: Wigwam after dinner. Day 3: Index late.");
    expect(out?.reply).toBe("Ready: nightclubs on nights 1 and 3.");
  });

  it("keeps the trip's length: new days are dropped and the reply says so", async () => {
    assistTrip.mockResolvedValue({
      reply: "Here is a new Day 4 and a lighter Day 2.",
      edits: [
        { day_number: 2, summary: "Lighter.", activities: [engineActivity("National Gallery", "10:00", "morning")] },
        { day_number: 4, summary: "New day.", activities: [engineActivity("Malahide Castle", "10:00", "morning")] },
      ],
      tripLength: 4,
      edit: null,
      meta,
    });
    const out = await proposeTripEdits({ ...input, locale: "it" });
    expect(out?.revisedDays.map((d) => d.day_number)).toEqual([2]);
    expect(out?.reply).toContain("Il viaggio resta di 3 giorni");
    expect(out?.summary).toBe("Giorno 2: Lighter.");
  });

  it("leaves a currency request to the chat: only the wizard switches currency", async () => {
    assistTrip.mockResolvedValue({ reply: "Prices now in USD.", edits: [], edit: null, currency: "USD", meta });
    expect(await proposeTripEdits({ ...input, message: "show prices in dollars" })).toBeNull();
  });

  it("returns an answer with no days when nothing needs to change", async () => {
    assistTrip.mockResolvedValue({ reply: "Which nights would you like?", edits: [], edit: null, meta });
    const out = await proposeTripEdits(input);
    expect(out).toEqual({ reply: "Which nights would you like?", revisedDays: [], summary: "", meta });
  });
});
