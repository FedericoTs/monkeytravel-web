/**
 * Shared vocabulary for "I'm going" (Live Trip Phase 2): what the routes
 * accept, what the page receives, and the small pure helpers both sides use.
 */

/** The anonymous vote cookie — one identity for votes and participation. */
export const PARTICIPANT_COOKIE = "mt_anon_voter";
export const PARTICIPANT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The length trip_participants.participant_cookie_id accepts. */
export function isParticipantCookieId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length >= 10 && value.length <= 60;
}

export const PARTICIPANT_SOURCES = ["shared", "public", "crew_ask"] as const;
export type ParticipantSource = (typeof PARTICIPANT_SOURCES)[number];

export function parseParticipantSource(value: unknown): ParticipantSource | null {
  return typeof value === "string" && (PARTICIPANT_SOURCES as readonly string[]).includes(value)
    ? (value as ParticipantSource)
    : null;
}

export const JOIN_ACTIONS = ["join", "leave", "update"] as const;
export type JoinAction = (typeof JOIN_ACTIONS)[number];

export function parseJoinAction(value: unknown): JoinAction | null {
  return typeof value === "string" && (JOIN_ACTIONS as readonly string[]).includes(value)
    ? (value as JoinAction)
    : null;
}

export const DISPLAY_NAME_MAX = 60;
export const EMAIL_MAX = 254;

/** Trimmed, bounded, single-spaced; null when empty. */
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/\s+/g, " ").trim().slice(0, DISPLAY_NAME_MAX).trim();
  return v.length > 0 ? v : null;
}

/** Lower-cased and bounded; null when empty; false when present but not an address. */
export function normalizeEmail(value: unknown): string | null | false {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v.length === 0) return null;
  if (v.length > EMAIL_MAX) return false;
  // One @, something on both sides, a dot in the domain, no spaces.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : false;
}

/** "Ana Lima" → "AL", "ana" → "A", "Ana (mobile)" → "A", "" → "?" */
export function initialsOf(name: string | null | undefined): string {
  // Only tokens that start with a letter or digit count — "(mobile)" or "-" do not.
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((p) => /^[\p{L}\p{N}]/u.test(p));
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** What the page shows about the group. Names are what participants typed. */
export interface ParticipantPublic {
  id: string;
  display_name: string | null;
  joined_at: string;
}

export interface ParticipantsResponse {
  /** Active participants (left_at is null). */
  count: number;
  /** Up to PUBLIC_NAMES_MAX of them, oldest first. */
  participants: ParticipantPublic[];
  me: {
    joined: boolean;
    display_name: string | null;
    has_email: boolean;
  };
}

export const PUBLIC_NAMES_MAX = 8;

/**
 * One person in the trip's group as the owner sees it (lib/trips/roster): the
 * owner, every collaborator and everyone who said they're going. Email is
 * never included — only whether one was given.
 */
export interface OwnerParticipant {
  /** Their "I'm going" row when they have one, else their account. */
  id: string;
  display_name: string | null;
  /** "owner" or their collaborator role; null for someone who only said they're going. */
  role: string | null;
  going: boolean;
  /** Shares new expenses (lib/trips/roster sharesExpenses). */
  in_split: boolean;
  has_account: boolean;
  has_email: boolean;
  /** When they said they're going. */
  joined_at: string | null;
  /** The "I'm going" row Remove takes back. */
  participant_id: string | null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
