import { describe, expect, it } from "vitest";
import { allowanceFrom, allowanceRule } from "./allowance";
import { buildPrompt } from "./edit-prompt";
import { chatPrompt } from "./chat-prompt";

/**
 * Asked how many free questions they get, a new traveller was told the
 * assistant is unlimited and that the counter on their screen ("97 left") is
 * just a general number. The assistant had never been told the traveller's
 * own numbers, so it made them up.
 */

const monthly = { left: 97, limit: 100, period: "monthly" as const, renews: "2026-12-01T00:00:00Z" };

describe("allowanceFrom", () => {
  it("counts this message as used, as the counter under the chat does", () => {
    expect(allowanceFrom({ remaining: 98, limit: 100, periodType: "monthly", resetAt: "2026-12-01T00:00:00Z" })).toEqual(monthly);
    expect(allowanceFrom({ remaining: 0, limit: 20, periodType: "daily", resetAt: "2026-11-21T00:00:00Z" })).toEqual({
      left: 0,
      limit: 20,
      period: "daily",
      renews: "2026-11-21T00:00:00Z",
    });
  });

  it("knows a plan with no limit", () => {
    expect(allowanceFrom({ remaining: -1, limit: -1, periodType: "monthly", resetAt: "" })).toEqual({ unlimited: true });
  });
});

describe("allowanceRule", () => {
  it("gives the numbers the counter shows and rules out calling it unlimited", () => {
    const rule = allowanceRule(monthly);
    expect(rule).toContain("97 of 100 messages left this month");
    expect(rule).toContain("they renew on 2026-12-01");
    expect(rule).toContain("never call it unlimited");
    expect(rule).toContain("never say they can ask as many questions as they like");
    expect(allowanceRule({ left: 3, limit: 20, period: "daily", renews: "2026-11-21T00:00:00Z" })).toContain("3 of 20 messages left today");
  });

  it("says a plan with no limit has none, and owns up when the numbers aren't known", () => {
    expect(allowanceRule({ unlimited: true })).toContain("have no limit");
    expect(allowanceRule(undefined)).toContain("can't see this traveller's numbers");
    expect(allowanceRule(undefined)).toContain("never say it is unlimited or that they can ask as many questions as they like");
  });
});

describe("the assistant's instructions", () => {
  const days = [{ day_number: 1, date: "2027-03-01", activities: [] }];

  it("give the edit engine the rule among its answers to questions", () => {
    const base = { message: "how many free questions do I get?", destination: "Rome", tripTitle: "Rome Trip", days };
    expect(buildPrompt({ ...base, allowance: monthly })).toContain("97 of 100 messages left this month");
    expect(buildPrompt(base)).toContain("can't see this traveller's numbers");
  });

  it("give the chat the same rule", () => {
    const tripContext = { id: "t", title: "Rome Trip", destination: "Rome", startDate: "2027-03-01", endDate: "2027-03-01", itinerary: days, dayCount: 1, activityCount: 0 };
    const prompt = (allowance?: typeof monthly) =>
      chatPrompt({ tripContext, language: "es", turn: "", thread: [], message: "¿cuántas preguntas gratis tengo?", ...(allowance ? { allowance } : {}) });
    expect(prompt(monthly)).toContain("97 of 100 messages left this month");
    expect(prompt()).toContain("can't see this traveller's numbers");
  });
});
