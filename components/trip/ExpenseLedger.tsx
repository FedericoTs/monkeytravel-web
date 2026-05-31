"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Plus,
  Trash2,
  Wallet,
  Loader2,
  AlertCircle,
  Scale,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import SettleUpView from "@/components/trip/SettleUpView";

/**
 * Per-trip expense ledger (task #220).
 *
 * Lists actual spend on a trip, lets owner + collaborators add new
 * entries, and shows per-category totals. Multi-currency support: we
 * group totals by currency rather than forcing a single base. This is
 * the right default for international trips where forcing FX conversion
 * would either require a per-expense rate snapshot (heavy) or use a
 * stale rate (misleading).
 *
 * RLS layer:
 *   - SELECT: any trip member sees all entries
 *   - UPDATE/DELETE: creator or trip owner only
 * The component reads `currentUserId` from the API response so it can
 * show edit/delete affordances only on rows the user can actually mutate.
 *
 * Render strategy: simple list (no virtualization). A trip with 200+
 * expenses is unusual; if that ever becomes the norm we'll paginate.
 */

interface ExpenseRow {
  id: string;
  trip_id: string;
  created_by: string | null;
  amount: number | string; // PG NUMERIC arrives as string sometimes
  currency: string;
  category:
    | "transport"
    | "accommodation"
    | "food"
    | "activity"
    | "shopping"
    | "other";
  description: string | null;
  spent_on: string; // YYYY-MM-DD
  created_at: string;
  updated_at: string;
}

interface ExpenseLedgerProps {
  tripId: string;
  /** Default currency for the add-form. Usually the trip's primary currency. */
  defaultCurrency?: string;
  /** Hide the component when the env flag is off. */
  className?: string;
}

const CATEGORIES: ExpenseRow["category"][] = [
  "transport",
  "accommodation",
  "food",
  "activity",
  "shopping",
  "other",
];

/**
 * Today's date as YYYY-MM-DD in the *user's local* timezone. Using
 * `new Date().toISOString().slice(0, 10)` gives UTC date, which is wrong
 * pre-fill for Tokyo at 02:00 (yesterday UTC) or PST at 23:00 (tomorrow UTC).
 */
function todayLocalISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ExpenseLedger({
  tripId,
  defaultCurrency = "EUR",
  className = "",
}: ExpenseLedgerProps) {
  // Flag-gate to avoid shipping an in-progress UI to everyone before we
  // collect feedback. Set NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED=true on
  // Vercel to flip it on per-environment.
  if (process.env.NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED !== "true") {
    return null;
  }

  return (
    <ExpenseLedgerInner
      tripId={tripId}
      defaultCurrency={defaultCurrency}
      className={className}
    />
  );
}

function ExpenseLedgerInner({
  tripId,
  defaultCurrency,
  className,
}: Required<Omit<ExpenseLedgerProps, "className">> & { className: string }) {
  const t = useTranslations("common.expenses");
  const locale = useLocale();
  const { addToast } = useToast();

  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isTripOwner, setIsTripOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Settle-up modal lives inside the ledger so trip members can see
  // recommended transfers without leaving the spend timeline. Hidden
  // until at least one expense exists — settling an empty ledger has
  // no signal.
  const [showSettle, setShowSettle] = useState(false);

  // Add-form state
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [category, setCategory] = useState<ExpenseRow["category"]>("food");
  const [description, setDescription] = useState("");
  const [spentOn, setSpentOn] = useState(() => todayLocalISO());

  const loadExpenses = useCallback(
    async (signal?: AbortSignal) => {
      // Reset state so a retry doesn't render the stale error briefly.
      setLoadError(null);
      setLoading(true);
      try {
        const res = await fetch(`/api/trips/${tripId}/expenses`, { signal });
        if (!res.ok) {
          const message = `Server returned ${res.status}`;
          setLoadError(message);
          addToast(t("errorLoadFailed"), "error");
          console.error("[ExpenseLedger] load failed", message);
          // Lazy-import Sentry so a missing/failed Sentry never breaks the
          // ledger render (mirrors lib/usage-limits/check.ts:83-95).
          import("@sentry/nextjs")
            .then((Sentry) => {
              Sentry.captureException?.(new Error(message), {
                tags: { source: "ExpenseLedger", subsystem: "load" },
                level: "warning",
                extra: { tripId, status: res.status },
              });
            })
            .catch(() => {
              /* Sentry not available — console.error above is the fallback */
            });
          return;
        }
        const data = (await res.json()) as {
          expenses: ExpenseRow[];
          currentUserId: string;
          isTripOwner?: boolean;
        };
        setExpenses(data.expenses || []);
        setCurrentUserId(data.currentUserId || null);
        setIsTripOwner(Boolean(data.isTripOwner));
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setLoadError(message);
        addToast(t("errorLoadFailed"), "error");
        console.error("[ExpenseLedger] load failed", err);
        import("@sentry/nextjs")
          .then((Sentry) => {
            Sentry.captureException?.(err, {
              tags: { source: "ExpenseLedger", subsystem: "load" },
              level: "warning",
              extra: { tripId },
            });
          })
          .catch(() => {
            /* Sentry not available — console.error above is the fallback */
          });
      } finally {
        setLoading(false);
      }
    },
    [tripId, addToast, t]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    loadExpenses(ctrl.signal);
    return () => ctrl.abort();
  }, [loadExpenses]);

  /** Per-currency totals + per-category breakdown. */
  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    const byCategoryAndCurrency = new Map<string, Map<string, number>>();
    for (const e of expenses) {
      const amt = typeof e.amount === "string" ? Number(e.amount) : e.amount;
      if (!Number.isFinite(amt)) continue;
      byCurrency.set(e.currency, (byCurrency.get(e.currency) || 0) + amt);
      const inner =
        byCategoryAndCurrency.get(e.category) ||
        new Map<string, number>();
      inner.set(e.currency, (inner.get(e.currency) || 0) + amt);
      byCategoryAndCurrency.set(e.category, inner);
    }
    return { byCurrency, byCategoryAndCurrency };
  }, [expenses]);

  const resetForm = () => {
    setAmount("");
    setCurrency(defaultCurrency);
    setCategory("food");
    setDescription("");
    setSpentOn(todayLocalISO());
  };

  const handleAdd = async () => {
    if (saving) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      addToast(t("errorAmountRequired"), "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: n,
          currency: currency.toUpperCase(),
          category,
          description: description.trim() || null,
          spent_on: spentOn,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        addToast(err.error || t("errorAddFailed"), "error");
        return;
      }
      const data = (await res.json()) as { expense: ExpenseRow };
      setExpenses((prev) => sortByDateDesc([data.expense, ...prev]));
      addToast(t("toastAdded"), "success");
      resetForm();
      setShowAdd(false);
    } catch (err) {
      console.error("[ExpenseLedger] add failed", err);
      addToast(t("errorAddFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/trips/${tripId}/expenses`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        addToast(err.error || t("errorDeleteFailed"), "error");
        return;
      }
      setExpenses((prev) => prev.filter((e) => e.id !== id));
      addToast(t("toastDeleted"), "success");
    } catch (err) {
      console.error("[ExpenseLedger] delete failed", err);
      addToast(t("errorDeleteFailed"), "error");
    } finally {
      setDeletingId(null);
    }
  };

  const formatMoney = (n: number, curr: string) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: curr,
      }).format(n);
    } catch {
      // Unknown currency code → fall back to plain number + code suffix.
      return `${n.toFixed(2)} ${curr}`;
    }
  };

  const formatDate = (iso: string) => {
    try {
      // YYYY-MM-DD parses as UTC midnight; without timeZone:"UTC" any user
      // west of UTC sees the prior day. Mirrors the React #418 fix in
      // lib/datetime/format.ts.
      return new Date(iso).toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div
        className={`bg-white border border-slate-200 rounded-xl p-4 ${className}`}
      >
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>{t("loading")}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Wallet className="w-5 h-5 text-slate-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900">{t("title")}</h3>
            {totals.byCurrency.size === 0 ? (
              <p className="text-sm text-slate-500">{t("emptyHint")}</p>
            ) : (
              <p className="text-sm text-slate-600">
                {Array.from(totals.byCurrency.entries())
                  .map(([curr, amt]) => formatMoney(amt, curr))
                  .join(" · ")}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Settle-up is only useful with at least one expense logged.
              Rendering it on an empty ledger would invite a click into a
              guaranteed-empty modal. */}
          {expenses.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSettle(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
              aria-haspopup="dialog"
            >
              <Scale className="w-4 h-4" aria-hidden="true" />
              {t("settle.openButton")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:opacity-90 transition-opacity"
            aria-expanded={showAdd}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {t("addButton")}
          </button>
        </div>
      </div>

      {/* Settle-up modal — controlled here so we own the open/close
          lifecycle alongside the ledger's other modal-adjacent state. */}
      <SettleUpView
        tripId={tripId}
        isOpen={showSettle}
        onClose={() => setShowSettle(false)}
      />

      {/* Add form */}
      {showAdd && (
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600 block mb-1">
                {t("fieldAmount")}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600 block mb-1">
                {t("fieldCurrency")}
              </span>
              <input
                type="text"
                value={currency}
                onChange={(e) =>
                  setCurrency(e.target.value.toUpperCase().slice(0, 3))
                }
                maxLength={3}
                placeholder="EUR"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] uppercase"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600 block mb-1">
                {t("fieldDate")}
              </span>
              <input
                type="date"
                value={spentOn}
                onChange={(e) => setSpentOn(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600 block mb-1">
                {t("fieldCategory")}
              </span>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as ExpenseRow["category"])
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`category.${c}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600 block mb-1">
                {t("fieldDescription")}
              </span>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 280))}
                placeholder={t("descriptionPlaceholder")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                resetForm();
              }}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !amount}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      )}

      {/* Expense rows */}
      {loadError ? (
        <div
          role="alert"
          className="m-4 p-4 rounded-lg border border-red-200 bg-red-50 flex items-start gap-3"
        >
          <AlertCircle
            className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-800">{t("errorLoadFailed")}</p>
            <button
              type="button"
              onClick={() => loadExpenses()}
              className="mt-2 text-sm font-medium text-red-700 hover:text-red-900 underline underline-offset-2"
            >
              {t("retry")}
            </button>
          </div>
        </div>
      ) : expenses.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">
          {t("empty")}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {expenses.map((e) => {
            const amt =
              typeof e.amount === "string" ? Number(e.amount) : e.amount;
            // RLS policy `trip_expenses_delete_creator_or_owner` allows
            // owner OR creator to delete. The UI must mirror that so trip
            // owners aren't UI-locked out of deleting collaborator entries.
            const canDelete =
              currentUserId !== null &&
              (e.created_by === currentUserId || isTripOwner);
            return (
              <li
                key={e.id}
                className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50/60 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900">
                      {formatMoney(Number.isFinite(amt) ? amt : 0, e.currency)}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {t(`category.${e.category}`)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatDate(e.spent_on)}
                    </span>
                  </div>
                  {e.description && (
                    <p className="mt-0.5 text-sm text-slate-600 truncate">
                      {e.description}
                    </p>
                  )}
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDelete(e.id)}
                    disabled={deletingId === e.id}
                    aria-label={t("deleteAriaLabel")}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {deletingId === e.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function sortByDateDesc(rows: ExpenseRow[]): ExpenseRow[] {
  return [...rows].sort((a, b) => {
    if (a.spent_on !== b.spent_on) {
      return a.spent_on < b.spent_on ? 1 : -1;
    }
    return a.created_at < b.created_at ? 1 : -1;
  });
}
