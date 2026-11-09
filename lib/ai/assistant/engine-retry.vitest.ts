/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * A 503 "high demand" from Gemini used to fail the wizard assistant outright.
 * It now gets one retry on the sibling model; other errors still fail fast.
 */

const generateContent = vi.fn();
const modelsAsked: string[] = [];

vi.mock("@/lib/ai/genai-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/genai-compat")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel({ model }: { model: string }) {
        return {
          generateContent: (req: unknown) => {
            modelsAsked.push(model);
            return generateContent(req);
          },
        };
      }
    },
  };
});

vi.mock("@/lib/ai/cache-metrics", () => ({ logCacheMetrics: vi.fn() }));

const overloaded = () => Object.assign(new Error("This model is currently experiencing high demand."), { status: 503 });
const answer = () => ({ response: { text: () => JSON.stringify({ reply: "Done.", edits: [] }) } });
const day = (n: number) =>
  ({ day_number: n, date: `2027-11-1${n}`, activities: [{ name: `Day ${n} thing`, time_slot: "morning" }] }) as unknown as ItineraryDay;
const input = { message: "What is on day 1?", destination: "Rome, Italy", tripTitle: "Rome", days: [day(1), day(2)], locale: "en" };

let mod: typeof import("./engine");

beforeEach(async () => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
  modelsAsked.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  mod = await import("./engine");
});

afterEach(() => {
  vi.useRealTimers();
});

async function run(i = input) {
  const p = mod.assistTrip(i);
  // Handled by the caller's expect; marked here so it isn't reported early.
  p.catch(() => {});
  await vi.runAllTimersAsync();
  return p;
}

describe("assistTrip on an overloaded model", () => {
  it("answers from the sibling model after a 503", async () => {
    generateContent.mockRejectedValueOnce(overloaded()).mockResolvedValueOnce(answer());
    const out = await run();
    expect(modelsAsked).toEqual(["gemini-3.5-flash-lite", "gemini-2.5-flash-lite"]);
    expect(out.meta.model).toBe("gemini-2.5-flash-lite");
  });

  it("fails after one retry when both models are overloaded", async () => {
    generateContent.mockRejectedValue(overloaded());
    await expect(run()).rejects.toThrow("high demand");
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("does not retry an error that is the request's own", async () => {
    generateContent.mockRejectedValueOnce(Object.assign(new Error("Invalid argument"), { status: 400 }));
    await expect(run()).rejects.toThrow("Invalid argument");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

const edited = (n: number, names: string[]) => ({
  response: { text: () => JSON.stringify({ reply: "Done.", edits: [{ day_number: n, activities: names.map((name) => ({ name })) }] }) },
});

describe("assistTrip on a reply that breaks a rule", () => {
  const onDay1 = { ...input, message: "add a gelato stop on day 1" };
  const onDay2 = edited(2, ["Day 2 thing", "Gelato at Giolitti"]);

  it("asks once more with the rule spelled out and keeps the better reply", async () => {
    generateContent.mockResolvedValueOnce(onDay2).mockResolvedValueOnce(edited(1, ["Day 1 thing", "Gelato at Giolitti"]));
    const out = await run(onDay1);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("CORRECTION: The traveller named Day 1.");
    expect(out.edits.map((e) => e.day_number)).toEqual([1]);
  });

  it("keeps the first reply when the second try fails, with no third call", async () => {
    generateContent.mockResolvedValueOnce(onDay2).mockRejectedValueOnce(overloaded());
    const out = await run(onDay1);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(out.edits.map((e) => e.day_number)).toEqual([2]);
  });

  it("keeps the first reply when the request is already slow", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(30_000);
    generateContent.mockResolvedValueOnce(onDay2);
    const out = await run(onDay1);
    now.mockRestore();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out.edits.map((e) => e.day_number)).toEqual([2]);
  });
});

// The reply says the change is made while "edits" is empty.
describe("assistTrip on a change it says it made but didn't send", () => {
  const timed = (n: number, names: string[]) =>
    ({ day_number: n, date: `2026-12-2${n}`, activities: names.map((name) => ({ name, time_slot: "morning", start_time: "09:00" })) }) as unknown as ItineraryDay;
  const days = [timed(1, ["Kiyomizu-dera"]), timed(2, ["Fushimi Inari-taisha"]), timed(3, ["Kinkaku-ji", "Dinner at Gion Kappa"])];
  const ryokan = { ...input, message: "I'll stay at a ryokan on the 23rd night add that", days };
  const said = (reply: string) => ({ response: { text: () => JSON.stringify({ reply, edits: [] }) } });
  const claimed = said("I've added a ryokan stay for the night of the 23rd.");
  const day3 = (names: string[]) => ({
    response: {
      text: () =>
        JSON.stringify({
          reply: "Here's Day 3 with your ryokan check-in.",
          edits: [{ day_number: 3, activities: names.map((name) => ({ name, start_time: "09:00" })) }],
        }),
    },
  });

  it("asks once more for the change, and keeps it", async () => {
    generateContent.mockResolvedValueOnce(claimed).mockResolvedValueOnce(day3(["Kinkaku-ji", "Dinner at Gion Kappa", "Check in at the ryokan"]));
    const out = await run(ryokan);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain('CORRECTION: Your \\"reply\\" says the plan changes, but \\"edits\\" is empty.');
    expect(out.edits.map((e) => e.day_number)).toEqual([3]);
    expect(out.reply).toBe("Here's Day 3 with your ryokan check-in.");
  });

  it("keeps a second try that makes the change but takes a stop out to fit it", async () => {
    generateContent.mockResolvedValueOnce(claimed).mockResolvedValueOnce(day3(["Kinkaku-ji", "Check in at the ryokan"]));
    const out = await run(ryokan);
    expect(out.edits[0].activities.map((a) => a.name)).toEqual(["Kinkaku-ji", "Check in at the ryokan"]);
  });

  it("says nothing changed when the second try sends nothing either", async () => {
    generateContent.mockResolvedValue(claimed);
    const out = await run(ryokan);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(out.edits).toEqual([]);
    expect(out.reply).toMatch(/^I haven't changed your plan/);
  });

  it("keeps nothing over a second try that changes another day than the one named", async () => {
    const onDay1 = { ...ryokan, message: "put a gelato stop on day 1" };
    generateContent
      .mockResolvedValueOnce(said("I've added a gelato stop to Day 1."))
      .mockResolvedValueOnce(edited(2, ["Fushimi Inari-taisha", "Gelato near the shrine"]));
    const out = await run(onDay1);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(out.edits).toEqual([]);
  });

  it("keeps nothing over a second try that leaves the day as it was", async () => {
    generateContent.mockResolvedValueOnce(claimed).mockResolvedValueOnce(day3(["Kinkaku-ji", "Dinner at Gion Kappa"]));
    const out = await run(ryokan);
    expect(out.edits).toEqual([]);
  });

  it("keeps nothing over a second try that makes the trip longer unasked", async () => {
    const longer = {
      response: { text: () => JSON.stringify({ reply: "Here's a new Day 4 at the ryokan.", trip_length: 4, edits: [{ day_number: 4, activities: [{ name: "Ryokan stay" }] }] }) },
    };
    generateContent.mockResolvedValueOnce(claimed).mockResolvedValueOnce(longer);
    const out = await run(ryokan);
    expect(out.tripLength).toBeUndefined();
    expect(out.edits).toEqual([]);
  });

  it("keeps nothing over a second try that changes days instead of adding the ones asked for", async () => {
    const moreDays = { ...ryokan, message: "add 2 more days for Nara" };
    generateContent
      .mockResolvedValueOnce(said("I've added two days for Nara."))
      .mockResolvedValueOnce({
        response: { text: () => JSON.stringify({ reply: "I've extended your trip with Nara.", edits: [{ day_number: 3, activities: [{ name: "Nara Park" }] }] }) },
      });
    const out = await run(moreDays);
    expect(out.edits).toEqual([]);
  });

  it("keeps nothing over a second try that changes days when the yes agreed to more days", async () => {
    const agreed = { ...ryokan, message: "yes", history: [{ role: "assistant" as const, text: "Want me to add 2 more days for Nara?" }] };
    generateContent
      .mockResolvedValueOnce(said("I've added two days for Nara."))
      .mockResolvedValueOnce({
        response: { text: () => JSON.stringify({ reply: "I've extended your trip with Nara.", edits: [{ day_number: 3, activities: [{ name: "Nara Park" }] }] }) },
      });
    const out = await run(agreed);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(out.edits).toEqual([]);
  });
});

describe("assistTrip on a change about more days than one reply holds", () => {
  const days = Array.from({ length: 9 }, (_, i) => ({
    ...day(i + 1),
    activities: [{ name: `Day ${i + 1} thing`, time_slot: "morning", start_time: "09:00" }],
  })) as unknown as ItineraryDay[];
  const long = { ...input, message: "im gluten free", days };
  const daysReply = (days: number[], more: number[] = []) => ({
    response: {
      text: () =>
        JSON.stringify({
          reply: "Every day is gluten-free now.",
          more_days: more,
          edits: days.map((n) => ({ day_number: n, summary: `GF day ${n}`, activities: [{ name: `GF place ${n}` }] })),
        }),
    },
  });

  it("asks for the other days together and returns every day", async () => {
    generateContent.mockResolvedValueOnce(daysReply([1, 2, 3, 4, 5, 6], [7, 8, 9])).mockResolvedValueOnce(daysReply([7, 8, 9]));
    const out = await run(long);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("Now return Days 7, 8, 9");
    expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out.reply).toBe("Every day is gluten-free now.");
  });

  it("names the days a part didn't bring back", async () => {
    generateContent.mockResolvedValueOnce(daysReply([1, 2, 3, 4, 5, 6], [7, 8, 9])).mockRejectedValueOnce(overloaded());
    const out = await run(long);
    expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.reply).toContain("Days 7, 8, 9 aren't changed yet");
  });

  // A list of ten restaurants: the first part placed all ten on Days 1-6, and the
  // part asked for Days 7-12 "the same way" added five of them again.
  it("adds nothing on a part's day that an earlier part already placed on another", async () => {
    // Days 1 and 7 both start with the same breakfast, which a day keeps.
    const breakfast = { name: "Breakfast at Hotel Bourbon", time_slot: "morning", start_time: "08:00" };
    const withBreakfast = days.map((d) => (d.day_number === 1 || d.day_number === 7 ? { ...d, activities: [breakfast, ...d.activities] } : d)) as unknown as ItineraryDay[];
    const list = { ...long, days: withBreakfast, message: "add Madalosso Restaurante, Zefy Diner, Café Lisboa and Bar do Alemão" };
    const first = {
      response: {
        text: () =>
          JSON.stringify({
            reply: "All four are in.",
            more_days: [7, 8, 9],
            edits: [
              { day_number: 1, summary: "Lunch.", activities: [breakfast, { name: "Day 1 thing", start_time: "09:00" }, { name: "Madalosso Restaurante", start_time: "12:30" }] },
              { day_number: 2, summary: "Dinner.", activities: [{ name: "Day 2 thing", start_time: "09:00" }, { name: "Zefy Diner", start_time: "19:30" }, { name: "Café Lisboa", start_time: "16:00" }] },
            ],
          }),
      },
    };
    const part = {
      response: {
        text: () =>
          JSON.stringify({
            reply: "ok",
            edits: [
              { day_number: 7, activities: [breakfast, { name: "Day 7 thing", start_time: "09:00" }, { name: "Madalosso", start_time: "12:30" }] },
              { day_number: 8, activities: [{ name: "Day 8 thing", start_time: "09:00" }, { name: "Café", start_time: "16:00" }, { name: "Bar do Alemão", start_time: "19:00" }, { name: "Zefy Diner Curitiba", start_time: "21:00" }] },
              { day_number: 9, activities: [{ name: "Day 9 thing", start_time: "10:30" }] },
            ],
          }),
      },
    };
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(part);
    const out = await run(list);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("Each thing they asked to add goes on one day only");
    // Day 7 is back as it was and Day 9 only moved, so neither is part of the
    // change; a short "Café" isn't taken for Café Lisboa.
    expect(out.edits.map((e) => [e.day_number, e.activities.map((a) => a.name)])).toEqual([
      [1, ["Breakfast at Hotel Bourbon", "Day 1 thing", "Madalosso Restaurante"]],
      [2, ["Day 2 thing", "Zefy Diner", "Café Lisboa"]],
      [8, ["Day 8 thing", "Café", "Bar do Alemão"]],
    ]);
  });

  // Live, 11-09: ten restaurants asked for, eight added, a reply naming all ten.
  it("asks once more for a list that came back short, and names what still isn't in", async () => {
    const list = { ...long, message: "adicione estes: madalosso restaurante, zefy diner, bar do alemao e lett's road", locale: "pt" };
    const added = (names: string[]) => ({
      response: {
        text: () =>
          JSON.stringify({
            reply: "Adicionei os quatro restaurantes.",
            edits: names.map((name, i) => ({ day_number: i + 1, summary: "Jantar.", activities: [{ name: `Day ${i + 1} thing`, start_time: "09:00" }, { name, start_time: "19:30" }] })),
          }),
      },
    });
    generateContent.mockResolvedValueOnce(added(["Madalosso", "Zefy Diner"])).mockResolvedValueOnce(added(["Madalosso", "Zefy Diner", "Bar do Alemão"]));
    const out = await run(list);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("These places from their list aren't in your edits: bar do alemao, lett's road");
    expect(out.edits.map((e) => e.activities[1].name)).toEqual(["Madalosso", "Zefy Diner", "Bar do Alemão"]);
    expect(out.reply).toContain("(Não entrou nesta alteração: lett's road.)");
  });

  it("doesn't take a second try that adds more of the list but drops what they said to keep", async () => {
    const sights = ["Jardim Botânico", "Ópera de Arame", "Museu Oscar Niemeyer"];
    const curitiba = sights.map((name, i) => ({ day_number: i + 1, date: `2027-11-1${i + 1}`, activities: [{ name, time_slot: "morning", start_time: "09:00" }] })) as unknown as ItineraryDay[];
    const list = { ...long, days: curitiba, message: "não remova nada, só adicione: madalosso restaurante, zefy diner, bar do alemao e lett's road", locale: "pt" };
    const withDinner = (n: number, name: string) => ({ day_number: n, activities: [{ name: sights[n - 1], start_time: "09:00" }, { name, start_time: "19:30" }] });
    const first = { response: { text: () => JSON.stringify({ reply: "Adicionei.", edits: [withDinner(1, "Madalosso"), withDinner(2, "Zefy Diner")] }) } };
    // Day 3 loses its museum to make room.
    const second = {
      response: {
        text: () =>
          JSON.stringify({ reply: "Adicionei.", edits: [withDinner(1, "Madalosso"), withDinner(2, "Zefy Diner"), { day_number: 3, activities: [{ name: "Bar do Alemão", start_time: "19:30" }] }] }),
      },
    };
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const out = await run(list);
    expect(out.edits.map((e) => e.day_number)).toEqual([1, 2]);
  });

  it("leaves the places of days still to come to the note about those days", async () => {
    const list = { ...long, message: "adicione: madalosso restaurante, zefy diner, bar do alemao e lett's road", locale: "pt" };
    const first = {
      response: {
        text: () =>
          JSON.stringify({
            reply: "Os quatro restaurantes.",
            more_days: [7, 8],
            edits: ["Madalosso", "Zefy Diner"].map((name, i) => ({ day_number: i + 1, activities: [{ name: `Day ${i + 1} thing`, start_time: "09:00" }, { name, start_time: "19:30" }] })),
          }),
      },
    };
    generateContent.mockResolvedValueOnce(first).mockRejectedValueOnce(overloaded());
    const out = await run(list);
    expect(out.reply).toContain("7, 8");
    expect(out.reply).not.toContain("Não entrou nesta alteração");
  });

  it("keeps a part's days that only move times when the change is about times", async () => {
    const later = (days: number[], more: number[] = []) => ({
      response: {
        text: () =>
          JSON.stringify({
            reply: "Every day starts at 10:30.",
            more_days: more,
            edits: days.map((n) => ({ day_number: n, summary: "Later.", activities: [{ name: `Day ${n} thing`, start_time: "10:30" }] })),
          }),
      },
    });
    generateContent.mockResolvedValueOnce(later([1, 2, 3, 4, 5, 6], [7, 8, 9])).mockResolvedValueOnce(later([7, 8, 9]));
    const out = await run({ ...long, message: "start every day at 10:30" });
    expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps a day a part left as it was out of the change", async () => {
    const same = { response: { text: () => JSON.stringify({ reply: "ok", edits: [{ day_number: 7, activities: [{ name: "Day 7 thing", time_slot: "morning" }] }] }) } };
    generateContent.mockResolvedValueOnce(daysReply([1, 2, 3, 4, 5, 6], [7])).mockResolvedValueOnce(same);
    const out = await run(long);
    expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.reply).toBe("Every day is gluten-free now.");
  });

  it("doesn't start the rest when the request is already slow, and says so", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(40_000);
    generateContent.mockResolvedValueOnce(daysReply([1, 2, 3, 4, 5, 6], [7, 8, 9]));
    const out = await run(long);
    now.mockRestore();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out.reply).toContain("Days 7, 8, 9 aren't changed yet");
  });
});

// One reply holds fewer new days than "add 7 more days" asks for.
describe("assistTrip adding more days than one reply holds", () => {
  const week = Array.from({ length: 7 }, (_, i) => ({
    ...day(i + 1),
    activities: [{ name: `Day ${i + 1} thing`, time_slot: "morning", start_time: "09:00" }],
  })) as unknown as ItineraryDay[];
  const more = { ...input, message: "aggiungi altri 7 giorni a questo viaggio", days: week, locale: "it" };
  const newDays = (days: number[], extra: Record<string, unknown> = {}) => ({
    response: {
      text: () =>
        JSON.stringify({
          reply: "Ecco 7 giorni in più: Kyoto, Nara e Osaka.",
          edits: days.map((n) => ({ day_number: n, summary: `Giorno ${n}`, activities: [{ name: `Sight ${n}` }] })),
          ...extra,
        }),
    },
  });

  it("asks for the rest of the new days and adds them all", async () => {
    generateContent
      .mockResolvedValueOnce(newDays([8, 9, 10, 11, 12, 13], { trip_length: 14, more_days: [14] }))
      .mockResolvedValueOnce(newDays([14]));
    const out = await run(more);
    const part = JSON.stringify(generateContent.mock.calls[1][0]);
    expect(part).toContain("Days 14 are new days at the end of the trip, which now has 14 days");
    expect(part).toContain('\\"trip_length\\" is 14');
    // The part sees the new days already planned, so it repeats none of them.
    expect(part).toContain("Day 13: Sight 13");
    expect(out.tripLength).toBe(14);
    expect(out.edits.map((e) => e.day_number)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(out.reply).toBe("Ecco 7 giorni in più: Kyoto, Nara e Osaka.");
  });

  it("adds the new days that came back, and names the rest", async () => {
    generateContent
      .mockResolvedValueOnce(newDays([8, 9, 10, 11, 12, 13], { trip_length: 14, more_days: [14] }))
      .mockRejectedValueOnce(overloaded());
    const out = await run(more);
    expect(out.tripLength).toBe(13);
    expect(out.edits.map((e) => e.day_number)).toEqual([8, 9, 10, 11, 12, 13]);
    expect(out.reply).toContain('(Il giorno 14 non è ancora aggiunto: scrivi "continua" e lo aggiungerò.)');
  });

  it("keeps the trip's length when none of its new days came back", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(40_000);
    generateContent.mockResolvedValueOnce(newDays([], { trip_length: 14, more_days: [8, 9, 10, 11, 12, 13, 14] }));
    const out = await run(more);
    now.mockRestore();
    expect(out.tripLength).toBeUndefined();
    expect(out.edits).toEqual([]);
    expect(out.reply).toMatch(/^Non ho modificato il tuo piano/);
  });
});

// A day must end in time for the traveller's departure.
describe("assistTrip on a day that doesn't fit when they leave", () => {
  const fiveDays = Array.from({ length: 5 }, (_, i) => day(i + 1));
  const message = { ...input, message: "Monday flight from BKK at 2 pm", days: fiveDays };
  const lastDay = (names: [string, string][]) => ({
    response: {
      text: () =>
        JSON.stringify({
          reply: "Day 5 is set for your 2 PM flight.",
          travel_times: [{ day: 5, leaves: "14:00", by: "flight" }],
          edits: [{ day_number: 5, activities: names.map(([name, start_time]) => ({ name, start_time, duration_minutes: 60 })) }],
        }),
    },
  });

  it("asks once more with the times spelled out, and keeps the day that fits", async () => {
    generateContent
      .mockResolvedValueOnce(lastDay([["Breakfast near the hotel", "08:30"], ["Lunch at Baan Khanitha", "12:30"]]))
      .mockResolvedValueOnce(lastDay([["Breakfast near the hotel", "08:30"], ["Transfer to BKK airport", "11:00"]]));
    const out = await run(message);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain(
      "CORRECTION: Day 5: they leave at 14:00, so everything must end by 11:00. Lunch at Baan Khanitha (12:30) doesn't fit.",
    );
    expect(out.edits[0].activities.map((a) => a.name)).toEqual(["Breakfast near the hotel", "Transfer to BKK airport"]);
  });

  it("says what still doesn't fit when the second try can't be had", async () => {
    generateContent
      .mockResolvedValueOnce(lastDay([["Breakfast near the hotel", "08:30"], ["Lunch at Baan Khanitha", "12:30"]]))
      .mockRejectedValueOnce(overloaded());
    const out = await run(message);
    expect(out.reply).toBe(
      "Day 5 is set for your 2 PM flight. (Check Day 5: you leave at 14:00, so plans should end by 11:00, and the day still has: Lunch at Baan Khanitha (12:30).)",
    );
  });

  it("holds the second try to the first one's times, even when it leaves them out", async () => {
    const noTimes = {
      response: {
        text: () =>
          JSON.stringify({
            reply: "Day 5 ends with shopping.",
            edits: [{ day_number: 5, activities: [{ name: "Shopping at MBK", start_time: "13:00", duration_minutes: 60 }] }],
          }),
      },
    };
    generateContent.mockResolvedValueOnce(lastDay([["Breakfast near the hotel", "08:30"], ["Lunch at Baan Khanitha", "12:30"]])).mockResolvedValueOnce(noTimes);
    const out = await run(message);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(out.edits[0].activities.map((a) => a.name)).toEqual(["Breakfast near the hotel", "Lunch at Baan Khanitha"]);
  });
});

describe("isModelOverloaded", () => {
  it("is true only for 429, 500 and 503", () => {
    expect([429, 500, 503].map((status) => mod.isModelOverloaded({ status }))).toEqual([true, true, true]);
    expect([400, 401, 404].map((status) => mod.isModelOverloaded({ status }))).toEqual([false, false, false]);
    expect(mod.isModelOverloaded(new Error("no status"))).toBe(false);
    expect(mod.isModelOverloaded(null)).toBe(false);
  });
});
