import { relativeTime } from "@/lib/feed/shared";
import type { NotificationRow } from "./types";

/** A translator over common.share.notifications. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

const VOTES = ["love", "flexible", "concerns", "no"];

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/**
 * The bell's line for a notification, in the viewer's language, built from its
 * type and payload. A row's stored `message` is the English written when the
 * event happened: it is shown only when the payload lacks what the sentence
 * needs (system notes, types nothing sends yet).
 */
export function notificationText(n: Pick<NotificationRow, "type" | "payload">, t: Translate): string {
  const p = n.payload ?? {};
  switch (n.type) {
    case "crew_joined":
    case "anon_vote": {
      const key = n.type === "crew_joined" ? "crewJoined" : "anonVote";
      const name = text(n.type === "crew_joined" ? p.name : p.voterName);
      const trip = text(p.tripName);
      if (trip) return name ? t(key, { name, trip }) : t(`${key}Someone`, { trip });
      break;
    }
    case "invite_accepted": {
      const name = text(p.collaborator_name);
      const trip = text(p.tripName);
      if (name) return trip ? t("inviteAccepted", { name, trip }) : t("inviteAcceptedNoTrip", { name });
      break;
    }
    case "collab_vote": {
      const name = text(p.voter_name);
      // Older rows carry only vote_type, and "up" was only ever a love.
      const vote = text(p.vote) ?? (p.vote_type === "up" ? "love" : null);
      if (name) return t(`collabVote.${vote && VOTES.includes(vote) ? vote : "voted"}`, { name });
      break;
    }
    case "collab_proposal": {
      const name = text(p.proposer_name);
      const activity = text(p.proposed_activity);
      if (name && activity && typeof p.day_number === "number") {
        return t("collabProposal", { name, activity, day: p.day_number });
      }
      break;
    }
  }
  return text(p.message) ?? t("update");
}

/** "just now", "5 minutes ago", "yesterday", and the date once it is a week old, in `locale`. */
export function notificationTime(iso: string, locale: string, justNow: string, now: Date = new Date()): string {
  if (!Number.isFinite(Date.parse(iso))) return "";
  const rel = relativeTime(iso, now);
  if (rel.unit === "now") return justNow;
  if (rel.unit === "day" && rel.value >= 7) return new Date(iso).toLocaleDateString(locale);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-rel.value, rel.unit);
}
