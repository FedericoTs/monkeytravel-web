/**
 * Shared vocabulary for "I'm going" (Live Trip Phase 2): what the routes
 * accept, what the page receives, and the small pure helpers both sides use.
 */

/** The anonymous vote cookie — one identity for votes and participation. */
export const PARTICIPANT_COOKIE = "mt_anon_voter";
export const PARTICIPANT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

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

/** What the owner sees. Email is never included — only whether one was given. */
export interface OwnerParticipant {
  id: string;
  display_name: string | null;
  joined_at: string;
  source: ParticipantSource;
  has_email: boolean;
  has_account: boolean;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
