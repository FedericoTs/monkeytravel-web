// Bananas currency system types
export * from './bananas';

// User types
export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  preferences: UserPreferences;
}

export interface UserPreferences {
  default_budget_tier?: "budget" | "balanced" | "premium";
  default_pace?: "relaxed" | "moderate" | "active";
  interests?: string[];
}

// ============================================================================
// CENTRALIZED CONSTANTS
// Use these arrays for validation; use the types for TypeScript
// ============================================================================

/** All valid trip statuses */
export const TRIP_STATUSES = ['planning', 'confirmed', 'active', 'completed', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

/** All valid time slots for activities */
export const TIME_SLOTS = ['morning', 'afternoon', 'evening'] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

/** All valid collaborator roles */
export const COLLABORATOR_ROLES = ['owner', 'editor', 'voter', 'viewer'] as const;

/** Roles that can be assigned via invite (excludes owner) */
export const INVITABLE_ROLES = ['editor', 'voter', 'viewer'] as const;

/** All valid proposal statuses */
export const PROPOSAL_STATUSES = ['pending', 'voting', 'approved', 'rejected', 'withdrawn', 'expired'] as const;

/** All valid activity voting statuses */
export const ACTIVITY_VOTING_STATUSES = ['proposed', 'voting', 'confirmed', 'rejected', 'deadlock', 'completed', 'skipped'] as const;

// ============================================================================

// Trip types
export interface Trip {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  start_date: string;
  end_date: string;
  status: TripStatus;
  visibility: "private" | "shared" | "public";
  cover_image_url?: string;
  tags?: string[];
  destination_ids?: string[];
  budget?: TripBudget;
  itinerary?: ItineraryDay[];
  share_token?: string;
  shared_at?: string;
  is_archived?: boolean;
  archived_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TripBudget {
  total: number;
  spent: number;
  currency: string;
  category_budgets?: Record<string, number>;
}

// Itinerary types
export interface ItineraryDay {
  day_number: number;
  date: string;
  title?: string;
  theme?: string;
  activities: Activity[];
  daily_budget?: DailyBudget;
  notes?: string;
}

export interface Activity {
  id?: string;
  time_slot: TimeSlot;
  start_time: string;
  duration_minutes: number;
  name: string;
  type:
    | "attraction" | "restaurant" | "activity" | "transport"
    | "food" | "cafe" | "bar" | "foodie" | "market" | "shopping"
    | "cultural" | "museum" | "landmark" | "spa" | "wellness"
    | "entertainment" | "nightlife" | "nature" | "park" | "event"
    | string;  // Allow custom types from AI generation
  description: string;
  location: string;
  address?: string; // Full street address for map links
  coordinates?: {
    lat: number;
    lng: number;
  };
  google_place_id?: string; // Google Maps Place ID for lookups
  estimated_cost: {
    amount: number;
    currency: string;
    tier: "free" | "budget" | "moderate" | "expensive";
  };
  tips: string[];
  booking_required: boolean;
  booking_url?: string;
  official_website?: string;
  image_url?: string;
}

export interface DailyBudget {
  total: number;
  breakdown: {
    activities: number;
    food: number;
    transport: number;
  };
}

// Generated itinerary from AI
export interface GeneratedItinerary {
  destination: {
    name: string;
    country: string;
    description: string;
    best_for: string[];
    weather_note: string;
  };
  days: ItineraryDay[];
  trip_summary: {
    total_estimated_cost: number;
    currency: string;
    highlights: string[];
    packing_suggestions: string[];
  };
  booking_links?: {
    flights: BookingLink[];
    hotels: BookingLink[];
  };
}

export interface BookingLink {
  provider: string;
  url: string;
  label: string;
}

// Place autocomplete prediction (Google Places API)
export interface PlacePrediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
  countryCode: string | null;
  flag: string;
  types: string[];
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  source?: "local" | "google"; // Track where result came from
}

// Travel segment for cached travel distances
export interface CachedTravelSegment {
  fromActivityId: string;
  toActivityId: string;
  mode: "WALKING" | "DRIVING" | "TRANSIT";
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  durationText: string;
}

// Cached travel data for a day
export interface CachedDayTravelData {
  dayNumber: number;
  segments: CachedTravelSegment[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
}

// Trip metadata stored in trip_meta JSONB column
// This data is generated by AI and preserved from the preview page
export interface TripMeta {
  weather_note?: string;           // Weather info for the destination
  highlights?: string[];           // Trip highlights (3-5 bullet points)
  booking_links?: {                // Affiliate booking links
    flights: BookingLink[];
    hotels: BookingLink[];
  };
  destination_best_for?: string[]; // Tags like "Culture", "Food", "Architecture"
  packing_suggestions?: string[];  // Suggested packing items
  packing_checked?: string[];      // Items user has marked as packed
  // Cached travel distances to avoid API calls on repeat visits
  travel_distances?: CachedDayTravelData[];
  travel_distances_hash?: string;  // Hash of itinerary used to validate cache
}

// ============================================================================
// EXPORT TYPES (PDF, Calendar)
// ============================================================================

/**
 * Base trip data structure for export (PDF, calendar, ICS)
 * Used by both basic and premium PDF generators
 */
export interface TripForExport {
  // Required fields
  title: string;
  startDate: string;
  endDate: string;
  itinerary: ItineraryDay[];
  // Optional fields (used by PDF exports)
  description?: string;
  budget?: { total: number; currency: string } | null;
}

/**
 * Extended trip data for premium PDF export
 * Includes all base fields plus cover images, gallery, and meta
 */
export interface PremiumTripForExport extends TripForExport {
  // Required for premium
  destination: string;
  // Optional premium features
  meta?: TripMeta;
  coverImageUrl?: string;
  galleryPhotos?: { url: string; thumbnailUrl: string }[];
}

/**
 * RGB color tuple for PDF styling
 */
export type RGB = [number, number, number];

/**
 * Activity type display configuration for PDF exports
 */
export interface ActivityTypeConfig {
  label: string;
  color: RGB;
  icon: string;
  bgLight: RGB;
}

// ============================================================================

// Trip vibe types (12 options: 8 practical + 4 fantasy/whimsical)
export type TripVibe =
  | "adventure"    // Outdoor activities, hiking, water sports, adrenaline
  | "cultural"     // Museums, heritage sites, local traditions, history
  | "foodie"       // Food markets, cooking classes, local cuisine, fine dining
  | "wellness"     // Spa, yoga, meditation, peaceful retreats
  | "romantic"     // Intimate experiences, sunset views, couple activities
  | "urban"        // City life, nightlife, architecture, trendy spots
  | "nature"       // Wildlife, national parks, wilderness, eco-tourism
  | "offbeat"      // Hidden gems, local secrets, non-touristy experiences
  | "wonderland"   // Alice in Wonderland vibes - quirky, whimsical, surreal spots
  | "movie-magic"  // Film locations, cinematic experiences, famous backdrops
  | "fairytale"    // Castles, enchanted forests, storybook villages
  | "retro";       // Vintage cafes, historic districts, nostalgic experiences

// Seasonal context for trip planning
export interface SeasonalContext {
  season: "spring" | "summer" | "autumn" | "winter";
  hemisphere: "northern" | "southern" | "tropical";
  avgTemp: { min: number; max: number };
  weather: string;
  holidays: string[];
  events: string[];
  crowdLevel: "low" | "moderate" | "high" | "peak";
}

// Vibe option for UI display
export interface VibeOption {
  id: TripVibe;
  label: string;
  emoji: string;
  color: string;
  description: string;
  details: string[];
  category: "practical" | "fantasy";
}

// User profile preferences that affect trip generation
export interface UserProfilePreferences {
  dietaryPreferences?: string[];  // e.g., ["vegetarian", "halal", "gluten-free"]
  travelStyles?: string[];        // e.g., ["adventure", "luxury", "solo"]
  accessibilityNeeds?: string[];  // e.g., ["wheelchair", "limited-mobility", "visual", "hearing"]
  // Scheduling preferences (from quiet hours settings)
  activeHoursStart?: number;      // Hour when user prefers to start activities (e.g., 8 = 8:00 AM)
  activeHoursEnd?: number;        // Hour when user prefers to end activities (e.g., 22 = 10:00 PM)
}

// Trip creation params
export interface TripCreationParams {
  destination: string;
  startDate: string;
  endDate: string;
  budgetTier: "budget" | "balanced" | "premium";
  pace: "relaxed" | "moderate" | "active";
  vibes: TripVibe[];  // Array of 1-3 vibes (ordered by priority)
  seasonalContext?: SeasonalContext;
  interests: string[];
  requirements?: string;
  // Profile-based preferences (fetched automatically from user profile)
  profilePreferences?: UserProfilePreferences;
}

// AI Assistant structured response types
export type AssistantCardType =
  | "activity_suggestion"  // Suggesting a new activity
  | "activity_replacement" // Replacing an existing activity
  | "activity_added"       // Confirmation that activity was added
  | "tip"                  // Quick tip or info
  | "comparison"           // Comparing multiple options
  | "confirmation"         // Action completed confirmation
  | "error"                // Error message
  | "duration_adjusted";   // Duration was adjusted

export interface AssistantActivityCard {
  type: "activity_suggestion" | "activity_added";
  activity: Activity;
  dayNumber?: number;
  reason?: string;
}

export interface AssistantReplacementCard {
  type: "activity_replacement";
  oldActivity: {
    id: string;
    name: string;
    type: Activity["type"];
  };
  newActivity: Activity;
  dayNumber: number;
  reason?: string;
  autoApplied?: boolean;  // Whether the change was automatically applied
}

export interface AssistantTipCard {
  type: "tip";
  icon: "lightbulb" | "warning" | "info" | "clock" | "money" | "weather";
  title: string;
  content: string;
}

export interface AssistantComparisonCard {
  type: "comparison";
  title: string;
  options: Array<{
    name: string;
    pros: string[];
    cons: string[];
    recommended?: boolean;
  }>;
}

export interface AssistantConfirmationCard {
  type: "confirmation";
  icon: "check" | "swap" | "plus" | "trash";
  title: string;
  description: string;
}

export interface AssistantErrorCard {
  type: "error";
  message: string;
}

export interface AssistantDurationCard {
  type: "duration_adjusted";
  activity: {
    id: string;
    name: string;
    type: Activity["type"];
  };
  oldDuration: number;
  newDuration: number;
  dayNumber: number;
  reason?: string;
  autoApplied?: boolean;
}

export interface AssistantScheduleReorderedCard {
  type: "schedule_reordered";
  dayNumber: number;
  reason: string;
  activities: {
    id: string;
    name: string;
    time: string;
    timeSlot: "morning" | "afternoon" | "evening";
  }[];
  autoApplied?: boolean;
}

export interface AssistantScheduleOptimizedCard {
  type: "schedule_optimized";
  dayNumber: number;
  reason: string;
  activities: {
    id: string;
    name: string;
    time: string;
    timeSlot: "morning" | "afternoon" | "evening";
  }[];
  autoApplied?: boolean;
}

export type AssistantCard =
  | AssistantActivityCard
  | AssistantReplacementCard
  | AssistantTipCard
  | AssistantComparisonCard
  | AssistantConfirmationCard
  | AssistantErrorCard
  | AssistantDurationCard
  | AssistantScheduleReorderedCard
  | AssistantScheduleOptimizedCard;

export interface StructuredAssistantResponse {
  summary: string;           // Brief text summary (1-2 sentences max)
  cards?: AssistantCard[];   // Optional structured cards
  action?: {
    type: "replace_activity" | "add_activity" | "remove_activity" | "reorder" | "adjust_duration";
    applied: boolean;        // Whether the action was auto-applied
    activityId?: string;     // For replace/remove actions
    dayNumber?: number;
    newActivity?: Activity;  // For add/replace actions
  };
}

// =====================================================
// Collaboration Types
// =====================================================

export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number];
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export interface TripCollaborator {
  id: string;
  trip_id: string;
  user_id: string;
  role: CollaboratorRole;
  invited_by: string | null;
  joined_at: string;
  // Joined from profiles table
  display_name: string;
  avatar_url: string | null;
  email?: string;
}

export interface TripInvite {
  id: string;
  trip_id: string;
  token: string;
  role: InvitableRole; // Can't invite as owner
  created_by: string | null;
  created_at: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  is_active: boolean;
}

// Role permissions helper
export const ROLE_PERMISSIONS: Record<CollaboratorRole, {
  canEdit: boolean;
  canVote: boolean;
  canSuggest: boolean;
  canView: boolean;
  canInvite: boolean;
  canRemove: boolean;
}> = {
  owner: { canEdit: true, canVote: true, canSuggest: true, canView: true, canInvite: true, canRemove: true },
  editor: { canEdit: true, canVote: true, canSuggest: true, canView: true, canInvite: true, canRemove: false },
  voter: { canEdit: false, canVote: true, canSuggest: true, canView: true, canInvite: false, canRemove: false },
  viewer: { canEdit: false, canVote: false, canSuggest: false, canView: true, canInvite: false, canRemove: false },
};

// Role display info
export const ROLE_INFO: Record<CollaboratorRole, {
  label: string;
  emoji: string;
  description: string;
  permissions: string[];
  restrictions: string[];
}> = {
  owner: {
    label: 'Owner',
    emoji: '👑',
    description: 'Full control over the trip',
    permissions: ['Edit activities', 'Manage team', 'Delete trip'],
    restrictions: [],
  },
  editor: {
    label: 'Editor',
    emoji: '✏️',
    description: 'Can edit and invite others',
    permissions: ['Edit activities', 'Vote on changes', 'Invite others'],
    restrictions: ['Cannot delete trip', 'Cannot remove owner'],
  },
  voter: {
    label: 'Voter',
    emoji: '🗳️',
    description: 'Can vote and suggest activities',
    permissions: ['Vote on activities', 'Suggest new places', 'View itinerary'],
    restrictions: ['Cannot edit directly', 'Cannot invite others'],
  },
  viewer: {
    label: 'Viewer',
    emoji: '👀',
    description: 'Read-only access',
    permissions: ['View full itinerary', 'See trip details'],
    restrictions: ['Cannot vote', 'Cannot suggest', 'Cannot edit'],
  },
};

// =====================================================
// Activity Voting Types
// =====================================================

export type VoteType = 'love' | 'flexible' | 'concerns' | 'no';

export type ActivityVotingStatus = (typeof ACTIVITY_VOTING_STATUSES)[number];

export type ReactionEmoji = 'fire' | 'money' | 'walking' | 'camera' | 'food' | 'clock' | 'heart' | 'star' | 'warning';

export interface ActivityVote {
  id: string;
  trip_id: string;
  activity_id: string;
  user_id: string;
  vote_type: VoteType;
  comment?: string;
  vote_weight: number;
  voted_at: string;
  updated_at?: string;
  // Joined user info
  user?: {
    display_name: string;
    avatar_url?: string;
  };
}

/**
 * Activity confirmation/voting record from database
 * Renamed from ActivityStatus to avoid collision with ActivityStatus in types/timeline.ts
 */
export interface ActivityConfirmationRecord {
  id: string;
  trip_id: string;
  activity_id: string;
  status: ActivityVotingStatus;
  proposed_by?: string;
  proposed_at: string;
  voting_started_at?: string;
  confirmed_at?: string;
  rejected_at?: string;
  confirmation_method?: 'unanimous' | 'majority' | 'auto_confirm' | 'owner_override' | 'timeout';
}

export interface ActivityReaction {
  id: string;
  trip_id: string;
  activity_id: string;
  user_id: string;
  emoji: ReactionEmoji;
  created_at: string;
}

export interface ConsensusResult {
  status: 'waiting' | 'voting' | 'likely_yes' | 'confirmed' | 'rejected' | 'deadlock';
  score: number;              // Weighted average of votes
  participation: number;      // 0-1, percentage of voters who voted
  hasStrongObjection: boolean; // Any "no" votes
  canAutoConfirm: boolean;    // Can be auto-confirmed based on time + score
  voteCounts: {
    love: number;
    flexible: number;
    concerns: number;
    no: number;
  };
  pendingVoters: string[];    // User IDs who haven't voted yet
}

// Vote weights for consensus calculation
export const VOTE_WEIGHTS: Record<VoteType, number> = {
  love: 2,      // Strong positive
  flexible: 1,  // Weak positive
  concerns: -1, // Weak negative
  no: -2,       // Strong negative (veto power)
};

// Vote display information - unified for both activities and proposals
// Uses translation keys for labels/descriptions (translate at render time with common.voting namespace)
export const VOTE_INFO: Record<VoteType, {
  labelKey: string;
  emoji: string;
  color: string;
  bgColor: string;
  requiresComment: boolean;
  descriptionKey: string;
}> = {
  love: {
    labelKey: 'types.love.label',
    emoji: '😍',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    requiresComment: false,
    descriptionKey: 'types.love.description',
  },
  flexible: {
    labelKey: 'types.flexible.label',
    emoji: '👌',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    requiresComment: false,
    descriptionKey: 'types.flexible.description',
  },
  concerns: {
    labelKey: 'types.concerns.label',
    emoji: '🤔',
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
    requiresComment: true,
    descriptionKey: 'types.concerns.description',
  },
  no: {
    labelKey: 'types.no.label',
    emoji: '👎',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    requiresComment: true,
    descriptionKey: 'types.no.description',
  },
};

// Reaction display information
export const REACTION_INFO: Record<ReactionEmoji, {
  label: string;
  emoji: string;
  description: string;
}> = {
  fire: { label: 'Must do', emoji: '🔥', description: 'Bucket list item!' },
  money: { label: 'Expensive', emoji: '💰', description: 'Pricey option' },
  walking: { label: 'Tiring', emoji: '🚶', description: 'Lots of walking' },
  camera: { label: 'Photo spot', emoji: '📸', description: 'Great for photos' },
  food: { label: 'Good food', emoji: '🍽️', description: 'Food highlight' },
  clock: { label: 'Time-sensitive', emoji: '⏰', description: 'Book early/specific time' },
  heart: { label: 'Romantic', emoji: '❤️', description: 'Couples favorite' },
  star: { label: 'Highlight', emoji: '⭐', description: 'Trip highlight' },
  warning: { label: 'Heads up', emoji: '⚠️', description: 'Note something' },
};

// Voting timing constants
export const VOTING_TIMING = {
  AUTO_CONFIRM_HOURS: 48,     // Auto-confirm if majority after 48h
  DEADLOCK_HOURS: 72,         // Escalate to owner after 72h
  REMINDER_HOURS: 24,         // Send reminder after 24h of inactivity
  MIN_PARTICIPATION: 0.5,     // At least 50% must vote
  STRONG_CONSENSUS_SCORE: 1.5, // Instant confirm if score >= 1.5
  REJECTION_THRESHOLD: -1,    // Reject if score <= -1
} as const;

// =====================================================
// Activity Proposal Types
// =====================================================

/**
 * Proposal type: what kind of change is being proposed
 * - 'new': Add new activity to an empty slot
 * - 'replacement': Replace an existing activity with a different one
 */
export type ProposalType = 'new' | 'replacement';

/**
 * Proposal lifecycle status (derived from PROPOSAL_STATUSES constant)
 * - 'pending': Just created, awaiting votes
 * - 'voting': Has at least one vote, voting in progress
 * - 'approved': Approved by consensus or owner
 * - 'rejected': Rejected by consensus or owner
 * - 'withdrawn': Withdrawn by proposer
 * - 'expired': Expired without resolution
 */
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * Proposal resolution method (how it was resolved)
 */
export type ProposalResolutionMethod =
  | 'consensus'        // Approved by group vote
  | 'owner_override'   // Owner force-approved/rejected
  | 'auto_approve'     // Auto-approved after timeout with positive score
  | 'timeout'          // Expired without resolution
  | 'withdrawn';       // Proposer withdrew

/**
 * Vote type for proposals - unified with activity votes for consistency
 * Uses same 4-level system: love (+2), flexible (+1), concerns (-1), no (-2)
 */
export type ProposalVoteType = VoteType;

/**
 * Activity proposal from a collaborator
 */
export interface ActivityProposal {
  id: string;
  trip_id: string;
  proposed_by: string;
  type: ProposalType;
  activity_data: Activity;
  target_activity_id?: string;  // For replacement: which activity to replace
  target_day: number;
  target_time_slot?: 'morning' | 'afternoon' | 'evening';
  note?: string;
  status: ProposalStatus;
  resolved_at?: string;
  resolved_by?: string;
  resolution_method?: ProposalResolutionMethod;
  created_at: string;
  updated_at: string;
  expires_at: string;
  // Joined data from users table
  proposer?: {
    display_name: string;
    avatar_url?: string;
  };
}

/**
 * Vote on a proposal
 */
export interface ProposalVote {
  id: string;
  proposal_id: string;
  user_id: string;
  vote_type: ProposalVoteType;
  comment?: string;
  rank?: number;  // For future tournament ranking
  voted_at: string;
  updated_at: string;
  // Joined data from users table
  user?: {
    display_name: string;
    avatar_url?: string;
  };
}

/**
 * Proposal consensus result (similar to ConsensusResult but for proposals)
 */
export interface ProposalConsensusResult {
  status: 'waiting' | 'voting' | 'likely_approve' | 'approved' | 'rejected' | 'deadlock' | 'expired';
  score: number;
  participation: number;
  hasStrongObjection: boolean;
  canAutoApprove: boolean;
  voteCounts: {
    love: number;
    flexible: number;
    concerns: number;
    no: number;
  };
  pendingVoters: string[];
  hoursRemaining: number;
}

/**
 * Proposal with votes and computed consensus
 */
export interface ProposalWithVotes extends ActivityProposal {
  votes: ProposalVote[];
  vote_summary: {
    love: number;
    flexible: number;
    concerns: number;
    no: number;
    total: number;
  };
  consensus?: ProposalConsensusResult;
  current_user_vote?: ProposalVoteType;
}

/**
 * Slot key format for grouping proposals
 * Format: "day-{dayIndex}-{timeSlot}" e.g., "day-0-morning"
 */
export type ProposalSlotKey = `day-${number}-${string}`;

/**
 * Generate a slot key from day and time slot
 */
export function getProposalSlotKey(day: number, timeSlot?: string): ProposalSlotKey {
  return `day-${day}-${timeSlot || 'any'}` as ProposalSlotKey;
}

/**
 * Vote weights for proposal consensus calculation
 * Now uses unified VOTE_WEIGHTS for consistency with activity voting
 * @deprecated Use VOTE_WEIGHTS instead
 */
export const PROPOSAL_VOTE_WEIGHTS = VOTE_WEIGHTS;

/**
 * Proposal vote display information
 * Now uses unified VOTE_INFO for consistency with activity voting
 * @deprecated Use VOTE_INFO instead
 */
export const PROPOSAL_VOTE_INFO = VOTE_INFO;

/**
 * Proposal timing constants (similar to voting)
 */
export const PROPOSAL_TIMING = {
  EXPIRY_DAYS: 7,             // Proposals expire after 7 days
  AUTO_APPROVE_HOURS: 48,     // Auto-approve if majority after 48h
  DEADLOCK_HOURS: 72,         // Escalate to owner if mixed votes after 72h
  MIN_PARTICIPATION: 0.5,     // At least 50% must vote
  STRONG_CONSENSUS_SCORE: 1.5, // Instant approve if score >= 1.5
  REJECTION_THRESHOLD: -1,    // Reject if score <= -1
} as const;
