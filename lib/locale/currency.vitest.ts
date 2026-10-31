import { describe, it, expect } from "vitest";
import { convertAndFormatCurrency } from "./currency";

// Frankfurter's table: units per euro, and no TWD.
const RATES = { base: "EUR", date: "2026-10-30", rates: { USD: 1.1, JPY: 165 }, fetchedAt: Date.now() };

describe("convertAndFormatCurrency", () => {
  it("shows a price in the traveller's currency", () => {
    const out = convertAndFormatCurrency(110, "USD", "EUR", RATES, "en-US");
    expect(out.currency).toBe("EUR");
    expect(out.value).toBeCloseTo(100);
    expect(out.formatted).toBe("€100");
  });

  it("shows a price the rates can't convert in its own currency, not under the traveller's symbol", () => {
    const out = convertAndFormatCurrency(300, "TWD", "EUR", RATES, "en-US");
    expect(out.currency).toBe("TWD");
    expect(out.value).toBe(300);
    expect(out.formatted).not.toContain("€");
    expect(out.formatted).toContain("300");
  });

  it("keeps the price's own currency when the traveller's isn't in the rates", () => {
    const out = convertAndFormatCurrency(25, "USD", "TWD", RATES, "en-US");
    expect(out.currency).toBe("USD");
    expect(out.formatted).toBe("$25");
  });
});
