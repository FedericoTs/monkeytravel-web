/**
 * "Who paid?" — shared types and pure money helpers for the live-trip expense
 * split. Live Trip plan, Phase 3.4 (expenses half).
 *
 * The split is across the trip's group, accounts and guests alike. The Today
 * summary and Settle Up both add up the same ledger, keyed by a unified actor
 * key. All arithmetic is in integer cents to avoid float drift; amounts
 * persist as NUMERIC(12,2).
 */

export const EXPENSE_CATEGORIES = ["transport", "accommodation", "food", "activity", "shopping", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function parseExpenseCategory(value: unknown): ExpenseCategory {
  return typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value)
    ? (value as ExpenseCategory)
    : "other";
}

/** The most one payment can be: 1,000,000.00. */
const MAX_AMOUNT_CENTS = 1_000_000_00;

/**
 * What a typed amount says. Ambiguous: a lone "," or "." before exactly three
 * digits where the locale writes decimals with it ("1.200" in en, "1,200" in
 * it) or no locale is known. Options in cents, the thousands reading first;
 * the decimal one only when it fits in cents ("1.200" → 1.20, not "1.234").
 */
export type AmountReading = { kind: "amount"; cents: number } | { kind: "ambiguous"; options: number[] } | { kind: "invalid" };

// A currency sign or code before or after the number: "€12", "R$ 12,50", "12 EUR".
const CURRENCY_MARK = String.raw`(?:[A-Za-z]{0,3}\p{Sc}|[A-Za-z]{3})`;
const LEADING_MARK = new RegExp(String.raw`^${CURRENCY_MARK}\s*`, "u");
const TRAILING_MARK = new RegExp(String.raw`\s*${CURRENCY_MARK}$`, "u");
// Thousands in threes, then the other mark and 1-2 decimals: "1,500.50", "1.500,50", "1 500".
const GROUPED: ReadonlyArray<readonly [string, RegExp]> = [
  [",", /^([1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{1,2}))?$/],
  [".", /^([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d{1,2}))?$/],
  [" ", /^([1-9]\d{0,2}(?: \d{3})+)(?:[.,](\d{1,2}))?$/],
];

/** "," where the locale writes decimals with ".", "." where it uses ","; null when unknown. */
function thousandsMark(locale: string | undefined): string | null {
  if (!locale) return null;
  try {
    const decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")?.value;
    return decimal === "." ? "," : decimal === "," ? "." : null;
  } catch {
    return null;
  }
}

function centsOf(whole: string, decimals = ""): AmountReading {
  const cents = Number(whole || "0") * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? { kind: "amount", cents } : { kind: "invalid" };
}

/**
 * Reads an amount as typed in the UI locale. "12.50" and "12,50" are 12.50
 * anywhere, and so are grouped forms like "1,500.50", "1.500,50" or "1 500".
 * Anything else (signs, three decimals, stray letters) is invalid.
 */
export function readAmount(input: string, locale?: string): AmountReading {
  const text = input.trim().replace(/\s/g, " ").replace(LEADING_MARK, "").replace(TRAILING_MARK, "");
  if (/^\d+$/.test(text)) return centsOf(text);
  const decimal = /^(\d*)[.,](\d{1,2})$/.exec(text);
  if (decimal) return centsOf(decimal[1], decimal[2]);
  for (const [mark, pattern] of GROUPED) {
    const match = pattern.exec(text);
    if (!match) continue;
    const groups = match[1].split(mark);
    const lone = groups.length === 2 && match[2] === undefined && mark !== " ";
    if (!lone || mark === thousandsMark(locale)) return centsOf(groups.join(""), match[2]);
    const [head, tail] = groups;
    const options = [Number(head + tail) * 100];
    if (tail.endsWith("0")) options.push(Number(head) * 100 + Number(tail.slice(0, 2)));
    return { kind: "ambiguous", options };
  }
  return { kind: "invalid" };
}

/**
 * The server's read of an amount: a JSON number or a string in the form
 * canonicalAmount writes. Cents when positive and at most 1,000,000.00, else
 * null. It has no locale, so a string that reads two ways is refused.
 */
export function parseAmountToCents(input: unknown): number | null {
  let cents: number | null = null;
  if (typeof input === "number" && Number.isFinite(input)) cents = Math.round(input * 100);
  else if (typeof input === "string") {
    const reading = readAmount(input);
    if (reading.kind === "amount") cents = reading.cents;
  }
  return cents !== null && cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/** What the browser sends once it has read the amount: "1200.00", the same in every locale. */
export function canonicalAmount(cents: number): string {
  return centsToAmount(cents).toFixed(2);
}

/** Cents with two decimals in the locale, so they read one way only: "1,200.00", "1.200,00". */
export function formatAmount(cents: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centsToAmount(cents));
  } catch {
    return canonicalAmount(cents);
  }
}

/** ISO-4217-ish: 3 letters, uppercased. Falls back to EUR. */
export function normalizeCurrency(value: unknown): string {
  return typeof value === "string" && /^[a-z]{3}$/i.test(value.trim()) ? value.trim().toUpperCase() : "EUR";
}

/**
 * Split `totalCents` equally into `n` shares that sum EXACTLY to the total.
 * The remainder cents go to the first shares (deterministic), so the parent
 * always equals the sum of splits — the invariant Settle Up and the summary
 * both rely on.
 */
export function splitEquallyCents(totalCents: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  let remainder = totalCents - base * n;
  return Array.from({ length: n }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

/** A person the cost is split across (owner or participant), unified. */
export interface ExpenseActor {
  /** Stable key: "u:<userId>" for authed, "c:<cookie>" for anonymous. */
  key: string;
  userId: string | null;
  cookieId: string | null;
  name: string | null;
  isOwner: boolean;
}

export function actorKey(userId: string | null, cookieId: string | null): string {
  return userId ? `u:${userId}` : cookieId ? `c:${cookieId}` : "c:unknown";
}

export interface ExpenseSplitPublic {
  name: string | null;
  shareCents: number;
}

/**
 * An expense as the server sums it, keyed by person. Never sent to the
 * browser: a guest's key is the cookie that identifies them on every trip.
 */
export interface ExpenseLedgerEntry {
  currency: string;
  amountCents: number;
  paidByKey: string;
  paidByName: string | null;
  splits: Array<{ key: string; name: string | null; shareCents: number }>;
}

export interface ExpensePublic {
  id: string;
  activityId: string | null;
  amountCents: number;
  currency: string;
  category: ExpenseCategory;
  description: string | null;
  paidByName: string | null;
  /** True when the payer is the trip owner (so a null name renders "The owner", not "someone"). */
  paidByIsOwner: boolean;
  mine: boolean;
  createdAt: string;
  splits: ExpenseSplitPublic[];
}

export interface ExpenseSummary {
  currency: string;
  totalCents: number;
  /** The viewer paid this much. */
  youPaidCents: number;
  /** The viewer's summed share of all expenses. */
  youOweCents: number;
  /** paid − owed: positive = you're owed, negative = you owe. */
  netCents: number;
  count: number;
}

/** Compute the viewer's summary over the ledger. Multi-currency collapses to the dominant one for display. */
export function summarize(expenses: ExpenseLedgerEntry[], viewerKey: string): ExpenseSummary {
  const byCurrencyTotal = new Map<string, number>();
  for (const e of expenses) byCurrencyTotal.set(e.currency, (byCurrencyTotal.get(e.currency) ?? 0) + e.amountCents);
  let currency = "EUR";
  let best = -1;
  for (const [c, tot] of byCurrencyTotal) if (tot > best) { best = tot; currency = c; }

  let totalCents = 0;
  let youPaidCents = 0;
  let youOweCents = 0;
  let count = 0;
  for (const e of expenses) {
    if (e.currency !== currency) continue; // summary is single-currency; mixed is rare
    totalCents += e.amountCents;
    count += 1;
    if (e.paidByKey === viewerKey) youPaidCents += e.amountCents;
    const mine = e.splits.find((s) => s.key === viewerKey);
    if (mine) youOweCents += mine.shareCents;
  }
  return { currency, totalCents, youPaidCents, youOweCents, netCents: youPaidCents - youOweCents, count };
}

export interface LedgerTransfer {
  fromKey: string;
  toKey: string;
  amountCents: number;
  currency: string;
}

/**
 * Who pays whom so everyone is even, per currency: whoever owes most pays
 * whoever is owed most, until nobody owes anything. A balance is what someone
 * paid minus their shares, the same sum as their Today summary.
 */
export function settleUp(entries: ExpenseLedgerEntry[]): LedgerTransfer[] {
  const balances = new Map<string, Map<string, number>>();
  const add = (currency: string, key: string, cents: number) => {
    const byKey = balances.get(currency) ?? new Map<string, number>();
    byKey.set(key, (byKey.get(key) ?? 0) + cents);
    balances.set(currency, byKey);
  };
  for (const e of entries) {
    add(e.currency, e.paidByKey, e.amountCents);
    for (const s of e.splits) add(e.currency, s.key, -s.shareCents);
  }

  const transfers: LedgerTransfer[] = [];
  for (const currency of [...balances.keys()].sort()) {
    // Sorted so that ties settle the same way every time.
    const people = [...balances.get(currency)!].map(([key, cents]) => ({ key, cents })).sort((a, b) => a.key.localeCompare(b.key));
    for (;;) {
      let creditor: { key: string; cents: number } | null = null;
      let debtor: { key: string; cents: number } | null = null;
      for (const p of people) {
        if (p.cents > 0 && (!creditor || p.cents > creditor.cents)) creditor = p;
        if (p.cents < 0 && (!debtor || p.cents < debtor.cents)) debtor = p;
      }
      if (!creditor || !debtor) break;
      const amountCents = Math.min(creditor.cents, -debtor.cents);
      transfers.push({ fromKey: debtor.key, toKey: creditor.key, amountCents, currency });
      creditor.cents -= amountCents;
      debtor.cents += amountCents;
    }
  }
  return transfers;
}

/** Each person's latest name in the ledger, given entries newest first. */
export function ledgerNames(entries: ExpenseLedgerEntry[]): Map<string, string> {
  const names = new Map<string, string>();
  const note = (key: string, name: string | null) => {
    const trimmed = name?.trim();
    if (trimmed && !names.has(key)) names.set(key, trimmed);
  };
  for (const e of entries) {
    note(e.paidByKey, e.paidByName);
    for (const s of e.splits) note(s.key, s.name);
  }
  return names;
}
