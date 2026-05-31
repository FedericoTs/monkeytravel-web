"use client";

/**
 * Payment handles settings UI.
 *
 * Reads + writes the user's 3 payment-handle columns (paypal_handle,
 * venmo_handle, wise_handle) via the existing /api/profile GET + PATCH.
 *
 * Empty input → server stores NULL → the SettleUpView hides that
 * provider's button for this user when others try to pay them.
 *
 * Live format validation on every keystroke gives the user fast
 * feedback. The server re-validates before write (defence in depth).
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";
import { useToast } from "@/components/ui/Toast";
import {
  isValidPaymentHandle,
  PAYMENT_PROVIDERS,
  type PaymentProvider,
} from "@/lib/payments/handle-links";

type HandlesState = Record<PaymentProvider, string>;

const EMPTY_HANDLES: HandlesState = {
  paypal: "",
  venmo: "",
  wise: "",
};

export default function PaymentHandlesClient() {
  const t = useTranslations("expenses.payments.settings");
  const tCommon = useTranslations("expenses.payments");
  const { addToast } = useToast();

  const [handles, setHandles] = useState<HandlesState>(EMPTY_HANDLES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/profile", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data = json?.data ?? json;
      const profile = data?.profile ?? {};
      setHandles({
        paypal: profile.paypal_handle ?? "",
        venmo: profile.venmo_handle ?? "",
        wise: profile.wise_handle ?? "",
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onChange = (provider: PaymentProvider, value: string) => {
    setHandles((prev) => ({ ...prev, [provider]: value }));
  };

  const validationError = (provider: PaymentProvider): string | null => {
    const v = handles[provider];
    if (!v || v.trim().length === 0) return null;
    if (v.length > 64) return t("errorTooLong");
    if (!isValidPaymentHandle(provider, v)) return t("errorInvalidHandle");
    return null;
  };

  const hasAnyError = PAYMENT_PROVIDERS.some(
    (p) => validationError(p) !== null,
  );

  const save = async () => {
    if (hasAnyError) {
      addToast(t("errorFixBeforeSave"), "error");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      for (const provider of PAYMENT_PROVIDERS) {
        const v = handles[provider].trim();
        // Empty string → null (clear the handle). Server treats both
        // the same but sending null is clearer in the audit log.
        body[`${provider}_handle`] = v === "" ? null : v;
      }
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error || `HTTP ${res.status}`);
      }
      addToast(t("toastSaved"), "success");
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : t("errorSaveFailed"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const FIELDS: Array<{
    provider: PaymentProvider;
    placeholder: string;
  }> = [
    { provider: "paypal", placeholder: "alyssaperez" },
    { provider: "venmo", placeholder: "alyssa-perez" },
    { provider: "wise", placeholder: "@alyssaperez" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <div className="text-sm text-slate-500 mb-6">
          <Link href="/profile" className="hover:text-slate-700">
            {t("breadcrumbProfile")}
          </Link>
          <span className="mx-2">›</span>
          <span className="text-slate-700">{t("title")}</span>
        </div>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          {t("title")}
        </h1>
        <p className="text-slate-600 mb-8">{t("description")}</p>

        {loading ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center text-slate-500">
            {t("loading")}
          </div>
        ) : loadError ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-red-200">
            <p className="text-red-700 mb-3">{t("errorLoadFailed")}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm font-medium"
            >
              {t("retry")}
            </button>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
              {FIELDS.map(({ provider, placeholder }) => {
                const err = validationError(provider);
                const inputId = `payment-handle-${provider}`;
                return (
                  <div
                    key={provider}
                    className="px-5 sm:px-6 py-5"
                  >
                    <label
                      htmlFor={inputId}
                      className="block font-semibold text-slate-900 mb-1"
                    >
                      {tCommon(`provider.${provider}`)}
                    </label>
                    <p className="text-sm text-slate-600 mb-3">
                      {t(`help.${provider}`)}
                    </p>
                    <input
                      id={inputId}
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      value={handles[provider]}
                      onChange={(e) => onChange(provider, e.target.value)}
                      placeholder={placeholder}
                      maxLength={64}
                      aria-invalid={err !== null}
                      aria-describedby={
                        err ? `${inputId}-error` : undefined
                      }
                      className={`w-full px-3 py-2 rounded-lg border bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 ${
                        err
                          ? "border-red-300 focus:border-red-400"
                          : "border-slate-200 focus:border-[var(--primary)]"
                      }`}
                    />
                    {err && (
                      <p
                        id={`${inputId}-error`}
                        className="mt-1.5 text-xs text-red-600"
                      >
                        {err}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || hasAnyError}
                className="px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white font-semibold hover:bg-[var(--primary)]/90 disabled:opacity-50 transition-colors"
              >
                {saving ? t("saving") : t("save")}
              </button>
              <Link
                href="/profile"
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-100 transition-colors text-sm"
              >
                {t("cancel")}
              </Link>
            </div>

            <p className="mt-6 text-xs text-slate-500">
              {t("privacyNote")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
