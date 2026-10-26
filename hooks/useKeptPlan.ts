"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { trackPlanKept } from "@/lib/analytics";
import { safeGet, safeSet } from "@/lib/safe-storage";
import type { KeptPlan } from "@/lib/plans/kept-plan";
import {
  changeKeptPlan,
  entryFor,
  forgetKeptPlan,
  keepPlan,
  planFingerprint,
  readKeptPlans,
  rememberKeptPlan,
} from "@/lib/plans/kept-plans-client";

// Which kept plan each plan of this tab is, by its useSessionTripStack id.
const LINKS_KEY = "mt_kept_by_trip";
// Edits come in bursts (the assistant, a date change, photos arriving).
const CHANGE_DELAY_MS = 2500;

/** The key is there only when this browser may change the plan. */
type Link = { token: string; key?: string; expiresAt: string; fingerprint: string };
type Links = Readonly<Record<string, Link>>;

// Mirrored to sessionStorage, and kept in memory when storage is blocked, so a
// plan is never kept twice for want of somewhere to write it down.
const NO_LINKS: Links = {};
let links: Links | null = null;
const listeners = new Set<() => void>();

function allLinks(): Links {
  if (!links) {
    try {
      const parsed: unknown = JSON.parse(safeGet(LINKS_KEY, "session") ?? "{}");
      links = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Links) : NO_LINKS;
    } catch {
      links = NO_LINKS;
    }
  }
  return links;
}

function setLink(planId: string, link: Link | null) {
  const next = { ...allLinks() };
  if (link) next[planId] = link;
  else delete next[planId];
  links = next;
  safeSet(LINKS_KEY, JSON.stringify(next), "session");
  listeners.forEach((onChange) => onChange());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function sameTrip(
  a: Pick<KeptPlan, "destination" | "startDate" | "endDate">,
  b: Pick<KeptPlan, "destination" | "startDate" | "endDate">
) {
  return a.destination === b.destination && a.startDate === b.startDate && a.endDate === b.endDate;
}

export interface KeptState {
  token: string;
  expiresAt: string;
}

/**
 * Keeps the plan on screen for a signed-out planner (lib/plans/kept-plan.ts).
 * A plan is kept the first time it is seen; each change after that is sent
 * once it settles, and a change still waiting when the planner goes is sent on
 * the way out. `planId` is the plan's id in this tab (useSessionTripStack):
 * the same through edits, a new one for a new plan.
 *
 * A plan opened from its link (adoptOpened) is not kept again; changed in a
 * browser without its key, it is kept as a copy of its own.
 */
export function useKeptPlan({
  enabled,
  planId,
  plan,
}: {
  enabled: boolean;
  planId: string | null;
  plan: KeptPlan | null;
}): { kept: KeptState | null; adoptOpened: (token: string, opened: KeptPlan, expiresAt: string) => void } {
  const openedRef = useRef<{ token: string; plan: KeptPlan; expiresAt: string } | null>(null);
  const keepingRef = useRef(new Set<string>());
  const pendingRef = useRef<{ planId: string; link: Link; plan: KeptPlan; fingerprint: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const tabLinks = useSyncExternalStore(subscribe, allLinks, () => NO_LINKS);
  const link = enabled && planId ? tabLinks[planId] : undefined;
  const token = link?.token;
  const expiresAt = link?.expiresAt;
  const kept = useMemo(() => (token && expiresAt ? { token, expiresAt } : null), [token, expiresAt]);

  const adoptOpened = useCallback((openedToken: string, opened: KeptPlan, openedExpiresAt: string) => {
    openedRef.current = { token: openedToken, plan: opened, expiresAt: openedExpiresAt };
  }, []);

  const keepNew = useCallback(async (id: string, current: KeptPlan, fingerprint: string) => {
    if (keepingRef.current.has(id)) return;
    keepingRef.current.add(id);
    const made = await keepPlan(current);
    keepingRef.current.delete(id);
    if (!made) return;
    trackPlanKept({ days: current.itinerary.days.length });
    rememberKeptPlan(entryFor(made.token, current, made.expiresAt, made.key));
    setLink(id, { token: made.token, key: made.key, expiresAt: made.expiresAt, fingerprint });
  }, []);

  const sendPending = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending?.link.key) return;
    pendingRef.current = null;
    const { planId: id, link: sent, plan: current, fingerprint } = pending;
    const result = await changeKeptPlan(sent.token, sent.key!, current);
    if (result === "gone") {
      forgetKeptPlan(sent.token);
      setLink(id, null);
      void keepNew(id, current, fingerprint);
    } else if (result) {
      rememberKeptPlan(entryFor(sent.token, current, result.expiresAt, sent.key));
      if (allLinks()[id]?.token === sent.token) setLink(id, { ...sent, expiresAt: result.expiresAt, fingerprint });
    }
  }, [keepNew]);

  useEffect(() => {
    if (!enabled || !planId || !plan) return;
    const fingerprint = planFingerprint(plan);
    let current = allLinks()[planId];
    if (!current) {
      const opened = openedRef.current;
      if (opened && sameTrip(opened.plan, plan)) {
        openedRef.current = null;
        const mine = readKeptPlans().find((e) => e.token === opened.token);
        current = { token: opened.token, key: mine?.key, expiresAt: opened.expiresAt, fingerprint };
      } else {
        // The same trip kept earlier in this browser (a reload, a new tab, a
        // regenerate): that plan is brought up to date rather than kept twice.
        const known = readKeptPlans().find((e) => e.key && sameTrip(e, plan));
        if (known) current = { token: known.token, key: known.key, expiresAt: known.expiresAt, fingerprint: "" };
      }
      if (current) setLink(planId, current);
    }
    if (!current) {
      void keepNew(planId, plan, fingerprint);
      return;
    }
    if (current.fingerprint === fingerprint) return;
    if (!current.key) {
      // Someone else's plan, changed here: it becomes this planner's own copy.
      setLink(planId, null);
      void keepNew(planId, plan, fingerprint);
      return;
    }
    pendingRef.current = { planId, link: current, plan, fingerprint };
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void sendPending(), CHANGE_DELAY_MS);
  }, [enabled, planId, plan, keepNew, sendPending]);

  // A change still waiting when the planner goes is sent on the way out.
  useEffect(() => {
    const flush = () => {
      const pending = pendingRef.current;
      clearTimeout(timerRef.current);
      if (!pending?.link.key) return;
      pendingRef.current = null;
      // keepalive outlives the page (up to 64 KB of body).
      void fetch(`/api/plans/${pending.link.token}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-plan-key": pending.link.key },
        body: JSON.stringify({ plan: pending.plan }),
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return { kept, adoptOpened };
}
