"use client";

/**
 * PaymentLinkButtons — renders 0-3 "Pay via {provider}" deeplink
 * buttons for a single settle-up transfer (one payer → one recipient
 * → one amount/currency).
 *
 * Used by SettleUpView's transfer list. Embedded as a standalone
 * component so it can be reused if we later surface "pay this person"
 * actions from other places (e.g. an inline expense detail card).
 *
 * Behaviour:
 *   - For each provider where the recipient has a stored handle, render
 *     a button. Hide entirely if no handle exists for that provider OR
 *     if the deeplink builder returns null (malformed handle).
 *   - If the recipient has NO handles set at all, render a single
 *     "empty state" hint asking the payer to ping them about adding
 *     handles in Settings.
 *   - Each button uses ExternalLinkButton so taps work inside the
 *     Capacitor iOS WKWebView (target="_blank" alone is swallowed there).
 *   - Each click fires the `settle_transfer_link_click` PostHog event
 *     with structured { provider, amount, currency, trip_id } props for
 *     revenue / conversion tracking. The ExternalLinkButton itself does
 *     the capture before opening — we just plumb the props through.
 *
 * NO backend integration. We never see the money — these links open
 * the payer's PayPal / Venmo / Wise app (or web fallback) where they
 * complete the transfer manually.
 *
 * Recipient handle source: ALL fields are optional on the recipient
 * profile. The SettleUpView is responsible for fetching them (usually
 * via the same /api/trips/[id]/members call it already makes for
 * balance computation). We accept them as plain props so this component
 * stays pure and easy to test.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import ExternalLinkButton from "@/components/tools/ExternalLinkButton";
import {
  buildPayPalLink,
  buildVenmoLink,
  buildWiseLink,
  PAYMENT_PROVIDERS,
  type PaymentProvider,
} from "@/lib/payments/handle-links";

export interface RecipientPaymentHandles {
  paypal_handle?: string | null;
  venmo_handle?: string | null;
  wise_handle?: string | null;
}

interface PaymentLinkButtonsProps {
  /** Recipient — the user who will receive the money. */
  recipient: RecipientPaymentHandles & {
    /** Optional display name, used only for the empty-state copy. */
    display_name?: string | null;
  };
  /** Amount in the major unit of the currency (e.g. 42.5 for €42.50). */
  amount: number;
  /** ISO-4217 alpha code, uppercased. */
  currency: string;
  /**
   * Free-form note attached to the transfer. Most providers show it to
   * both parties — we pass the trip name so the recipient sees
   * "Paris weekend" when the payment lands.
   */
  tripName?: string | null;
  /** Trip id for PostHog event attribution. */
  tripId: string;
  /** Optional layout override; defaults to a wrapping flex row. */
  className?: string;
}

interface ResolvedButton {
  provider: PaymentProvider;
  href: string;
  label: string;
}

export default function PaymentLinkButtons({
  recipient,
  amount,
  currency,
  tripName,
  tripId,
  className,
}: PaymentLinkButtonsProps) {
  const t = useTranslations("expenses.payments");

  // Resolve once per render. Each provider gets a row only if its
  // handle is set AND the deeplink builder accepts it.
  const buttons = useMemo<ResolvedButton[]>(() => {
    const out: ResolvedButton[] = [];
    const note = tripName?.trim() || null;

    if (recipient.paypal_handle) {
      const href = buildPayPalLink(
        recipient.paypal_handle,
        amount,
        currency,
      );
      if (href) {
        out.push({ provider: "paypal", href, label: t("payVia.paypal") });
      }
    }

    if (recipient.venmo_handle) {
      const href = buildVenmoLink(
        recipient.venmo_handle,
        amount,
        note,
      );
      if (href) {
        out.push({ provider: "venmo", href, label: t("payVia.venmo") });
      }
    }

    if (recipient.wise_handle) {
      const href = buildWiseLink(
        recipient.wise_handle,
        amount,
        currency,
        note,
      );
      if (href) {
        out.push({ provider: "wise", href, label: t("payVia.wise") });
      }
    }

    return out;
  }, [
    recipient.paypal_handle,
    recipient.venmo_handle,
    recipient.wise_handle,
    amount,
    currency,
    tripName,
    t,
  ]);

  // Empty state — recipient has no handles set anywhere.
  const noHandlesAtAll = PAYMENT_PROVIDERS.every(
    (p) => !recipient[`${p}_handle` as keyof RecipientPaymentHandles],
  );
  if (noHandlesAtAll) {
    return (
      <p className="text-xs text-slate-500 italic">
        {t("recipientHasNoHandles")}
      </p>
    );
  }

  // All handles present but ALL malformed → render empty too (the
  // user should fix their handle, but the payer can't do anything).
  if (buttons.length === 0) {
    return (
      <p className="text-xs text-slate-500 italic">
        {t("recipientHandlesInvalid")}
      </p>
    );
  }

  return (
    <div
      className={
        className ??
        "flex flex-wrap items-center gap-2"
      }
    >
      {buttons.map(({ provider, href, label }) => (
        <ExternalLinkButton
          key={provider}
          href={href}
          // Conservative rel for outbound: noopener noreferrer is the
          // default in ExternalLinkButton — we omit the prop so it
          // applies the default. No "sponsored" needed; we're not in
          // an affiliate flow.
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm font-medium text-slate-700 transition-colors"
          captureEvent="settle_transfer_link_click"
          captureProps={{
            provider,
            amount,
            currency,
            trip_id: tripId,
          }}
          ariaLabel={label}
        >
          {label}
        </ExternalLinkButton>
      ))}
    </div>
  );
}
