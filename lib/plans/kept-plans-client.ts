/**
 * The browser's side of kept plans (lib/plans/kept-plan.ts): the list of plans
 * this browser kept or opened, the private link, and the calls to /api/plans.
 */

import { safeGet, safeSet } from "@/lib/safe-storage";
import { isKeptToken, parseKeptPlan, type KeptPlan } from "@/lib/plans/kept-plan";

const INDEX_KEY = "mt_kept_plans";
const MAX_ENTRIES = 8;

/** A kept plan as this browser remembers it. Only the browser that kept it has the key. */
export interface KeptPlanEntry {
  token: string;
  key?: string;
  destination: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  expiresAt: string;
}

function isEntry(v: unknown): v is KeptPlanEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    isKeptToken(e.token) &&
    (e.key === undefined || typeof e.key === "string") &&
    typeof e.destination === "string" &&
    typeof e.startDate === "string" &&
    typeof e.endDate === "string" &&
    typeof e.dayCount === "number" &&
    typeof e.expiresAt === "string"
  );
}

/** Newest first, without the ones past their expiry. */
export function readKeptPlans(now = Date.now()): KeptPlanEntry[] {
  try {
    const parsed: unknown = JSON.parse(safeGet(INDEX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry).filter((e) => Date.parse(e.expiresAt) > now) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
const NONE: KeptPlanEntry[] = [];
let snapshot: { raw: string | null; plans: KeptPlanEntry[] } | null = null;

function write(entries: KeptPlanEntry[]) {
  safeSet(INDEX_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  listeners.forEach((onChange) => onChange());
}

/** Puts the plan first; a key this browser already holds for it is kept. */
export function rememberKeptPlan(entry: KeptPlanEntry): void {
  const all = readKeptPlans();
  const key = entry.key ?? all.find((e) => e.token === entry.token)?.key;
  write([{ ...entry, ...(key ? { key } : {}) }, ...all.filter((e) => e.token !== entry.token)]);
}

export function forgetKeptPlan(token: string): void {
  write(readKeptPlans().filter((e) => e.token !== token));
}

/** For useSyncExternalStore: the same array until the list changes. */
export function keptPlansSnapshot(): KeptPlanEntry[] {
  const raw = safeGet(INDEX_KEY);
  if (!snapshot || snapshot.raw !== raw) snapshot = { raw, plans: raw ? readKeptPlans() : NONE };
  return snapshot.plans;
}

/** The server renders no list: it is this browser's. */
export function keptPlansServerSnapshot(): KeptPlanEntry[] {
  return NONE;
}

export function subscribeKeptPlans(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === INDEX_KEY) onChange();
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function entryFor(token: string, plan: KeptPlan, expiresAt: string, key?: string): KeptPlanEntry {
  return {
    token,
    ...(key ? { key } : {}),
    destination: plan.destination,
    startDate: plan.startDate,
    endDate: plan.endDate,
    dayCount: plan.itinerary.days.length,
    expiresAt,
  };
}

/**
 * The plan's private link: the planner's own address with the token in the
 * fragment, which never reaches a server log, a page view or a Referer. The
 * planner reads it and takes it off the address bar.
 */
export function keptPlanLink(plannerUrl: string, token: string): string {
  const url = new URL(plannerUrl);
  url.search = "";
  url.hash = `plan=${token}`;
  return url.toString();
}

export function keptTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("plan");
  return isKeptToken(token) ? token : null;
}

/** A cheap fingerprint, to send a plan only when it changed. */
export function planFingerprint(plan: KeptPlan): string {
  const json = JSON.stringify(plan);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${json.length}:${(h >>> 0).toString(36)}`;
}

export async function keepPlan(plan: KeptPlan): Promise<{ token: string; key: string; expiresAt: string } | null> {
  try {
    const res = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: unknown; key?: unknown; expiresAt?: unknown };
    return isKeptToken(body.token) && typeof body.key === "string" && typeof body.expiresAt === "string"
      ? { token: body.token, key: body.key, expiresAt: body.expiresAt }
      : null;
  } catch {
    return null;
  }
}

/** "gone" when the plan expired or the key is not this plan's. */
export async function changeKeptPlan(
  token: string,
  key: string,
  plan: KeptPlan
): Promise<{ expiresAt: string } | "gone" | null> {
  try {
    const res = await fetch(`/api/plans/${token}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-plan-key": key },
      body: JSON.stringify({ plan }),
    });
    if (res.status === 404) return "gone";
    if (!res.ok) return null;
    const body = (await res.json()) as { expiresAt?: unknown };
    return typeof body.expiresAt === "string" ? { expiresAt: body.expiresAt } : null;
  } catch {
    return null;
  }
}

/** "gone" when no plan is kept under the token any more. */
export async function openKeptPlan(token: string): Promise<{ plan: KeptPlan; expiresAt: string } | "gone" | null> {
  try {
    const res = await fetch(`/api/plans/${token}`, { cache: "no-store" });
    if (res.status === 404) return "gone";
    if (!res.ok) return null;
    const body = (await res.json()) as { plan?: unknown; expiresAt?: unknown };
    const plan = parseKeptPlan(body.plan);
    return plan && typeof body.expiresAt === "string" ? { plan, expiresAt: body.expiresAt } : null;
  } catch {
    return null;
  }
}
