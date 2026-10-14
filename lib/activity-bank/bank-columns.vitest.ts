/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";

/**
 * The bank's time_slot and budget_tier columns are varchar(20) and readers
 * match exact values. best_time is free text from the model: one long value
 * made Postgres reject the whole upsert batch ("value too long for type
 * character varying(20)"), and values like "sunset" or "spring" were stored
 * where no reader would ever match them.
 */

const { generateContent, upserts } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  upserts: [] as Array<Array<Record<string, unknown>>>,
}));

vi.mock("@/lib/ai/genai-compat", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent };
    }
  },
}));

// Just enough client for populateActivityBank. Like Postgres, a value longer
// than varchar(20) fails the whole upsert batch.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ gt: async () => ({ count: 0, error: null }) }) }),
      upsert: async (rows: Array<Record<string, unknown>>) => {
        upserts.push(rows);
        const tooLong = rows.some(
          (r) => String(r.time_slot).length > 20 || String(r.budget_tier).length > 20
        );
        return { error: tooLong ? { message: "value too long for type character varying(20)" } : null };
      },
    }),
  }),
}));

import { normalizeBankBudgetTier, normalizeBankTimeSlot, populateActivityBank } from "./index";

describe("normalizeBankTimeSlot", () => {
  it("passes the readers' vocabulary through", () => {
    for (const slot of ["morning", "afternoon", "evening", "any"]) {
      expect(normalizeBankTimeSlot(slot)).toBe(slot);
    }
    expect(normalizeBankTimeSlot(" Evening ")).toBe("evening");
  });

  it("maps free text to a slot by keyword", () => {
    expect(normalizeBankTimeSlot("sunrise")).toBe("morning");
    expect(normalizeBankTimeSlot("breakfast")).toBe("morning");
    expect(normalizeBankTimeSlot("lunch")).toBe("afternoon");
    expect(normalizeBankTimeSlot("midday")).toBe("afternoon");
    expect(normalizeBankTimeSlot("around noon")).toBe("afternoon");
    expect(normalizeBankTimeSlot("late afternoon")).toBe("afternoon");
    expect(normalizeBankTimeSlot("sunset")).toBe("evening");
    expect(normalizeBankTimeSlot("after dinner")).toBe("evening");
    expect(normalizeBankTimeSlot("Friday night")).toBe("evening");
  });

  it("falls back to any for unknown text, several slots, or no text", () => {
    expect(normalizeBankTimeSlot("spring")).toBe("any");
    expect(normalizeBankTimeSlot("morning|afternoon|evening|any")).toBe("any");
    expect(normalizeBankTimeSlot("lunch or dinner")).toBe("any");
    expect(normalizeBankTimeSlot("")).toBe("any");
    expect(normalizeBankTimeSlot(undefined)).toBe("any");
    expect(normalizeBankTimeSlot(null)).toBe("any");
    expect(normalizeBankTimeSlot(18)).toBe("any");
  });

  it("never returns more than the column's 20 characters", () => {
    const long = "Late afternoon into the evening, when the sunset lights up the bay";
    expect(long.length).toBeGreaterThan(20);
    expect(normalizeBankTimeSlot(long).length).toBeLessThanOrEqual(20);
    expect(normalizeBankTimeSlot("x".repeat(500))).toBe("any");
  });
});

describe("normalizeBankBudgetTier", () => {
  it("keeps the three tiers and defaults anything else to moderate", () => {
    expect(normalizeBankBudgetTier("budget")).toBe("budget");
    expect(normalizeBankBudgetTier("moderate")).toBe("moderate");
    expect(normalizeBankBudgetTier(" Expensive ")).toBe("expensive");
    expect(normalizeBankBudgetTier("mid-range")).toBe("moderate");
    expect(normalizeBankBudgetTier("varies with the season and group size")).toBe("moderate");
    expect(normalizeBankBudgetTier(undefined)).toBe("moderate");
  });
});

function generated(name: string, bestTime: unknown, tier: unknown = "moderate") {
  return {
    name,
    type: "attraction",
    description: `About ${name}`,
    estimated_cost: { amount: 15, currency: "EUR", tier },
    best_time: bestTime,
    keywords: [name.toLowerCase()],
  };
}

describe("populateActivityBank", () => {
  it("writes only in-vocabulary slots and tiers, so no batch is lost", async () => {
    // 25 activities: one batch of 20, one of 5. Each batch carries a value
    // that is too long for its column as the model wrote it.
    const activities = [
      generated("Castle Viewpoint", "Late afternoon into the evening, for the sunset over the bay"),
      generated("Corner Trattoria", "lunch"),
      generated("Rooftop Bar", "sunset"),
      generated("Flower Market", "spring"),
      generated("Old Town Walk", "morning|afternoon|evening|any"),
      ...Array.from({ length: 19 }, (_, i) => generated(`Gallery ${i + 1}`, "morning", "budget")),
      generated("Harbour Cruise", "evening", "varies with the season and group size"),
    ];
    generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify(activities) } });

    const result = await populateActivityBank("Testville");

    expect(result.count).toBe(activities.length);
    const rows = upserts.flat();
    expect(rows).toHaveLength(activities.length);

    const row = (name: string) =>
      rows.find((r) => (r.activity_data as { name: string }).name === name);
    expect(row("Castle Viewpoint")?.time_slot).toBe("any");
    expect(row("Corner Trattoria")?.time_slot).toBe("afternoon");
    expect(row("Rooftop Bar")?.time_slot).toBe("evening");
    expect(row("Flower Market")?.time_slot).toBe("any");
    expect(row("Old Town Walk")?.time_slot).toBe("any");
    expect(row("Harbour Cruise")?.budget_tier).toBe("moderate");

    for (const r of rows) {
      expect(["morning", "afternoon", "evening", "any"]).toContain(r.time_slot);
      expect(["budget", "moderate", "expensive"]).toContain(r.budget_tier);
      expect((r.activity_data as { time_slot: unknown }).time_slot).toBe(r.time_slot);
    }
  });
});
