/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A visit to a share link is one row, and how the link was opened is kept on it: as the group's ask,
 * as a day sent from an email, or as the trip's story.
 */

const cookieJar: Record<string, string> = {};
const inserted: Array<Record<string, unknown>> = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in cookieJar ? { value: cookieJar[name] } : undefined) }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
      },
    }),
  }),
}));

const { logSharedTripVisit } = await import("./funnel-events");

beforeEach(() => {
  for (const key of Object.keys(cookieJar)) delete cookieJar[key];
  inserted.length = 0;
});

describe("logSharedTripVisit", () => {
  it("writes the visit under the trip and the visitor's session", async () => {
    cookieJar.mt_session_id = "session-of-a-friend";
    await logSharedTripVisit("trip-1");
    expect(inserted).toEqual([
      { event_type: "share_link_visited", trip_id: "trip-1", session_id: "session-of-a-friend", user_id: null, anon_id: null, metadata: { crew_ask: false } },
    ]);
  });

  it("keeps the group's ask and the day a link pointed at", async () => {
    await logSharedTripVisit("trip-1", { crewAsk: true, day: 3 });
    expect(inserted[0]).toMatchObject({ session_id: null, metadata: { crew_ask: true, day: 3 } });
  });

  it("marks a link opened as the trip's story, and only that one", async () => {
    await logSharedTripVisit("trip-1", { crewAsk: false, story: true });
    await logSharedTripVisit("trip-1", { crewAsk: false, story: false });
    expect(inserted.map((row) => row.metadata)).toEqual([{ crew_ask: false, story: true }, { crew_ask: false }]);
  });
});
