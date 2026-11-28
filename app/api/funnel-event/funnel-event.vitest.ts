/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const inserted: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { POST } from "./route";

const TRIP = "3f2b6c1e-8a4d-4e2f-9b7a-1c2d3e4f5a6b";
const post = (body: unknown) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/funnel-event", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie: "mt_session_id=e2eprobe-test" },
    })
  );

beforeEach(() => {
  inserted.length = 0;
});

describe("client-fired funnel events", () => {
  it("records a trip card share with its format and method", async () => {
    const res = await post({ event_type: "trip_card_shared", trip_id: TRIP, format: "square", method: "native_share" });
    expect(res.status).toBe(204);
    expect(inserted).toEqual([
      {
        event_type: "trip_card_shared",
        trip_id: TRIP,
        session_id: "e2eprobe-test",
        user_id: "user-1",
        metadata: { format: "square", method: "native_share" },
      },
    ]);
  });

  it("records a share of a match result, which has no trip", async () => {
    const res = await post({ event_type: "trip_card_shared", kind: "match", method: "whatsapp" });
    expect(res.status).toBe(204);
    expect(inserted).toEqual([
      {
        event_type: "trip_card_shared",
        trip_id: null,
        session_id: "e2eprobe-test",
        user_id: "user-1",
        metadata: { kind: "match", method: "whatsapp" },
      },
    ]);
    expect((await post({ event_type: "trip_card_shared", kind: "match", method: "carrier-pigeon" })).status).toBe(400);
    expect((await post({ event_type: "trip_card_shared", kind: "poster", method: "whatsapp" })).status).toBe(400);
  });

  it("records a plan pressed under a place in a month's guide", async () => {
    const res = await post({ event_type: "plan_own_clicked", destination: "Rajasthan & North India", surface: "article_place" });
    expect(res.status).toBe(204);
    expect(inserted[0]?.metadata).toEqual({ destination: "Rajasthan & North India", referral_code: null, surface: "article_place" });
  });

  it("records a story's picture posted, by which one and how", async () => {
    const tripId = "99999999-2222-4333-8444-555555555555";
    for (const format of ["guess", "place"]) {
      inserted.length = 0;
      const res = await post({ event_type: "trip_card_shared", trip_id: tripId, format, method: "native_share" });
      expect(res.status).toBe(204);
      expect(inserted[0]?.metadata).toEqual({ format, method: "native_share" });
    }
    expect((await post({ event_type: "trip_card_shared", trip_id: tripId, format: "poster", method: "native_share" })).status).toBe(400);
  });

  it("records a plan pressed at the end of a trip's story, under that trip", async () => {
    const tripId = "99999999-2222-4333-8444-555555555555";
    const res = await post({ event_type: "plan_own_clicked", trip_id: tripId, destination: "Lisbon", surface: "story" });
    expect(res.status).toBe(204);
    expect(inserted[0]?.trip_id).toBe(tripId);
    expect(inserted[0]?.metadata).toEqual({ destination: "Lisbon", referral_code: null, surface: "story" });
    expect((await post({ event_type: "plan_own_clicked", destination: "Lisbon", surface: "storybook" })).status).toBe(400);
  });

  it("records how a friend's guess on a trip's story ended", async () => {
    const tripId = "99999999-2222-4333-8444-555555555555";
    expect((await post({ event_type: "story_guessed", trip_id: tripId, right: true, misses: 2 })).status).toBe(204);
    expect(inserted[0]).toMatchObject({ event_type: "story_guessed", trip_id: tripId, session_id: "e2eprobe-test" });
    expect(inserted[0]?.metadata).toEqual({ right: true, misses: 2 });
    inserted.length = 0;
    expect((await post({ event_type: "story_guessed", trip_id: tripId, right: false, misses: 6 })).status).toBe(204);
    expect(inserted[0]?.metadata).toEqual({ right: false, misses: 6 });
  });

  it("refuses a guess that couldn't have been played", async () => {
    const tripId = "99999999-2222-4333-8444-555555555555";
    for (const body of [
      { right: true, misses: 7 },
      { right: true, misses: -1 },
      { right: true, misses: 1.5 },
      { right: "yes", misses: 1 },
      { misses: 1 },
      { right: true },
    ]) {
      expect((await post({ event_type: "story_guessed", trip_id: tripId, ...body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await post({ event_type: "story_guessed", right: true, misses: 1 })).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("records a trip's story watched to its last part, after a guess or not", async () => {
    const tripId = "99999999-2222-4333-8444-555555555555";
    expect((await post({ event_type: "story_finished", trip_id: tripId, guessed: true })).status).toBe(204);
    expect(inserted[0]).toMatchObject({ event_type: "story_finished", trip_id: tripId });
    expect(inserted[0]?.metadata).toEqual({ guessed: true });
    expect((await post({ event_type: "story_finished", trip_id: tripId })).status).toBe(400);
    expect((await post({ event_type: "story_finished", guessed: false })).status).toBe(400);
  });

  it("records a plan pressed on a match result, with no trip to point to", async () => {
    const res = await post({ event_type: "plan_own_clicked", destination: "kyoto", surface: "match" });
    expect(res.status).toBe(204);
    expect(inserted[0]?.trip_id).toBeNull();
    expect(inserted[0]?.metadata).toEqual({ destination: "kyoto", referral_code: null, surface: "match" });
  });

  it("still records plan-own clicks with their destination and referral code", async () => {
    const res = await post({ event_type: "plan_own_clicked", trip_id: TRIP, destination: "Lisbon", referral_code: "abc" });
    expect(res.status).toBe(204);
    expect(inserted[0]?.metadata).toEqual({ destination: "Lisbon", referral_code: "abc" });
  });

  it("records which plan-own button was pressed, and only a known one", async () => {
    const res = await post({ event_type: "plan_own_clicked", trip_id: TRIP, destination: "Lisbon", surface: "after_vote" });
    expect(res.status).toBe(204);
    expect(inserted[0]?.metadata).toEqual({ destination: "Lisbon", referral_code: null, surface: "after_vote" });
    expect((await post({ event_type: "plan_own_clicked", trip_id: TRIP, surface: "popup" })).status).toBe(400);
    expect(inserted).toHaveLength(1);
  });

  it("rejects server-side events and card shares missing a trip or with an unknown format", async () => {
    expect((await post({ event_type: "share_link_visited", trip_id: TRIP })).status).toBe(400);
    expect((await post({ event_type: "trip_card_shared", format: "story", method: "download" })).status).toBe(400);
    expect((await post({ event_type: "trip_card_shared", trip_id: TRIP, format: "poster", method: "download" })).status).toBe(400);
    expect(inserted).toEqual([]);
  });
});
