/**
 * The account-free crew ask: turning an anonymous share link into a request
 * for votes, and reading the answer back.
 *
 * WHY THIS EXISTS
 * ---------------
 * Group planning is the thing people say they came for and the thing the
 * product has never delivered. Measured 2026-09-03 over 30 days: 531 wizard
 * sessions answered "with friends" at step 1 against 225 solo, and 477 of the
 * group sessions generated a trip. Across 449 live trips, all-time, there are
 * 3 collaborator rows, 6 invites, 0 activity votes and 0 proposals.
 *
 * The one multiplayer feature anyone uses is the one that needs no account:
 * `anonymous_activity_votes` has 51 rows. Every other group feature sits
 * behind a sign-up, and group-intent planners already save at a HIGHER rate
 * than solo ones (12.4% vs 9.6%) — they are not the reluctant ones, they were
 * just never given a way to include anybody.
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
const SHARE_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shareTokenFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url.split("#")[0].split("?")[0].replace(/\/+$/, "");
  const last = path.split("/").pop();
  return last && SHARE_TOKEN_RE.test(last) ? last : null;
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
