/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ItineraryDay } from "@/types";
import {
  budgetUncheckedReply,
  claimsBudgetFit,
  planCostsReply,
  unshownBudgetClaim,
  withoutBudgetClaims,
} from "./honesty";
import { planCosts } from "./plan-costs";
import { buildPrompt } from "./edit-prompt";

/**
 * A claim that the plan fits a budget ("we're keeping the total well under
 * your budget") has to come with figures of its own: one whose only figure is
 * the traveller's budget was worked out from nothing. It gets one more try,
 * and then the plan's own figures instead.
 */

const generateContent = vi.fn();

vi.mock("@/lib/ai/genai-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/genai-compat")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return { generateContent: (req: unknown) => generateContent(req) };
      }
    },
  };
});

vi.mock("@/lib/ai/cache-metrics", () => ({ logCacheMetrics: vi.fn() }));

const priced = (n: number, costs: number[]) =>
  ({
    day_number: n,
    date: `2027-05-0${n}`,
    activities: costs.map((amount, i) => ({
      name: `Stop ${n}.${i + 1}`,
      time_slot: i === 0 ? "morning" : "afternoon",
      estimated_cost: { amount, currency: "EUR" },
    })),
  }) as unknown as ItineraryDay;

// 200 EUR of activities per person.
const days = [priced(1, [40, 60]), priced(2, [100])];
const asked = {
  message: "Make the whole trip stay under 3,000 EUR",
  history: [
    { role: "user" as const, text: "There are 6 of us going" },
    { role: "assistant" as const, text: "Lovely, a trip for six!" },
  ],
  destination: "Lisbon, Portugal",
  tripTitle: "Lisbon",
  days,
  locale: "en",
};

const reply = (text: string, edits: unknown[] = []) => ({
  response: { text: () => JSON.stringify({ reply: text, edits }) },
});

describe("claimsBudgetFit", () => {
  it.each([
    "We are keeping the total cost well under 3,000 EUR for your group.",
    "No problem! We're keeping the total cost well under control for everyone.",
    "Keeping your trip under your 3,000 EUR budget for all six of you, here is your plan as it is.",
    "All set, and comfortably within your budget!",
    "With the hostel added, the trip stays below 3,000 EUR overall.",
    "Mantenemos el coste total muy por debajo de tu presupuesto de 3.000 EUR.",
    "Todo queda dentro de tu presupuesto.",
    "Il viaggio resta ben al di sotto del tuo budget di 3.000 EUR.",
    "Tutto rientra nel vostro budget.",
    "O custo total fica bem abaixo do seu orçamento de 3.000 EUR.",
    "Tudo cabe no seu orçamento.",
    "Com um orçamento de 5.000 EUR para duas pessoas, o roteiro está super confortável, cobrindo com folga os custos.",
    "Your budget leaves plenty of room for the rest of the trip.",
    "There's plenty of room left in your budget.",
    "Con tu presupuesto vas de sobra.",
  ])("hears a claim in %s", (text) => {
    expect(claimsBudgetFit(text)).toBe(true);
  });

  it.each([
    "Want me to swap a few stops so it stays within your budget?",
    "Most sights are well within walking distance of each other.",
    "Here are some budget-friendly lunch spots near the castle.",
    "The Oceanarium is under 20 minutes away by tram.",
    "The walk along the river stays under 2 hours.",
    "Your budget tier is moderate, so the dinners are mid-range.",
    "Chegue com folga ao aeroporto, pelo menos duas horas antes.",
    "The rooms at the budget hotel near the station are small.",
    "",
  ])("hears none in %s", (text) => {
    expect(claimsBudgetFit(text)).toBe(false);
  });
});

describe("unshownBudgetClaim", () => {
  const told = "There are 6 of us going\nMake the whole trip stay under 3,000 EUR";

  it("is a claim whose only figures are the traveller's own", () => {
    expect(unshownBudgetClaim("Keeping your trip under your 3,000 EUR budget for all 6 of you.", told)).toBe(true);
    expect(unshownBudgetClaim("We're keeping the total cost well under control for everyone.", told)).toBe(true);
  });

  it("reads a budget written in thousands, or with a dot, as the same figure", () => {
    expect(unshownBudgetClaim("We are keeping it well under 3,000 EUR.", "keep it under 3k please")).toBe(true);
    expect(unshownBudgetClaim("Queda muy por debajo de tu presupuesto de 3.000 EUR.", "menos de 3000 euros")).toBe(true);
  });

  it("is no such claim when the reply shows figures of its own", () => {
    const shown =
      "- Activities: about 200 EUR each, 1,200 EUR for six.\n- Hostel: about 1,000 EUR.\nThat leaves you well under your 3,000 EUR budget.";
    expect(unshownBudgetClaim(shown, told)).toBe(false);
  });

  it("is no claim at all without one", () => {
    expect(unshownBudgetClaim("The castle opens at 9:00.", told)).toBe(false);
  });

  it("takes a year for no figure", () => {
    expect(unshownBudgetClaim("Your 2027 trip stays well within your budget.", told)).toBe(true);
  });
});

describe("withoutBudgetClaims", () => {
  it("drops the sentences that claim a fit and keeps the rest", () => {
    expect(withoutBudgetClaims("Day 2 now has cheaper lunches. That keeps everything well under your 3,000 EUR budget!")).toBe(
      "Day 2 now has cheaper lunches.",
    );
  });
});

describe("what the traveller reads about the plan's costs", () => {
  const costs = planCosts(days)!;

  it("says the plan's figure is per person", () => {
    expect(planCostsReply("en", costs)).toBe(
      "The activities in your plan come to about 200 EUR per person. Hotels and flights aren't in the plan, so add those on top.",
    );
    expect(planCostsReply("es", costs)).toContain("200 EUR por persona");
    expect(planCostsReply("it", costs)).toContain("200 EUR a persona");
    expect(planCostsReply("pt", costs)).toContain("200 EUR por pessoa");
  });

  it("says plainly that the budget wasn't checked, then the plan's figure", () => {
    expect(budgetUncheckedReply("en", costs)).toBe(
      "I can't say yet whether that fits your budget. The activities in your plan come to about 200 EUR per person. Hotels and flights aren't in the plan, so add those on top.",
    );
    expect(budgetUncheckedReply("it", null)).toBe("Non posso ancora dire se rientra nel tuo budget.");
  });
});

describe("the prompt", () => {
  it("holds a budget to everyone together and asks for figures before any claim", () => {
    const prompt = buildPrompt(asked);
    expect(prompt).toContain("A budget the traveller gives is for everyone together unless they say per person");
    expect(prompt).toContain("Never say the plan fits a budget");
  });
});

describe("assistTrip on a claim that the plan fits a budget", () => {
  let mod: typeof import("./engine");

  beforeEach(async () => {
    process.env.GOOGLE_AI_API_KEY = "test-key";
    generateContent.mockReset();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    mod = await import("./engine");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function run(i: Parameters<typeof mod.assistTrip>[0] = asked) {
    const p = mod.assistTrip(i);
    p.catch(() => {});
    await vi.runAllTimersAsync();
    return p;
  }

  it("names the rule a claim with no figures of its own breaks", () => {
    const c = mod.correctionWithRule(asked, { reply: "We are keeping the total cost well under 3,000 EUR for your group.", edits: [] });
    expect(c?.rule).toBe("budget_unshown");
    expect(c?.text).toContain("per person");
    expect(mod.correctionWithRule(asked, { reply: "Want me to swap a few stops so it stays within your budget?", edits: [] })).toBeNull();
  });

  it("reads the budget from earlier in the conversation", () => {
    const later = { ...asked, message: "How are we doing?", history: [{ role: "user" as const, text: "Keep it under 3,000 EUR" }] };
    expect(mod.correctionWithRule(later, { reply: "We're doing great, well under your 3,000 EUR budget.", edits: [] })?.rule).toBe("budget_unshown");
  });

  it("takes its own earlier figure, repeated, for one worked out", () => {
    const later = {
      ...asked,
      message: "Are we fine?",
      history: [
        { role: "user" as const, text: "Keep it under 3,000 EUR" },
        { role: "assistant" as const, text: "The stops come to about 1,200 EUR for six." },
      ],
    };
    expect(mod.correctionWithRule(later, { reply: "Yes: about 1,200 EUR for six, well under your budget.", edits: [] })).toBeNull();
  });

  it("asks once more, and keeps the second answer when it shows the figures", async () => {
    generateContent
      .mockResolvedValueOnce(reply("We are keeping the total cost well under 3,000 EUR for your group."))
      .mockResolvedValueOnce(reply("- Activities: about 200 EUR each, 1,200 EUR for six.\n- Hostel: about 1,000 EUR.\nThat comes to about 2,200 EUR, under your 3,000 EUR."));
    const out = await run();
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("CORRECTION: Your \\\"reply\\\" says the plan fits their budget");
    expect(out.reply).toContain("2,200 EUR");
    expect(out.corrected).toEqual({ rule: "budget_unshown", answer: "second" });
  });

  it("gives the plan's own figure when the second answer still shows none", async () => {
    generateContent
      .mockResolvedValueOnce(reply("We are keeping the total cost well under 3,000 EUR for your group."))
      .mockResolvedValueOnce(reply("Everything stays comfortably within your budget!"));
    const out = await run();
    expect(out.corrected).toEqual({ rule: "budget_unshown", answer: "first" });
    expect(out.reply).toBe(
      "I can't say yet whether that fits your budget. The activities in your plan come to about 200 EUR per person. Hotels and flights aren't in the plan, so add those on top.",
    );
  });

  it("keeps a change it prepared, without the claim, and with the changed plan's figure", async () => {
    const cheaper = [{ day_number: 2, activities: [{ name: "Free walking tour", time_slot: "morning", estimated_cost: { amount: 10, currency: "EUR" } }] }];
    generateContent
      .mockResolvedValueOnce(reply("We are keeping the total cost well under 3,000 EUR for your group."))
      .mockResolvedValueOnce(reply("Day 2 now has a free walking tour instead. That keeps everything well under your 3,000 EUR budget!", cheaper));
    const out = await run();
    expect(out.edits.map((e) => e.day_number)).toEqual([2]);
    expect(out.reply).toContain("Day 2 now has a free walking tour instead.");
    expect(out.reply).not.toContain("well under");
    expect(out.reply).toContain("I can't say yet whether that fits your budget.");
    expect(out.reply).toContain("about 110 EUR per person");
  });

  it("asks no second time about a change that came with the claim, and keeps the change", async () => {
    const cheaper = [{ day_number: 2, activities: [{ name: "Free walking tour", time_slot: "morning", estimated_cost: { amount: 10, currency: "EUR" } }] }];
    generateContent.mockResolvedValueOnce(reply("Day 2 now has a free walking tour instead. That keeps everything well under your 3,000 EUR budget!", cheaper));
    const out = await run();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out.edits.map((e) => e.day_number)).toEqual([2]);
    expect(out.reply).not.toContain("well under");
    expect(out.reply).toContain("about 110 EUR per person");
  });

  it("leaves an answer with figures of its own as it is", async () => {
    const shown = "- Activities: about 200 EUR each, 1,200 EUR for six.\n- Hostel: about 1,000 EUR.\nThat comes to about 2,200 EUR, well under your 3,000 EUR.";
    generateContent.mockResolvedValueOnce(reply(shown));
    const out = await run();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out.reply).toBe(shown);
    expect(out.corrected).toBeUndefined();
  });
});
