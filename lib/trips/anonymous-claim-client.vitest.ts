import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression tests for the anonymous share/claim CLIENT parsing.
 *
 * WHY THIS FILE EXISTS
 * The first version of this client read `json.data.shareUrl` and
 * `json.data.claimed`. But apiSuccess() returns the payload FLAT — `wrap`
 * defaults to false and not one of the 222 apiSuccess call sites in this repo
 * opts into wrapping. The result was a silent, expensive failure mode that
 * every other gate missed:
 *
 *   - `tsc` was happy: `data?: T` is a legal optional property.
 *   - The unit tests were happy: they covered the payload VALIDATOR, never the
 *     client's response parsing.
 *   - The API tests were happy: curl saw a 200 with correct JSON.
 *   - Production returned 200, created the trip row, and the UI showed the
 *     planner "Could not create the share link. Try again." The row was then
 *     orphaned until the sweeper collected it.
 *
 * It was caught only by clicking the real button on a real mobile viewport.
 * These tests pin the wire contract so a future change to either side fails
 * here instead of in front of a user.
 */

const setMock = vi.fn(async () => undefined);
const getMock = vi.fn(async () => null as string | null);
const removeMock = vi.fn(async () => undefined);

vi.mock("@/lib/platform/storage", () => ({
  prefs: {
    set: (...a: unknown[]) => setMock(...(a as [])),
    get: (...a: unknown[]) => getMock(...(a as [])),
    remove: (...a: unknown[]) => removeMock(...(a as [])),
  },
}));

import { shareAnonymousTrip, claimPendingTrip } from "./anonymous-claim-client";

// Pinned as a LITERAL, not imported: this is the persisted storage key, so
// changing it strands the claim token of every planner mid-flight between
// sharing and signing up. A rename must fail here and be a deliberate choice.
const CLAIM_TOKEN_KEY = "mt_pending_claim_token";

const payload = {
  title: "T",
  description: "d",
  destination: "Lisbon",
  startDate: "2026-10-05",
  endDate: "2026-10-09",
  itinerary: [{ day: 1 }],
};

// Exactly what apiSuccess(data) puts on the wire — flat, no `data` envelope.
const FLAT_SHARE = {
  tripId: "11111111-1111-1111-1111-111111111111",
  shareToken: "22222222-2222-2222-2222-222222222222",
  shareUrl: "https://monkeytravel.app/shared/22222222-2222-2222-2222-222222222222",
  claimToken: "a-claim-token-long-enough-to-be-real",
  claimExpiresAt: "2026-09-17T00:00:00.000Z",
};

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  setMock.mockClear();
  getMock.mockClear();
  removeMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("shareAnonymousTrip — wire contract", () => {
  it("parses the FLAT apiSuccess payload (the bug: expected json.data)", async () => {
    vi.stubGlobal("fetch", mockFetch(200, FLAT_SHARE));
    const res = await shareAnonymousTrip(payload);
    expect(res.shareUrl).toBe(FLAT_SHARE.shareUrl);
    expect(res.tripId).toBe(FLAT_SHARE.tripId);
  });

  it("persists the claim token so the trip survives into signup", async () => {
    vi.stubGlobal("fetch", mockFetch(200, FLAT_SHARE));
    await shareAnonymousTrip(payload);
    expect(setMock).toHaveBeenCalledWith(CLAIM_TOKEN_KEY, FLAT_SHARE.claimToken);
  });

  it("does NOT treat a wrapped {data:{...}} body as success", async () => {
    // If someone later flips this route to wrap:true, this must fail loudly
    // rather than silently telling the planner the share failed.
    vi.stubGlobal("fetch", mockFetch(200, { data: FLAT_SHARE }));
    await expect(shareAnonymousTrip(payload)).rejects.toThrow();
  });

  it("surfaces the server error message on a non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetch(429, { error: "Too many share links" }));
    await expect(shareAnonymousTrip(payload)).rejects.toThrow(/Too many share links/);
  });

  it("still returns the link when storage is unavailable (private mode)", async () => {
    setMock.mockRejectedValueOnce(new Error("storage disabled"));
    vi.stubGlobal("fetch", mockFetch(200, FLAT_SHARE));
    const res = await shareAnonymousTrip(payload);
    expect(res.shareUrl).toBe(FLAT_SHARE.shareUrl);
  });
});

describe("claimPendingTrip — wire contract", () => {
  it("reads the FLAT claim payload (the bug: expected json.data.claimed)", async () => {
    getMock.mockResolvedValueOnce("a-stored-claim-token");
    vi.stubGlobal("fetch", mockFetch(200, { claimed: true, tripId: "trip-9" }));
    await expect(claimPendingTrip()).resolves.toBe("trip-9");
  });

  it("returns null and clears the token when the server says unavailable", async () => {
    getMock.mockResolvedValueOnce("a-stored-claim-token");
    vi.stubGlobal("fetch", mockFetch(200, { claimed: false }));
    await expect(claimPendingTrip()).resolves.toBeNull();
    expect(removeMock).toHaveBeenCalled();
  });

  it("KEEPS the token on 401 so the next auth transition can retry", async () => {
    getMock.mockResolvedValueOnce("a-stored-claim-token");
    vi.stubGlobal("fetch", mockFetch(401, { error: "unauthorized" }));
    await expect(claimPendingTrip()).resolves.toBeNull();
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("never throws on a network failure, and keeps the token", async () => {
    getMock.mockResolvedValueOnce("a-stored-claim-token");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    await expect(claimPendingTrip()).resolves.toBeNull();
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("is a no-op with no stored token", async () => {
    getMock.mockResolvedValueOnce(null);
    const f = mockFetch(200, {});
    vi.stubGlobal("fetch", f);
    await expect(claimPendingTrip()).resolves.toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
