"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";

interface PackingItem {
  name: string;
  note?: string;
  essential?: boolean;
}

interface PackingCategory {
  id:
    | "documents"
    | "clothing"
    | "toiletries"
    | "electronics"
    | "activity_gear"
    | "health"
    | "misc";
  items: PackingItem[];
}

interface PackingListResult {
  categories: PackingCategory[];
  contextNote: string;
}

const STYLE_OPTIONS = [
  { value: "city", emoji: "🏙️" },
  { value: "beach", emoji: "🏖️" },
  { value: "adventure", emoji: "🏔️" },
  { value: "business", emoji: "💼" },
  { value: "wellness", emoji: "🧘" },
  { value: "mixed", emoji: "✨" },
] as const;

const ACTIVITY_OPTIONS = [
  "hiking",
  "swimming",
  "fine_dining",
  "nightlife",
  "skiing",
  "diving",
  "yoga",
  "photography",
  "museums",
  "shopping",
  "religious_sites",
  "kids",
] as const;

const CATEGORY_ICONS: Record<PackingCategory["id"], string> = {
  documents: "📄",
  clothing: "👕",
  toiletries: "🧴",
  electronics: "🔌",
  activity_gear: "🎒",
  health: "💊",
  misc: "📦",
};

interface Props {
  locale: string;
}

export default function PackingListClient({ locale }: Props) {
  const t = useTranslations("tools.packingList");

  const todayIso = new Date().toISOString().split("T")[0];

  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [travelStyle, setTravelStyle] =
    useState<(typeof STYLE_OPTIONS)[number]["value"]>("city");
  const [activities, setActivities] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PackingListResult | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Email gate (only after a list is generated)
  const [email, setEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"idle" | "ok" | "err">("idle");

  const canSubmit =
    !!destination.trim() &&
    !!startDate &&
    !!endDate &&
    new Date(endDate) >= new Date(startDate) &&
    !loading;

  const toggleActivity = (a: string) => {
    setActivities((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  };

  const itemKey = (catId: string, idx: number) => `${catId}-${idx}`;

  const allItemKeys = useMemo(() => {
    if (!result) return [] as string[];
    return result.categories.flatMap((c) =>
      c.items.map((_, idx) => itemKey(c.id, idx))
    );
  }, [result]);

  const handleGenerate = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setChecked(new Set());

    try {
      const res = await fetch("/api/tools/packing-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: destination.trim(),
          startDate,
          endDate,
          travelStyle,
          activities,
          locale,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          setError(t("rateLimitMessage"));
        } else {
          setError(json?.error || t("errorTitle"));
        }
        setLoading(false);
        return;
      }
      setResult(json.list);
    } catch {
      setError(t("errorTitle"));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setEmailSending(true);
    setEmailStatus("idle");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          source: "packing_list_tool",
          metadata: { destination, startDate, endDate, travelStyle },
        }),
      });
      if (res.ok) {
        setEmailStatus("ok");
        // PostHog event (best-effort)
        if (typeof window !== "undefined") {
          const ph = (window as unknown as { posthog?: { capture: (e: string, p: Record<string, unknown>) => void } }).posthog;
          ph?.capture("tools_packing_list_email_capture", {
            destination,
            style: travelStyle,
          });
        }
      } else {
        setEmailStatus("err");
      }
    } catch {
      setEmailStatus("err");
    } finally {
      setEmailSending(false);
    }
  };

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.href;
  }, []);

  const handleShare = async () => {
    if (typeof navigator === "undefined") return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: t("resultTitle", { destination }),
          url: shareUrl,
        });
      } catch {
        // user cancelled — fine
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      alert(t("shareCopied"));
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-8">
      {/* Form */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t("destinationLabel")}
            </label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={t("destinationPlaceholder")}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none text-base"
              maxLength={100}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t("startDateLabel")}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={todayIso}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none text-base"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t("endDateLabel")}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || todayIso}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none text-base"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t("styleLabel")}
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {STYLE_OPTIONS.map((opt) => {
                const selected = travelStyle === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTravelStyle(opt.value)}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-xs font-medium transition-all ${
                      selected
                        ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <span className="text-xl">{opt.emoji}</span>
                    {t(`styles.${opt.value}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t("activitiesLabel")}
            </label>
            <div className="flex flex-wrap gap-2">
              {ACTIVITY_OPTIONS.map((a) => {
                const selected = activities.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggleActivity(a)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      selected
                        ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {t(`activities.${a}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canSubmit}
            className="w-full bg-[var(--primary)] text-white py-3.5 rounded-xl font-semibold text-base hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t("generating")}
              </>
            ) : (
              <>✨ {t("generate")}</>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-700">
          <strong className="block mb-1">{t("errorTitle")}</strong>
          {error}
          <button
            onClick={handleGenerate}
            className="block mt-3 text-rose-700 underline font-medium"
          >
            {t("errorRetry")}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-2xl font-bold text-slate-900">
              {t("resultTitle", { destination })}
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  checked.size === allItemKeys.length
                    ? setChecked(new Set())
                    : setChecked(new Set(allItemKeys))
                }
                className="text-sm text-slate-600 hover:text-slate-900 underline"
              >
                {checked.size === allItemKeys.length
                  ? t("uncheckAll")
                  : t("checkAll")}
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="text-sm text-[var(--primary)] hover:underline"
              >
                {t("shareCta")}
              </button>
            </div>
          </div>

          {result.contextNote && (
            <p className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
              {result.contextNote}
            </p>
          )}

          <div className="space-y-4">
            {result.categories.map((cat) => (
              <details
                key={cat.id}
                open
                className="rounded-xl border border-slate-200 bg-white overflow-hidden"
              >
                <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{CATEGORY_ICONS[cat.id]}</span>
                    <h3 className="font-semibold text-slate-900">
                      {t(`categories.${cat.id}`)}
                    </h3>
                    <span className="text-xs text-slate-500">
                      {cat.items.length}
                    </span>
                  </div>
                </summary>
                <ul className="border-t border-slate-100 divide-y divide-slate-100">
                  {cat.items.map((item, idx) => {
                    const key = itemKey(cat.id, idx);
                    const isChecked = checked.has(key);
                    return (
                      <li
                        key={key}
                        className={`flex items-start gap-3 px-5 py-3 transition-colors ${
                          isChecked ? "bg-slate-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            setChecked((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            });
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]/30"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-sm font-medium ${
                                isChecked
                                  ? "line-through text-slate-400"
                                  : "text-slate-900"
                              }`}
                            >
                              {item.name}
                            </span>
                            {item.essential && (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                {t("essentialBadge")}
                              </span>
                            )}
                          </div>
                          {item.note && (
                            <p
                              className={`text-xs mt-0.5 ${
                                isChecked ? "text-slate-400" : "text-slate-500"
                              }`}
                            >
                              {item.note}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </details>
            ))}
          </div>

          {/* Email gate */}
          <div className="rounded-2xl bg-gradient-to-br from-[var(--primary)]/5 to-[var(--accent)]/10 border border-[var(--primary)]/20 p-6 sm:p-8">
            <h3 className="text-lg sm:text-xl font-semibold text-slate-900 mb-2">
              📧 {t("downloadCta")}
            </h3>
            {emailStatus === "ok" ? (
              <p className="text-green-700 text-sm font-medium">
                ✓ {t("emailSuccess")}
              </p>
            ) : (
              <form
                onSubmit={handleEmailSubmit}
                className="flex flex-col sm:flex-row gap-2 mt-3"
              >
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("emailPlaceholder")}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-base focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none"
                  disabled={emailSending}
                />
                <button
                  type="submit"
                  disabled={emailSending || !email.trim()}
                  className="bg-[var(--primary)] text-white px-5 py-2.5 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50"
                >
                  {emailSending ? "..." : t("emailSubmit")}
                </button>
              </form>
            )}
            {emailStatus === "err" && (
              <p className="text-rose-700 text-sm mt-2">{t("emailError")}</p>
            )}
          </div>

          {/* Funnel CTA → wizard */}
          <Link
            href={`/trips/new?destination=${encodeURIComponent(destination)}`}
            className="block text-center bg-[var(--accent)] text-slate-900 px-6 py-4 rounded-xl font-semibold hover:bg-[var(--accent)]/90 transition-colors"
          >
            {t("planTripCta")}
          </Link>
        </div>
      )}
    </div>
  );
}
