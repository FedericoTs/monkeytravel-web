import type { EngineHealth, EngineVerdict } from "@/lib/ops/engine-health";
import { AutoRefresh } from "./AutoRefresh";

export interface FunnelWindow {
  opened?: number;
  generating?: number;
  planned?: number;
  failed?: number;
  save_clicked?: number;
  saved?: number;
  kept?: number;
  reopened?: number;
}

export interface EngineWindow {
  requests?: number;
  errors?: number;
  cache_hits?: number;
  p50_ms?: number | null;
  p90_ms?: number | null;
  first_day_p50_ms?: number | null;
}

export type SpendWindow = Partial<Record<"gemini" | "google_places" | "other", number>>;

export interface LiveWindow {
  trips?: number;
  owned?: number;
  owner_back?: number;
  used_today?: number;
  with_participants?: number;
}

/** mission_control() in the database. */
export interface MissionData {
  days: number;
  generated_at: string;
  funnel: { cur: FunnelWindow; prev: FunnelWindow };
  engine: { cur: EngineWindow; prev: EngineWindow };
  spend: { cur: SpendWindow; prev: SpendWindow };
  live?: { cur: LiveWindow; prev: LiveWindow };
  daily: Array<{ day: string; plans: number; usd: number }>;
}

const n = (v: number | null | undefined) => v ?? 0;
const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");
const seconds = (ms: number | null | undefined) => (ms ? `${(ms / 1000).toFixed(1)} s` : "–");
const usd = (v: number) => `$${v.toFixed(2)}`;
const total = (s: SpendWindow) => n(s.gemini) + n(s.google_places) + n(s.other);

/** The change from the window before, coloured by whether it is good news. */
function Delta({ cur, prev, lowerIsBetter = false }: { cur: number; prev: number; lowerIsBetter?: boolean }) {
  if (!prev) return <span className="text-xs text-slate-500">new</span>;
  const change = (cur - prev) / prev;
  if (Math.abs(change) < 0.005) return <span className="text-xs text-slate-500">±0%</span>;
  const good = lowerIsBetter ? change < 0 : change > 0;
  return (
    <span className={`text-xs font-semibold tabular-nums ${good ? "text-emerald-700" : "text-rose-700"}`}>
      {change > 0 ? "▲" : "▼"} {Math.abs(Math.round(change * 100))}%
    </span>
  );
}

function Stage({ label, value, prev, note }: { label: string; value: number; prev: number; note?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-slate-900">{value.toLocaleString("en-US")}</p>
      <div className="mt-1 flex items-center gap-2">
        <Delta cur={value} prev={prev} />
        {note && <span className="text-xs text-slate-500">{note}</span>}
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

function Bars({ label, values, days, format }: { label: string; values: number[]; days: string[]; format: (v: number) => string }) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="text-xs tabular-nums text-slate-500">peak {format(max)}</p>
      </div>
      <div className="mt-2 flex h-20 items-end gap-1" role="img" aria-label={`${label}: ${values.map(format).join(", ")}`}>
        {values.map((v, i) => (
          <div
            key={days[i]}
            title={`${days[i]}: ${format(v)}`}
            className={`flex-1 rounded-t ${i === values.length - 1 ? "bg-slate-400" : "bg-slate-700"}`}
            style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-slate-500">
        <span>{days[0]?.slice(5)}</span>
        <span>{days[days.length - 1]?.slice(5)} (today, so far)</span>
      </div>
    </div>
  );
}

/**
 * Mission control: one page for whether MonkeyTravel is doing its job: people
 * get a plan and keep it, the engine is quick and up, and what a plan costs.
 */
export function MissionControl({
  data,
  health,
  verdict,
  updatedAt,
}: {
  data: MissionData;
  health: EngineHealth;
  verdict: EngineVerdict;
  updatedAt: string;
}) {
  const f = data.funnel.cur;
  const fp = data.funnel.prev;
  const e = data.engine.cur;
  const ep = data.engine.prev;
  const spend = total(data.spend.cur);
  const spendPrev = total(data.spend.prev);
  const perPlan = n(f.planned) ? spend / n(f.planned) : 0;
  const perPlanPrev = n(fp.planned) ? spendPrev / n(fp.planned) : 0;
  const days = data.daily.map((d) => d.day);
  const l = data.live?.cur ?? {};
  const lp = data.live?.prev ?? {};

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">MonkeyTravel</p>
          <h1 className="text-3xl font-bold text-slate-900">Mission control</h1>
          <p className="mt-1 text-sm text-slate-600">
            Last {data.days} days against the {data.days} before. Real people only: no bots, automation, probes or admins.
          </p>
        </div>
        <AutoRefresh updatedAt={updatedAt} />
      </div>

      <section aria-labelledby="launch-title">
        <h2 id="launch-title" className="mb-3 text-lg font-semibold text-slate-900">The launch</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stage label="Opened the planner" value={n(f.opened)} prev={n(fp.opened)} />
          <Stage label="Got a plan" value={n(f.planned)} prev={n(fp.planned)} note={`${share(n(f.planned), n(f.opened))} of openers`} />
          <Stage label="Kept, no account" value={n(f.kept)} prev={n(fp.kept)} note={`${share(n(f.kept), n(f.planned))} of plans`} />
          <Stage label="Came back to a kept plan" value={n(f.reopened)} prev={n(fp.reopened)} note={`${share(n(f.reopened), n(f.kept))} of kept`} />
          <Stage label="Saved to an account" value={n(f.saved)} prev={n(fp.saved)} note={`${share(n(f.saved), n(f.planned))} of plans`} />
        </div>
      </section>

      <section aria-labelledby="live-title">
        <h2 id="live-title" className="text-lg font-semibold text-slate-900">Live trips</h2>
        <p className="mb-3 mt-1 text-sm text-slate-600">
          Trips under way in the window. The owner came back means the trip&apos;s account owner opened it during the trip.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stage label="Under way" value={n(l.trips)} prev={n(lp.trips)} note={`${n(l.owned)} with an account`} />
          <Stage
            label="Owner came back"
            value={n(l.owner_back)}
            prev={n(lp.owner_back)}
            note={`${share(n(l.owner_back), n(l.owned))} of those`}
          />
          <Stage label="Used Today" value={n(l.used_today)} prev={n(lp.used_today)} note={`${share(n(l.used_today), n(l.trips))} of trips`} />
          <Stage
            label="Had participants"
            value={n(l.with_participants)}
            prev={n(lp.with_participants)}
            note={`${share(n(l.with_participants), n(l.trips))} of trips`}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="engine-title" className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="engine-title" className="text-lg font-semibold text-slate-900">Engine</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                verdict.ok ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${verdict.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
              {verdict.ok ? "Nominal" : "Degraded"} · last {health.minutes} min
            </span>
          </div>
          {!verdict.ok && (
            <ul className="mt-3 space-y-1 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">
              {verdict.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Metric label="Median plan" value={seconds(e.p50_ms)} sub={<Delta cur={n(e.p50_ms)} prev={n(ep.p50_ms)} lowerIsBetter />} />
            <Metric label="Slowest 10%" value={seconds(e.p90_ms)} sub={<Delta cur={n(e.p90_ms)} prev={n(ep.p90_ms)} lowerIsBetter />} />
            <Metric label="Day 1 on screen" value={seconds(e.first_day_p50_ms)} sub={<span className="text-xs text-slate-500">median</span>} />
            <Metric
              label="Server errors"
              value={`${n(e.errors)} of ${n(e.requests)}`}
              sub={<span className="text-xs text-slate-500">{share(n(e.errors), n(e.requests))}</span>}
            />
            <Metric
              label="Failed for planners"
              value={`${n(f.failed)} of ${n(f.generating)}`}
              sub={<span className="text-xs text-slate-500">{share(n(f.failed), n(f.generating))}</span>}
            />
            <Metric
              label="Served from cache"
              value={`${n(e.cache_hits)} of ${n(e.requests)}`}
              sub={<span className="text-xs text-slate-500">{share(n(e.cache_hits), n(e.requests))}</span>}
            />
          </div>
        </section>

        <section aria-labelledby="cost-title" className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 id="cost-title" className="text-lg font-semibold text-slate-900">Cost</h2>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <Metric label={`External APIs, ${data.days} days`} value={usd(spend)} sub={<Delta cur={spend} prev={spendPrev} lowerIsBetter />} />
            <Metric label="Per plan" value={usd(perPlan)} sub={<Delta cur={perPlan} prev={perPlanPrev} lowerIsBetter />} />
          </div>
          <div className="mt-5 space-y-2">
            {(
              [
                ["Google Places", n(data.spend.cur.google_places)],
                ["Gemini", n(data.spend.cur.gemini)],
                ["Other", n(data.spend.cur.other)],
              ] as const
            ).map(([name, value]) => (
              <div key={name} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-slate-600">{name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-slate-700" style={{ width: `${spend ? (value / spend) * 100 : 0}%` }} />
                </span>
                <span className="w-16 shrink-0 text-right font-mono tabular-nums text-slate-900">{usd(value)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="daily-title" className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 id="daily-title" className="text-lg font-semibold text-slate-900">Daily, {days.length} days</h2>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <Bars label="Plans made" values={data.daily.map((d) => d.plans)} days={days} format={(v) => String(v)} />
          <Bars label="External API spend" values={data.daily.map((d) => Number(d.usd))} days={days} format={(v) => usd(v)} />
        </div>
      </section>
    </div>
  );
}
