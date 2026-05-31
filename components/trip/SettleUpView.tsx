"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ArrowRight, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import BaseModal from "@/components/ui/BaseModal";
import { useToast } from "@/components/ui/Toast";
import PaymentLinkButtons from "@/components/trip/PaymentLinkButtons";

/**
 * SettleUpView — Splitwise-style "who owes whom" recap modal.
 *
 * Renders the greedy minimum-transfer settlement set returned by
 * GET /api/trips/[id]/settlements (which calls the
 * compute_trip_settlements PL/pgSQL RPC, see 20260531_day10_expense_splits).
 *
 * Mobile-first: full-bleed BaseModal on small screens (max-w-md is the
 * BaseModal default; the inner list is single-column at every breakpoint
 * because shrinking a "Alice owes Bob X" line into two columns would
 * just make it harder to scan).
 *
 * Pay actions: for each transfer row we render <PaymentLinkButtons>,
 * which inspects the recipient's stored PayPal/Venmo/Wise handles (or
 * lack thereof) and emits the right deeplink set. Recipients with no
 * handles get an inline hint asking them to add one in Settings. The
 * older onPayClick override hook is preserved so callers that want to
 * route the payment through a custom flow (test harness, future
 * paywall, etc.) can still intercept — when provided, it WINS over the
 * deeplink buttons and renders a single "Pay" CTA.
 */

export interface SettlementTransfer {
  fromUser: { id: string; name: string };
  toUser: {
    id: string;
    name: string;
    // Optional payment handles — present when the API joined them from
    // public.users for this recipient. Absence = null = "no handle"
    // (the PaymentLinkButtons component hides the per-provider button).
    paypal_handle?: string | null;
    venmo_handle?: string | null;
    wise_handle?: string | null;
  };
  amount: number;
  currency: string;
}

interface SettleUpViewProps {
  tripId: string;
  /** Modal open state — owned by the parent. */
  isOpen: boolean;
  /** Close handler — owned by the parent. */
  onClose: () => void;
  /**
   * Optional payment handler hook. When provided, the per-transfer
   * "Pay" button calls this with the transfer descriptor — the sibling
   * agent's handle-link work plugs in here. When absent, we render a
   * disabled placeholder so the slot stays visible.
   */
  onPayClick?: (transfer: SettlementTransfer) => void;
}

export default function SettleUpView({
  tripId,
  isOpen,
  onClose,
  onPayClick,
}: SettleUpViewProps) {
  const t = useTranslations("common.expenses.settle");
  const locale = useLocale();
  const { addToast } = useToast();

  const [transfers, setTransfers] = useState<SettlementTransfer[]>([]);
  const [tripName, setTripName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Currency formatter — mirrors ExpenseLedger.formatMoney() so the
  // settle-up modal renders amounts identically to the source ledger.
  // Unknown ISO codes fall back to plain number + suffix rather than
  // throwing, so an obscure currency on a real trip doesn't blank the
  // entire row.
  const formatMoney = useCallback(
    (n: number, currency: string) => {
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
        }).format(n);
      } catch {
        return `${n.toFixed(2)} ${currency}`;
      }
    },
    [locale]
  );

  const loadSettlements = useCallback(
    async (signal?: AbortSignal) => {
      setLoadError(null);
      setLoading(true);
      try {
        const res = await fetch(`/api/trips/${tripId}/settlements`, { signal });
        if (!res.ok) {
          const message = `Server returned ${res.status}`;
          setLoadError(message);
          // Toast only on user-facing failures (4xx + 5xx). 401 shouldn't
          // surface here because the modal is gated behind the
          // ExpenseLedger which is itself auth-gated upstream.
          addToast(t("errorLoad"), "error");
          console.error("[SettleUpView] load failed", message);
          return;
        }
        const data = (await res.json()) as {
          transfers: SettlementTransfer[];
          tripName?: string | null;
        };
        setTransfers(data.transfers ?? []);
        setTripName(data.tripName ?? null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setLoadError(message);
        addToast(t("errorLoad"), "error");
        console.error("[SettleUpView] load failed", err);
      } finally {
        setLoading(false);
      }
    },
    [tripId, addToast, t]
  );

  // Re-fetch every time the modal opens — settlements drift as new
  // expenses are added in the ledger, so a stale read from a previous
  // open would surface stale balances. The abort cleanup handles the
  // close-during-load race.
  useEffect(() => {
    if (!isOpen) return;
    const ctrl = new AbortController();
    loadSettlements(ctrl.signal);
    return () => ctrl.abort();
  }, [isOpen, loadSettlements]);

  // Group transfers by currency so the UI naturally segments them under
  // currency headings. A trip with one currency renders a single
  // unlabelled section; a multi-currency trip gets per-currency totals.
  const grouped = useMemo(() => {
    const map = new Map<string, SettlementTransfer[]>();
    for (const tr of transfers) {
      const list = map.get(tr.currency) ?? [];
      list.push(tr);
      map.set(tr.currency, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [transfers]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("title")}
      subtitle={transfers.length > 0 ? t("subtitleCount", { count: transfers.length }) : undefined}
      usePortal
      closeOnEscape
      closeOnBackdrop
      maxWidth="max-w-md"
      ariaLabel={t("title")}
    >
      {loading ? (
        <div className="py-8 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
          <span className="text-sm">{t("loading")}</span>
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="p-4 rounded-lg border border-red-200 bg-red-50 flex items-start gap-3"
        >
          <AlertCircle
            className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-800">{t("errorLoad")}</p>
            <button
              type="button"
              onClick={() => loadSettlements()}
              className="mt-2 text-sm font-medium text-red-700 hover:text-red-900 underline underline-offset-2"
            >
              {t("retry")}
            </button>
          </div>
        </div>
      ) : transfers.length === 0 ? (
        <div className="py-8 flex flex-col items-center gap-3 text-center">
          <CheckCircle2
            className="w-10 h-10 text-green-500"
            aria-hidden="true"
          />
          <p className="text-base font-medium text-slate-900">{t("empty")}</p>
          <p className="text-sm text-slate-500 max-w-xs">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([currency, group]) => (
            <section key={currency} aria-labelledby={`settle-section-${currency}`}>
              {grouped.length > 1 && (
                <h4
                  id={`settle-section-${currency}`}
                  className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2"
                >
                  {currency}
                </h4>
              )}
              <ul className="space-y-2">
                {group.map((tr, idx) => (
                  <li
                    key={`${tr.fromUser.id}-${tr.toUser.id}-${idx}`}
                    className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm hover:shadow transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {/* "Alice owes Bob €45" — kept as a single flow rather
                            than three columns, because mobile widths can't
                            comfortably split avatar/from/arrow/to/amount. */}
                        <p className="text-sm text-slate-700 leading-snug">
                          <span className="font-semibold text-slate-900">
                            {tr.fromUser.name}
                          </span>{" "}
                          {t("owes")}{" "}
                          <span className="font-semibold text-slate-900">
                            {tr.toUser.name}
                          </span>{" "}
                          <span className="font-semibold text-[var(--primary,#0ea5e9)] whitespace-nowrap">
                            {formatMoney(tr.amount, tr.currency)}
                          </span>
                        </p>
                      </div>
                      <ArrowRight
                        className="w-4 h-4 text-slate-400 flex-shrink-0 mt-1"
                        aria-hidden="true"
                      />
                    </div>

                    {/* Pay actions.
                        - If a parent provided onPayClick, honor that
                          override (test harness / future custom flow).
                        - Otherwise render PaymentLinkButtons, which
                          uses the recipient's stored handles to emit
                          PayPal / Venmo / Wise deeplinks, or a
                          "recipient has no handles" hint when they
                          haven't set any. */}
                    <div className="mt-3 flex justify-end">
                      {onPayClick ? (
                        <button
                          type="button"
                          onClick={() => onPayClick(tr)}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--primary,#0ea5e9)] text-white hover:opacity-90 transition-opacity"
                        >
                          {t("payAction")}
                        </button>
                      ) : (
                        <PaymentLinkButtons
                          recipient={{
                            paypal_handle: tr.toUser.paypal_handle,
                            venmo_handle: tr.toUser.venmo_handle,
                            wise_handle: tr.toUser.wise_handle,
                            display_name: tr.toUser.name,
                          }}
                          amount={tr.amount}
                          currency={tr.currency}
                          tripName={tripName}
                          tripId={tripId}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </BaseModal>
  );
}
