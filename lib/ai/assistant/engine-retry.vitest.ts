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

async function run(i: Parameters<typeof mod.assistTrip>[0] = input) {
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

  it("names a stop a later part set to the shortest a stop can be", async () => {
    const part = {
      response: {
        text: () =>
          JSON.stringify({
            reply: "ok",
            // Day 2 wasn't this part's to change, so its stop is dropped and never named.
            edits: [2, 7, 8, 9].map((n) => ({
              day_number: n,
              summary: `GF day ${n}`,
              activities: [
                { name: n === 8 ? "Quick look at the market" : n === 2 ? "A stop nobody asked for" : `GF place ${n}`, start_time: "10:00", duration_minutes: n === 8 || n === 2 ? 2 : 60 },
              ],
            })),
          }),
      },
    };
    generateContent.mockResolvedValueOnce(daysReply([1, 2, 3, 4, 5, 6], [7, 8, 9])).mockResolvedValueOnce(part);
    const out = await run(long);
    expect(out.edits.find((e) => e.day_number === 8)?.activities[0].duration_minutes).toBe(5);
    expect(out.reply).toContain("Quick look at the market: set to 5 min, the shortest a stop can be.");
    expect(out.reply).not.toContain("A stop nobody asked for");
    expect(out.edits.find((e) => e.day_number === 2)?.activities[0].name).toBe("GF place 2");
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

  // Live, 11-09: two parts asked at once each placed the same restaurants, and
  // one part repeated a place on two of its days.
  describe("each place of a list once, whichever reply or part placed it", () => {
    const fortnight = Array.from({ length: 14 }, (_, i) => ({
      day_number: i + 1,
      date: `2027-12-${String(i + 1).padStart(2, "0")}`,
      activities: [{ name: `Sight ${String.fromCharCode(65 + i)}`, time_slot: "morning", start_time: "09:00" }],
    })) as unknown as ItineraryDay[];
    const dayWith = (n: number, ...extra: string[]) => ({
      day_number: n,
      summary: "Dinner.",
      activities: [{ name: `Sight ${String.fromCharCode(64 + n)}`, start_time: "09:00" }, ...extra.map((name) => ({ name, start_time: "19:30" }))],
    });
    const reply = (edits: unknown[], more: number[] = []) => ({ response: { text: () => JSON.stringify({ reply: "Os restaurantes.", more_days: more, edits }) } });
    const named = (out: Awaited<ReturnType<typeof run>>) => out.edits.map((e) => [e.day_number, e.activities.slice(1).map((a) => a.name)]);

    it("leaves a place off a later day, in one part or another, when an earlier day has it", async () => {
      const list = { ...input, days: fortnight, locale: "pt", message: "adicione: o senhor restaurante, dhoosushi, park do churrasco e baraquias restaurante" };
      generateContent
        .mockResolvedValueOnce(reply([dayWith(1, "O Senhor Restaurante"), dayWith(2, "Dhoosushi")], [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))
        .mockResolvedValueOnce(reply([dayWith(3, "Park do Churrasco Restaurante"), dayWith(5, "Park do Churrasco"), dayWith(6, "O Senhor Restaurante")]))
        .mockResolvedValueOnce(reply([dayWith(9, "Dhoosushi"), dayWith(10, "Baraquias Restaurante")]));
      const out = await run(list);
      expect(generateContent).toHaveBeenCalledTimes(3);
      expect(named(out)).toEqual([
        [1, ["O Senhor Restaurante"]],
        [2, ["Dhoosushi"]],
        [3, ["Park do Churrasco Restaurante"]],
        [10, ["Baraquias Restaurante"]],
      ]);
    });

    it("keeps one reply's first day for a place it repeats, and a place it moves", async () => {
      const list = { ...input, days: [...fortnight.slice(0, 2), { ...fortnight[2], activities: [...fortnight[2].activities, { name: "Zefy Diner", start_time: "19:30" }] }] as unknown as ItineraryDay[], locale: "pt", message: "adicione: madalosso restaurante, zefy diner e bar do alemao" };
      // Madalosso on Days 1 and 2; Zefy Diner moved from Day 3 to Day 1.
      generateContent.mockResolvedValueOnce(reply([dayWith(1, "Madalosso", "Zefy Diner"), dayWith(2, "Madalosso", "Bar do Alemão"), dayWith(3)]));
      const out = await run(list);
      expect(named(out)).toEqual([
        [1, ["Madalosso", "Zefy Diner"]],
        [2, ["Bar do Alemão"]],
        [3, []],
      ]);
    });

    it("leaves a place where the plan already has it, on a day the change doesn't touch", async () => {
      const kept = { ...fortnight[3], activities: [...fortnight[3].activities, { name: "Madalosso Restaurante", start_time: "12:30" }] } as unknown as ItineraryDay;
      const list = { ...input, days: [...fortnight.slice(0, 3), kept], locale: "pt", message: "adicione: madalosso restaurante, zefy diner e bar do alemao" };
      generateContent.mockResolvedValueOnce(reply([dayWith(1, "Madalosso", "Zefy Diner"), dayWith(2, "Bar do Alemão")]));
      const out = await run(list);
      expect(named(out)).toEqual([
        [1, ["Zefy Diner"]],
        [2, ["Bar do Alemão"]],
      ]);
    });

    it("holds only the list's places to once: other things added on several days stay", async () => {
      const list = { ...input, days: fortnight.slice(0, 3), locale: "pt", message: "adicione: madalosso restaurante, zefy diner e bar do alemao, e café da manhã no hotel" };
      generateContent.mockResolvedValueOnce(
        reply([dayWith(1, "Madalosso", "Hotel breakfast buffet"), dayWith(2, "Zefy Diner", "Hotel breakfast buffet"), dayWith(3, "Bar do Alemão", "Hotel breakfast buffet")]),
      );
      const out = await run(list);
      expect(named(out)).toEqual([
        [1, ["Madalosso", "Hotel breakfast buffet"]],
        [2, ["Zefy Diner", "Hotel breakfast buffet"]],
        [3, ["Bar do Alemão", "Hotel breakfast buffet"]],
      ]);
    });

    it("keeps a place the plan already had on two days, on both", async () => {
      const twice = fortnight.slice(0, 3).map((d) =>
        d.day_number === 2 ? d : { ...d, activities: [...d.activities, { name: "Madalosso Restaurante", start_time: "12:30" }] },
      ) as unknown as ItineraryDay[];
      const list = { ...input, days: twice, locale: "pt", message: "adicione: madalosso restaurante, zefy diner e bar do alemao" };
      generateContent.mockResolvedValueOnce(
        reply([dayWith(1, "Madalosso Restaurante", "Zefy Diner"), dayWith(2, "Bar do Alemão"), dayWith(3, "Madalosso Restaurante", "Café Lisboa")]),
      );
      const out = await run(list);
      expect(named(out)).toEqual([
        [1, ["Madalosso Restaurante", "Zefy Diner"]],
        [2, ["Bar do Alemão"]],
        [3, ["Madalosso Restaurante", "Café Lisboa"]],
      ]);
    });

    it("leaves a place on the later day that had it, when the reply also adds it earlier", async () => {
      const zefyOn3 = [...fortnight.slice(0, 2), { ...fortnight[2], activities: [...fortnight[2].activities, { name: "Zefy Diner", start_time: "19:30" }] }] as unknown as ItineraryDay[];
      const list = { ...input, days: zefyOn3, locale: "pt", message: "adicione: madalosso restaurante, zefy diner e bar do alemao" };
      generateContent.mockResolvedValueOnce(reply([dayWith(1, "Madalosso", "Zefy Diner"), dayWith(3, "Zefy Diner", "Bar do Alemão")]));
      const out = await run(list);
      expect(named(out)).toEqual([
        [1, ["Madalosso"]],
        [3, ["Zefy Diner", "Bar do Alemão"]],
      ]);
    });

    it("drops a day whose only change was a place another day holds", async () => {
      const list = { ...input, days: fortnight.slice(0, 3), locale: "pt", message: "adicione: madalosso restaurante, zefy diner e bar do alemao" };
      generateContent.mockResolvedValueOnce(reply([dayWith(1, "Madalosso", "Zefy Diner", "Bar do Alemão"), dayWith(2, "Madalosso")]));
      const out = await run(list);
      expect(named(out)).toEqual([[1, ["Madalosso", "Zefy Diner", "Bar do Alemão"]]]);
    });

    it("holds a list sent in an earlier message, when they ask for the rest", async () => {
      const list = {
        ...input,
        days: fortnight.slice(0, 3),
        locale: "pt",
        message: "ainda falta adicionar os outros, adicione-os",
        history: [{ role: "user" as const, text: "madalosso restaurante, zefy diner, bar do alemao e lett's road" }],
      };
      generateContent.mockResolvedValueOnce(reply([dayWith(1, "Madalosso", "Bar do Alemão"), dayWith(2, "Lett's Road", "Madalosso Restaurante")]));
      const out = await run(list);
      expect(named(out)).toEqual([
        [1, ["Madalosso", "Bar do Alemão"]],
        [2, ["Lett's Road"]],
      ]);
    });

    // Live, 11-09: told "não remova nada", a part swapped a day's dinner for a
    // restaurant of the list; only the first reply was held to keeping everything.
    it("doesn't take a day that takes something out when they said to keep everything, from a part either", async () => {
      const dinnerOn8 = fortnight.map((d) => (d.day_number === 8 ? { ...d, activities: [...d.activities, { name: "Jantar na Choperia Brahma", start_time: "19:30" }] } : d)) as unknown as ItineraryDay[];
      const list = {
        ...input,
        days: dinnerOn8,
        locale: "pt",
        message: "o senhor restaurante, dhoosushi, park do churrasco e baraquias restaurante",
        history: [{ role: "user" as const, text: "quero adicionar restaurantes, não quero que você remova nada do que já está" }],
      };
      const swapped = { day_number: 8, activities: [{ name: "Sight H", start_time: "09:00" }, { name: "Park do Churrasco", start_time: "19:30" }] };
      generateContent
        .mockResolvedValueOnce(reply([dayWith(1, "O Senhor Restaurante"), dayWith(2, "Dhoosushi")], [7, 8]))
        .mockResolvedValueOnce(reply([dayWith(7, "Baraquias Restaurante"), swapped]));
      const out = await run(list);
      expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("They asked you to keep everything already planned");
      expect(named(out)).toEqual([
        [1, ["O Senhor Restaurante"]],
        [2, ["Dhoosushi"]],
        [7, ["Baraquias Restaurante"]],
      ]);
      expect(out.reply).toContain("(Não entrou nesta alteração: park do churrasco.)");
    });

    it("asks once more for what a list still lacks after its parts, and keeps what it brings", async () => {
      const list = { ...input, days: fortnight, locale: "pt", message: "adicione: o senhor restaurante, dhoosushi, park do churrasco e baraquias restaurante" };
      generateContent
        .mockResolvedValueOnce(reply([dayWith(1, "O Senhor Restaurante"), dayWith(2, "Dhoosushi")], [7, 8]))
        .mockResolvedValueOnce(reply([dayWith(7, "Park do Churrasco")]))
        .mockResolvedValueOnce(reply([dayWith(9, "Baraquias Restaurante")]));
      const out = await run(list);
      expect(generateContent).toHaveBeenCalledTimes(3);
      expect(JSON.stringify(generateContent.mock.calls[2][0])).toContain("these places from their list aren't in the plan yet: baraquias restaurante");
      expect(named(out)).toEqual([
        [1, ["O Senhor Restaurante"]],
        [2, ["Dhoosushi"]],
        [7, ["Park do Churrasco"]],
        [9, ["Baraquias Restaurante"]],
      ]);
      expect(out.reply).not.toContain("Não entrou");
    });

    it("keeps everything planned on that last ask too, or leaves the place named", async () => {
      const dinnerOn9 = fortnight.map((d) => (d.day_number === 9 ? { ...d, activities: [...d.activities, { name: "Jantar na Choperia Brahma", start_time: "19:30" }] } : d)) as unknown as ItineraryDay[];
      const list = {
        ...input,
        days: dinnerOn9,
        locale: "pt",
        message: "o senhor restaurante, dhoosushi, park do churrasco e baraquias restaurante",
        history: [{ role: "user" as const, text: "quero adicionar restaurantes, não remova nada" }],
      };
      generateContent
        .mockResolvedValueOnce(reply([dayWith(1, "O Senhor Restaurante"), dayWith(2, "Dhoosushi"), dayWith(3, "Park do Churrasco")]))
        // The correction for the short list: no better.
        .mockResolvedValueOnce(reply([dayWith(1, "O Senhor Restaurante"), dayWith(2, "Dhoosushi"), dayWith(3, "Park do Churrasco")]))
        // The last ask swaps Day 9's dinner for it.
        .mockResolvedValueOnce(reply([{ day_number: 9, activities: [{ name: "Sight I", start_time: "09:00" }, { name: "Baraquias Restaurante", start_time: "19:30" }] }]));
      const out = await run(list);
      expect(JSON.stringify(generateContent.mock.calls[2][0])).toContain("keeping every activity the day already has. ");
      expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 3]);
      expect(out.reply).toContain("(Não entrou nesta alteração: baraquias restaurante.)");
    });

    it("doesn't take a last ask that brings none of the list and loses a place already in", async () => {
      const list = { ...input, days: fortnight, locale: "pt", message: "adicione: o senhor restaurante, dhoosushi, park do churrasco e baraquias restaurante" };
      const three = reply([dayWith(1, "O Senhor Restaurante"), dayWith(2, "Dhoosushi"), dayWith(3, "Park do Churrasco")]);
      generateContent
        .mockResolvedValueOnce(three)
        .mockResolvedValueOnce(three)
        .mockResolvedValueOnce(reply([dayWith(1, "Café Lisboa")]));
      const out = await run(list);
      expect(generateContent).toHaveBeenCalledTimes(3);
      expect(named(out)).toEqual([
        [1, ["O Senhor Restaurante"]],
        [2, ["Dhoosushi"]],
        [3, ["Park do Churrasco"]],
      ]);
    });

    // Replay, 11-09: "Let's Road" on one day, then "Lett's Road" added again on another.
    it("knows a longer name a letter off as the same place, and keeps short names apart", async () => {
      const list = {
        ...input,
        days: fortnight.slice(0, 4),
        locale: "pt",
        message: "adicione: lett's road, madalosso restaurante, bar basso, bar bassi, casa mineira, casa madeira, pasta bar e pasta barbieri",
      };
      generateContent.mockResolvedValueOnce(
        reply([
          dayWith(1, "Let's Road", "Madalosso"),
          dayWith(2, "Lett's Road", "Bar Basso"),
          dayWith(3, "Bar Bassi", "Casa Mineira", "Pasta Bar"),
          dayWith(4, "Casa Madeira", "Pasta Barbieri"),
        ]),
      );
      const out = await run(list);
      expect(generateContent).toHaveBeenCalledTimes(1);
      expect(named(out)).toEqual([
        [1, ["Let's Road", "Madalosso"]],
        [2, ["Bar Basso"]],
        [3, ["Bar Bassi", "Casa Mineira", "Pasta Bar"]],
        [4, ["Casa Madeira", "Pasta Barbieri"]],
      ]);
      expect(out.reply).not.toContain("Não entrou");
    });

    // A London day sent as a list of stops, Chinatown among them, while Day 4
    // already had Chinatown: Day 1 came back without it, and the reply still
    // named it for Day 1.
    describe("a place of their list the plan already has on another day", () => {
      const at = (name: string, start_time: string) => ({ name, time_slot: "morning", start_time });
      const london = [
        { day_number: 1, date: "2027-12-01", activities: [at("Oxford Street", "10:00")] },
        { day_number: 2, date: "2027-12-02", activities: [at("Natural History Museum", "10:00")] },
        { day_number: 3, date: "2027-12-03", activities: [at("Tower of London", "10:00")] },
        { day_number: 4, date: "2027-12-04", activities: [at("Borough Market", "12:00"), at("Chinatown London", "17:30")] },
      ] as unknown as ItineraryDay[];
      const stops = ["Oxford Street", "Broadwick Street", "Neal's Yard", "Covent Garden", "Cecil Court", "Chinatown", "Trafalgar Square"];
      const told = { ...input, destination: "London, United Kingdom", tripTitle: "London", days: london, message: "Broadwick Street 5 min, Neal's Yard 5 min, Covent Garden, Cecil Court, Chinatown, Trafalgar Square" };
      const answer = (text: string) => ({ response: { text: () => JSON.stringify({ reply: text, edits: [{ day_number: 1, activities: stops.map((name) => ({ name })) }] }) } });

      it("leaves it where it is and says which day has it", async () => {
        generateContent.mockResolvedValueOnce(answer("Here is Day 1 with Broadwick Street, Neal's Yard, Covent Garden, Cecil Court, Chinatown and Trafalgar Square."));
        const out = await run(told);
        expect(out.edits.map((e) => [e.day_number, e.activities.map((a) => a.name)])).toEqual([[1, stops.filter((s) => s !== "Chinatown")]]);
        expect(out.reply).toBe(
          "Here is Day 1 with Broadwick Street, Neal's Yard, Covent Garden, Cecil Court, Chinatown and Trafalgar Square. (Already on Day 4, so not added again: Chinatown London.)",
        );
      });

      it("says it when the reply names none of the stops", async () => {
        generateContent.mockResolvedValueOnce(answer("Here is Day 1 with all your stops."));
        const out = await run(told);
        expect(out.reply).toBe("Here is Day 1 with all your stops. (Already on Day 4, so not added again: Chinatown London.)");
      });

      it("says nothing more when the reply already says where it is", async () => {
        generateContent.mockResolvedValueOnce(answer("Here is Day 1 with your stops. Chinatown is already on Day 4, so I left it there."));
        const out = await run(told);
        expect(out.reply).toContain("Here is Day 1 with your stops. Chinatown is already on Day 4, so I left it there.");
        expect(out.reply).not.toContain("not added again");
      });

      it("says it in the traveller's language", async () => {
        generateContent.mockResolvedValueOnce(answer("Aquí tienes el día 1 con todas tus paradas."));
        const out = await run({ ...told, locale: "es" });
        expect(out.reply).toBe("Aquí tienes el día 1 con todas tus paradas. (Ya está en el día 4, así que no se añade otra vez: Chinatown London.)");
      });

      it("says nothing when the change moves it, taking it off the day that had it", async () => {
        const moved = { day_number: 4, activities: [{ name: "Borough Market" }, { name: "Sky Garden" }] };
        generateContent.mockResolvedValueOnce({
          response: { text: () => JSON.stringify({ reply: "Chinatown moves to Day 1.", edits: [{ day_number: 1, activities: stops.map((name) => ({ name })) }, moved] }) },
        });
        const out = await run(told);
        expect(out.edits.map((e) => [e.day_number, e.activities.map((a) => a.name)])).toEqual([
          [1, stops],
          [4, ["Borough Market", "Sky Garden"]],
        ]);
        expect(out.reply).toBe("Chinatown moves to Day 1.");
      });
      it("says it when the change never put it on the day, and not for a place the day keeps", async () => {
        const museum = { name: "Science Museum", time_slot: "afternoon", start_time: "15:00" };
        const days = london.map((d) =>
          d.day_number === 1 || d.day_number === 2 ? { ...d, activities: [...d.activities, museum] } : d,
        ) as unknown as ItineraryDay[];
        const kept = [...stops.filter((s) => s !== "Chinatown"), "Science Museum"];
        generateContent.mockResolvedValueOnce({
          response: { text: () => JSON.stringify({ reply: "Here is Day 1 with Chinatown and the rest of your stops.", edits: [{ day_number: 1, activities: kept.map((name) => ({ name })) }] }) },
        });
        const out = await run({ ...told, days, message: `${told.message}, Science Museum` });
        expect(out.reply).toBe("Here is Day 1 with Chinatown and the rest of your stops. (Already on Day 4, so not added again: Chinatown London.)");
      });

      it("says nothing of a place the change takes off the day that had it", async () => {
        generateContent.mockResolvedValueOnce({
          response: {
            text: () =>
              JSON.stringify({
                reply: "Here is Day 1 with all your stops.",
                edits: [
                  { day_number: 1, activities: stops.filter((s) => s !== "Chinatown").map((name) => ({ name })) },
                  { day_number: 4, activities: [{ name: "Borough Market" }, { name: "Sky Garden" }] },
                ],
              }),
          },
        });
        const out = await run(told);
        expect(out.edits.map((e) => e.day_number)).toEqual([1, 4]);
        expect(out.reply).not.toContain("not added again");
      });

      it("leaves alone a list of places to take out", async () => {
        const days = london.map((d) =>
          d.day_number === 1 ? { ...d, activities: [...d.activities, at("Broadwick Street", "12:00"), at("Neal's Yard", "13:00")] } : d,
        ) as unknown as ItineraryDay[];
        generateContent.mockResolvedValueOnce({
          response: { text: () => JSON.stringify({ reply: "Done: they're out.", edits: [{ day_number: 1, activities: [{ name: "Oxford Street" }, { name: "Liberty London" }] }] }) },
        });
        const out = await run({ ...told, days, message: "remove Broadwick Street, Neal's Yard and Chinatown" });
        expect(out.edits.map((e) => [e.day_number, e.activities.map((a) => a.name)])).toEqual([[1, ["Oxford Street", "Liberty London"]]]);
        expect(out.reply).not.toContain("not added again");
      });
    });

    it("doesn't ask for the rest of a list when time is short", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(40_000);
      const list = { ...input, days: fortnight, locale: "pt", message: "adicione: o senhor restaurante, dhoosushi, park do churrasco e baraquias restaurante" };
      generateContent.mockResolvedValueOnce(reply([dayWith(1, "O Senhor Restaurante"), dayWith(2, "Dhoosushi"), dayWith(3, "Park do Churrasco")]));
      const out = await run(list);
      now.mockRestore();
      expect(generateContent).toHaveBeenCalledTimes(1);
      expect(out.reply).toContain("(Não entrou nesta alteração: baraquias restaurante.)");
    });

    it("takes out what they ask to now, even after saying to keep everything", async () => {
      const list = {
        ...input,
        days: fortnight.slice(0, 3),
        locale: "pt",
        message: "tire o Sight A e coloque o Madalosso no lugar",
        history: [{ role: "user" as const, text: "não remova nada do que já está" }],
      };
      generateContent.mockResolvedValueOnce(reply([{ day_number: 1, activities: [{ name: "Madalosso", start_time: "09:00" }] }]));
      const out = await run(list);
      expect(out.edits.map((e) => [e.day_number, e.activities.map((a) => a.name)])).toEqual([[1, ["Madalosso"]]]);
    });

    it("takes a part's day that replaces something when they didn't say to keep everything", async () => {
      const dinnerOn8 = fortnight.map((d) => (d.day_number === 8 ? { ...d, activities: [...d.activities, { name: "Jantar na Choperia Brahma", start_time: "19:30" }] } : d)) as unknown as ItineraryDay[];
      const list = { ...input, days: dinnerOn8, locale: "pt", message: "adicione: o senhor restaurante, dhoosushi, park do churrasco e baraquias restaurante" };
      const swapped = { day_number: 8, activities: [{ name: "Sight H", start_time: "09:00" }, { name: "Park do Churrasco", start_time: "19:30" }] };
      generateContent
        .mockResolvedValueOnce(reply([dayWith(1, "O Senhor Restaurante"), dayWith(2, "Dhoosushi")], [7, 8]))
        .mockResolvedValueOnce(reply([dayWith(7, "Baraquias Restaurante"), swapped]));
      const out = await run(list);
      expect(JSON.stringify(generateContent.mock.calls[1][0])).not.toContain("They asked you to keep everything already planned");
      expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 7, 8]);
    });

    it("puts what they add to every day on every day, parts included", async () => {
      const daily = { ...input, days: fortnight, locale: "en", message: "add breakfast at the hotel every day" };
      const breakfast = (n: number) => ({ day_number: n, activities: [{ name: "Breakfast at the hotel", start_time: "08:00" }, { name: `Sight ${String.fromCharCode(64 + n)}`, start_time: "09:00" }] });
      generateContent
        .mockResolvedValueOnce(reply([1, 2, 3, 4, 5, 6].map(breakfast), [7, 8, 9, 10, 11, 12, 13, 14]))
        .mockResolvedValueOnce(reply([7, 8, 9, 10, 11, 12].map(breakfast)))
        .mockResolvedValueOnce(reply([13, 14].map(breakfast)));
      const out = await run(daily);
      expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    });

    it("keeps a free day added at the end", async () => {
      generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify({ reply: "Day 10 is free.", trip_length: 10, edits: [{ day_number: 10, activities: [] }] }) } });
      const out = await run({ ...long, message: "add one more free day at the end" });
      expect(out.tripLength).toBe(10);
      expect(out.edits.map((e) => [e.day_number, e.activities.length])).toEqual([[10, 0]]);
    });
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

// "Acrescentar dia 15 em dublin" on a 14-day trip: the reply handed over a new
// Day 15, "pronto para salvar", four times, and each came with no change.
describe("assistTrip on a trip at its longest", () => {
  const days = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ...day(i + 1), activities: [{ name: `Day ${i + 1} thing`, time_slot: "morning", start_time: "09:00" }] })) as unknown as ItineraryDay[];
  const ask = { ...input, message: "Acrescentar dia 15 em dublin", days: days(14), locale: "pt" };
  const day15 = {
    response: {
      text: () =>
        JSON.stringify({
          reply: "Aqui está o novo Dia 15 em Dublin, pronto para salvar.",
          trip_length: 15,
          // Its departure moved to the new last day, and another day still to come.
          more_days: [3],
          edits: [
            { day_number: 14, summary: "Dublin", activities: [{ name: "Guinness Storehouse", start_time: "10:00" }] },
            { day_number: 15, summary: "Dublin", activities: [{ name: "Trinity College", start_time: "10:00" }] },
          ],
        }),
    },
  };

  it("says trips can be at most 14 days when the model keeps adding one, and keeps nothing of that reply", async () => {
    generateContent.mockResolvedValue(day15);
    const out = await run(ask);
    // The first reply and the correction: no part is asked for the days it named.
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain('CORRECTION: Trips can be at most 14 days, and this one has 14: keep \\"trip_length\\" null and add no day.');
    expect(out.edits).toEqual([]);
    expect(out.tripLength).toBeUndefined();
    expect(out.reply).toMatch(/^As viagens podem ter no máximo 14 dias, e esta já tem 14, por isso não acrescentei nenhum dia\./);
  });

  it("keeps the model's own answer once it keeps to the 14 days", async () => {
    const honest = { response: { text: () => JSON.stringify({ reply: "As viagens podem ter no máximo 14 dias. Posso trocar o dia 9, o mais leve, por um dia em Dublin.", trip_length: null, edits: [] }) } };
    generateContent.mockResolvedValueOnce(day15).mockResolvedValueOnce(honest);
    const out = await run(ask);
    expect(out.edits).toEqual([]);
    expect(out.reply).toBe("As viagens podem ter no máximo 14 dias. Posso trocar o dia 9, o mais leve, por um dia em Dublin.");
  });

  it("tells a shorter trip how many days it can still take", async () => {
    const more = { response: { text: () => JSON.stringify({ reply: "Here are 5 new days.", trip_length: 17, edits: [] }) } };
    generateContent.mockResolvedValue(more);
    const out = await run({ ...ask, message: "add 5 more days", days: days(12), locale: "en" });
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain('Trips can be at most 14 days, and this one has 12: \\"trip_length\\" can be 14 at most.');
    expect(out.reply).toMatch(/^Trips can be at most 14 days, so this one can take 2 more: ask me for up to 2\./);
  });
});

// "I am arriving at 6pm on the 28th" on a trip from the 29th: the reply made Day 1
// the arrival evening, over the 29th's plan, for a 9-day trip whose last day never
// came, and said both "9 days in total" and "the trip stays at 8 days".
describe("assistTrip on an arrival before Day 1", () => {
  const days = Array.from({ length: 8 }, (_, i) => ({
    ...day(i + 1),
    activities: [{ name: `Day ${i + 1} thing`, time_slot: "morning", start_time: "09:00" }],
  })) as unknown as ItineraryDay[];
  const arriving = { ...input, message: "I am arriving at 6pm on the 28th", days, locale: "en" };
  const newDayOne = {
    response: {
      text: () =>
        JSON.stringify({
          reply: "Here is an updated Day 1 to accommodate your arrival, adding a day to your trip.",
          trip_length: 9,
          // The days the move would push along, to be asked for next.
          more_days: [2, 3, 4, 5, 6, 7, 8],
          edits: [{ day_number: 1, summary: "Arrival", activities: [{ name: "Noi Bai International Airport", start_time: "18:00" }, { name: "Dinner", start_time: "21:00" }] }],
        }),
    },
  };

  it("keeps Day 1 as it was when the model holds to a new first day", async () => {
    generateContent.mockResolvedValue(newDayOne);
    const out = await run(arriving);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("If they arrive before Day 1's date, change no day for it");
    expect(out.edits).toEqual([]);
    expect(out.tripLength).toBeUndefined();
    expect(out.reply).toMatch(/^I haven't changed your plan/);
  });

  it("keeps a change to a day they asked for when the longer trip they also asked for didn't come back", async () => {
    const both = {
      response: {
        text: () =>
          JSON.stringify({
            reply: "Here's a market on Day 3, and a new Day 9.",
            trip_length: 9,
            edits: [{ day_number: 3, summary: "Market", activities: [{ name: "Dong Xuan Market", start_time: "09:00" }] }],
          }),
      },
    };
    generateContent.mockResolvedValue(both);
    const out = await run({ ...arriving, message: "add one more day, and a market on day 3" });
    expect(out.edits.map((e) => e.day_number)).toEqual([3]);
    expect(out.reply).toContain("(The trip stays at 8 days");
  });

  it("keeps the model's answer once it leaves Day 1 alone", async () => {
    const honest = { response: { text: () => JSON.stringify({ reply: "You land the evening before Day 1, so Day 1 stays a full day. To add the 28th, move the trip's dates.", edits: [] }) } };
    generateContent.mockResolvedValueOnce(newDayOne).mockResolvedValueOnce(honest);
    const out = await run(arriving);
    expect(out.edits).toEqual([]);
    expect(out.reply).toBe("You land the evening before Day 1, so Day 1 stays a full day. To add the 28th, move the trip's dates.");
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

// 28 Nov to 6 Dec is 9 days and 8 nights. "Isn't it 8 days?" got "You're totally
// right!", and "count, it's 8", twice, cut the trip to 8 days.
describe("assistTrip on how long the trip is", () => {
  const days = Array.from({ length: 9 }, (_, i) => ({
    day_number: i + 1,
    date: i < 3 ? `2026-11-${28 + i}` : `2026-12-0${i - 2}`,
    activities: [{ name: `Algarve ${i + 1}`, time_slot: "morning", start_time: "10:00" }],
  })) as unknown as ItineraryDay[];
  const algarve = { ...input, destination: "Algarve, Portugal", days, startDate: "2026-11-28", endDate: "2026-12-06", autoApply: true };
  const said = (reply: string, trip_length: number | null = null, edits: unknown[] = []) => ({ response: { text: () => JSON.stringify({ reply, trip_length, edits }) } });
  const lastDayOn8 = { day_number: 8, activities: [{ name: "Algarve 8", start_time: "10:00" }, { name: "Algarve 9", start_time: "15:00" }] };
  const cutTo8 = said("I've adjusted your itinerary to 8 days, running from November 28 to December 5.", 8, [lastDayOn8]);
  const counted = said("28 November to 6 December is 9 days and 8 nights: Day 1 is the 28th and Day 9 the 6th.");

  it("asks again when a day is cut that nobody asked to cut, and keeps the better answer", async () => {
    generateContent.mockResolvedValueOnce(cutTo8).mockResolvedValueOnce(counted);
    const out = await run({ ...algarve, message: "No in this chat here, count, it's 8" });
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("CORRECTION: The trip is Sat, 28 Nov 2026 to Sun, 6 Dec 2026: 9 days and 8 nights");
    expect(out.tripLength).toBeUndefined();
    expect(out.reply).toBe("28 November to 6 December is 9 days and 8 nights: Day 1 is the 28th and Day 9 the 6th.");
  });

  it("keeps every day, and gives the count, when both answers cut one", async () => {
    generateContent.mockResolvedValue(cutTo8);
    const out = await run({ ...algarve, message: "No in this chat here, count, it's 8" });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(out.tripLength).toBeUndefined();
    expect(out.edits).toEqual([]);
    expect(out.reply).toBe("November 28 to December 6 is 9 days and 8 nights, so the trip keeps all 9 days. To make it shorter, tell me which day to take out.");
  });

  it("asks again when the reply agrees to a wrong count", async () => {
    generateContent.mockResolvedValueOnce(said("You're totally right! From November 28 to December 6 is indeed 8 days total.")).mockResolvedValueOnce(counted);
    const out = await run({ ...algarve, message: "Also kind if confused isn't 28 nov to 6 dec 8 days instead of 9 days?" });
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain('Your \\"reply\\" gives it another number of days.');
    expect(out.reply).toBe("28 November to 6 December is 9 days and 8 nights: Day 1 is the 28th and Day 9 the 6th.");
  });

  it("cuts the day they ask to cut", async () => {
    generateContent.mockResolvedValueOnce(said("Your trip now ends on December 5.", 8));
    const out = await run({ ...algarve, message: "please make it 8 days, remove the last day" });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out.tripLength).toBe(8);
  });
});

// "Add a tile museum before my flight" on the flight's day changed nothing: the
// whole day was refused for its fixed plan.
describe("assistTrip on a day with a fixed plan", () => {
  const flight = { id: "anchor-f1", anchor_id: "f1", name: "Flight to Lisbon", time_slot: "afternoon", start_time: "15:00", duration_minutes: 120, locked: true };
  const days = [
    { day_number: 1, date: "2027-05-01", activities: [{ name: "Ribeira walk", time_slot: "morning", start_time: "10:00" }] },
    { day_number: 2, date: "2027-05-02", activities: [{ name: "Bolhão market", time_slot: "morning", start_time: "09:00" }, flight] },
  ] as unknown as ItineraryDay[];
  const ask = { ...input, message: "add a tile museum before my flight on day 2", days };
  const dayTwo = (reply: string, activities: Array<[string, string]>) => ({
    response: { text: () => JSON.stringify({ reply, edits: [{ day_number: 2, activities: activities.map(([name, start_time]) => ({ name, start_time })) }] }) },
  });
  const named = (out: { edits: Array<{ activities: Array<{ name: string; start_time?: string }> }> }) =>
    out.edits.map((e) => e.activities.map((a) => `${a.name} ${a.start_time}`));

  it("changes the day around it, the fixed plan as stored", async () => {
    generateContent.mockResolvedValueOnce(dayTwo("Here's Day 2 with the tile museum.", [["Bolhão market", "09:00"], ["Tile museum", "11:00"], ["Flight to Lisbon", "15:00"]]));
    const out = await run(ask);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(named(out)).toEqual([["Bolhão market 09:00", "Tile museum 11:00", "Flight to Lisbon 15:00"]]);
    expect(out.edits[0].activities[2]).toMatchObject({ id: "anchor-f1", anchor_id: "f1", locked: true, duration_minutes: 120 });
    expect(out.reply).toBe("Here's Day 2 with the tile museum.");
  });

  it("asks once more when the reply takes it out, and keeps the better day", async () => {
    generateContent
      .mockResolvedValueOnce(dayTwo("Here's Day 2 with the tile museum.", [["Tile museum", "11:00"], ["Lunch in Ribeira", "15:30"]]))
      .mockResolvedValueOnce(dayTwo("Here's Day 2 with the tile museum.", [["Bolhão market", "09:00"], ["Tile museum", "11:00"], ["Flight to Lisbon", "15:00"]]));
    const out = await run(ask);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("CORRECTION: Day 2 has a fixed plan the traveller set: Flight to Lisbon at 15:00.");
    expect(named(out)).toEqual([["Bolhão market 09:00", "Tile museum 11:00", "Flight to Lisbon 15:00"]]);
    expect(out.reply).toBe("Here's Day 2 with the tile museum.");
  });

  it("keeps it in the change, and says so, when both replies take it out", async () => {
    const without = dayTwo("Here's Day 2 with the tile museum.", [["Tile museum", "11:00"], ["Lunch in Ribeira", "15:30"]]);
    generateContent.mockResolvedValue(without);
    const out = await run(ask);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(named(out)).toEqual([["Tile museum 11:00", "Flight to Lisbon 15:00", "Lunch in Ribeira 15:30"]]);
    expect(out.reply).toBe("Here's Day 2 with the tile museum. (The fixed plan on Day 2 stays as you set it: Flight to Lisbon.)");
  });

  it("changes nothing, and says why, when only the fixed plan was to move", async () => {
    generateContent.mockResolvedValue(dayTwo("I've moved your flight to 18:00.", [["Bolhão market", "09:00"], ["Flight to Lisbon", "18:00"]]));
    const out = await run({ ...ask, message: "move my flight to 18:00" });
    expect(out.edits).toEqual([]);
    expect(out.reply).toMatch(/^Day 2 has a fixed plan you set \(Flight to Lisbon\), so I left it as it is/);
  });

  it("asks for the days after a fixed plan's day too", async () => {
    const three = [...days, { day_number: 3, date: "2027-05-03", activities: [{ name: "Douro cruise", time_slot: "morning", start_time: "09:00" }, { ...flight, id: "anchor-f2", anchor_id: "f2", name: "Train to Coimbra", start_time: "18:00" }] }] as unknown as ItineraryDay[];
    generateContent
      .mockResolvedValueOnce({
        response: { text: () => JSON.stringify({ reply: "Vegetarian lunches everywhere.", more_days: [2, 3], edits: [{ day_number: 1, activities: [{ name: "Ribeira walk", start_time: "10:00" }, { name: "Veggie lunch", start_time: "13:00" }] }] }) },
      })
      .mockResolvedValueOnce({
        response: {
          text: () =>
            JSON.stringify({
              reply: "Done.",
              edits: [
                { day_number: 2, activities: [{ name: "Bolhão market", start_time: "09:00" }, { name: "Veggie lunch 2", start_time: "13:00" }, { name: "Flight to Lisbon", start_time: "15:00" }] },
                { day_number: 3, activities: [{ name: "Douro cruise", start_time: "09:00" }, { name: "Veggie lunch 3", start_time: "13:00" }, { name: "Train to Coimbra", start_time: "18:00" }] },
              ],
            }),
        },
      });
    const out = await run({ ...ask, message: "vegetarian lunch every day", days: three });
    expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 3]);
    expect(named(out)[2]).toEqual(["Douro cruise 09:00", "Veggie lunch 3 13:00", "Train to Coimbra 18:00"]);
  });
});

// "Cluster the itinerary by areas" on Busan and Seoul: Busan's sights stayed on Seoul's days.
describe("assistTrip on a trip through two cities", () => {
  const at = (name: string, lat: number, lng: number) => ({ name, time_slot: "morning", start_time: "10:00", coordinates: { lat, lng } });
  const days = [
    { day_number: 1, city: "Busan", date: "2026-11-10", activities: [at("Haeundae Beach", 35.1587, 129.1604), at("Jagalchi Market", 35.0966, 129.0306)] },
    { day_number: 2, city: "Seoul", date: "2026-11-11", activities: [at("Gyeongbokgung Palace", 37.5796, 126.977), at("N Seoul Tower", 37.5512, 126.9882)] },
  ] as unknown as ItineraryDay[];
  const ask = { ...input, destination: "Busan & Seoul", days, message: "cluster the itinerary by areas" };
  const reply = (edits: Array<[number, Array<[string, number, number]>]>) => ({
    response: { text: () => JSON.stringify({ reply: "Grouped by area.", edits: edits.map(([n, list]) => ({ day_number: n, activities: list.map(([name, lat, lng]) => ({ name, start_time: "11:00", coordinates: { lat, lng } })) })) }) },
  });
  const mixed = reply([[2, [["N Seoul Tower", 37.5512, 126.9882], ["Gyeongbokgung Palace", 37.5796, 126.977], ["Gamcheon Culture Village", 35.0975, 129.0106]]]]);
  const clean = reply([[1, [["Jagalchi Market", 35.0966, 129.0306], ["Gamcheon Culture Village", 35.0975, 129.0106], ["Haeundae Beach", 35.1587, 129.1604]]], [2, [["N Seoul Tower", 37.5512, 126.9882], ["Gyeongbokgung Palace", 37.5796, 126.977]]]]);
  const named = (out: { edits: Array<{ day_number: number; activities: Array<{ name: string }> }> }) => out.edits.map((e) => `${e.day_number}: ${e.activities.map((a) => a.name).join(", ")}`);

  it("asks again when a change puts another city's places on a day, and keeps the better one", async () => {
    generateContent.mockResolvedValueOnce(mixed).mockResolvedValueOnce(clean);
    const out = await run(ask);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("CORRECTION: Day 2 is in Seoul, but your edits put places in Busan on it: Gamcheon Culture Village.");
    expect(named(out)).toEqual(["1: Jagalchi Market, Gamcheon Culture Village, Haeundae Beach", "2: N Seoul Tower, Gyeongbokgung Palace"]);
    expect(out.reply).toBe("Grouped by area.");
  });

  it("takes them off the day, and says so, when both replies put them there", async () => {
    generateContent.mockResolvedValue(mixed);
    const out = await run(ask);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(named(out)).toEqual(["2: N Seoul Tower, Gyeongbokgung Palace"]);
    expect(out.reply).toBe("Grouped by area. (Busan places stay off Seoul days: Gamcheon Culture Village.)");
  });

  // Fixing Seoul's last day, a regroup borrowed the day before's places and was
  // turned down for it: the day before now comes in a part, with places of its own.
  it("takes a day a regroup borrowed from in the next part, rather than asking again", async () => {
    const rome = [
      { day_number: 1, date: "2027-05-01", activities: [{ name: "Colosseum", start_time: "09:00" }, { name: "Pantheon", start_time: "13:00" }] },
      { day_number: 2, date: "2027-05-02", activities: [{ name: "Vatican Museums", start_time: "09:00" }, { name: "Castel Sant'Angelo", start_time: "13:00" }] },
      { day_number: 3, date: "2027-05-03", activities: [{ name: "Trevi Fountain", start_time: "09:00" }, { name: "Villa Borghese", start_time: "13:00" }] },
    ] as unknown as ItineraryDay[];
    const first = { response: { text: () => JSON.stringify({ reply: "Grouped.", edits: [{ day_number: 1, activities: [{ name: "Colosseum", start_time: "09:00" }, { name: "Pantheon", start_time: "11:00" }, { name: "Trevi Fountain", start_time: "15:00" }] }] }) } };
    const part = { response: { text: () => JSON.stringify({ reply: "Done.", edits: [{ day_number: 3, activities: [{ name: "Spanish Steps", start_time: "10:00" }, { name: "Villa Borghese", start_time: "13:00" }] }] }) } };
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(part);
    const out = await run({ ...input, destination: "Rome", days: rome, message: "regroup the days by area" });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("Now return Days 3");
    expect(out.edits.map((e) => `${e.day_number}: ${e.activities.map((a) => a.name).join(", ")}`)).toEqual(["1: Colosseum, Pantheon, Trevi Fountain", "3: Spanish Steps, Villa Borghese"]);
    // Asked for something else, it is asked again to move it.
    generateContent.mockReset();
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(first);
    await run({ ...input, destination: "Rome", days: rome, message: "add the trevi fountain to day 1" });
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("CORRECTION: Trevi Fountain is already on Day 3.");
  });

  it("tells a regroup's later part which of its days hold another city's places", async () => {
    const three = [...days, { day_number: 3, city: "Seoul", date: "2026-11-12", activities: [at("Songdo Cable Car", 35.0758, 129.0166), at("Bukchon Hanok Village", 37.5826, 126.9831)] }] as unknown as ItineraryDay[];
    const first = { response: { text: () => JSON.stringify({ reply: "Grouped.", more_days: [2, 3], edits: [{ day_number: 1, activities: [{ name: "Jagalchi Market", start_time: "10:00" }, { name: "Songdo Cable Car", start_time: "13:00" }, { name: "Haeundae Beach", start_time: "16:00" }] }] }) } };
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(reply([[3, [["Bukchon Hanok Village", 37.5826, 126.9831], ["Insadong", 37.574, 126.985]]]]));
    const out = await run({ ...ask, days: three });
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("Day 3 is in Seoul, but it holds places in Busan (Songdo Cable Car): give it places in Seoul instead.");
    // Asked to regroup, they expect places to move: no note for it.
    expect(out.reply).toBe("Grouped.");
  });

  // A copy on a day of the other city is still to move: it isn't the one kept.
  it("keeps a place a part puts on its city's day while a day of the other city still has it", async () => {
    const three = [...days, { day_number: 3, city: "Seoul", date: "2026-11-12", activities: [at("Bukchon Hanok Village", 37.5826, 126.9831), at("Gamcheon Culture Village", 35.0975, 129.0106)] }] as unknown as ItineraryDay[];
    const seoul = [["N Seoul Tower", 37.5512, 126.9882], ["Gyeongbokgung Palace", 37.5796, 126.977], ["Insadong", 37.574, 126.985]].map(([name, lat, lng]) => ({ name, start_time: "11:00", coordinates: { lat, lng } }));
    const first = { response: { text: () => JSON.stringify({ reply: "Grouped.", more_days: [1], edits: [{ day_number: 2, activities: seoul }] }) } };
    const part = reply([[1, [["Haeundae Beach", 35.1587, 129.1604], ["Jagalchi Market", 35.0966, 129.0306], ["Gamcheon Culture Village", 35.0975, 129.0106]]]]);
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(first).mockResolvedValueOnce(part);
    const out = await run({ ...ask, days: three });
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(generateContent.mock.calls[2][0])).toContain("Other days already have these, so use none of them: N Seoul Tower, Gyeongbokgung Palace, Insadong, Bukchon Hanok Village.");
    expect(named(out)[0]).toBe("1: Haeundae Beach, Jagalchi Market, Gamcheon Culture Village");
  });

  // The last ask for a list's places also put BIFF Square on a Seoul day: it came
  // off, and the answer was kept for the list. The reply says so.
  it("names the places it took off another city's day in an answer it keeps", async () => {
    const busan: Array<[string, number, number]> = [["Haeundae Beach", 35.1587, 129.1604], ["Jagalchi Market", 35.0966, 129.0306], ["Gamcheon Culture Village", 35.0975, 129.0106], ["Songdo Cable Car", 35.0758, 129.0166]];
    const first = reply([[1, busan]]);
    const fill = reply([
      [1, [...busan, ["Taejongdae", 35.0517, 129.0848]]],
      [2, [["Gyeongbokgung Palace", 37.5796, 126.977], ["N Seoul Tower", 37.5512, 126.9882], ["Bukchon Hanok Village", 37.5826, 126.9831], ["BIFF Square", 35.0985, 129.0273]]],
    ]);
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(first).mockResolvedValueOnce(fill);
    const out = await run({ ...ask, message: "add Gamcheon Culture Village, Songdo Cable Car, Taejongdae and Bukchon Hanok Village" });
    expect(JSON.stringify(generateContent.mock.calls[2][0])).toContain("these places from their list aren't in the plan yet: Taejongdae, Bukchon Hanok Village.");
    expect(named(out)[1]).toBe("2: Gyeongbokgung Palace, N Seoul Tower, Bukchon Hanok Village");
    expect(out.reply).toContain("(Busan places stay off Seoul days: BIFF Square.)");
  });

  // Put back on a Seoul day, Jagalchi Market came off it again: that answer isn't
  // kept, and the reply doesn't speak of it.
  it("leaves the reply as it was when it turns down the answer for a place left off every day", async () => {
    generateContent
      .mockResolvedValueOnce(reply([[1, [["Haeundae Beach", 35.1587, 129.1604], ["Gamcheon Culture Village", 35.0975, 129.0106]]]]))
      .mockResolvedValueOnce(reply([[2, [["Gyeongbokgung Palace", 37.5796, 126.977], ["N Seoul Tower", 37.5512, 126.9882], ["Jagalchi Market", 35.0966, 129.0306]]]]));
    const out = await run(ask);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("left these places of the plan off every day: Jagalchi Market.");
    expect(named(out)).toEqual(["1: Haeundae Beach, Gamcheon Culture Village"]);
    expect(out.reply).toBe("Grouped by area.");
  });

  // The Seoul day still has the Busan sight a change put on a Busan day: that copy isn't a repeat.
  it("keeps another city's place a change put on a day of its own city, though the wrong day still has it", async () => {
    const mixed = [days[0], { ...days[1], activities: [...days[1].activities, at("Gamcheon Culture Village", 35.0975, 129.0106)] }] as unknown as ItineraryDay[];
    generateContent.mockResolvedValue(reply([[1, [["Haeundae Beach", 35.1587, 129.1604], ["Jagalchi Market", 35.0966, 129.0306], ["Gamcheon Culture Village", 35.0975, 129.0106]]]]));
    const out = await run({ ...ask, days: mixed, message: "make day 1 a full day" });
    expect(named(out)[0]).toBe("1: Haeundae Beach, Jagalchi Market, Gamcheon Culture Village");
  });

  // Gamcheon was on a Busan day already: taking its copy off the Seoul day moves nothing.
  it("doesn't call a copy taken off a day of the wrong city moved", async () => {
    const gamcheon = at("Gamcheon Culture Village", 35.0975, 129.0106);
    const twice = [{ ...days[0], activities: [...days[0].activities, gamcheon] }, { ...days[1], activities: [...days[1].activities, gamcheon] }] as unknown as ItineraryDay[];
    generateContent.mockResolvedValueOnce(reply([[2, [["Gyeongbokgung Palace", 37.5796, 126.977], ["N Seoul Tower", 37.5512, 126.9882], ["Bukchon Hanok Village", 37.5826, 126.9831]]]]));
    const out = await run({ ...ask, days: twice, message: "why are there busan sights in seoul?" });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out.reply).toBe("Grouped by area.");
  });

  // "Why are there Busan sights in Seoul?": the reply gave Day 2 Seoul places,
  // and Gamcheon Culture Village was on no day. It goes to a Busan day.
  it("moves another city's place a change took off a day to a day of its own city, and says so", async () => {
    const mixed = [days[0], { ...days[1], activities: [...days[1].activities, at("Gamcheon Culture Village", 35.0975, 129.0106)] }] as unknown as ItineraryDay[];
    const first = reply([[2, [["Gyeongbokgung Palace", 37.5796, 126.977], ["Bukchon Hanok Village", 37.5826, 126.9831]]]]);
    // It also redid Day 2, which isn't what it was asked for.
    const back = reply([
      [1, [["Haeundae Beach", 35.1587, 129.1604], ["Jagalchi Market", 35.0966, 129.0306], ["Gamcheon Culture Village", 35.0975, 129.0106]]],
      [2, [["Gyeongbokgung Palace", 37.5796, 126.977], ["Myeongdong", 37.5636, 126.9827]]],
    ]);
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(back);
    const out = await run({ ...ask, days: mixed, message: "why are there busan sights in seoul?" });
    // Only the other city's place is asked about, with its city's days: N Seoul Tower made room for Bukchon.
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain(
      "CONTINUE: this change left these places of the plan off every day: Gamcheon Culture Village. Gamcheon Culture Village is in Busan: put it on Busan's days (Days 1), never on a day of another city.",
    );
    expect(named(out)).toEqual(["1: Haeundae Beach, Jagalchi Market, Gamcheon Culture Village", "2: Gyeongbokgung Palace, Bukchon Hanok Village"]);
    expect(out.reply).toBe("Grouped by area. (Moved to Busan days: Gamcheon Culture Village.)");
    // Asked to swap them for Seoul sights, they still go to a Busan day, and what else went is named.
    generateContent.mockReset();
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(back);
    const swapped = await run({ ...ask, days: mixed, message: "yes, replace them with seoul sights", explainRemovals: true });
    expect(named(swapped)[0]).toBe("1: Haeundae Beach, Jagalchi Market, Gamcheon Culture Village");
    expect(swapped.reply).toBe("Grouped by area. (This change takes out: N Seoul Tower.) (Moved to Busan days: Gamcheon Culture Village.)");
    // Asked to take them out, they stay out.
    generateContent.mockReset();
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(back);
    const removed = await run({ ...ask, days: mixed, message: "remove the busan sights from the seoul days" });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(removed.reply).toBe("Grouped by area.");
  });

  it("keeps each day in its city when the reply moves it to another", async () => {
    generateContent.mockResolvedValueOnce({
      response: { text: () => JSON.stringify({ reply: "Done.", edits: [{ day_number: 2, city: "Busan", activities: [{ name: "N Seoul Tower", start_time: "10:00" }, { name: "Gyeongbokgung Palace", start_time: "13:00" }] }] }) },
    });
    const out = await run({ ...ask, message: "make day 2 start later" });
    expect(out.edits[0].city).toBeUndefined();
  });
});

// "Cluster by areas" on a long trip: a part repeated a place the first reply had
// placed, and places came back on no day at all.
describe("assistTrip regrouping a trip", () => {
  const at = (name: string, start_time: string) => ({ name, start_time });
  const plan = [
    { day_number: 1, date: "2027-05-01", activities: [at("Breakfast at the hotel", "08:00"), at("Colosseum", "09:00"), at("Pantheon", "13:00")] },
    { day_number: 2, date: "2027-05-02", activities: [at("Breakfast at the hotel", "08:00"), at("Vatican Museums", "09:00"), at("Castel Sant'Angelo", "13:00")] },
    { day_number: 3, date: "2027-05-03", activities: [at("Breakfast at the hotel", "08:00"), at("Trevi Fountain", "09:00"), at("Villa Borghese", "13:00")] },
  ] as unknown as ItineraryDay[];
  const regroup = { ...input, destination: "Rome", days: plan, message: "regroup the days by area" };
  const reply = (edits: Array<[number, Array<[string, string]>]>, more_days: number[] = []) => ({
    response: { text: () => JSON.stringify({ reply: "Grouped by area.", more_days, edits: edits.map(([n, list]) => ({ day_number: n, activities: list.map(([name, start_time]) => ({ name, start_time })) })) }) },
  });
  const named = (out: { edits: Array<{ day_number: number; activities: Array<{ name: string }> }> }) => out.edits.map((e) => `${e.day_number}: ${e.activities.map((a) => a.name).join(", ")}`);

  it("tells its parts the places other days keep, and takes a part's repeats off its day", async () => {
    const first = reply([[1, [["Breakfast at the hotel", "08:00"], ["Colosseum", "09:00"], ["Roman Forum", "11:00"], ["Pantheon", "15:00"]]]], [2, 3]);
    const part = reply([
      [2, [["Breakfast at the hotel", "08:00"], ["Vatican Museums", "09:00"], ["Castel Sant'Angelo", "13:00"], ["Roman Forum", "16:00"], ["Spanish Steps", "18:00"]]],
      [3, [["Breakfast at the hotel", "08:00"], ["Trevi Fountain", "09:00"], ["Spanish Steps", "11:00"], ["Villa Borghese", "13:00"]]],
    ]);
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(part);
    const out = await run(regroup);
    expect(generateContent).toHaveBeenCalledTimes(2);
    // The hotel breakfast is on every day on purpose.
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("Other days already have these, so use none of them: Colosseum, Roman Forum, Pantheon.");
    // Day 2 is back as it was: the Roman Forum is on Day 1, the Spanish Steps on Day 3.
    expect(named(out)).toEqual(["1: Breakfast at the hotel, Colosseum, Roman Forum, Pantheon", "3: Breakfast at the hotel, Trevi Fountain, Spanish Steps, Villa Borghese"]);
  });

  it("leaves a part's day whole when taking its repeats off would leave one place", async () => {
    const first = reply([[1, [["Colosseum", "09:00"], ["Trevi Fountain", "11:00"], ["Villa Borghese", "14:00"], ["Pantheon", "17:00"]]]], [3]);
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(reply([[3, [["Trevi Fountain", "09:00"], ["Villa Borghese", "11:00"], ["Spanish Steps", "15:00"]]]]));
    const out = await run(regroup);
    expect(named(out)).toEqual(["1: Colosseum, Trevi Fountain, Villa Borghese, Pantheon", "3: Trevi Fountain, Villa Borghese, Spanish Steps"]);
  });

  it("asks once more for the places it left off every day, and keeps the answer only when it brings them back", async () => {
    const first = reply([
      [1, [["Breakfast at the hotel", "08:00"], ["Colosseum", "09:00"], ["Roman Forum", "11:00"]]],
      [3, [["Breakfast at the hotel", "08:00"], ["Trevi Fountain", "09:00"], ["Spanish Steps", "11:00"], ["Villa Borghese", "13:00"]]],
    ]);
    const back = reply([[1, [["Breakfast at the hotel", "08:00"], ["Colosseum", "09:00"], ["Roman Forum", "11:00"], ["Pantheon", "15:00"]]]]);
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(back);
    const out = await run(regroup);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("CONTINUE: this change left these places of the plan off every day: Pantheon.");
    expect(named(out)).toEqual(["1: Breakfast at the hotel, Colosseum, Roman Forum, Pantheon", "3: Breakfast at the hotel, Trevi Fountain, Spanish Steps, Villa Borghese"]);
    // An answer that brings it back by taking another place out isn't kept.
    generateContent.mockReset();
    generateContent.mockResolvedValueOnce(first).mockResolvedValueOnce(reply([[2, [["Breakfast at the hotel", "08:00"], ["Vatican Museums", "09:00"], ["Pantheon", "13:00"]]]]));
    const swapped = await run(regroup);
    expect(named(swapped)).toEqual(["1: Breakfast at the hotel, Colosseum, Roman Forum", "3: Breakfast at the hotel, Trevi Fountain, Spanish Steps, Villa Borghese"]);
  });

  it("doesn't ask for them when they asked to take something out, to add or for a day trip, nor while days are still to come", async () => {
    const asked = () => generateContent.mock.calls.some((c) => JSON.stringify(c[0]).includes("left these places of the plan off every day"));
    const first = reply([[1, [["Colosseum", "09:00"], ["Roman Forum", "11:00"]]]]);
    for (const message of ["regroup the days by area and remove the Pantheon", "regroup the days by area and add the Roman Forum", "regroup the days by area with a day trip to Tivoli"]) {
      generateContent.mockReset();
      generateContent.mockResolvedValue(first);
      await run({ ...regroup, message });
      expect(asked()).toBe(false);
    }
    // The days a part didn't bring back may be where those places were going.
    generateContent.mockReset();
    generateContent.mockResolvedValueOnce(reply([[1, [["Colosseum", "09:00"], ["Roman Forum", "11:00"]]]], [2, 3])).mockRejectedValueOnce(overloaded());
    await run(regroup);
    expect(asked()).toBe(false);
  });
});

// "Yes" to new Seoul places for Day 8 got Day 5's dinner at Gwangjang Market
// again, and the retry kept it.
describe("assistTrip on a day that repeats a place another day keeps", () => {
  const at = (name: string, start_time: string) => ({ name, start_time });
  const plan = [
    { day_number: 1, date: "2027-05-01", activities: [at("Colosseum", "09:00"), at("Pantheon", "13:00")] },
    { day_number: 2, date: "2027-05-02", activities: [at("Vatican Museums", "09:00"), at("Castel Sant'Angelo", "13:00")] },
    { day_number: 3, date: "2027-05-03", activities: [at("Trevi Fountain", "09:00"), at("Villa Borghese", "13:00")] },
  ] as unknown as ItineraryDay[];
  const art = { ...input, destination: "Rome", days: plan, message: "make day 3 about art" };
  const day3 = (names: string[], text = "Day 3 is all art now, with the Vatican Museums.") => ({
    response: { text: () => JSON.stringify({ reply: text, edits: [{ day_number: 3, activities: names.map((name, i) => ({ name, start_time: `${9 + i * 3}:00`.padStart(5, "0") })) }] }) },
  });
  const repeated = day3(["Galleria Borghese", "Vatican Museums", "Villa Borghese"]);
  const named = (out: { edits: Array<{ day_number: number; activities: Array<{ name: string }> }> }) => out.edits.map((e) => `${e.day_number}: ${e.activities.map((a) => a.name).join(", ")}`);

  it("asks once more for other places, and says why the one it named isn't there", async () => {
    // The answer also redid Day 1, which it wasn't asked for.
    const other = {
      response: {
        text: () =>
          JSON.stringify({
            reply: "Done.",
            edits: [
              { day_number: 1, activities: [{ name: "Colosseum", start_time: "09:00" }, { name: "Roman Forum", start_time: "12:00" }] },
              { day_number: 3, activities: [{ name: "Galleria Borghese", start_time: "09:00" }, { name: "Palazzo Barberini", start_time: "12:00" }, { name: "Villa Borghese", start_time: "15:00" }] },
            ],
          }),
      },
    };
    generateContent.mockResolvedValueOnce(repeated).mockResolvedValueOnce(repeated).mockResolvedValueOnce(other);
    const out = await run(art);
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(generateContent.mock.calls[2][0])).toContain("CONTINUE: Day 3 of this change repeats places other days keep: Vatican Museums (Day 2). Return Day 3 in");
    expect(named(out)).toEqual(["3: Galleria Borghese, Palazzo Barberini, Villa Borghese"]);
    expect(out.reply).toBe("Day 3 is all art now, with the Vatican Museums. (Already on Day 2, so not added again: Vatican Museums.)");
  });

  it("takes the copy off the day when the answer still repeats it, unless the day would keep one place", async () => {
    generateContent.mockResolvedValue(repeated);
    expect(named(await run(art))).toEqual(["3: Galleria Borghese, Villa Borghese"]);
    // An answer that still repeats it isn't kept, whatever else it changed.
    generateContent.mockReset();
    generateContent.mockResolvedValueOnce(repeated).mockResolvedValueOnce(repeated).mockResolvedValueOnce(day3(["Palazzo Barberini", "Vatican Museums", "Villa Borghese"]));
    expect(named(await run(art))).toEqual(["3: Galleria Borghese, Villa Borghese"]);
    generateContent.mockReset();
    generateContent.mockResolvedValue(day3(["Vatican Museums", "Villa Borghese"]));
    expect(named(await run(art))).toEqual(["3: Vatican Museums, Villa Borghese"]);
  });

  // A regroup moved the Trevi Fountain to Day 1, and the part for Day 3 didn't
  // take it off there: the move stands (a regroup has its own repeat rules).
  it("leaves a regroup's move as it is", async () => {
    const moved = { response: { text: () => JSON.stringify({ reply: "Grouped.", edits: [{ day_number: 1, activities: [{ name: "Colosseum", start_time: "09:00" }, { name: "Pantheon", start_time: "12:00" }, { name: "Trevi Fountain", start_time: "15:00" }] }] }) } };
    const nothing = { response: { text: () => JSON.stringify({ reply: "Done.", edits: [] }) } };
    generateContent.mockResolvedValueOnce(moved).mockResolvedValueOnce(nothing);
    const out = await run({ ...art, message: "regroup the days by area" });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(named(out)).toEqual(["1: Colosseum, Pantheon, Trevi Fountain"]);
  });

  it("doesn't keep an answer that drops another of the day's places", async () => {
    generateContent.mockResolvedValueOnce(repeated).mockResolvedValueOnce(repeated).mockResolvedValueOnce(day3(["Galleria Borghese", "Palazzo Barberini"], "Done."));
    expect(named(await run(art))).toEqual(["3: Galleria Borghese, Villa Borghese"]);
  });

  it("waits while days of the change are still to come", async () => {
    const more = { response: { text: () => JSON.stringify({ reply: "Day 3 is all art now.", more_days: [2], edits: [{ day_number: 3, activities: [{ name: "Galleria Borghese", start_time: "09:00" }, { name: "Vatican Museums", start_time: "12:00" }, { name: "Villa Borghese", start_time: "15:00" }] }] }) } };
    generateContent.mockResolvedValueOnce(more).mockRejectedValueOnce(overloaded());
    const out = await run(art);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(named(out)).toEqual(["3: Galleria Borghese, Vatican Museums, Villa Borghese"]);
  });

  it("leaves a place they named where they asked for it", async () => {
    generateContent.mockResolvedValue(repeated);
    const out = await run({ ...art, message: "put the vatican museums on day 3 too" });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(named(out)).toEqual(["3: Galleria Borghese, Vatican Museums, Villa Borghese"]);
  });
});

describe("assistTrip on a name with two writing systems in one word", () => {
  const at = (name: string, start_time: string) => ({ name, start_time });
  const plan = [
    { day_number: 1, date: "2027-05-01", activities: [at("Gyeongbokgung Palace", "09:00"), at("Bukchon Hanok Village", "13:00")] },
    { day_number: 2, date: "2027-05-02", activities: [at("Myeongdong", "09:00"), at("N Seoul Tower", "13:00")] },
  ] as unknown as ItineraryDay[];
  const seoul = { ...input, destination: "Seoul", days: plan, message: "add a market to day 2" };
  const day2 = (names: string[], reply = "Added Nam대mun to Day 2.") => ({
    response: { text: () => JSON.stringify({ reply, edits: [{ day_number: 2, activities: names.map((name, i) => at(name, `${9 + i * 2}:00`.padStart(5, "0"))) }] }) },
  });
  const usual = (name: string) => ({ response: { text: () => JSON.stringify({ names: [{ number: 1, name }] }) } });
  // The edit's reply is asked with a request object, the names with a question.
  const answering = (edit: ReturnType<typeof day2>, name: string) => async (req: unknown) => (typeof req === "string" ? usual(name) : edit);
  const questions = () => generateContent.mock.calls.map(([req]) => req).filter((req): req is string => typeof req === "string");
  const named = (out: { edits: Array<{ day_number: number; activities: Array<{ name: string }> }> }) => out.edits.map((e) => `${e.day_number}: ${e.activities.map((a) => a.name).join(", ")}`);

  it("gets its usual name, in the reply too", async () => {
    generateContent.mockImplementation(answering(day2(["Myeongdong", "Nam대mun", "N Seoul Tower"]), "Namdaemun Market"));
    const out = await run(seoul);
    expect(questions()).toHaveLength(1);
    expect(questions()[0]).toContain("1. Nam대mun");
    expect(named(out)).toEqual(["2: Myeongdong, Namdaemun Market, N Seoul Tower"]);
    expect(out.reply).toBe("Added Namdaemun Market to Day 2.");
  });

  it("keeps the name when the answer is another place", async () => {
    generateContent.mockImplementation(answering(day2(["Myeongdong", "Nam대mun", "N Seoul Tower"]), "Gwangjang Market"));
    const out = await run(seoul);
    expect(named(out)).toEqual(["2: Myeongdong, Nam대mun, N Seoul Tower"]);
    expect(out.reply).toBe("Added Nam대mun to Day 2.");
  });

  it("asks nothing about a name the plan already had", async () => {
    const glued = plan.map((d) => (d.day_number === 2 ? { ...d, activities: [at("Myeongdong", "09:00"), at("Green波 Cafe", "11:00")] } : d)) as unknown as ItineraryDay[];
    generateContent.mockImplementation(answering(day2(["Myeongdong", "Green波 Cafe", "Gwangjang Market"], "Added Gwangjang Market."), "Green Wave Cafe"));
    const out = await run({ ...seoul, days: glued });
    expect(questions()).toEqual([]);
    expect(named(out)).toEqual(["2: Myeongdong, Green波 Cafe, Gwangjang Market"]);
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
