import type { GrowthStats } from "@/lib/admin/growth/types";

// ============================================
// COLLABORATION ANALYTICS COMPONENT
// ============================================
export function CollaborationAnalytics({ collaboration }: { collaboration: GrowthStats["collaboration"] }) {
  return (
    <div className="p-6 pt-2">
      <div className="mb-6">
        <p className="text-sm font-medium text-slate-600 mb-3">Adoption</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-2xl font-bold text-purple-700">{collaboration.collaborativeTrips}</p>
            <p className="text-xs text-purple-600">Collaborative Trips</p>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-2xl font-bold text-purple-700">{collaboration.totalInvitesCreated}</p>
            <p className="text-xs text-purple-600">Invites Created</p>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-2xl font-bold text-purple-700">{collaboration.inviteAcceptRate}%</p>
            <p className="text-xs text-purple-600">Accept Rate</p>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-2xl font-bold text-purple-700">{collaboration.avgCollaboratorsPerTrip || 0}</p>
            <p className="text-xs text-purple-600">Avg Team Size</p>
          </div>
        </div>
      </div>

      {collaboration.totalProposals > 0 ? (
        <>
          <div className="mb-6">
            <p className="text-sm font-medium text-slate-600 mb-3">Proposal Pipeline</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { label: "Pending", value: collaboration.proposalsByStatus.pending, color: "bg-slate-100 text-slate-700" },
                { label: "Voting", value: collaboration.proposalsByStatus.voting, color: "bg-blue-100 text-blue-700" },
                { label: "Approved", value: collaboration.proposalsByStatus.approved, color: "bg-green-100 text-green-700" },
                { label: "Rejected", value: collaboration.proposalsByStatus.rejected, color: "bg-red-100 text-red-700" },
                { label: "Withdrawn", value: collaboration.proposalsByStatus.withdrawn, color: "bg-amber-100 text-amber-700" },
                { label: "Expired", value: collaboration.proposalsByStatus.expired, color: "bg-gray-100 text-gray-700" },
              ].map((status) => (
                <div key={status.label} className={`text-center p-2 rounded-lg ${status.color}`}>
                  <p className="text-lg font-bold">{status.value}</p>
                  <p className="text-xs">{status.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>
                {collaboration.totalProposals} proposals from {collaboration.proposersCount} users
              </span>
              <span>Approval: {collaboration.proposalApprovalRate}%</span>
            </div>
          </div>

          <div className="mb-2">
            <p className="text-sm font-medium text-slate-600 mb-3">Voting Engagement</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <p className="text-2xl font-bold text-indigo-700">{collaboration.totalProposalVotes}</p>
                <p className="text-xs text-indigo-600">Total Votes</p>
              </div>
              <div className="text-center p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <p className="text-2xl font-bold text-indigo-700">{collaboration.uniqueVoters}</p>
                <p className="text-xs text-indigo-600">Unique Voters</p>
              </div>
              <div className="text-center p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <p className="text-2xl font-bold text-indigo-700">{collaboration.avgVotesPerProposal}</p>
                <p className="text-xs text-indigo-600">Avg Votes/Proposal</p>
              </div>
              <div className="text-center p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <p className="text-2xl font-bold text-indigo-700">{collaboration.participationRate}%</p>
                <p className="text-xs text-indigo-600">Participation</p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-500 text-center py-4">
          No activity proposals yet — the propose/vote feature hasn&apos;t been used.
        </p>
      )}
    </div>
  );
}
