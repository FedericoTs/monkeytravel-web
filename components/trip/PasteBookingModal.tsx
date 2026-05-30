"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import BaseModal from "@/components/ui/BaseModal";
import { useToast } from "@/components/ui/Toast";
import type { ParsedBooking } from "@/lib/email-parse/extract";

/**
 * Minimum email body length we'll bother sending to Gemini. Anything
 * shorter is almost certainly noise (a copied subject line, a stray
 * paste). The /api/trips/[id]/parse-confirmation route enforces this
 * server-side too — this is purely UX, surfaces a friendly inline
 * message instead of round-tripping for a 400.
 */
const MIN_BODY_LENGTH = 40;

/**
 * Editable shape backing the preview form.
 *
 * The canonical `ParsedBooking` from the server carries `startAt` /
 * `endAt` as ISO 8601 strings, but the user-facing form has separate
 * date + time inputs (and HTML date/time inputs need YYYY-MM-DD and
 * HH:MM respectively). We split on incoming `{parsed}` from the API
 * via `toDraft()` and recombine via `toParsed()` before POSTing to
 * /api/trips/[id]/activities/from-booking.
 *
 * Wire history: an earlier draft of this modal used a snake_case
 * `ParsedBookingPreview` type (`type`, `date`, `start_time`,
 * `confirmation_number`, etc.) and keyed off `data.booking` — both of
 * which mismatched the server. That meant every successful Gemini
 * parse fell into the "no booking found" branch. Keep this shape in
 * lockstep with `ParsedBooking` going forward.
 */
interface DraftBooking {
  kind: ParsedBooking["kind"];
  name: string;
  address: string;
  city: string;
  country: string;
  startDate: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endDate: string;
  endTime: string;
  confirmationNumber: string;
  raw_excerpt: string;
}

/**
 * Pull YYYY-MM-DD + HH:MM out of an ISO 8601 string. The server emits
 * `2026-05-27T14:00:00` (or with a `+02:00` offset). We deliberately
 * read the string parts rather than going through `new Date()` so we
 * don't lose the local-time intent to UTC conversion — the email said
 * "Check-in 14:00" and that's what the user should see in the form.
 */
function splitIso(iso: string): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (m) return { date: m[1], time: m[2] };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function toDraft(parsed: ParsedBooking): DraftBooking {
  const start = splitIso(parsed.startAt);
  const end = parsed.endAt ? splitIso(parsed.endAt) : { date: "", time: "" };
  return {
    kind: parsed.kind,
    name: parsed.name || "",
    address: parsed.address || "",
    city: parsed.city || "",
    country: parsed.country || "",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    confirmationNumber: parsed.confirmationNumber || "",
    raw_excerpt: parsed.raw_excerpt || "",
  };
}

/**
 * Rebuild a canonical ParsedBooking for the from-booking endpoint.
 * - When time is blank we fall back to 09:00 (start) / 11:00 (end) —
 *   same defaults the route uses when extracting time-of-day from a
 *   timeless ISO.
 * - Omits optional fields when the user emptied them so the server
 *   sees `undefined` rather than empty strings (matches the schema's
 *   "absent" contract).
 */
function toParsed(draft: DraftBooking): ParsedBooking {
  const startAt = draft.startDate
    ? `${draft.startDate}T${draft.startTime || "09:00"}:00`
    : "";
  const endAt = draft.endDate
    ? `${draft.endDate}T${draft.endTime || "11:00"}:00`
    : undefined;
  const result: ParsedBooking = {
    kind: draft.kind,
    name: draft.name.trim(),
    startAt,
    raw_excerpt: draft.raw_excerpt,
  };
  if (draft.address.trim()) result.address = draft.address.trim();
  if (draft.city.trim()) result.city = draft.city.trim();
  if (draft.country.trim()) result.country = draft.country.trim();
  if (endAt) result.endAt = endAt;
  if (draft.confirmationNumber.trim()) {
    result.confirmationNumber = draft.confirmationNumber.trim();
  }
  return result;
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
  const [preview, setPreview] = useState<DraftBooking | null>(null);

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

      // Server returns either { parsed: ParsedBooking } on success or
      // { error: 'too_short' | 'no_booking_found' | 'parse_failed' } as
      // 200 with an error tag (see parse-confirmation route header).
      const data = (await res.json()) as
        | { parsed?: ParsedBooking; error?: string }
        | null;

      if (!data) {
        setErrorMessage(t("errorParseFailed"));
        return;
      }
      if (typeof data.error === "string") {
        // Map the typed errors back to user-facing messages.
        if (data.error === "no_booking_found") {
          setErrorMessage(t("errorNoBooking"));
        } else if (data.error === "too_short") {
          setErrorMessage(t("errorTooShort"));
        } else {
          setErrorMessage(t("errorParseFailed"));
        }
        return;
      }
      if (!data.parsed || typeof data.parsed !== "object") {
        setErrorMessage(t("errorNoBooking"));
        return;
      }

      setPreview(toDraft(data.parsed));
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
    <K extends keyof DraftBooking>(key: K, value: DraftBooking[K]) => {
      setPreview((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    []
  );

  const handleConfirm = useCallback(async () => {
    if (!preview) return;
    setErrorMessage(null);
    setIsConfirming(true);
    try {
      // Server expects { parsed, day_id?, day_number?, time_slot? } —
      // matches the `parsed` key used by the parse-confirmation response.
      const res = await fetch(`/api/trips/${tripId}/activities/from-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsed: toParsed(preview) }),
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
              value={preview.name}
              onChange={(v) => updatePreviewField("name", v)}
              disabled={isConfirming}
            />
            <FieldRow
              label={t("fieldLocation")}
              value={preview.city}
              onChange={(v) => updatePreviewField("city", v)}
              disabled={isConfirming}
            />
            <FieldRow
              label={t("fieldAddress")}
              value={preview.address}
              onChange={(v) => updatePreviewField("address", v)}
              disabled={isConfirming}
            />

            <div className="grid grid-cols-2 gap-3">
              <FieldRow
                label={t("fieldDate")}
                value={preview.startDate}
                onChange={(v) => updatePreviewField("startDate", v)}
                disabled={isConfirming}
                placeholder="YYYY-MM-DD"
              />
              <FieldRow
                label={t("fieldStartTime")}
                value={preview.startTime}
                onChange={(v) => updatePreviewField("startTime", v)}
                disabled={isConfirming}
                placeholder="HH:MM"
              />
            </div>

            <FieldRow
              label={t("fieldConfirmation")}
              value={preview.confirmationNumber}
              onChange={(v) => updatePreviewField("confirmationNumber", v)}
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
