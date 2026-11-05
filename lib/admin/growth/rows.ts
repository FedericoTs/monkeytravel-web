import type { SupabaseClient } from "@supabase/supabase-js";
import { readWholeTable } from "@/lib/supabase/read-all-rows";

export interface GrowthUser {
  id: string;
  display_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  onboarding_completed: boolean | null;
  subscription_tier: string | null;
  is_pro: boolean | null;
  referred_by_code: string | null;
  banana_balance: number | null;
  referral_tier: number | null;
  show_on_leaderboard: boolean | null;
  leaderboard_visibility: string | null;
}
export interface GrowthTrip {
  id: string;
  user_id: string | null;
  created_at: string;
  share_token: string | null;
  is_template: boolean | null;
}
export interface GrowthReferralCode {
  id: string;
  user_id: string;
  total_clicks: number | null;
  total_signups: number | null;
}
export interface GrowthConversation {
  id: string;
  user_id: string | null;
  created_at: string;
}
export interface GrowthCollaborator {
  id: string;
  trip_id: string;
  user_id: string;
  role: string;
  invited_by: string | null;
}
export interface GrowthInvite {
  id: string;
  trip_id: string;
  created_by: string | null;
  use_count: number | null;
}
export interface GrowthProposal {
  id: string;
  proposed_by: string | null;
  status: string;
  resolution_method: string | null;
}
export interface GrowthProposalVote {
  id: string;
  proposal_id: string;
  user_id: string;
  vote_type: string;
}
export interface GrowthBananaTransaction {
  id: string;
  user_id: string;
  amount: number;
  transaction_type: string;
  created_at: string;
  expires_at: string | null;
  expired: boolean | null;
}
export interface GrowthReferralTier {
  id: string;
  user_id: string;
  tier_1_unlocked_at: string | null;
  tier_2_unlocked_at: string | null;
  tier_3_unlocked_at: string | null;
}
export interface GrowthCatalogItem {
  id: string;
  name: string;
}
export interface GrowthRedemption {
  id: string;
  user_id: string;
  catalog_item_id: string;
  bananas_spent: number;
}
export interface GrowthAnonVote {
  id: string;
  voter_cookie_id: string | null;
  trip_id: string | null;
}

/** Everything the Growth tab counts from. Templates aren't anyone's trips, so they're left out. */
export interface GrowthRows {
  users: GrowthUser[];
  trips: GrowthTrip[];
  referralCodes: GrowthReferralCode[];
  aiConversations: GrowthConversation[];
  collaborators: GrowthCollaborator[];
  invites: GrowthInvite[];
  proposals: GrowthProposal[];
  proposalVotes: GrowthProposalVote[];
  bananaTransactions: GrowthBananaTransaction[];
  referralTiers: GrowthReferralTier[];
  redemptionCatalog: GrowthCatalogItem[];
  bananaRedemptions: GrowthRedemption[];
  anonVotes: GrowthAnonVote[];
}

/**
 * Every row the Growth tab counts from, read with the service role so the counts
 * cover everyone. A read that fails comes back empty and is named in `dataWarnings`,
 * so schema drift shows up as a banner rather than a silent wall of zeros.
 */
export async function readGrowthRows(db: SupabaseClient): Promise<{ rows: GrowthRows; dataWarnings: string[] }> {
  const [
    users,
    trips,
    referralCodes,
    aiConversations,
    collaborators,
    invites,
    proposals,
    proposalVotes,
    bananaTransactions,
    referralTiers,
    redemptionCatalog,
    bananaRedemptions,
    anonVotes,
  ] = await Promise.all([
    readWholeTable<GrowthUser>(
      db,
      "users",
      "id, display_name, created_at, last_sign_in_at, onboarding_completed, subscription_tier, is_pro, referred_by_code, banana_balance, referral_tier, show_on_leaderboard, leaderboard_visibility"
    ),
    readWholeTable<GrowthTrip>(db, "trips", "id, user_id, created_at, share_token, is_template"),
    readWholeTable<GrowthReferralCode>(db, "referral_codes", "id, user_id, total_clicks, total_signups"),
    readWholeTable<GrowthConversation>(db, "ai_conversations", "id, user_id, created_at"),
    readWholeTable<GrowthCollaborator>(db, "trip_collaborators", "id, trip_id, user_id, role, invited_by"),
    readWholeTable<GrowthInvite>(db, "trip_invites", "id, trip_id, created_by, use_count"),
    readWholeTable<GrowthProposal>(db, "activity_proposals", "id, proposed_by, status, resolution_method"),
    readWholeTable<GrowthProposalVote>(db, "proposal_votes", "id, proposal_id, user_id, vote_type"),
    readWholeTable<GrowthBananaTransaction>(
      db,
      "banana_transactions",
      "id, user_id, amount, transaction_type, created_at, expires_at, expired"
    ),
    readWholeTable<GrowthReferralTier>(
      db,
      "referral_tiers",
      "id, user_id, tier_1_unlocked_at, tier_2_unlocked_at, tier_3_unlocked_at"
    ),
    readWholeTable<GrowthCatalogItem>(db, "banana_redemption_catalog", "id, name"),
    readWholeTable<GrowthRedemption>(db, "banana_redemptions", "id, user_id, catalog_item_id, bananas_spent"),
    readWholeTable<GrowthAnonVote>(db, "anonymous_activity_votes", "id, voter_cookie_id, trip_id"),
  ]);

  const dataWarnings: string[] = [];
  const reads: Record<string, { error: { message: string } | null }> = {
    users,
    trips,
    referral_codes: referralCodes,
    ai_conversations: aiConversations,
    trip_collaborators: collaborators,
    trip_invites: invites,
    activity_proposals: proposals,
    proposal_votes: proposalVotes,
    banana_transactions: bananaTransactions,
    referral_tiers: referralTiers,
    banana_redemption_catalog: redemptionCatalog,
    banana_redemptions: bananaRedemptions,
    anonymous_activity_votes: anonVotes,
  };
  for (const [name, read] of Object.entries(reads)) {
    if (read.error) dataWarnings.push(`${name}: ${read.error.message}`);
  }
  if (dataWarnings.length) console.warn("[Admin Growth] query warnings:", dataWarnings);

  return {
    rows: {
      users: users.data ?? [],
      trips: (trips.data ?? []).filter((t) => !t.is_template),
      referralCodes: referralCodes.data ?? [],
      aiConversations: aiConversations.data ?? [],
      collaborators: collaborators.data ?? [],
      invites: invites.data ?? [],
      proposals: proposals.data ?? [],
      proposalVotes: proposalVotes.data ?? [],
      bananaTransactions: bananaTransactions.data ?? [],
      referralTiers: referralTiers.data ?? [],
      redemptionCatalog: redemptionCatalog.data ?? [],
      bananaRedemptions: bananaRedemptions.data ?? [],
      anonVotes: anonVotes.data ?? [],
    },
    dataWarnings,
  };
}
