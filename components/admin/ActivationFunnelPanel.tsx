"use client";

/**
 * The consent-free half of the Activation card.
 *
 * Everything above this panel is all-time and provider-blind. This is the
 * last 30 days, per signup provider, counted in the database: no cookie
 * banner, no ad blocker, every account. See lib/admin/activation-funnel.ts
 * for the definitions and the migration that computes them.
 */
import type { ActivationFunnelStats, ProviderFunnelRow } from "@/lib/admin/activation-funnel";
import { pct } from "@/lib/admin/activation-funnel";

function ratio(n: number, d: number): string {
  return d > 0 ? `${pct(n, d)}%` : "n/a";
}

function providerLabel(p: string): string {
  if (p === "google") return "Google";
  if (p === "email") return "Email";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function Step({
  label,
  value,
  sub,
  share,
  emphasis,
}: {
  label: string;
  value: number;
  sub: string;
  /** 0-100, drawn as the bar under the number. */
  share?: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        emphasis ? "bg-emerald-50 border-emerald-100" : "bg-slate-50 border-slate-200"
      }`}
    >
      <div className="text-[11px] font-medium text-slate-600">{label}</div>
      <div
        className={`text-xl sm:text-2xl font-bold leading-none mt-1 tabular-nums ${
          emphasis ? "text-emerald-700" : "text-[var(--foreground)]"
        }`}
      >
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] text-slate-500 mt-1">{sub}</div>
      {share !== undefined && (
        <div className="mt-2 h-1 bg-white/80 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${emphasis ? "bg-emerald-500" : "bg-slate-400"}`}
            style={{ width: `${Math.min(Math.max(share, 0), 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Callout({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "neutral" | "emerald" | "amber";
  hint: string;
}) {
  const color = { neutral: "text-slate-700", emerald: "text-emerald-600", amber: "text-amber-600" }[tone];
  return (
    <div title={hint}>
      <div className={`text-base sm:text-lg font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] sm:text-[11px] text-slate-500 leading-tight">{label}</div>
    </div>
  );
}

function deltaLabel(now: number, before: number): string {
  const d = Math.round((now - before) * 10) / 10;
  if (d === 0) return "flat vs prior 30d";
  return `${d > 0 ? "+" : ""}${d} pts vs prior 30d`;
}

export default function ActivationFunnelPanel({ funnel }: { funnel: ActivationFunnelStats }) {
  if (!funnel.available) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-100">
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          The consent-free funnel is unavailable right now: one of its database functions failed. The
          server log for /api/admin/stats has the error. Nothing above is affected.
        </p>
      </div>
    );
  }

  const t = funnel.last30d.total;
  const p = funnel.prior30d.total;
  const w7 = funnel.last7d.total;
  const email: ProviderFunnelRow | undefined = funnel.last30d.byProvider.find((r) => r.provider === "email");
  const google: ProviderFunnelRow | undefined = funnel.last30d.byProvider.find((r) => r.provider === "google");
  const loop = funnel.anonymousLoop.last30d;
  const loopPrior = funnel.anonymousLoop.prior30d;

  const providersSummary =
    funnel.last30d.byProvider.length > 0
      ? funnel.last30d.byProvider.map((r) => `${providerLabel(r.provider)} ${r.signups}`).join(" · ")
      : "no signups in the window";

  return (
    <div className="mt-4 pt-4 border-t border-slate-100" data-activation-funnel>
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            What the last 30 days of signups actually did
          </h3>
          <p className="text-[11px] text-slate-500">
            Counted in the database, not in PostHog. No consent gate, no ad blocker, every account.
          </p>
        </div>
        <span className="text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
          Last 7 days: {w7.signups} signed up, {w7.hasTrip} with a trip
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Step label="Signed up" value={t.signups} sub={providersSummary} />
        <Step
          label="Confirmed"
          value={t.confirmed}
          sub={`${ratio(t.confirmed, t.signups)} of signups`}
          share={pct(t.confirmed, t.signups)}
        />
        <Step
          label="Generated an itinerary"
          value={t.generated}
          sub={`${ratio(t.generated, t.signups)} of signups`}
          share={pct(t.generated, t.signups)}
        />
        <Step
          label="Has a trip"
          value={t.hasTrip}
          sub={`${ratio(t.hasTrip, t.signups)} of signups · ${deltaLabel(pct(t.hasTrip, t.signups), pct(p.hasTrip, p.signups))}`}
          share={pct(t.hasTrip, t.signups)}
          emphasis
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <Callout
          label="Generated, no trip"
          value={t.generatedNoTrip.toString()}
          tone={t.generatedNoTrip > 0 ? "amber" : "emerald"}
          hint="Reached a rendered itinerary while signed in and no trip row exists. Should trend to zero after the 2026-09-02 auto-save fix."
        />
        <Callout
          label="Users with a failed save"
          value={t.saveFailedUsers.toString()}
          tone={t.saveFailedUsers > 0 ? "amber" : "neutral"}
          hint="At least one save_failed funnel row in the window. Sentry has the error class."
        />
        <Callout
          label="Email signups unconfirmed"
          value={email ? (email.signups - email.confirmed).toString() : "0"}
          tone={email && email.signups - email.confirmed > 0 ? "amber" : "neutral"}
          hint="Created an email account and never clicked the confirmation link. The cross-device dead end lives here."
        />
        <Callout
          label="Google signup → trip"
          value={google ? ratio(google.hasTrip, google.signups) : "n/a"}
          tone="neutral"
          hint="The cleanest cohort: no confirmation step, so this is the wizard's own conversion."
        />
      </div>

      {funnel.last30d.byProvider.length > 1 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px] sm:text-xs tabular-nums">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left font-medium py-1 pr-2">Provider</th>
                <th className="text-right font-medium py-1 px-2">Signed up</th>
                <th className="text-right font-medium py-1 px-2">Confirmed</th>
                <th className="text-right font-medium py-1 px-2">Reached wizard</th>
                <th className="text-right font-medium py-1 px-2">Generated</th>
                <th className="text-right font-medium py-1 px-2">Has a trip</th>
                <th className="text-right font-medium py-1 pl-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {funnel.last30d.byProvider.map((r) => (
                <tr key={r.provider} className="border-t border-slate-100 text-slate-700">
                  <td className="py-1 pr-2 font-medium">{providerLabel(r.provider)}</td>
                  <td className="text-right py-1 px-2">{r.signups}</td>
                  <td className="text-right py-1 px-2">{r.confirmed}</td>
                  <td className="text-right py-1 px-2">{r.reachedWizard}</td>
                  <td className="text-right py-1 px-2">{r.generated}</td>
                  <td className="text-right py-1 px-2">{r.hasTrip}</td>
                  <td className="text-right py-1 pl-2 font-semibold text-emerald-700">{ratio(r.hasTrip, r.signups)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-2">
          <h4 className="text-xs font-semibold text-[var(--foreground)]">Signed-out planners, last 30 days</h4>
          <span className="text-[11px] text-slate-500 tabular-nums">
            Prior 30 days: {loopPrior.anonCreated} shared, {loopPrior.claimed} claimed
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Step label="Shared without an account" value={loop.anonCreated} sub="a share is the only way to mint one" />
          <Step
            label="Someone opened it"
            value={loop.anonVisited}
            sub={`${loop.shareVisits.toLocaleString()} human visits`}
            share={pct(loop.anonVisited, loop.anonCreated)}
          />
          <Step
            label='Tapped "plan your own"'
            value={loop.planOwnClicks}
            sub="on those shared trips"
          />
          <Step
            label="Claimed at signup"
            value={loop.claimed}
            sub={`${ratio(loop.claimed, loop.anonCreated)} · ${loop.sharerSignedIn} sharers signed in later · ${loop.unclaimedLive} still claimable`}
            share={pct(loop.claimed, loop.anonCreated)}
            emphasis={loop.claimed > 0}
          />
        </div>
      </div>
    </div>
  );
}
