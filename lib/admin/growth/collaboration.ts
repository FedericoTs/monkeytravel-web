import type { GrowthRows } from "./rows";
import type { GrowthStats } from "./types";

/** Whether trips are planned together: invites, proposals, votes and who holds which role. */
export function collaborationStats({
  trips,
  collaborators,
  invites,
  proposals,
  proposalVotes,
}: GrowthRows): GrowthStats["collaboration"] {
  const withStatus = (status: string) => proposals.filter((p) => p.status === status).length;
  const resolvedBy = (method: string) => proposals.filter((p) => p.resolution_method === method).length;
  const withRole = (role: string) => collaborators.filter((c) => c.role === role).length;
  const withVote = (vote: string) => proposalVotes.filter((v) => v.vote_type === vote).length;

  // Adoption. A trip is collaborative with two or more people on it.
  const collaboratorsByTrip = new Map<string, number>();
  collaborators.forEach((c) => collaboratorsByTrip.set(c.trip_id, (collaboratorsByTrip.get(c.trip_id) || 0) + 1));
  const collaborativeTripSizes = Array.from(collaboratorsByTrip.values()).filter((count) => count >= 2);
  const totalInvitesCreated = invites.length;
  const totalInviteUses = invites.reduce((sum, i) => sum + (i.use_count || 0), 0);

  // Proposals.
  const proposalsByStatus = {
    pending: withStatus("pending"),
    voting: withStatus("voting"),
    approved: withStatus("approved"),
    rejected: withStatus("rejected"),
    withdrawn: withStatus("withdrawn"),
    expired: withStatus("expired"),
  };
  const decided = proposalsByStatus.approved + proposalsByStatus.rejected;
  const proposalsWithVotes = new Set(proposalVotes.map((v) => v.proposal_id)).size;

  // Votes. Participation is voters among everyone on a trip but its owner.
  const uniqueVoters = new Set(proposalVotes.map((v) => v.user_id)).size;
  const nonOwnerCollaborators = collaborators.filter((c) => c.role !== "owner").length;

  return {
    collaborativeTrips: collaborativeTripSizes.length,
    tripsWithInvites: new Set(invites.map((i) => i.trip_id)).size,
    totalInvitesCreated,
    inviteAcceptRate: totalInvitesCreated > 0 ? Math.round((totalInviteUses / totalInvitesCreated) * 100) : 0,
    avgCollaboratorsPerTrip:
      collaborativeTripSizes.length > 0
        ? Math.round((collaborativeTripSizes.reduce((a, b) => a + b, 0) / collaborativeTripSizes.length) * 10) / 10
        : 0,
    totalCollaborators: collaborators.length,

    totalProposals: proposals.length,
    proposalsByStatus,
    proposalApprovalRate: decided > 0 ? Math.round((proposalsByStatus.approved / decided) * 100) : 0,
    avgVotesPerProposal: proposalsWithVotes > 0 ? Math.round((proposalVotes.length / proposalsWithVotes) * 10) / 10 : 0,
    proposersCount: new Set(proposals.map((p) => p.proposed_by)).size,

    totalProposalVotes: proposalVotes.length,
    uniqueVoters,
    voteDistribution: { approve: withVote("approve"), reject: withVote("reject") },
    participationRate: nonOwnerCollaborators > 0 ? Math.round((uniqueVoters / nonOwnerCollaborators) * 100) : 0,

    resolutionMethods: {
      consensus: resolvedBy("consensus"),
      ownerOverride: resolvedBy("owner_override"),
      autoApprove: resolvedBy("auto_approve"),
      timeout: resolvedBy("timeout"),
      withdrawn: resolvedBy("withdrawn"),
    },

    roleDistribution: {
      owner: withRole("owner"),
      editor: withRole("editor"),
      voter: withRole("voter"),
      viewer: withRole("viewer"),
    },

    funnel: {
      tripsCreated: trips.length,
      invitesCreated: totalInvitesCreated,
      invitesAccepted: totalInviteUses,
      proposalsCreated: proposals.length,
      proposalsResolved: decided + proposalsByStatus.withdrawn,
    },
  };
}
