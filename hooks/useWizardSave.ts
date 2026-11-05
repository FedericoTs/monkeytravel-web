"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { trackWizardEvent } from "@/components/wizard/wizardEvents";
import { useAutoSaveTrip, type AutoSaveSkipReason } from "@/hooks/useAutoSaveTrip";
import { tripSpanDays } from "@/lib/dates/iso-date";
import { useRouter } from "@/lib/i18n/routing";
import { sentryException } from "@/lib/observability/sentry";
import { usePostHog } from "@/lib/posthog";
import {
  type AuthPromptLocation,
  captureAutoSaveSkipped,
  captureSaveBlockedAnon,
  captureSaveFailed,
  captureTripUpdated,
} from "@/lib/posthog/events";
import { safeSet } from "@/lib/safe-storage";
import { shouldRedeemSaveIntent } from "@/lib/trips/autoSaveGate";
import type { TripFormState } from "@/lib/trips/persistTrip";
import { newWizardMountId, wizardTripWrites } from "@/lib/trips/wizard-trip-writes";
import { tripFormState, type WizardAnswers } from "@/lib/wizard/answers";
import { funnelDays, funnelTraits } from "@/lib/wizard/plan-funnel";
import { saveErrorClass } from "@/lib/wizard/save-failure";
import { reportTripSaved } from "@/lib/wizard/trip-saved";
import type { GeneratedItinerary } from "@/types";

/**
 * Saving the wizard's plan, by either arm: the auto-save, whose state machine is
 * hooks/useAutoSaveTrip.ts, and the Save button, which for a signed-out planner
 * is the account wall. Always on, unless NEXT_PUBLIC_AUTO_SAVE_FORCE=off
 * (lib/trips/autoSaveGate.ts); then the redemption effect below owns the
 * post-auth save instead.
 */
export function useWizardSave({
  autoSaveEnabled,
  generatedItinerary,
  answers,
  derivedInterests,
  savedTripId,
  setSavedTripId,
  deferAutoSave,
  adoptedTripId,
  planHeldBy = null,
  awaitingTwinChoice,
  replaceTripId,
  draftAutoRestored,
  clearDraft,
  openKeepAuth,
  setLoading,
  setError,
}: {
  autoSaveEnabled: boolean;
  generatedItinerary: GeneratedItinerary | null;
  answers: WizardAnswers;
  derivedInterests: string[];
  /** Id of the trip once either arm has stored it (or a claimed trip is adopted). */
  savedTripId: string | null;
  setSavedTripId: (id: string | null) => void;
  /** A shared plan's claim has not reported yet (hooks/usePendingClaim.ts). */
  deferAutoSave: boolean;
  adoptedTripId: string | null;
  /** The trip the page before this one saved this plan to (hooks/useSameTripCheck.ts). */
  planHeldBy?: string | null;
  /** The same trip is already saved, and the planner has not chosen (hooks/useSameTripCheck.ts). */
  awaitingTwinChoice: boolean;
  replaceTripId: string | null;
  draftAutoRestored: boolean;
  clearDraft: () => void;
  /** The account wall, with the draft parked first. */
  openKeepAuth: (location: AuthPromptLocation) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string) => void;
}) {
  const locale = useLocale();
  const router = useRouter();
  const posthog = usePostHog();
  const { user: authUser, loading: authLoading } = useAuth();
  const isAuthenticated: boolean | null = authLoading ? null : !!authUser;
  const { destination, startDate, endDate, budgetTier, tripIntent, travelStyle, anchors } = answers;

  // Synchronous re-entry guard for handleSaveTrip. setLoading(true) is async
  // — between click and re-render, a second click can fire before the button
  // is visibly disabled, producing duplicate trip rows. A ref check is
  // synchronous and catches the race regardless of React render timing.
  const savingTripRef = useRef<boolean>(false);

  // One-shot guard for the post-auth save-intent redemption (see the
  // effect just below handleSaveTrip). After a magic-link return we auto-
  // complete the Save the user already clicked before signing up. At most once.
  const saveIntentRedeemedRef = useRef<boolean>(false);

  // Every answer is written to the trip. "Who's coming?" is among them so the
  // answer is queryable from the database (reading it from PostHog needs a
  // personal API key), which makes the toggle evidence for the group-vs-solo
  // decision. `locale` is the fallback for trip_meta.locale; the itinerary's
  // own language wins.
  const autoSaveFormState: TripFormState = tripFormState(answers, { derivedInterests, locale });

  // What this mount writes to the database (lib/trips/wizard-trip-writes.ts).
  const [tripWrites] = useState(() => wizardTripWrites(newWizardMountId()));

  // A trip just inserted, by either save. The report runs once per trip (a
  // login-return remount can insert the same row again); the rest every time.
  // savedTripId is set directly so the sticky bar and the post-save redirects
  // have it at once (the mirror effect below sets it too).
  const tripInserted = (tripId: string, durationDays: number, logLabel: string) => {
    reportTripSaved(
      { tripId, durationDays, destination, budgetTier, tripIntent, travelStyle, anchorCount: anchors.length, locale },
      logLabel
    );
    clearDraft();
    // A planner who just finished the wizard is not asked to complete a profile.
    safeSet("profile_modal_shown", "true", "session");
    setSavedTripId(tripId);
  };

  // A plain function, like the hook's other callbacks: a save starts with the
  // one from the latest render, so it is reported with the answers as they are
  // by then ("Who's coming?" is often answered after the place).
  const handlePersisted = (tripId: string, durationDays: number, mode: "insert" | "update") => {
    if (mode === "insert") {
      // Only on insert, so a regenerate is not another completion. No share
      // ask here: at insert time the user hasn't read the itinerary they'd be
      // asked to send. It lives on /trips/[id] behind an engagement gate; see
      // components/trip/SharePromptOnTrip.tsx.
      tripInserted(tripId, durationDays, "Auto-save");
      return;
    }
    // Don't re-fire referral/bananas on regen — only count the first save.
    // Just emit the distinct trip_updated event for funnel analysis.
    captureTripUpdated({
      trip_id: tripId,
      destination,
      duration_days: durationDays,
      budget_tier: budgetTier,
      is_from_template: false,
    });
  };

  // Where and who, on every funnel row about this plan (lib/wizard/plan-funnel.ts);
  // its PostHog mirrors take the traits without the locale. The length is
  // read when the row is sent.
  const planTraits = funnelTraits({ destination, tripIntent, travelStyle });
  const planFunnel = { ...planTraits, locale };
  const planDays = () => funnelDays(startDate, endDate);

  // A failed save, from either arm, leaves an event everywhere, so a lost trip
  // is never silent: Sentry is unconditional (no consent gate), the server row
  // is consent-free, PostHog is the sliceable mirror. Both arms bucket their
  // errors alike (lib/wizard/save-failure.ts), so dashboards chart them
  // together.
  const reportSaveFailure = (err: unknown, arm: "auto" | "manual", attempts?: number) => {
    const errMsg = err instanceof Error ? err.message : "";
    const errorClass = saveErrorClass(errMsg);
    sentryException(err, {
      tags: { feature: arm === "auto" ? "auto_save" : "manual_save", arm, error_class: errorClass },
      extra: { ...(attempts !== undefined ? { attempts } : {}), destination },
    });
    void trackWizardEvent("save_failed", planFunnel);
    captureSaveFailed({
      ...planTraits,
      error_class: errorClass,
      error_message: errMsg.slice(0, 80) || undefined,
      arm,
      ...(attempts !== undefined ? { attempts } : {}),
    });
  };
  // Auto-save also reports every skip, so a lost generation is never silent.
  const reportAutoSaveFailure = (err: Error, info: { attempts: number }) => {
    reportSaveFailure(err, "auto", info.attempts);
    console.error(`[auto-save] failed after ${info.attempts} attempt(s):`, err);
  };
  const reportAutoSaveSkipped = (reason: AutoSaveSkipReason) => {
    void captureAutoSaveSkipped({ reason, destination });
  };

  const autoSave = useAutoSaveTrip({
    itinerary: generatedItinerary,
    isAuthenticated,
    enabled: autoSaveEnabled,
    deferred: deferAutoSave || awaitingTwinChoice,
    deferredReason: deferAutoSave ? "pending_claim" : "pending_choice",
    adoptedTripId: adoptedTripId ?? planHeldBy,
    replaceTripId,
    formState: autoSaveFormState,
    saveTrip: tripWrites.saveTrip,
    updateTrip: tripWrites.updateTrip,
    deleteTrip: tripWrites.deleteTrip,
    attachCoverImage: tripWrites.attachCoverImage,
    onPersisted: handlePersisted,
    onError: reportAutoSaveFailure,
    onSkipped: reportAutoSaveSkipped,
  });

  // The save the page before this one couldn't report: it was reloading.
  useEffect(() => {
    if (planHeldBy) tripInserted(planHeldBy, tripSpanDays(startDate, endDate), "Auto-save");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planHeldBy]);

  // Mirror the auto-save trip id into the existing savedTripId state so the
  // Sticky Bottom Bar and the post-save redirects read it from one place.
  // setState is a no-op when values are equal.
  useEffect(() => {
    if (autoSave.savedTripId && autoSave.savedTripId !== savedTripId) {
      setSavedTripId(autoSave.savedTripId);
    }
    if (!autoSave.savedTripId && savedTripId && autoSaveEnabled) {
      // discarded
      setSavedTripId(null);
    }
  }, [autoSave.savedTripId, savedTripId, autoSaveEnabled, setSavedTripId]);

  // "Unsaved" respects BOTH save arms: the manual flow (savedTripId) and the
  // auto-save flow (autoSave.savedTripId).
  const isUnsaved = !savedTripId && !autoSave.savedTripId;
  // Signed in with auto-save on: the save is already under way, so the bars
  // keep their saved layout (the button reads "Saving…") rather than
  // flashing the unsaved one and collapsing a second later.
  const autoSaving =
    autoSaveEnabled && !deferAutoSave && !awaitingTwinChoice && isAuthenticated === true && autoSave.status !== "error";
  // Signed in, a shared plan's claim is its save while the request runs
  // (hooks/usePendingClaim.ts): Save shows it under way, and does not insert
  // a copy beside the trip the claim hands over.
  const claimingSharedPlan = isAuthenticated === true && deferAutoSave;

  // The wall's report, whichever way a signed-out planner reached it. Without
  // its terminal event a tap would emit save_clicked with no outcome, and the
  // funnel accounting (save_clicked minus saved/blocked/failed) reads that
  // silence as a React crash mid-save.
  const reportBlockedAnon = () => {
    void trackWizardEvent("save_blocked_anon", planFunnel);
    // PostHog mirror so the same funnel renders in the product analytics
    // dashboard alongside save_clicked → saved. Sync (nav-safe) since the auth
    // modal opens right after and an async capture loses the race.
    captureSaveBlockedAnon({ ...planTraits, modal_shown: true });
  };

  const handleKeepSharedTrip = () => {
    void trackWizardEvent("save_clicked", planFunnel);
    // Every call site of this handler is gated on isAuthenticated === false,
    // so a Keep tap here is the auth wall by definition.
    reportBlockedAnon();
    openKeepAuth("anon_share_keep");
  };

  const handleSaveTrip = async () => {
    if (!generatedItinerary) return;
    // No-op when the auto-save flow has already persisted the trip.
    // Defense in depth — the UI hides this button when autoSave.savedTripId
    // is set, but a child component (ValuePropositionBanner's onSave, the
    // assistant's save bridge) could still invoke it.
    if (autoSaveEnabled && autoSave.savedTripId) return;
    // While the replace-or-keep-both prompt is open, a save from here would
    // insert another copy behind it: take the planner to the prompt instead.
    if (awaitingTwinChoice) {
      const prompt = document.querySelector<HTMLElement>("[data-twin-trip-prompt]");
      prompt?.scrollIntoView({ behavior: "smooth", block: "center" });
      prompt?.querySelector("button")?.focus({ preventScroll: true });
      return;
    }
    // The shared plan's claim is saving it (claimingSharedPlan above).
    if (claimingSharedPlan) return;
    // Synchronous re-entry guard: setLoading(true) below is async, and a
    // user can click a second time in the gap before React re-renders the
    // disabled button. The ref check fires before any state update lands.
    if (savingTripRef.current) return;
    savingTripRef.current = true;

    // Supabase funnel mirror — fired on the user's Save tap regardless
    // of auth state. This captures the "peak intent" event before the
    // auth modal potentially intercepts.
    void trackWizardEvent("save_clicked", { ...planFunnel, duration_days: planDays() });

    setLoading(true);
    try {
      // Read auth from the central AuthProvider rather than firing another
      // getUser() round-trip. The subsequent supabase INSERT below still
      // goes through the per-request client (RLS will re-verify the session
      // on the wire).
      const user = authUser;

      if (!user) {
        // This is the auth wall; generating needs no account (up to the
        // anonymous cap). The user just saw their generated itinerary and
        // clicked Save — peak motivation, the right moment to ask for an
        // account. The draft logic (saveDraft + pendingTripGeneration flag)
        // persists the trip so it'll be restored after signup.
        reportBlockedAnon();
        openKeepAuth("wizard_save");
        return;
      }

      // The row the auto-save writes (lib/trips/persistTrip.ts), marked as this
      // arm's: one builder, so neither arm can drop a field the other stores.
      // The insert_trip_dedup RPC inside it makes a double save reuse the
      // first row. The cover follows once the row exists, as for auto-save.
      const { tripId: savedId } = await tripWrites.saveTripManually(
        { itinerary: generatedItinerary, formState: autoSaveFormState },
        user.id,
      );
      void tripWrites.attachCoverImage(savedId, autoSaveFormState.destination);
      tripInserted(savedId, tripSpanDays(startDate, endDate), "Trip Save");

      // Go straight to the trip. The share ask waits until the user has
      // actually looked at the itinerary, on the trip page itself
      // (components/trip/SharePromptOnTrip.tsx).
      router.push(`/trips/${savedId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trip");
      // The AUTHED save genuinely failed (INSERT errored, RLS rejected,
      // network died, etc), as distinct from save_blocked_anon above. If this
      // fires even once in a 2h watcher window we want to wake up — it means
      // a real user lost a real trip after a real save click.
      reportSaveFailure(err, "manual");
    } finally {
      setLoading(false);
      // Always clear the re-entry guard so a legitimate retry (e.g. after
      // a transient network error) is not permanently blocked.
      savingTripRef.current = false;
    }
  };

  // ── Redeem the pre-signup Save intent ─────────────────────────────────────
  // An anonymous user who clicks Save hits the auth wall, signs up via magic
  // link, and returns to /trips/new with the itinerary silently restored
  // (draftAutoRestored === true). With auto-save switched off nothing then
  // persists that trip, so this honours the Save click they already made by
  // invoking the same tested handleSaveTrip once.
  //
  // Safety / no double-save:
  //  - Runs only when auto-save is off (shouldRedeemSaveIntent), so it never
  //    races the auto-save hook.
  //  - draftAutoRestored is set only by the silent auto-restore of a signed-in
  //    user's draft (lib/wizard/draft-restore.ts), never by banner recovery or
  //    a normal authed generation. That restore also runs for a signed-in
  //    return that never clicked Save, and this saves those drafts too.
  //  - Idempotent: one-shot ref + savedTripId / autoSave.savedTripId checks;
  //    handleSaveTrip's own re-entry guard (savingTripRef) and the 60s server-
  //    side dedupe are the backstops against a duplicate row.
  useEffect(() => {
    if (saveIntentRedeemedRef.current) return;
    if (!isAuthenticated) return;
    if (!shouldRedeemSaveIntent(process.env.NEXT_PUBLIC_AUTO_SAVE_FORCE)) return;
    if (!draftAutoRestored || !generatedItinerary) return;
    if (savedTripId || autoSave.savedTripId) return; // already persisted
    if (savingTripRef.current) return; // a save is already in flight
    saveIntentRedeemedRef.current = true;
    // Observability: quantify how many activations this recovers. PostHog
    // (unlike trackWizardEvent) has no event-name enum, so this needs no
    // migration.
    posthog?.capture("save_intent_redeemed", planFunnel);
    void handleSaveTrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAuthenticated,
    draftAutoRestored,
    generatedItinerary,
    savedTripId,
    autoSave.savedTripId,
  ]);

  return { autoSave, isUnsaved, autoSaving, claimingSharedPlan, handleSaveTrip, handleKeepSharedTrip };
}
