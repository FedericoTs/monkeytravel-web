"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import BaseModal from "@/components/ui/BaseModal";
import {
  requestPushPermissionAndRegister,
  markSoftPromptGranted,
} from "@/lib/native/push";

/**
 * Soft prompt that primes the user for push notifications BEFORE
 * triggering the OS-level permission dialog. Booking/Airbnb pattern:
 *
 *   - iOS lets us show the OS prompt EXACTLY ONCE. If denied, the
 *     only way back is a Settings trip — which 95% of users never
 *     make. So a cold prompt costs us forever if the user says no.
 *   - Industry data: cold OS prompts get ~25% opt-in. Soft-prompt-
 *     first patterns get ~70%. The custom in-app sheet primes the
 *     user with value ("we'll only buzz you for trip stuff") so by
 *     the time they tap "Yes, notify me" they've already committed
 *     and won't decline the OS prompt that follows.
 *
 * Display gating (all client-side, no server roundtrip):
 *
 *   - Mounts inside TripsPageClient (post-first-trip-save is the
 *     ideal moment — user has demonstrated investment in the app's
 *     value before we ask for permission).
 *   - Renders nothing on web (isNativePlatform check via the push
 *     helper module's own gate).
 *   - Renders nothing if the user has already opted in OR explicitly
 *     dismissed (both flags in localStorage).
 *   - Renders nothing until at least one trip has been saved
 *     (localStorage `mt_has_saved_trip` flag — set by SaveTripModal
 *     on first success; not in this commit, see follow-up).
 *
 * The sheet has two buttons:
 *
 *   - "Yes, notify me" → fires the OS prompt via
 *     requestPushPermissionAndRegister(). On grant: marks
 *     soft-prompt + starts receiving pushes. On deny: marks
 *     dismissed so we don't ask again.
 *   - "Not now" → marks dismissed for 30 days. We CAN re-prompt
 *     after that on the assumption the user's relationship with
 *     the app has matured. Industry pattern: 1-3 re-prompts max
 *     across the user's lifetime; aggressive re-prompting reads
 *     as nag and tanks D7 retention.
 *
 * The dismissal flag uses a versioned key (`mt_push_dismissed_at`)
 * with a timestamp so the 30-day cooldown is computed off the
 * stored time, not a hardcoded TTL we'd have to refresh.
 */
const DISMISSED_KEY = "mt_push_dismissed_at";
const HAS_SAVED_TRIP_KEY = "mt_has_saved_trip";
const SOFT_PROMPT_GRANTED_KEY = "mt_push_soft_prompt_granted";

const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Should we show the sheet on this mount? Pure read from localStorage
 * — no async side effects. Returns false on web.
 */
function shouldShowPrompt(): boolean {
  if (!isNativePlatform()) return false;
  if (typeof localStorage === "undefined") return false;

  // Already opted in — never re-prompt.
  if (localStorage.getItem(SOFT_PROMPT_GRANTED_KEY) === "true") return false;

  // Hasn't saved a trip yet — the prime moment hasn't happened.
  if (localStorage.getItem(HAS_SAVED_TRIP_KEY) !== "true") return false;

  // Was dismissed recently — respect the cooldown.
  const dismissedAt = localStorage.getItem(DISMISSED_KEY);
  if (dismissedAt) {
    const elapsed = Date.now() - parseInt(dismissedAt, 10);
    if (Number.isFinite(elapsed) && elapsed < DISMISS_COOLDOWN_MS) return false;
  }

  return true;
}

/**
 * Mount once per session inside any authenticated client page.
 * Self-gates — if shouldShowPrompt() returns false, renders null and
 * costs nothing.
 */
export default function PushOptInSheet() {
  const t = useTranslations("push.optIn");
  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Delay the open by 1s so the user has a moment to land on the
    // page after the save-success redirect. Avoids feeling like a
    // pop-up trap right after a click.
    const t = setTimeout(() => {
      if (shouldShowPrompt()) setIsOpen(true);
    }, 1000);
    return () => clearTimeout(t);
  }, []);

  const handleAllow = async () => {
    setSubmitting(true);
    try {
      const granted = await requestPushPermissionAndRegister();
      if (granted) {
        // markSoftPromptGranted is called internally by
        // requestPushPermissionAndRegister on success; defensive
        // call here is redundant but documents intent.
        markSoftPromptGranted();
      } else {
        // User declined the OS prompt — mark dismissed indefinitely.
        // Even if our cooldown elapses, asking again would just
        // surface the same OS prompt which the user has now denied,
        // so any re-ask would silently no-op.
        localStorage.setItem(DISMISSED_KEY, String(Date.now()));
      }
    } finally {
      setSubmitting(false);
      setIsOpen(false);
    }
  };

  const handleDismiss = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    }
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleDismiss}
      ariaLabel={t("title")}
      maxWidth="max-w-sm"
      animation="slide"
      showCloseButton={false}
      closeOnBackdrop={false}
      closeOnEscape
    >
      <div className="flex flex-col items-center text-center">
        {/* Icon — bell with a small dot indicating notifications.
            Lucide icon is already in the bundle from other surfaces. */}
        <div className="w-16 h-16 rounded-full bg-[var(--primary)]/10 flex items-center justify-center mb-4">
          <Bell className="w-8 h-8 text-[var(--primary)]" aria-hidden="true" />
        </div>

        <h2 className="text-lg font-bold text-slate-900 mb-2">{t("title")}</h2>
        <p className="text-sm text-slate-600 mb-6 max-w-xs">{t("body")}</p>

        <div className="flex flex-col w-full gap-2">
          <button
            type="button"
            onClick={handleAllow}
            disabled={submitting}
            className="w-full bg-[var(--primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50"
          >
            {submitting ? t("allowing") : t("allow")}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={submitting}
            className="w-full text-slate-500 hover:text-slate-700 py-2 text-sm font-medium transition-colors"
          >
            {t("notNow")}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

/**
 * Helper exported for SaveTripModal to set the "has saved trip" flag
 * on first successful save. Idempotent. Keep this tiny + free-standing
 * so the SaveTripModal doesn't have to import the whole sheet just to
 * mark the flag.
 */
export function markFirstTripSaved(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(HAS_SAVED_TRIP_KEY, "true");
}
