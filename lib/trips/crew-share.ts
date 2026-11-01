import { isUuid } from "@/lib/utils/uuid";
/**
 * The account-free crew ask: turning an anonymous share link into a request
 * for votes, and reading the answer back.
 *
 * WHY THIS EXISTS
 * ---------------
 * Most planners say at step 1 that they travel with friends, yet the
 * group features behind a sign-up (collaborators, invites, votes, proposals)
 * go almost unused. The multiplayer feature people do use is the one that
 * needs no account (anonymous activity votes), and group-intent planners
 * save at least as often as solo ones: they are not the reluctant ones, they
 * need a way to include anybody.
 *
 * So the crew ask rides the anonymous share mint (shipped in the anon
 * share/keep loop) rather than the invite system: send a link, friends vote
 * with no account, the planner returns to a count.
 */

/** Vote tallies as the /api/shared/[token]/votes endpoint returns them. */
export type VoteTallies = Record<string, { up?: number; down?: number } | null | undefined>;

/**
 * The share link, marked as an ask when the planner asked.
 *
 * `?vote=1` tells the shared page to lead with the vote prompt. The token is
 * untouched, so a link that loses the marker (a chat app rewriting the URL,
 * someone retyping it) still opens the same trip — the marker only changes
 * which sentence the recipient reads first.
 */
export function crewShareUrl(rawUrl: string | null | undefined, mode: "share" | "crew"): string | null {
  if (!rawUrl) return null;
  if (mode !== "crew") return rawUrl;
  if (/[?&]vote=1(&|$)/.test(rawUrl)) return rawUrl;
  const [base, hash = ""] = rawUrl.split("#");
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}vote=1${hash ? `#${hash}` : ""}`;
}

/** How a share link is framed for the recipient. */
export type ShareFraming = "crew" | "plain";

/**
 * The framing a signed-in owner's share modal opens on.
 *
 * The anonymous crew ask, whose link opens on the vote, reaches a real
 * recipient far more often than the generic link a signed-in owner copies.
 * So a trip whose planner said "with friends" at step 1 opens on the crew
 * ask; everyone else keeps the plain link. Both stay one tap away.
 */
export function defaultShareFraming(tripIntent: "solo" | "group" | null | undefined): ShareFraming {
  return tripIntent === "group" ? "crew" : "plain";
}

/** The link to hand out for a framing — the crew ask carries ?vote=1. */
export function framedShareUrl(rawUrl: string | null | undefined, framing: ShareFraming): string | null {
  return crewShareUrl(rawUrl, framing === "crew" ? "crew" : "share");
}

/**
 * The share token out of a share URL.
 *
 * Parsed from the URL rather than threaded separately so the adopted-link case
 * works too: more than one share button can be on screen, only one of them
 * minted the link, and the others receive nothing but the URL.
 *
 * The UUID check is what makes it safe to take the last path segment: on a URL
 * with no token ("https://monkeytravel.app/") that segment is the HOSTNAME,
 * and returning it would send a nonsense request on every render. Matches the
 * validation in app/api/shared/[token]/votes/route.ts, so anything this
 * returns is a token that route will accept.
 */
export function shareTokenFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url.split("#")[0].split("?")[0].replace(/\/+$/, "");
  const last = path.split("/").pop();
  return last && isUuid(last) ? last : null;
}

/**
 * Total votes cast across every activity.
 *
 * Up and down both count: the planner's question is "did anyone answer?", and
 * a thumbs-down is an answer. Written to survive a malformed payload without
 * throwing — this number decorates a share box and must never break it.
 */
export function totalVotes(tallies: VoteTallies | null | undefined): number {
  if (!tallies || typeof tallies !== "object") return 0;
  let total = 0;
  for (const tally of Object.values(tallies)) {
    if (!tally || typeof tally !== "object") continue;
    const up = typeof tally.up === "number" && Number.isFinite(tally.up) ? tally.up : 0;
    const down = typeof tally.down === "number" && Number.isFinite(tally.down) ? tally.down : 0;
    total += up + down;
  }
  return total;
}
