"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import type { KeptPlan } from "@/lib/plans/kept-plan";
import {
  entryFor,
  forgetKeptPlan,
  keptPlansServerSnapshot,
  keptPlansSnapshot,
  keptTokenFromHash,
  openKeptPlan,
  rememberKeptPlan,
  subscribeKeptPlans,
} from "@/lib/plans/kept-plans-client";
import { capture } from "@/lib/posthog/events";
import { createClient } from "@/lib/supabase/client";
import { applyKeptPlan, type DraftTargets, type KeptPlanTargets } from "@/lib/wizard/apply-draft";
import { isItinerarySaved } from "@/lib/wizard/draft-saved-check";

type Current = Parameters<typeof applyKeptPlan>[2];

/**
 * Opening a kept plan (lib/plans/kept-plan.ts) from step 1's list of the plans
 * this browser kept, or from the plan's link: it fills the wizard and keeps
 * its own link. Signed in, a plan already among the planner's trips leads to
 * them instead of a second save; an expired one is said so and forgotten.
 */
export function useKeptPlanOpening({
  isAuthenticated,
  authUser,
  router,
  adoptOpenedPlan,
  setShowDraftRecovery,
  draftTargets,
  setDestinationCoords,
  setMultiCityMode,
  pace,
  selectedVibes,
  budgetTier,
  tripIntent,
}: {
  isAuthenticated: boolean | null;
  authUser: User | null;
  router: { push: (href: string) => void };
  /** The opened plan keeps its own link (hooks/useKeptPlan.ts). */
  adoptOpenedPlan: (token: string, opened: KeptPlan, expiresAt: string) => void;
  setShowDraftRecovery: (show: boolean) => void;
  /** Where an opened plan goes (lib/wizard/apply-draft.ts). */
  draftTargets: DraftTargets;
  setDestinationCoords: KeptPlanTargets["setDestinationCoords"];
  setMultiCityMode: KeptPlanTargets["setMultiCityMode"];
  /** The answers on screen, kept where the plan has none. */
  pace: Current["pace"];
  selectedVibes: Current["vibes"];
  budgetTier: Current["budgetTier"];
  tripIntent: Current["tripIntent"];
}) {
  const keptPlans = useSyncExternalStore(subscribeKeptPlans, keptPlansSnapshot, keptPlansServerSnapshot);
  const [openingKeptPlan, setOpeningKeptPlan] = useState<string | null>(null);
  const [keptPlanGone, setKeptPlanGone] = useState(false);

  const handleOpenKeptPlan = async (token: string, source: "link" | "list") => {
    setOpeningKeptPlan(token);
    const opened = await openKeptPlan(token);
    setOpeningKeptPlan(null);
    if (opened === "gone") {
      forgetKeptPlan(token);
      setKeptPlanGone(true);
      return;
    }
    if (!opened) return;
    const { plan, expiresAt } = opened;
    // Signed in, the planner saves what it shows: a plan already among their
    // trips is not saved twice.
    if (isAuthenticated && authUser && (await isItinerarySaved(createClient(), authUser.id, plan.itinerary))) {
      router.push("/trips");
      return;
    }
    rememberKeptPlan(entryFor(token, plan, expiresAt));
    adoptOpenedPlan(token, plan, expiresAt);
    setKeptPlanGone(false);
    setShowDraftRecovery(false);
    applyKeptPlan(
      plan,
      { ...draftTargets, setDestinationCoords, setMultiCityMode },
      { pace, vibes: selectedVibes, budgetTier, tripIntent }
    );
    void capture("kept_plan_opened", { source });
  };

  // A plan's link (#plan=<token>), on arrival or pasted into this tab: taken off
  // the address bar at once, before analytics start, then opened once sign-in
  // state is known.
  const linkedPlanRef = useRef<string | null>(null);
  const [linkedPlanCount, setLinkedPlanCount] = useState(0);
  useEffect(() => {
    const take = () => {
      const token = keptTokenFromHash(window.location.hash);
      if (!token) return false;
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      linkedPlanRef.current = token;
      return true;
    };
    take();
    const onHashChange = () => {
      if (take()) setLinkedPlanCount((n) => n + 1);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  useEffect(() => {
    const token = linkedPlanRef.current;
    if (!token || isAuthenticated === null) return;
    linkedPlanRef.current = null;
    void handleOpenKeptPlan(token, "link");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, linkedPlanCount]);

  return { keptPlans, openingKeptPlan, keptPlanGone, handleOpenKeptPlan };
}
