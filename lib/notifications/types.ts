/**
 * Notification type discriminator + per-type payload shapes.
 *
 * Keep this file in sync with the CHECK constraint in
 * supabase/migrations/20260523_notifications_scaffold.sql — adding a new
 * type means migrating the constraint AND adding a payload type here.
 */

export type NotificationType =
  | "collab_vote"
  | "collab_comment"
  | "collab_proposal"
  | "invite_accepted"
  | "trip_shared"
  | "system";

/**
 * Common payload fields shared by every notification type. The bell UI
 * uses these to render the dropdown row without needing per-type code.
 */
interface BasePayload {
  /** Short human-readable line. ~80 chars max. */
  message: string;
  /** Path to open when the user clicks the row. e.g. "/trips/abc/edit". */
  href?: string;
  /** Trip this notification belongs to (optional — system messages omit). */
  trip_id?: string;
}

export interface CollabVotePayload extends BasePayload {
  trip_id: string;
  voter_name: string;
  activity_label: string; // e.g. "Day 2 — Boqueria Market"
  vote_type: "up" | "down";
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
  collaborator_name: string;
  collaborator_email: string;
}

export interface TripSharedPayload extends BasePayload {
  trip_id: string;
  share_token: string;
  vote_count: number; // first-vote signal, e.g. "Someone voted on your shared trip!"
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
