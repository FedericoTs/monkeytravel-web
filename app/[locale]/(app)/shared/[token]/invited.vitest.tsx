// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Someone invited by email can open the trip's share link while signed in, and
 * nothing there let them in, so they read the trip and had no way to join it. The
 * real page runs up to the view, and the view is told about the invite only when
 * the viewer isn't in yet and a usable one waits at their own address.
 */

const s = vi.hoisted(() => ({
  viewer: null as { id: string; email?: string } | null,
  collaborator: false,
  invites: [] as Array<Record<string, unknown>>,
  inviteReadFails: false,
  logs: [] as unknown[][],
}));

vi.mock("./SharedTripView", () => ({ default: () => null }));
vi.mock("@/components/explore/TripEngagementSection", () => ({ default: () => null }));
vi.mock("@/lib/places/refreshItineraryPhotos", () => ({ refreshTripItinerary: async (days: unknown) => days }));
vi.mock("@/lib/analytics/funnel-events", () => ({ logSharedTripVisit: async () => {} }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: async () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/participants/request", () => ({ signedInUser: async () => s.viewer }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    fakeSupabase((q) => ({ data: q.table === "trip_collaborators" && s.collaborator ? { role: "editor" } : null, error: null })).client,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q) => {
      if (q.table === "trip_invites") {
        return s.inviteReadFails ? { data: null, error: { message: "read failed" } } : { data: s.invites, error: null };
      }
      return { data: q.table === "trips" ? TRIP : null, error: null };
    });
    s.logs.push(db.log);
    return db.client;
  },
}));

const TRIP = {
  id: "trip-1",
  user_id: "owner-1",
  title: "Lisbon Trip",
  description: null,
  start_date: "2027-05-10",
  end_date: "2027-05-12",
  itinerary: [],
  trip_meta: { destination: "Lisbon, Portugal" },
  visibility: "private",
};
const usable = { token: "invite-1", is_active: true, expires_at: new Date(Date.now() + 86_400_000).toISOString(), max_uses: 1, use_count: 0 };

const SharedTripView = (await import("./SharedTripView")).default;
const SharedTripPage = (await import("./page")).default;

async function open() {
  const page = (await SharedTripPage({ params: Promise.resolve({ locale: "en", token: "tok-1" }) })) as ReactElement<{
    children: Array<ReactElement<Record<string, unknown>>>;
  }>;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return page.props.children.find((child) => child?.type === SharedTripView)!.props;
}
const inviteReads = () => (s.logs.flat() as FakeQuery[]).filter((q) => q.table === "trip_invites");

beforeEach(() => {
  s.viewer = { id: "mate-1", email: "Mate@Example.com" };
  s.collaborator = false;
  s.invites = [usable];
  s.inviteReadFails = false;
  s.logs = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the share link, for someone invited by email", () => {
  it("offers their invite, found at their own address", async () => {
    const view = await open();
    expect(view.inviteHref).toBe("/invite/invite-1");
    expect(view.editorHref).toBeUndefined();
    expect(eqOf(inviteReads()[0], "trip_id")).toBe("trip-1");
    expect(eqOf(inviteReads()[0], "recipient_email")).toBe("mate@example.com");
  });

  it("offers nothing once the invite can't be used", async () => {
    s.invites = [{ ...usable, use_count: 1 }];
    expect((await open()).inviteHref).toBeUndefined();
    s.invites = [{ ...usable, is_active: false }];
    expect((await open()).inviteHref).toBeUndefined();
    s.invites = [];
    expect((await open()).inviteHref).toBeUndefined();
  });

  it("still shows the trip when the invite can't be read", async () => {
    s.inviteReadFails = true;
    expect((await open()).inviteHref).toBeUndefined();
  });

  it("doesn't look for one for a collaborator, who gets the editor", async () => {
    s.collaborator = true;
    const view = await open();
    expect(view.inviteHref).toBeUndefined();
    expect(view.editorHref).toBe("/trips/trip-1");
    expect(inviteReads()).toEqual([]);
  });

  it("doesn't look for one for the owner", async () => {
    s.viewer = { id: "owner-1", email: "owner@example.com" };
    const view = await open();
    expect(view.inviteHref).toBeUndefined();
    expect(view.isOwner).toBe(true);
    expect(inviteReads()).toEqual([]);
  });

  it("doesn't look for one for someone signed out", async () => {
    s.viewer = null;
    expect((await open()).inviteHref).toBeUndefined();
    expect(inviteReads()).toEqual([]);
  });
});
