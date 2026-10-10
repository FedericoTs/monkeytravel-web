/**
 * Notification type discriminator + per-type payload shapes.
 *
 * Keep this file in sync with the CHECK constraint in
 * supabase/migrations/20260523_notifications_scaffold.sql — adding a new
 * type means migrating the constraint AND adding a payload type here.
 */

import type { VoteType } from "@/types";

export type NotificationType =
  | "collab_vote"
  | "collab_comment"
  | "collab_proposal"
  | "invite_accepted"
  | "trip_shared"
  | "anon_vote"
  | "crew_joined"
  | "system";

/**
 * Common payload fields shared by every notification type. The bell UI
 * uses these to render the dropdown row without needing per-type code.
 */
interface BasePayload {
  /** Short human-readable line. ~80 chars max. */
  message: string;
  /** Path to open when the user clicks the row. e.g. "/trips/abc" (old "/trips/abc/edit" links redirect there). */
  href?: string;
  /** Trip this notification belongs to (optional — system messages omit). */
  trip_id?: string;
}

export interface CollabVotePayload extends BasePayload {
  trip_id: string;
  voter_name: string;
  activity_label: string; // e.g. "Day 2 — Boqueria Market"
  vote_type: "up" | "down";
  /** The exact vote; older rows only have vote_type. */
  vote?: VoteType;
}

export interface CollabCommentPayload extends BasePayload {
  trip_id: string;
  commenter_name: string;
  excerpt: string; // first ~100 chars of the comment
}

export interface CollabProposalPayload extends BasePayload {
  trip_id: string;
  proposer_name: string;
  proposed_activity: string;
  day_number: number;
}

export interface InviteAcceptedPayload extends BasePayload {
  trip_id: string;
  /** The bell names the trip in the viewer's language; older rows lack it. */
  tripName?: string;
  collaborator_name: string;
  collaborator_email: string;
}

export interface TripSharedPayload extends BasePayload {
  trip_id: string;
  share_token: string;
  vote_count: number; // first-vote signal, e.g. "Someone voted on your shared trip!"
}

/**
 * Crew Loop (2026-07): an anonymous visitor voted on a shared-link trip.
 * Throttled to one notification per voter per trip (the shared vote route
 * only enqueues on a voter's FIRST vote row for the trip), so an owner
 * isn't buzzed 30 times while one friend votes through the itinerary.
 */
export interface AnonVotePayload extends BasePayload {
  trip_id: string;
  tripId: string;
  tripName?: string;
  activityId: string;
  voteType: "up" | "down";
  /** voter_display_name if the voter gave one, else null. */
  voterName: string | null;
}

/**
 * Someone said "I'm going" on a shared trip, the first time for that trip.
 * The bell shows their current name, read from their "I'm going" row when
 * the list loads: a guest gives a name only after the tap.
 */
export interface CrewJoinedPayload extends BasePayload {
  trip_id: string;
  tripName: string;
  participant_id: string;
  name: string | null;
}

export interface SystemPayload extends BasePayload {
  category?: "release_note" | "billing" | "outage" | "tip";
}

export type NotificationPayload =
  | { type: "collab_vote"; data: CollabVotePayload }
  | { type: "collab_comment"; data: CollabCommentPayload }
  | { type: "collab_proposal"; data: CollabProposalPayload }
  | { type: "invite_accepted"; data: InviteAcceptedPayload }
  | { type: "trip_shared"; data: TripSharedPayload }
  | { type: "anon_vote"; data: AnonVotePayload }
  | { type: "crew_joined"; data: CrewJoinedPayload }
  | { type: "system"; data: SystemPayload };

/**
 * The row shape the bell UI receives from the API. Mirrors the table but
 * with the JSONB payload typed via the discriminator.
 */
export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  payload: BasePayload & Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  deleted_at: string | null;
}
