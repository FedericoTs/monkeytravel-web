"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import BaseModal from "@/components/ui/BaseModal";
import { useToast } from "@/components/ui/Toast";

/**
 * Minimum email body length we'll bother sending to Gemini. Anything
 * shorter is almost certainly noise (a copied subject line, a stray
 * paste). The /api/trips/[id]/parse-confirmation route enforces this
 * server-side too — this is purely UX, surfaces a friendly inline
 * message instead of round-tripping for a 400.
 */
const MIN_BODY_LENGTH = 40;

/**
 * Shape we expect back from /api/trips/[id]/parse-confirmation. Kept
 * intentionally loose — the route is the source of truth and may
 * evolve (e.g. add confidence scores) without forcing every consumer
 * to rev. Fields we render fall back to "—" when missing so a partial
 * parse doesn't blow up the preview card.
 */
interface ParsedBookingPreview {
  type?: "flight" | "hotel" | "activity" | "transport" | "restaurant" | string;
  name?: string;
  description?: string;
  location?: string;
  address?: string;
  start_time?: string; // "HH:MM"
  date?: string; // "YYYY-MM-DD"
  duration_minutes?: number;
  confirmation_number?: string;
  booking_url?: string;
  estimated_cost?: {
    amount?: number;
    currency?: string;
  };
}

interface PasteBookingModalProps {
  /** The trip we're attaching the parsed booking to. */
  tripId: string;
  /** Whether the modal is open. Owned by the parent. */
  isOpen: boolean;
  /** Close handler. The modal calls this on cancel, success, and Esc. */
  onClose: () => void;
  /** Called after a successful add — parent can refetch the itinerary. */
  onBookingAdded?: () => void;
}

/**
 * "Add from email" — paste a booking confirmation, let Gemini extract
 * the structured fields, preview + edit, then commit.
 *
 * Two-step flow inside one modal:
 *   1. PASTE: textarea + Parse button. POST to
 *      /api/trips/[id]/parse-confirmation with { emailBody }.
 *   2. PREVIEW: editable form prefilled with the parsed fields. On
 *      Confirm we POST to /api/trips/[id]/activities/from-booking and
 *      close.
 *
 * Gating: NEXT_PUBLIC_EMAIL_PARSE_ENABLED. Same dead-code-elimination
 * pattern as DownloadIcsButton — flag flipped at the env layer means
 * zero bytes shipped when off.
 *
 * Accessibility: built on BaseModal (a11y-hardened in cycle-7 #192 —
 * has role="dialog", aria-modal, focus trap, Esc handler). We pass
 * `title` so the dialog gets an aria-labelledby out of the box.
 */
export default function PasteBookingModal({
  tripId,
  isOpen,
  onClose,
  onBookingAdded,
}: PasteBookingModalProps) {
  // Flag check first — keep the early return BEFORE any hooks that
  // would only matter when the modal is renderable. We still call the
  // useTranslations / useToast / useState hooks below in a consistent
  // order across renders, but skipping the whole component when the
  // flag is off keeps the action bar tidy and the bundle smaller.
  if (process.env.NEXT_PUBLIC_EMAIL_PARSE_ENABLED !== "true") {
    return null;
  }

  return (
    <PasteBookingModalInner
      tripId={tripId}
      isOpen={isOpen}
      onClose={onClose}
      onBookingAdded={onBookingAdded}
    />
  );
}

function PasteBookingModalInner({
  tripId,
  isOpen,
  onClose,
  onBookingAdded,
}: PasteBookingModalProps) {
  const t = useTranslations("common.addFromEmail");
  const tButtons = useTranslations("common.buttons");
  const { addToast } = useToast();

  const [emailBody, setEmailBody] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedBookingPreview | null>(null);

  // Full reset — invoked on close and after a successful add so that
  // reopening the modal doesn't show stale state.
  const resetState = useCallback(() => {
    setEmailBody("");
    setIsParsing(false);
    setIsConfirming(false);
    setErrorMessage(null);
    setPreview(null);
  }, []);

  const handleClose = useCallback(() => {
    // Don't allow closing mid-flight — disableBackdropClick on
    // BaseModal handles the click case; this guards the explicit
    // close path (close button, programmatic).
    if (isParsing || isConfirming) return;
    resetState();
    onClose();
  }, [isParsing, isConfirming, onClose, resetState]);

  const handleParse = useCallback(async () => {
    setErrorMessage(null);
    if (emailBody.trim().length < MIN_BODY_LENGTH) {
      setErrorMessage(t("errorTooShort"));
      return;
    }

    setIsParsing(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/parse-confirmation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailBody }),
      });

      if (!res.ok) {
        // Surface a generic friendly error — server-side reasons
        // (rate limit, parse failure, no booking detected) all map to
        // the same UI message. We can branch later if Gemini gives us
        // distinct enough signals to act on.
        setErrorMessage(t("errorParseFailed"));
        return;
      }

      const data = (await res.json()) as { booking?: ParsedBookingPreview };
      if (!data.booking || typeof data.booking !== "object") {
        setErrorMessage(t("errorNoBooking"));
        return;
      }

      setPreview(data.booking);
    } catch (err) {
      console.error("[PasteBookingModal] Parse failed:", err);
      setErrorMessage(t("errorParseFailed"));
    } finally {
      setIsParsing(false);
    }
  }, [emailBody, t, tripId]);

  // Lift any field of the preview (the user is allowed to correct
  // Gemini's extraction before confirming).
  const updatePreviewField = useCallback(
    <K extends keyof ParsedBookingPreview>(key: K, value: ParsedBookingPreview[K]) => {
      setPreview((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    []
  );

  const handleConfirm = useCallback(async () => {
    if (!preview) return;
    setErrorMessage(null);
    setIsConfirming(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/activities/from-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking: preview }),
      });

      if (!res.ok) {
        setErrorMessage(t("errorParseFailed"));
        setIsConfirming(false);
        return;
      }

      addToast(t("toastAdded"), "success");
      onBookingAdded?.();
      resetState();
      onClose();
    } catch (err) {
      console.error("[PasteBookingModal] Confirm failed:", err);
      setErrorMessage(t("errorParseFailed"));
      setIsConfirming(false);
    }
  }, [preview, tripId, addToast, t, onBookingAdded, onClose, resetState]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("modalTitle")}
      maxWidth="max-w-lg"
      usePortal
      closeOnEscape={!isParsing && !isConfirming}
      closeOnBackdrop={!isParsing && !isConfirming}
      disableBackdropClick={isParsing || isConfirming}
    >
      {/* Step 1: paste form. Visible until we have a preview. */}
      {!preview && (
        <div className="space-y-4">
          <textarea
            value={emailBody}
            onChange={(e) => {
              setEmailBody(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder={t("placeholder")}
            rows={10}
            disabled={isParsing}
            className="w-full rounded-lg border border-slate-200 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 focus:outline-none disabled:opacity-60 disabled:bg-slate-50"
            aria-label={t("modalTitle")}
          />

          {errorMessage && (
            <p
              role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
            >
              {errorMessage}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isParsing}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleParse}
              disabled={isParsing || emailBody.trim().length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isParsing ? (
                <>
                  <svg
                    className="w-4 h-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {t("parsing")}
                </>
              ) : (
                t("parseAction")
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: editable preview. Renders once we get a booking back. */}
      {preview && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("preview")}
            </p>

            <FieldRow
              label={t("fieldName")}
              value={preview.name ?? ""}
              onChange={(v) => updatePreviewField("name", v)}
              disabled={isConfirming}
            />
            <FieldRow
              label={t("fieldLocation")}
              value={preview.location ?? ""}
              onChange={(v) => updatePreviewField("location", v)}
              disabled={isConfirming}
            />
            <FieldRow
              label={t("fieldAddress")}
              value={preview.address ?? ""}
              onChange={(v) => updatePreviewField("address", v)}
              disabled={isConfirming}
            />

            <div className="grid grid-cols-2 gap-3">
              <FieldRow
                label={t("fieldDate")}
                value={preview.date ?? ""}
                onChange={(v) => updatePreviewField("date", v)}
                disabled={isConfirming}
                placeholder="YYYY-MM-DD"
              />
              <FieldRow
                label={t("fieldStartTime")}
                value={preview.start_time ?? ""}
                onChange={(v) => updatePreviewField("start_time", v)}
                disabled={isConfirming}
                placeholder="HH:MM"
              />
            </div>

            <FieldRow
              label={t("fieldConfirmation")}
              value={preview.confirmation_number ?? ""}
              onChange={(v) => updatePreviewField("confirmation_number", v)}
              disabled={isConfirming}
            />
          </div>

          {errorMessage && (
            <p
              role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
            >
              {errorMessage}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                // Back to step 1 — keep the pasted body around so the
                // user doesn't have to re-paste if the parse was off.
                setPreview(null);
                setErrorMessage(null);
              }}
              disabled={isConfirming}
              className="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              {tButtons("back")}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isConfirming}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isConfirming}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {isConfirming ? (
                  <>
                    <svg
                      className="w-4 h-4 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    {t("confirming")}
                  </>
                ) : (
                  t("confirm")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </BaseModal>
  );
}

/**
 * Tiny inline labeled-input. Kept local — these fields only exist in
 * this modal and only ever render strings, so the abstraction in
 * components/forms/ would be overkill.
 */
function FieldRow({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600 mb-1 block">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 focus:outline-none disabled:opacity-60 disabled:bg-slate-50"
      />
    </label>
  );
}
