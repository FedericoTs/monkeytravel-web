"use client";

import { prefs } from "@/lib/platform/storage";

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
  coverImageUrl?: string | null;
}): Promise<AnonymousShareResult> {
  const res = await fetch("/api/trips/anonymous", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => null)) as
    | { data?: AnonymousShareResult; error?: string }
    | null;

  if (!res.ok || !json?.data?.shareUrl) {
    throw new Error(json?.error || "Could not create the share link.");
  }

  try {
    await prefs.set(CLAIM_TOKEN_KEY, json.data.claimToken);
  } catch {
    /* private mode / storage disabled — the link still works */
  }

  return json.data;
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
export async function claimPendingTrip(): Promise<string | null> {
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

    const json = (await res.json().catch(() => null)) as
      | { data?: { claimed?: boolean; tripId?: string | null } }
      | null;

    // A 401 means the session was not ready yet — keep the token so the next
    // auth transition can retry. Every other outcome is terminal: claimed, or
    // the server says unavailable (already claimed / expired / unknown), and
    // in both cases holding the token forever would mean retrying on every
    // future login of every future account on this device.
    if (res.status === 401) return null;

    await prefs.remove(CLAIM_TOKEN_KEY).catch(() => {});

    return json?.data?.claimed ? json.data.tripId ?? null : null;
  } catch {
    // Network failure — leave the token in place and try again next time.
    return null;
  }
}

/** Exported for tests and for the rare case a caller must clear state by hand. */
export const PENDING_CLAIM_STORAGE_KEY = CLAIM_TOKEN_KEY;
