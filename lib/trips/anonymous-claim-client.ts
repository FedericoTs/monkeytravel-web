"use client";

import { prefs } from "@/lib/platform/storage";
import { publishClaimedTrip } from "@/lib/trips/claimed-trip-signal";

/**
 * Client half of the anonymous share loop.
 *
 * A signed-out planner shares a trip, we keep the secret claim token, and the
 * first time they hold a session we hand the trip to their account. Everything
 * that touches that token lives here so the lifecycle is in one file rather
 * than smeared across the wizard and three auth entry points.
 *
 * Storage goes through `prefs` (lib/platform/storage) rather than raw
 * localStorage: inside the Capacitor shell localStorage is not durable across
 * app restarts, and losing the token means losing the user's trip. This is
 * exactly the "real data, not decoration" case that wrapper exists for.
 */

const CLAIM_TOKEN_KEY = "mt_pending_claim_token";
// What the trip was, so the UI can say "your Lisbon trip is still here" and
// the wizard can tell whether the draft on screen IS the shared trip. Stored
// beside the token, only meaningful while the token exists, cleared with it.
const PENDING_CLAIM_META_KEY = "mt_pending_claim_meta";

export interface PendingClaim {
  tripId: string;
  shareToken: string;
  shareUrl: string;
  destination: string;
  startDate: string;
  endDate: string;
  days: number;
  createdAt: string;
}

export function buildPendingClaim(
  result: { tripId: string; shareToken: string; shareUrl: string },
  payload: { destination: string; startDate: string; endDate: string; itinerary: unknown[] },
): PendingClaim {
  return {
    tripId: result.tripId,
    shareToken: result.shareToken,
    shareUrl: result.shareUrl,
    destination: payload.destination,
    startDate: payload.startDate,
    endDate: payload.endDate,
    days: Array.isArray(payload.itinerary) ? payload.itinerary.length : 0,
    createdAt: new Date().toISOString(),
  };
}

/** The trip this browser could still claim, or null. Requires the token; the metadata alone is nothing. */
export async function readPendingClaim(): Promise<PendingClaim | null> {
  try {
    const token = await prefs.get(CLAIM_TOKEN_KEY);
    if (!token) return null;
    const raw = await prefs.get(PENDING_CLAIM_META_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingClaim>;
    if (typeof p.tripId !== "string" || typeof p.shareToken !== "string" || typeof p.shareUrl !== "string") {
      return null;
    }
    return {
      tripId: p.tripId,
      shareToken: p.shareToken,
      shareUrl: p.shareUrl,
      destination: typeof p.destination === "string" ? p.destination : "",
      startDate: typeof p.startDate === "string" ? p.startDate : "",
      endDate: typeof p.endDate === "string" ? p.endDate : "",
      days: Number(p.days) || 0,
      createdAt: typeof p.createdAt === "string" ? p.createdAt : "",
    };
  } catch {
    return null;
  }
}

/** Forget the pending claim: token and metadata together. Never throws. */
export async function clearPendingClaim(): Promise<void> {
  await Promise.all([
    prefs.remove(CLAIM_TOKEN_KEY).catch(() => {}),
    prefs.remove(PENDING_CLAIM_META_KEY).catch(() => {}),
  ]);
}

export interface AnonymousShareResult {
  tripId: string;
  shareToken: string;
  shareUrl: string;
  claimToken: string;
  claimExpiresAt: string;
}

/**
 * Mint a share link for a trip built while signed out.
 *
 * Stores the claim token before returning, so a planner who shares and then
 * immediately closes the tab can still claim the trip when they come back and
 * sign up. Storage failure is non-fatal: the share link is the point, and a
 * private-mode browser that refuses writes should still get its link.
 */
export async function shareAnonymousTrip(payload: {
  title: string;
  description?: string;
  destination: string;
  startDate: string;
  endDate: string;
  itinerary: unknown[];
  /** Language of the itinerary text; the server stores it as trip_meta.locale. */
  locale?: string;
  coverImageUrl?: string | null;
  /**
   * "crew" when the planner is asking friends to vote rather than just
   * sharing a link. Recorded on the server's share_link_created row so the
   * crew loop can be measured separately from a plain share — 531 wizard
   * sessions a month say they are planning with friends and, before this,
   * three trips in the product's history ever had a second person on them.
   */
   intent?: "share" | "crew";
}): Promise<AnonymousShareResult> {
  const res = await fetch("/api/trips/anonymous", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // apiSuccess() returns the payload FLAT, not under a `data` key: `wrap`
  // defaults to false and not one of the 222 apiSuccess call sites in this
  // codebase opts into wrapping. Reading `json.data.shareUrl` here made a
  // perfectly successful 200 render the error state — the API created the
  // trip, the UI told the planner it had failed, and the row was orphaned
  // until the sweeper collected it. Caught only by clicking the real button.
  const json = (await res.json().catch(() => null)) as
    | (AnonymousShareResult & { error?: string })
    | null;

  if (!res.ok || !json?.shareUrl) {
    throw new Error(json?.error || "Could not create the share link.");
  }

  try {
    await prefs.set(CLAIM_TOKEN_KEY, json.claimToken);
    await prefs.set(PENDING_CLAIM_META_KEY, JSON.stringify(buildPendingClaim(json, payload)));
  } catch {
    /* private mode / storage disabled — the link still works */
  }

  return json;
}

/** True when this browser is holding a trip that could still be claimed. */
export async function hasPendingClaim(): Promise<boolean> {
  try {
    return Boolean(await prefs.get(CLAIM_TOKEN_KEY));
  } catch {
    return false;
  }
}

/**
 * Attempt to attach a previously shared anonymous trip to the now-signed-in
 * user. Safe to call on every auth transition: with no stored token it is a
 * no-op, and the server treats a replayed token as unavailable.
 *
 * Returns the claimed trip id, or null when there was nothing to claim.
 *
 * NEVER throws. This runs on the signup/login path, and a failed claim must
 * not break someone's ability to sign in — the worst case is that the trip
 * stays anonymous until the sweeper expires it.
 */
async function claimPendingTripOnce(): Promise<string | null> {
  let claimToken: string | null = null;
  try {
    claimToken = await prefs.get(CLAIM_TOKEN_KEY);
  } catch {
    return null;
  }
  if (!claimToken) return null;

  try {
    const res = await fetch("/api/trips/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimToken }),
    });

    // Flat, for the same reason as above — /api/trips/claim also returns via
    // apiSuccess. Reading `json.data.claimed` made every SUCCESSFUL claim look
    // like a failure to the client: the trip really was transferred server
    // side, but this returned null and the token was already cleared, so
    // nothing downstream could tell the planner their trip had arrived.
    const json = (await res.json().catch(() => null)) as
      | { claimed?: boolean; tripId?: string | null }
      | null;

    // A 401 means the session was not ready yet — keep the token so the next
    // auth transition can retry. Every other outcome is terminal: claimed, or
    // the server says unavailable (already claimed / expired / unknown), and
    // in both cases holding the token forever would mean retrying on every
    // future login of every future account on this device.
    if (res.status === 401) return null;

    await clearPendingClaim();

    const claimedId = json?.claimed ? json.tripId ?? null : null;
    // Announce before resolving, so a caller that lost the in-flight race
    // (below) can still find the id in the signal rather than reading
    // "nothing to claim" as "auto-save a fresh copy".
    if (claimedId) publishClaimedTrip(claimedId);
    return claimedId;
  } catch {
    // Network failure — leave the token in place and try again next time.
    return null;
  }
}

/** Exported for tests and for the rare case a caller must clear state by hand. */
export const PENDING_CLAIM_STORAGE_KEY = CLAIM_TOKEN_KEY;

// Two callers race the claim on sign-in: AuthProvider on SIGNED_IN and the
// wizard once it knows the draft on screen is the shared trip. Sent twice,
// the second request would answer `claimed:false` and the wizard would read
// that as "released" and auto-save a duplicate. One in-flight promise, shared.
let claimInFlight: Promise<string | null> | null = null;

/**
 * Attach a previously shared anonymous trip to the now-signed-in user.
 * Concurrent calls share one request. See claimPendingTripOnce for the
 * contract: never throws, returns the claimed trip id or null.
 */
export function claimPendingTrip(): Promise<string | null> {
  if (claimInFlight) return claimInFlight;
  claimInFlight = claimPendingTripOnce().finally(() => {
    claimInFlight = null;
  });
  return claimInFlight;
}
