"use client";

import { useCallback, useEffect, useRef } from "react";
import { isNativePlatform } from "@/lib/native/platform";
import { capture, captureResultExitUnsaved } from "@/lib/posthog/events";
import { safeGet, safeSet } from "@/lib/safe-storage";

/**
 * While a generated plan is on screen and not saved: the save nudges are
 * counted once per session (the pill, the session tray), leaving the page asks
 * first, and leaving is recorded once as result_exit_unsaved, with whether the
 * assistant changed the plan (`noteEditApplied`).
 */
export function useUnsavedPlan({
  hasResult,
  isUnsaved,
  sessionTrayVisible,
  showAuthModal,
  getGenCount,
}: {
  hasResult: boolean;
  /** Neither save arm has stored the trip. */
  isUnsaved: boolean;
  sessionTrayVisible: boolean;
  /** The account dialog is open: its Google sign-in leaves the page and must not be asked about. */
  showAuthModal: boolean;
  getGenCount: () => number;
}) {
  // Has the user applied ≥1 anon-assistant edit? Mirrored to
  // sessionStorage ("mt_edits_applied") so the flag survives the post-auth
  // full-page round trip; the ref is the fast path + private-mode fallback.
  const editsAppliedRef = useRef<boolean>(false);
  // Once-per-pagehide-sequence guard for result_exit_unsaved (reset on
  // pageshow when the page comes back out of the bfcache).
  const resultExitFiredRef = useRef<boolean>(false);

  // save_nudge_shown for the "Not saved" pill — once per session
  // (sessionStorage once-flag; desktop + mobile pills share this one effect).
  useEffect(() => {
    if (!hasResult || !isUnsaved) return;
    if (safeGet("mt_save_nudge_pill_captured", "session") === "1") return;
    // A blocked store cannot dedupe, and safeSet reports that instead of
    // throwing. Skip rather than spam this once-per-session event on every
    // remount.
    if (!safeSet("mt_save_nudge_pill_captured", "1", "session")) return;
    void capture("save_nudge_shown", {
      source: "unsaved_pill",
      gen_count: getGenCount(),
    });
  }, [hasResult, isUnsaved, getGenCount]);

  // save_nudge_shown for the session tray — once per session.
  useEffect(() => {
    if (!sessionTrayVisible) return;
    if (safeGet("mt_save_nudge_tray_captured", "session") === "1") return;
    // Same as the pill above: no store means no dedupe, so stay quiet.
    if (!safeSet("mt_save_nudge_tray_captured", "1", "session")) return;
    void capture("save_nudge_shown", {
      source: "session_tray",
      gen_count: getGenCount(),
    });
  }, [sessionTrayVisible, getGenCount]);

  // Native leave-guard, separate from the wizard's abandonment analytics.
  // While an UNSAVED result is on screen, tab-close/back/external nav
  // triggers the browser's native "leave site?" dialog. Disarmed when saved
  // (either arm), while the auth modal is open (the Google OAuth full-page
  // redirect starts from inside it and must not be interrupted), and inside
  // the Capacitor shell (beforeunload dialogs are broken in WebViews). SPA
  // navigations never fire beforeunload, so in-app moves are unaffected.
  useEffect(() => {
    if (!hasResult || !isUnsaved || showAuthModal) return;
    if (isNativePlatform()) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasResult, isUnsaved, showAuthModal]);

  // Exit telemetry. pagehide with an unsaved result → nav-safe
  // result_exit_unsaved (sync SDK queue + sendBeacon flush — the same
  // mechanism as captureSaveBlockedAnon). At most once per pagehide sequence
  // (ref guard, reset when the page returns from the bfcache) and never
  // after save: the effect tears down as soon as isUnsaved flips false.
  useEffect(() => {
    if (!hasResult || !isUnsaved) return;
    const onPageHide = () => {
      if (resultExitFiredRef.current) return;
      resultExitFiredRef.current = true;
      let editsApplied = editsAppliedRef.current;
      if (!editsApplied) {
        // safeGet reports a blocked store as null rather than throwing, and
        // null is the same answer the ref already gave us.
        editsApplied = safeGet("mt_edits_applied", "session") === "1";
      }
      captureResultExitUnsaved({
        gen_count: getGenCount(),
        edits_applied: editsApplied,
      });
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) resultExitFiredRef.current = false;
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [hasResult, isUnsaved, getGenCount]);

  // Best-effort mirror for the post-auth round trip. When storage is
  // blocked safeSet just returns false; the ref covers this page's life.
  const noteEditApplied = useCallback(() => {
    editsAppliedRef.current = true;
    safeSet("mt_edits_applied", "1", "session");
  }, []);

  return { noteEditApplied };
}
