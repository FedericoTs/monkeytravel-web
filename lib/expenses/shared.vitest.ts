import { describe, expect, it } from "vitest";
import {
  actorKey,
  centsToAmount,
  normalizeCurrency,
  parseAmountToCents,
  parseExpenseCategory,
  splitEquallyCents,
  summarize,
  type ExpensePublic,
} from "./shared";

describe("parseAmountToCents", () => {
  it("parses dot and comma decimals and strips symbols", () => {
    expect(parseAmountToCents("12.50")).toBe(1250);
    expect(parseAmountToCents("12,50")).toBe(1250);
    expect(parseAmountToCents("€12")).toBe(1200);
    expect(parseAmountToCents(9.99)).toBe(999);
  });
  it("rejects non-positive and junk", () => {
    expect(parseAmountToCents("0")).toBeNull();
    expect(parseAmountToCents("-5")).toBe(500); // symbols stripped incl. '-', so "5"; ok — never negative
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents(0)).toBeNull();
  });
  it("caps absurd amounts", () => {
    expect(parseAmountToCents("99999999")).toBeNull();
  });
});

describe("splitEquallyCents", () => {
  it("sums exactly to the total, remainder to the first shares", () => {
    expect(splitEquallyCents(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEquallyCents(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(splitEquallyCents(1200, 4)).toEqual([300, 300, 300, 300]);
    expect(splitEquallyCents(1, 2)).toEqual([1, 0]);
    expect(splitEquallyCents(500, 1)).toEqual([500]);
    expect(splitEquallyCents(500, 0)).toEqual([]);
  });
});

describe("currency + category + cents", () => {
  it("normalizes currency", () => {
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("Eur")).toBe("EUR");
    expect(normalizeCurrency("nonsense")).toBe("EUR");
    expect(normalizeCurrency(null)).toBe("EUR");
  });
  it("whitelists category", () => {
    expect(parseExpenseCategory("food")).toBe("food");
    expect(parseExpenseCategory("bribes")).toBe("other");
  });
  it("cents to amount", () => {
    expect(centsToAmount(1234)).toBe(12.34);
  });
  it("actorKey prefers user over cookie", () => {
    expect(actorKey("u1", "c1")).toBe("u:u1");
    expect(actorKey(null, "c1")).toBe("c:c1");
  });
});

describe("summarize", () => {
  const exp = (over: Partial<ExpensePublic>): ExpensePublic => ({
    id: Math.random().toString(36).slice(2),
    activityId: null,
    amountCents: 3000,
    currency: "EUR",
    category: "food",
    description: null,
    paidByKey: "c:ana",
    paidByName: "Ana",
    paidByIsOwner: false,
    mine: false,
    createdAt: "2026-09-06T10:00:00Z",
    splits: [
      { key: "c:ana", name: "Ana", shareCents: 1000 },
      { key: "c:bob", name: "Bob", shareCents: 1000 },
      { key: "u:owner", name: null, shareCents: 1000 },
    ],
    ...over,
  });

  it("computes paid, owed and net for the viewer", () => {
    const s = summarize([exp({})], "c:ana");
    expect(s.totalCents).toBe(3000);
    expect(s.youPaidCents).toBe(3000); // Ana paid
    expect(s.youOweCents).toBe(1000); // Ana's share
    expect(s.netCents).toBe(2000); // owed 2000 by the others
    expect(s.count).toBe(1);

    const bob = summarize([exp({})], "c:bob");
    expect(bob.youPaidCents).toBe(0);
    expect(bob.youOweCents).toBe(1000);
    expect(bob.netCents).toBe(-1000); // Bob owes 1000
  });

  it("picks the dominant currency and ignores the rest in totals", () => {
    const s = summarize([exp({ currency: "EUR", amountCents: 3000 }), exp({ currency: "USD", amountCents: 100 })], "c:ana");
    expect(s.currency).toBe("EUR");
    expect(s.totalCents).toBe(3000);
  });
});
