import type { GrowthStats } from "@/lib/admin/growth/types";

// ============================================
// AHA MOMENT TABLE COMPONENT
// ============================================
export function AhaMomentTable({
  ahaMoments,
  meta,
}: {
  ahaMoments: GrowthStats["ahaMoments"];
  meta: GrowthStats["meta"];
}) {
  const actions = [
    { key: "generatedItinerary", label: "Generated a Trip" },
    { key: "sharedTrip", label: "Shared a Trip" },
    { key: "completedOnboarding", label: "Completed Onboarding" },
    { key: "usedAssistant", label: "Used AI Assistant" },
    { key: "createdInvite", label: "Created Invite Link" },
    { key: "joinedViaInvite", label: "Joined via Invite" },
    { key: "votedOnProposal", label: "Voted on Proposal" },
    { key: "createdProposal", label: "Created Proposal" },
  ] as const;

  // Only show actions with at least one cohort having a measurable rate.
  const rows = actions
    .map((a) => ({ ...a, data: ahaMoments[a.key] }))
    .filter((r) => r.data.didIt > 0 || r.data.didntDoIt > 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-[var(--foreground)]">Aha Moment Analysis</h3>
        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
          {meta.retentionMethod === "activity_proxy" ? "Activity-based D7 lift" : "D7 retention lift"}
        </span>
      </div>

      <p className="text-sm text-slate-500 mb-6">
        Which actions correlate with users coming back? Higher lift = stronger &quot;aha moment&quot; to push users toward.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-4">
          Not enough activity yet to measure retention lift.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="pb-3 font-medium">Action</th>
                <th className="pb-3 font-medium text-center">Did It</th>
                <th className="pb-3 font-medium text-center">Didn&apos;t</th>
                <th className="pb-3 font-medium text-right">Retention Lift</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const data = row.data;
                const isPositive = data.retentionLift > 0;
                const isStrong = Math.abs(data.retentionLift) >= 50;
                return (
                  <tr key={row.key} className="border-b border-slate-50 last:border-0">
                    <td className="py-4">
                      <span className="text-sm font-medium text-slate-700">{row.label}</span>
                    </td>
                    <td className="py-4 text-center">
                      <span className="text-sm font-semibold text-green-600">{data.didIt}%</span>
                    </td>
                    <td className="py-4 text-center">
                      <span className="text-sm font-semibold text-slate-500">{data.didntDoIt}%</span>
                    </td>
                    <td className="py-4 text-right">
                      <span
                        className={`inline-flex items-center gap-1 text-sm font-bold px-2 py-1 rounded-full ${
                          isPositive
                            ? isStrong
                              ? "bg-green-100 text-green-700"
                              : "bg-green-50 text-green-600"
                            : "bg-red-50 text-red-600"
                        }`}
                      >
                        {isPositive ? "+" : ""}
                        {data.retentionLift}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
        <p className="text-xs text-blue-700">
          <strong>Tip:</strong> actions with 50%+ lift are your aha-moment candidates — get new users to do them fast.
        </p>
      </div>
    </div>
  );
}
