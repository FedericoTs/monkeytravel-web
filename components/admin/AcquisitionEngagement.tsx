"use client";

interface AcquisitionEngagementProps {
  acquisition: {
    /**
     * Entry channel of each SESSION, from our own page views — not GA4, and
     * not page views. Since 2026-09-01 (c17abc3) the GA tags obey the cookie
     * banner and only ~3% of visitors accept, so GA4's channel report shows a
     * collapse that did not happen. This is consent-free: first-party,
     * cookieless, aggregate.
     */
    channels: {
      channel: string;
      entrySessions: number;
      reachedWizard: number;
      wizardPct: number;
      sharePct: number;
    }[];
    windowDays: number;
  };
  engagement: {
    dau: number;
    wau: number;
    mau: number;
    stickinessPct: number;
    timeToFirstTrip: {
      avgHours: number;
      medianHours: number;
      usersCount: number;
      within1h: number;
      within24h: number;
      within7d: number;
    };
  };
}

const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct",
  ai_assistant: "AI Assistant",
  other_search: "Other Search",
  social: "Social",
  // A session whose FIRST recorded view already carries a monkeytravel
  // referrer — i.e. we missed its real entry. Shown rather than folded into
  // Direct, which it would inflate by about a fifth.
  internal: "Continuation (unattributed)",
  dev: "Dev/Preview",
  google: "Google",
  bing: "Bing",
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  youtube: "YouTube",
  tiktok: "TikTok",
  other: "Other",
};

const SOURCE_COLORS: Record<string, string> = {
  direct: "#0A4B73",
  ai_assistant: "#7c3aed",
  other_search: "#0891b2",
  social: "#db2777",
  internal: "#64748b",
  dev: "#94a3b8",
  google: "#4285f4",
  bing: "#00809d",
  facebook: "#1877f2",
  instagram: "#e4405f",
  twitter: "#1da1f2",
  linkedin: "#0a66c2",
  reddit: "#ff4500",
  youtube: "#ff0000",
  tiktok: "#010101",
  other: "#a78bfa",
};

export default function AcquisitionEngagement({ acquisition, engagement }: AcquisitionEngagementProps) {
  // Dev/preview traffic is ours; "internal" stays visible because it is a
  // measurement gap worth seeing, not a channel to hide.
  const channels = acquisition.channels.filter((c) => c.channel !== "dev");
  const totalSessions = channels.reduce((sum, c) => sum + c.entrySessions, 0);
  const maxSessions = Math.max(...channels.map((c) => c.entrySessions), 1);

  const { timeToFirstTrip: ttt } = engagement;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Acquisition / Traffic Sources */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </span>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Acquisition</h2>
            <p className="text-xs text-slate-500">
              {totalSessions.toLocaleString("en-US")} sessions, last {acquisition.windowDays} days · first-party, no consent gate
            </p>
          </div>
        </div>

        {channels.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">No acquisition data yet</div>
        ) : (
          <div className="space-y-3" data-testid="acquisition-channels">
            {channels.map((c) => {
              const barWidth = (c.entrySessions / maxSessions) * 100;
              const color = SOURCE_COLORS[c.channel] || SOURCE_COLORS.other;
              return (
                <div key={c.channel}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-sm text-slate-700 font-medium truncate">
                        {SOURCE_LABELS[c.channel] || c.channel}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500 flex-shrink-0">
                      {c.entrySessions.toLocaleString("en-US")} ({c.sharePct}%)
                      {c.entrySessions >= 30 && (
                        <>
                          {" · "}
                          <span
                            className="font-medium text-slate-600"
                            title="Share of these sessions that reached the wizard"
                          >
                            {c.wizardPct}% to wizard
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${barWidth}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })}
            {/* The intent signal is the point of this panel: it is the one
                acquisition question GA4 cannot answer at a 3% consent rate. */}
            <p className="text-[11px] text-slate-400 pt-1 leading-snug">
              &ldquo;To wizard&rdquo; is the share of arrivals that reached /trips/new in the same
              session. Hidden below 30 sessions, where the percentage says nothing.
            </p>
          </div>
        )}
      </div>

      {/* Engagement Metrics */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </span>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Engagement</h2>
            <p className="text-xs text-slate-500">Active users &amp; activation speed</p>
          </div>
        </div>

        {/* DAU / WAU / MAU */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="text-center p-3 bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl border border-blue-100">
            <div className="text-2xl font-bold text-blue-600">{engagement.dau}</div>
            <div className="text-xs text-blue-600 font-medium">DAU</div>
          </div>
          <div className="text-center p-3 bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-xl border border-purple-100">
            <div className="text-2xl font-bold text-purple-600">{engagement.wau}</div>
            <div className="text-xs text-purple-600 font-medium">WAU</div>
          </div>
          <div className="text-center p-3 bg-gradient-to-br from-indigo-50 to-indigo-100/50 rounded-xl border border-indigo-100">
            <div className="text-2xl font-bold text-indigo-600">{engagement.mau}</div>
            <div className="text-xs text-indigo-600 font-medium">MAU</div>
          </div>
        </div>

        {/* Stickiness */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-600">Stickiness (DAU/MAU)</span>
            <span className={`text-sm font-bold ${
              engagement.stickinessPct >= 20 ? "text-emerald-600" :
              engagement.stickinessPct >= 10 ? "text-amber-600" :
              "text-red-500"
            }`}>
              {engagement.stickinessPct}%
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                engagement.stickinessPct >= 20 ? "bg-emerald-500" :
                engagement.stickinessPct >= 10 ? "bg-amber-500" :
                "bg-red-400"
              }`}
              style={{ width: `${Math.min(engagement.stickinessPct, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-1">20%+ is excellent for consumer apps</p>
        </div>

        {/* Time to First Trip */}
        <div className="border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-600 mb-3 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Time to First Trip
          </h3>
          {ttt.usersCount === 0 ? (
            <p className="text-sm text-slate-500">No trip data yet</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-100">
                  <div className="text-lg font-bold text-emerald-600">
                    {ttt.medianHours < 1 ? `${Math.round(ttt.medianHours * 60)}m` :
                     ttt.medianHours < 24 ? `${ttt.medianHours}h` :
                     `${Math.round(ttt.medianHours / 24)}d`}
                  </div>
                  <div className="text-[10px] text-emerald-600">Median</div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="text-lg font-bold text-slate-600">
                    {ttt.avgHours < 1 ? `${Math.round(ttt.avgHours * 60)}m` :
                     ttt.avgHours < 24 ? `${ttt.avgHours}h` :
                     `${Math.round(ttt.avgHours / 24)}d`}
                  </div>
                  <div className="text-[10px] text-slate-500">Average</div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <span className="font-medium text-emerald-600">{ttt.within1h}</span> within 1h
                <span className="text-slate-300 mx-1">|</span>
                <span className="font-medium text-blue-600">{ttt.within24h}</span> within 24h
                <span className="text-slate-300 mx-1">|</span>
                <span className="font-medium text-slate-600">{ttt.within7d}</span> within 7d
                <span className="text-slate-300 mx-1">|</span>
                <span className="text-slate-500">{ttt.usersCount} total</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
