import { describe, expect, it } from "vitest";
import {
  actorKey,
  canonicalAmount,
  centsToAmount,
  formatAmount,
  ledgerNames,
  normalizeCurrency,
  parseAmountToCents,
  parseExpenseCategory,
  readAmount,
  settleUp,
  splitEquallyCents,
  summarize,
  type ExpenseLedgerEntry,
} from "./shared";

const LOCALES = ["en", "es", "it", "pt"] as const;
const amount = (cents: number) => ({ kind: "amount", cents });
const ask = (...options: number[]) => ({ kind: "ambiguous", options });
const invalid = { kind: "invalid" };

describe("readAmount", () => {
  it.each([...LOCALES, undefined])("reads one decimal mark with 1-2 decimals the same way (%s)", (locale) => {
    expect(readAmount("12.50", locale)).toEqual(amount(1250));
    expect(readAmount("12,50", locale)).toEqual(amount(1250));
    expect(readAmount("12,5", locale)).toEqual(amount(1250));
    expect(readAmount("0.05", locale)).toEqual(amount(5));
    expect(readAmount(",50", locale)).toEqual(amount(50));
    expect(readAmount("1200", locale)).toEqual(amount(120000));
    expect(readAmount(" 7 ", locale)).toEqual(amount(700));
  });

  it.each([...LOCALES, undefined])("reads grouped thousands the same way (%s)", (locale) => {
    expect(readAmount("1,500.50", locale)).toEqual(amount(150050));
    expect(readAmount("1.500,50", locale)).toEqual(amount(150050));
    expect(readAmount("1 500", locale)).toEqual(amount(150000));
    expect(readAmount("1 500,50", locale)).toEqual(amount(150050));
    expect(readAmount("1 500.5", locale)).toEqual(amount(150050));
    // The no-break spaces Intl writes in some locales.
    expect(readAmount("1 500", locale)).toEqual(amount(150000));
    expect(readAmount("1 500,50", locale)).toEqual(amount(150050));
    expect(readAmount("1.500.000", locale)).toEqual(amount(150000000));
    expect(readAmount("1,234,567.89", locale)).toEqual(amount(123456789));
  });

  it("en: a comma before three digits is thousands; a dot there asks", () => {
    expect(readAmount("1,500", "en")).toEqual(amount(150000));
    expect(readAmount("12,345", "en")).toEqual(amount(1234500));
    expect(readAmount("$1,200", "en")).toEqual(amount(120000));
    expect(readAmount("1.200", "en")).toEqual(ask(120000, 120));
    expect(readAmount("1.250", "en")).toEqual(ask(125000, 125));
    // 1.234 is no amount of money, so only the thousands reading is offered.
    expect(readAmount("1.234", "en")).toEqual(ask(123400));
  });

  it.each(["es", "it", "pt"])("%s: a dot before three digits is thousands; a comma there asks", (locale) => {
    expect(readAmount("1.200", locale)).toEqual(amount(120000));
    expect(readAmount("12.500", locale)).toEqual(amount(1250000));
    expect(readAmount("€ 1.200", locale)).toEqual(amount(120000));
    expect(readAmount("1,200", locale)).toEqual(ask(120000, 120));
    expect(readAmount("1,234", locale)).toEqual(ask(123400));
  });

  it("asks either way when there is no locale, as on the server", () => {
    expect(readAmount("1.200")).toEqual(ask(120000, 120));
    expect(readAmount("1,200")).toEqual(ask(120000, 120));
    expect(readAmount("1.200,00")).toEqual(amount(120000));
  });

  it("drops a currency sign or code around the number", () => {
    expect(readAmount("€12", "en")).toEqual(amount(1200));
    expect(readAmount("12 €", "it")).toEqual(amount(1200));
    expect(readAmount("12€", "es")).toEqual(amount(1200));
    expect(readAmount("R$ 1.200,50", "pt")).toEqual(amount(120050));
    expect(readAmount("US$1,500.50", "en")).toEqual(amount(150050));
    expect(readAmount("EUR 1.200", "it")).toEqual(amount(120000));
    expect(readAmount("1.200 eur", "es")).toEqual(amount(120000));
  });

  it("refuses what it could only guess at", () => {
    const junk = [
      "", " ", "abc", "€", "-5", "+5", "−5", "5k", "1e3", "0x10", "12abc34",
      "12 50", "1  500", "1,5000", "1234.567", "0,500", "1.234.56", "1,500,50", "1.500.50", "1,2,3",
      "1,500.505", "1.200,50.00", "12.", "12,", ".", "1, 500",
    ];
    for (const locale of [...LOCALES, undefined]) {
      for (const input of junk) expect(readAmount(input, locale), `${input} (${locale})`).toEqual(invalid);
    }
  });
});

describe("parseAmountToCents", () => {
  it("takes a number or the string the browser sends", () => {
    expect(parseAmountToCents(9.99)).toBe(999);
    expect(parseAmountToCents("1200.00")).toBe(120000);
    expect(parseAmountToCents("12,50")).toBe(1250);
    expect(parseAmountToCents("€12")).toBe(1200);
    expect(parseAmountToCents("1.500,50")).toBe(150050);
  });
  it("refuses a string that reads two ways instead of guessing", () => {
    expect(parseAmountToCents("1.200")).toBeNull();
    expect(parseAmountToCents("1,500")).toBeNull();
  });
  it("rejects non-positive and junk", () => {
    expect(parseAmountToCents("0")).toBeNull();
    expect(parseAmountToCents("-5")).toBeNull();
    expect(parseAmountToCents(-5)).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents(0)).toBeNull();
    expect(parseAmountToCents(Number.NaN)).toBeNull();
    expect(parseAmountToCents(null)).toBeNull();
  });
  it("caps absurd amounts, typed or sent as a number", () => {
    expect(parseAmountToCents("1000000")).toBe(100000000);
    expect(parseAmountToCents("1.000.000,01")).toBeNull();
    expect(parseAmountToCents("99999999")).toBeNull();
    expect(parseAmountToCents(99999999)).toBeNull();
  });
});

describe("the browser and the server read the same amount", () => {
  const samples = [1, 5, 10, 99, 100, 120, 1250, 99999, 120000, 150050, 12345678, 100000000];

  it("the server reads back what the browser sends", () => {
    for (const cents of samples) expect(parseAmountToCents(canonicalAmount(cents))).toBe(cents);
    expect(canonicalAmount(120000)).toBe("1200.00");
    expect(canonicalAmount(5)).toBe("0.05");
  });

  it.each(LOCALES)("%s: an amount offered to pick reads back as itself", (locale) => {
    for (const cents of samples) expect(readAmount(formatAmount(cents, locale), locale)).toEqual(amount(cents));
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
  const exp = (over: Partial<ExpenseLedgerEntry>): ExpenseLedgerEntry => ({
    amountCents: 3000,
    currency: "EUR",
    paidByKey: "c:ana",
    paidByName: "Ana",
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

describe("settleUp", () => {
  const entry = (paidByKey: string, amountCents: number, keys: string[], currency = "EUR"): ExpenseLedgerEntry => ({
    currency,
    amountCents,
    paidByKey,
    paidByName: null,
    splits: keys.map((key, i) => ({ key, name: null, shareCents: splitEquallyCents(amountCents, keys.length)[i] })),
  });

  // The owner paid dinner for three; a guest paid gelato for three.
  const ledger = [entry("u:owner", 9000, ["u:owner", "u:mate", "c:bo"]), entry("c:bo", 3000, ["u:owner", "u:mate", "c:bo"])];

  it("settles guests like everyone else", () => {
    expect(settleUp(ledger)).toEqual([
      { fromKey: "u:mate", toKey: "u:owner", amountCents: 4000, currency: "EUR" },
      { fromKey: "c:bo", toKey: "u:owner", amountCents: 1000, currency: "EUR" },
    ]);
  });

  it("agrees with each person's Today summary", () => {
    const transfers = settleUp(ledger);
    for (const key of ["u:owner", "u:mate", "c:bo"]) {
      const received = transfers.filter((t) => t.toKey === key).reduce((sum, t) => sum + t.amountCents, 0);
      const paid = transfers.filter((t) => t.fromKey === key).reduce((sum, t) => sum + t.amountCents, 0);
      expect(received - paid).toBe(summarize(ledger, key).netCents);
    }
  });

  it("settles each currency on its own", () => {
    const transfers = settleUp([entry("u:owner", 2000, ["u:owner", "u:mate"]), entry("u:mate", 5000, ["u:owner", "u:mate"], "USD")]);
    expect(transfers).toEqual([
      { fromKey: "u:mate", toKey: "u:owner", amountCents: 1000, currency: "EUR" },
      { fromKey: "u:owner", toKey: "u:mate", amountCents: 2500, currency: "USD" },
    ]);
  });

  it("has nothing to settle when everyone paid their share", () => {
    expect(settleUp([entry("u:owner", 1000, ["u:owner", "u:mate"]), entry("u:mate", 1000, ["u:owner", "u:mate"])])).toEqual([]);
    expect(settleUp([])).toEqual([]);
  });
});

describe("ledgerNames", () => {
  it("keeps each person's latest name, newest entry first", () => {
    const names = ledgerNames([
      { currency: "EUR", amountCents: 100, paidByKey: "c:bo", paidByName: " Bo ", splits: [{ key: "u:owner", name: null, shareCents: 100 }] },
      { currency: "EUR", amountCents: 100, paidByKey: "u:owner", paidByName: null, splits: [{ key: "c:bo", name: "Bobby", shareCents: 100 }] },
    ]);
    expect(Object.fromEntries(names)).toEqual({ "c:bo": "Bo" });
  });
});
