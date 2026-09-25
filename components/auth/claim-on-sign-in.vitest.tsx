import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

/**
 * When AuthProvider hands a signed-out shared trip to the account.
 *
 * Google/Apple sign-ins and emailed links finish on the server
 * (/auth/callback), so the page they land on hears INITIAL_SESSION, never
 * SIGNED_IN. The claim listened for SIGNED_IN only, so those sign-ins left the
 * trip unclaimed (6 of 69 anonymous shared trips were ever claimed). It now
 * runs on both, and only fetches the claim module when a token is waiting.
 */

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;
let fire: AuthCallback = () => {};
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: (cb: AuthCallback) => {
        fire = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));
vi.mock("@/lib/posthog/identify", () => ({ identify: vi.fn(async () => {}) }));

let storedToken: string | null = null;
vi.mock("@/lib/platform/storage", () => ({
  prefs: { get: vi.fn(async () => storedToken), set: vi.fn(), remove: vi.fn() },
}));
const claimPendingTrip = vi.fn(async () => "trip-1");
vi.mock("@/lib/trips/anonymous-claim-client", () => ({ claimPendingTrip: () => claimPendingTrip() }));
const publishClaimedTrip = vi.fn();
vi.mock("@/lib/trips/claimed-trip-signal", () => ({ publishClaimedTrip: (id: string) => publishClaimedTrip(id) }));

async function signal(event: string, user: boolean) {
  const { AuthProvider } = await import("./AuthProvider");
  render(
    <AuthProvider>
      <div />
    </AuthProvider>
  );
  await act(async () => {
    fire(event, user ? { user: { id: "u1" } } : null);
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => {
  storedToken = null;
  claimPendingTrip.mockClear();
  publishClaimedTrip.mockClear();
});
afterEach(() => cleanup());

describe("claim on sign-in", () => {
  it("a page landed on after Google or an emailed link (INITIAL_SESSION) claims the waiting trip", async () => {
    storedToken = "claim-token-abcdefghijklmnopqrstuvwxyz";
    await signal("INITIAL_SESSION", true);
    expect(claimPendingTrip).toHaveBeenCalledTimes(1);
    expect(publishClaimedTrip).toHaveBeenCalledWith("trip-1");
  });

  it("an in-browser sign-in (SIGNED_IN) still claims", async () => {
    storedToken = "claim-token-abcdefghijklmnopqrstuvwxyz";
    await signal("SIGNED_IN", true);
    expect(claimPendingTrip).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no trip is waiting", async () => {
    await signal("INITIAL_SESSION", true);
    expect(claimPendingTrip).not.toHaveBeenCalled();
  });

  it("does nothing signed out, or on other auth events", async () => {
    storedToken = "claim-token-abcdefghijklmnopqrstuvwxyz";
    await signal("INITIAL_SESSION", false);
    await signal("TOKEN_REFRESHED", true);
    await signal("SIGNED_OUT", false);
    expect(claimPendingTrip).not.toHaveBeenCalled();
  });
});
