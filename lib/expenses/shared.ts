/**
 * "Who paid?" — shared types and pure money helpers for the live-trip expense
 * split. Live Trip plan, Phase 3.4 (expenses half).
 *
 * The split is across the trip's *participants* (Phase 2), who are anonymous.
 * The existing Settle Up / compute_trip_settlements stays authed-only; this
 * layer computes its own summary over authed AND anonymous splitters, keyed
 * by a unified actor key. All arithmetic is in integer cents to avoid float
 * drift; amounts persist as NUMERIC(12,2).
 */

export const EXPENSE_CATEGORIES = ["transport", "accommodation", "food", "activity", "shopping", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function parseExpenseCategory(value: unknown): ExpenseCategory {
  return typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value)
    ? (value as ExpenseCategory)
    : "other";
}

/** Accepts "12.50", "12,50", "€12" → cents (1250); null when not a positive amount. */
export function parseAmountToCents(input: unknown): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) return null;
    return Math.round(input * 100);
  }
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[^\d.,]/g, "").replace(/,/g, ".");
  if (!cleaned) return null;
  // Keep only the last dot as the decimal separator (handles "1.234.56" oddities minimally).
  const parts = cleaned.split(".");
  const normalized = parts.length > 1 ? parts.slice(0, -1).join("") + "." + parts[parts.length - 1] : parts[0];
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return cents > 0 && cents <= 1_000_000_00 ? cents : null; // cap at 1,000,000.00
}

export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/** ISO-4217-ish: 3 letters, uppercased. Falls back to EUR. */
export function normalizeCurrency(value: unknown): string {
  return typeof value === "string" && /^[a-z]{3}$/i.test(value.trim()) ? value.trim().toUpperCase() : "EUR";
}

/**
 * Split `totalCents` equally into `n` shares that sum EXACTLY to the total.
 * The remainder cents go to the first shares (deterministic), so the parent
 * always equals the sum of splits — the invariant compute_trip_settlements
 * and the summary both rely on.
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
  key: string;
  name: string | null;
  shareCents: number;
}

export interface ExpensePublic {
  id: string;
  activityId: string | null;
  amountCents: number;
  currency: string;
  category: ExpenseCategory;
  description: string | null;
  paidByKey: string;
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
export function summarize(expenses: ExpensePublic[], viewerKey: string): ExpenseSummary {
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
