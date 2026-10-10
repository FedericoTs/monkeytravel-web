/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SaveTripModal from "./SaveTripModal";

/**
 * "Save to My Trips" from a shared link copies the trip by its share token.
 * The public trip page has no token, so it saves by the trip's public slug,
 * and signing in first comes back to the public page, not a /shared link.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
const SLUG = "lisbon-trip-abc123";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  pushed: [] as string[],
  stored: [] as Array<[string, string]>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (url: string) => state.pushed.push(url) }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "en" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock("@/lib/analytics", () => ({ trackTemplateCopied: () => {}, trackTripCreated: () => {} }));
vi.mock("@/lib/native/haptics", () => ({ hapticSuccess: () => {}, hapticError: () => {} }));
vi.mock("@/components/native/PushOptInSheet", () => ({ markFirstTripSaved: () => {} }));
vi.mock("@/lib/platform/storage", () => ({
  prefs: {
    set: async (key: string, value: string) => {
      state.stored.push([key, value]);
    },
    get: async () => null,
    remove: async () => {},
  },
}));

let posted: Array<{ url: string; body: Record<string, unknown> }>;

function open(props: { shareToken?: string; publicSlug?: string }) {
  render(<SaveTripModal isOpen onClose={() => {}} tripTitle="Lisbon Trip" tripDestination="Lisbon" durationDays={3} onSuccess={() => {}} {...props} />);
}

beforeEach(() => {
  state.user = null;
  state.pushed = [];
  state.stored = [];
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      posted.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ tripId: "new-trip" }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("saving from the public trip page", () => {
  it("copies the trip by its slug", async () => {
    state.user = { id: "viewer-1" };
    open({ publicSlug: SLUG });
    fireEvent.click(screen.getByText("saveToTrips"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].url).toBe("/api/trips/duplicate");
    expect(Object.keys(posted[0].body).sort()).toEqual(["publicSlug", "startDate"]);
    expect(posted[0].body.publicSlug).toBe(SLUG);
  });

  it("comes back to the public page after signing in, keeping no token", async () => {
    open({ publicSlug: SLUG });
    fireEvent.click(screen.getByText("signUpToSave"));
    await waitFor(() => expect(state.pushed).toHaveLength(1));
    expect(state.pushed[0]).toBe(`/auth/login?redirect=${encodeURIComponent(`/trip/${SLUG}`)}`);
    const pending = JSON.parse(state.stored[0][1]);
    expect(pending.publicSlug).toBe(SLUG);
    expect(pending.shareToken).toBeUndefined();
    expect(posted).toEqual([]);
  });
});

describe("saving from a shared link is unchanged", () => {
  it("copies the trip by its token", async () => {
    state.user = { id: "viewer-1" };
    open({ shareToken: TOKEN });
    fireEvent.click(screen.getByText("saveToTrips"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(Object.keys(posted[0].body).sort()).toEqual(["shareToken", "startDate"]);
    expect(posted[0].body.shareToken).toBe(TOKEN);
  });

  it("comes back to the shared link after signing in", async () => {
    open({ shareToken: TOKEN });
    fireEvent.click(screen.getByText("signUpToSave"));
    await waitFor(() => expect(state.pushed).toHaveLength(1));
    expect(state.pushed[0]).toBe(`/auth/login?redirect=${encodeURIComponent(`/shared/${TOKEN}`)}`);
  });
});
