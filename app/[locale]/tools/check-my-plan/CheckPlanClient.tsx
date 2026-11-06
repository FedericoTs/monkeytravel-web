"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";
import { capture } from "@/lib/posthog";
import type { CheckedStop, PlanReport } from "@/lib/plans/plan-check";

type Report = PlanReport & { lookedUp: boolean };
type Failure = "too_short" | "nothing_found" | "limit" | "failed";

async function askForCheck(text: string): Promise<Report | Failure> {
  try {
    const res = await fetch("/api/tools/check-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) return (await res.json()) as Report;
    if (res.status === 429) return "limit";
    const body = (await res.json().catch(() => null)) as { reason?: string } | null;
    return body?.reason === "too_short" || body?.reason === "nothing_found" ? body.reason : "failed";
  } catch {
    return "failed";
  }
}

/** The wizard with the plan's place and the stops worth keeping as must-dos. */
export function fixHref(report: Pick<PlanReport, "destination" | "keep" | "days">): string {
  const query = new URLSearchParams();
  if (report.destination) query.set("destination", report.destination);
  query.set("days", String(report.days.length));
  for (const name of report.keep) query.append("must", name);
  query.set("from", "check");
  return `/trips/new?${query}`;
}

function StopNote({ status }: { status: CheckedStop["status"] }) {
  const t = useTranslations("tools.checkPlan");
  if (status === "closed") {
    return <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">{t("closed")}</span>;
  }
  if (status === "missing") {
    return <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">{t("notFound")}</span>;
  }
  if (status === "open") {
    return <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">{t("open")}</span>;
  }
  return null;
}

export default function CheckPlanClient() {
  const t = useTranslations("tools.checkPlan");
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || checking) return;
    setChecking(true);
    setFailure(null);
    setReport(null);
    const result = await askForCheck(text);
    setChecking(false);
    if (typeof result === "string") {
      setFailure(result);
      void capture("plan_check_failed", { reason: result });
      return;
    }
    setReport(result);
    void capture("plan_checked", {
      days: result.days.length,
      looked: result.looked,
      closed: result.closed,
      missing: result.missing,
      packed_days: result.packedDays,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(event) => void check(event)} className="flex flex-col gap-3">
        <label htmlFor="plan-text" className="text-sm font-medium text-slate-800">
          {t("label")}
        </label>
        <textarea
          id="plan-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          placeholder={t("placeholder")}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-[var(--secondary-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--secondary-ink)] sm:text-sm"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={checking || !text.trim()}
            className="min-h-[44px] rounded-xl bg-[var(--secondary-ink)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--secondary-ink)]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking ? t("checking") : t("check")}
          </button>
          <p className="text-xs text-slate-500">{t("note")}</p>
        </div>
      </form>

      {failure && (
        <p role="alert" className="text-sm text-red-700">
          {t(`error_${failure}`)}
        </p>
      )}

      {report && (
        <section aria-labelledby="plan-report" className="flex flex-col gap-4">
          <h2 id="plan-report" className="text-xl font-bold text-slate-900">
            {report.destination ? t("reportFor", { destination: report.destination }) : t("report")}
          </h2>

          <ul role="status" className="flex flex-col gap-1 text-sm text-slate-700">
            <li>{t("packedSummary", { count: report.packedDays })}</li>
            {report.lookedUp ? (
              <li>{report.looked > 0 ? t("lookedSummary", { count: report.looked, closed: report.closed, missing: report.missing }) : t("nothingLooked")}</li>
            ) : (
              <li>{t("noLookups")}</li>
            )}
          </ul>

          <div className="flex flex-col gap-3">
            {report.days.map((day, i) => (
              <article key={`${day.label}-${i}`} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{day.label || t("dayFallback", { number: i + 1 })}</h3>
                  {day.packed && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">{t("packed")}</span>
                  )}
                </div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {day.stops.map((stop, j) => (
                    <li key={`${stop.name}-${j}`} className="flex items-start justify-between gap-3 text-sm text-slate-700">
                      <span className="min-w-0">{stop.name}</span>
                      <StopNote status={stop.status} />
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          {report.looked > 0 && <p className="text-xs text-slate-500">{t("source")}</p>}

          <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-4">
            <h3 className="font-semibold text-slate-900">{t("fixTitle")}</h3>
            <p className="text-sm text-slate-600">{t("fixBody")}</p>
            <Link
              href={fixHref(report)}
              prefetch={false}
              onClick={() => void capture("plan_check_fix_clicked", { closed: report.closed, packed_days: report.packedDays })}
              className="mt-1 inline-flex min-h-[44px] w-fit items-center rounded-xl bg-[var(--secondary-ink)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--secondary-ink)]/90"
            >
              {t("fix")}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
