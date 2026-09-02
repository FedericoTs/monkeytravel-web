import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The pending-claim record and the claim's concurrency contract (2026-09-02).
 *
 * Two callers race the claim on sign-in — AuthProvider on SIGNED_IN and the
 * wizard when it decides the draft on screen is the shared trip. If both went
 * to the network the second would get `claimed:false` and the wizard would
 * read that as "released" and auto-save a duplicate. So concurrent calls share
 * one in-flight promise, success publishes the claimed-trip signal before any
 * caller resolves, and the metadata that lets the UI say "your Lisbon trip is
 * still here" is stored beside the token and cleared with it.
 */

const store = new Map<string, string>();
vi.mock("@/lib/platform/storage", () => ({
  prefs: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); },
    remove: async (k: string) => { store.delete(k); },
  },
}));

const publishMock = vi.fn();
vi.mock("@/lib/trips/claimed-trip-signal", () => ({
  publishClaimedTrip: (id: string) => publishMock(id),
}));

import {
  buildPendingClaim,
  claimPendingTrip,
  clearPendingClaim,
  readPendingClaim,
  shareAnonymousTrip,
} from "./anonymous-claim-client";

const SHARE = {
  tripId: "trip-1",
  shareToken: "8b8c1a2e-0000-4000-8000-000000000001",
  shareUrl: "https://monkeytravel.app/shared/8b8c1a2e-0000-4000-8000-000000000001",
  claimToken: "claim-token-with-at-least-twenty-chars",
  claimExpiresAt: "2026-10-02T00:00:00.000Z",
};
const PAYLOAD = {
  title: "Lisbon Trip",
  destination: "Lisbon",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  itinerary: [{}, {}, {}],
};

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  store.clear();
  publishMock.mockClear();
});

describe("the pending-claim record", () => {
  it("is stored beside the token when a share is minted, and read back whole", async () => {
    stubFetch(SHARE);
    await shareAnonymousTrip(PAYLOAD);
    const pending = await readPendingClaim();
    expect(pending).toMatchObject({
      tripId: "trip-1",
      shareToken: SHARE.shareToken,
      shareUrl: SHARE.shareUrl,
      destination: "Lisbon",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      days: 3,
    });
    expect(store.get("mt_pending_claim_token")).toBe(SHARE.claimToken);
  });

  it("is nothing without the token, even if stale metadata survived", async () => {
    store.set("mt_pending_claim_meta", JSON.stringify(buildPendingClaim(SHARE, PAYLOAD)));
    expect(await readPendingClaim()).toBeNull();
  });

  it("is nothing when the metadata is unreadable", async () => {
    store.set("mt_pending_claim_token", SHARE.claimToken);
    store.set("mt_pending_claim_meta", "{not json");
    expect(await readPendingClaim()).toBeNull();
    store.set("mt_pending_claim_meta", JSON.stringify({ tripId: 5 }));
    expect(await readPendingClaim()).toBeNull();
  });

  it("clears both keys together", async () => {
    stubFetch(SHARE);
    await shareAnonymousTrip(PAYLOAD);
    await clearPendingClaim();
    expect(store.size).toBe(0);
  });
});

describe("claimPendingTrip", () => {
  it("publishes the claimed-trip signal before resolving, and clears both keys", async () => {
    stubFetch(SHARE);
    await shareAnonymousTrip(PAYLOAD);
    stubFetch({ claimed: true, tripId: "trip-1" });
    const id = await claimPendingTrip();
    expect(id).toBe("trip-1");
    expect(publishMock).toHaveBeenCalledWith("trip-1");
    expect(store.size).toBe(0);
  });

  it("shares one request between concurrent callers, so the loser cannot read 'unavailable'", async () => {
    stubFetch(SHARE);
    await shareAnonymousTrip(PAYLOAD);
    const fetchMock = stubFetch({ claimed: true, tripId: "trip-1" });
    const [a, b] = await Promise.all([claimPendingTrip(), claimPendingTrip()]);
    expect(a).toBe("trip-1");
    expect(b).toBe("trip-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("does not publish when the server says unavailable, and still clears the record", async () => {
    stubFetch(SHARE);
    await shareAnonymousTrip(PAYLOAD);
    stubFetch({ claimed: false, tripId: null });
    expect(await claimPendingTrip()).toBeNull();
    expect(publishMock).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("keeps the record on 401 so the next sign-in can retry", async () => {
    stubFetch(SHARE);
    await shareAnonymousTrip(PAYLOAD);
    stubFetch({ error: "unauthenticated" }, 401);
    expect(await claimPendingTrip()).toBeNull();
    expect(store.size).toBe(2);
  });
});
