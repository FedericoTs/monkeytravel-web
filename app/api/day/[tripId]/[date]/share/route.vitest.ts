/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import { signDayLink } from "@/lib/trips/day-link";

/**
 * "Send to the group" from the signed day page: the send key is the only
 * access check, the link is created on this tap only when the trip has none,
 * and two taps at once still end with one link.
 */

let client: ReturnType<typeof fakeSupabase>["client"];
let log: ReturnType<typeof fakeSupabase>["log"];
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
// The link comes from the guarded mint (lib/trips/share-token.vitest.ts).
const ensureShareToken = vi.fn<(tripId: string, visibility: string) => Promise<{ token: string; isNew: boolean }>>();
vi.mock("@/lib/trips/share-token", () => ({ ensureShareToken: (id: string, v: string) => ensureShareToken(id, v) }));

const logFunnelEventServer = vi.fn<(event: unknown) => Promise<void>>(async () => {});
vi.mock("@/lib/analytics/funnel-events", () => ({ logFunnelEventServer: (e: unknown) => logFunnelEventServer(e) }));
const captureServerEvent = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: (...a: unknown[]) => captureServerEvent(...a) }));
const enrichTripByIdAdmin = vi.fn<(...args: unknown[]) => Promise<null>>(async () => null);
vi.mock("@/lib/images/enrichTrip", () => ({ enrichTripByIdAdmin: (...a: unknown[]) => enrichTripByIdAdmin(...a) }));
const afterTasks: Array<() => Promise<unknown>> = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => afterTasks.push(task),
}));

const { POST } = await import("./route");

const OWNER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const TRIP = "3f6c2a8e-91d4-4b7a-a5e2-6c0d8b1f4e29";
const OTHER_TRIP = "0b5c3a52-6f0e-4c1e-9d3b-8a7f6e5d4c3b";
const SHARE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const RACED = "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a";
const MINTED = "7e6d5c4b-3a29-4180-8f7e-6d5c4b3a2918";
const DATE = "2026-10-16";

type Trip = { id: string; user_id: string | null; share_token: string | null; visibility: string; start_date: string; end_date: string };
let trip: Trip | null;

function answer(q: FakeQuery) {
  if (q.op === "rpc") return { data: "OWNERCODE", error: null };
  if (q.table !== "trips") return { data: null, error: null };
  return { data: trip, error: null };
}

const post = (s: unknown, tripId = TRIP, date = DATE, raw?: string) =>
  POST(
    new NextRequest(`https://monkeytravel.app/api/day/${tripId}/${date}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ?? JSON.stringify(s === undefined ? {} : { s }),
    }),
    { params: Promise.resolve({ tripId, date }) },
  );
const sendKey = (tripId = TRIP, date = DATE) => signDayLink(tripId, date, undefined, "send");
const updates = () => log.filter((q) => q.table === "trips" && q.op === "update");

beforeEach(() => {
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T09:00:00Z"));
  trip = { id: TRIP, user_id: OWNER, share_token: null, visibility: "private", start_date: "2026-10-14", end_date: "2026-10-18" };
  ensureShareToken.mockReset();
  ensureShareToken.mockImplementation(async () =>
    trip?.share_token ? { token: trip.share_token, isNew: false } : { token: MINTED, isNew: true },
  );
  afterTasks.length = 0;
  logFunnelEventServer.mockClear();
  captureServerEvent.mockClear();
  enrichTripByIdAdmin.mockClear();
  ({ client, log } = fakeSupabase(answer));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/day/[tripId]/[date]/share", () => {
  it("hands out an existing link, opened on that day, and changes nothing", async () => {
    trip!.share_token = SHARE;
    trip!.visibility = "shared";
    const res = await post(sendKey());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: `https://monkeytravel.app/shared/${SHARE}?ref=OWNERCODE&day=3`, isNew: false });
    expect(updates()).toHaveLength(0);
    expect(afterTasks).toHaveLength(0);
  });

  it("creates the link on the tap when the trip has none, as the Share button would", async () => {
    const res = await post(sendKey());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNew).toBe(true);
    expect(ensureShareToken).toHaveBeenCalledWith(TRIP, "shared");
    expect(body.url).toBe(`https://monkeytravel.app/shared/${MINTED}?ref=OWNERCODE&day=3`);

    await Promise.all(afterTasks.map((task) => task()));
    expect(logFunnelEventServer).toHaveBeenCalledWith({
      event_type: "share_link_created",
      trip_id: TRIP,
      user_id: OWNER,
      metadata: { via: "day_digest" },
    });
    expect(captureServerEvent).toHaveBeenCalledWith(OWNER, "crew_link_created", { tripId: TRIP, via: "day_digest" });
    expect(enrichTripByIdAdmin).toHaveBeenCalledWith(TRIP, "share");
  });

  it("keeps a listed trip public", async () => {
    trip!.visibility = "public";
    await post(sendKey());
    expect(ensureShareToken).toHaveBeenCalledWith(TRIP, "public");
  });

  it("uses the link another tap made first, and counts no new one", async () => {
    ensureShareToken.mockResolvedValueOnce({ token: RACED, isNew: false });
    const res = await post(sendKey());
    expect(await res.json()).toEqual({ url: `https://monkeytravel.app/shared/${RACED}?ref=OWNERCODE&day=3`, isNew: false });
    expect(afterTasks).toHaveLength(0);
  });


  it("refuses the day's view key, another trip's key and a forged one", async () => {
    for (const s of [signDayLink(TRIP, DATE), sendKey(OTHER_TRIP), sendKey(TRIP, "2026-10-17"), "123.abc", ""]) {
      const res = await post(s);
      expect(res.status, String(s)).toBe(403);
    }
    expect(log).toHaveLength(0);
  });

  it("says when the link has expired", async () => {
    vi.setSystemTime(new Date("2026-10-19T00:00:00Z"));
    const res = await post(sendKey());
    expect(res.status).toBe(410);
    expect(log).toHaveLength(0);
  });

  it("rejects a request without a key", async () => {
    expect((await post(undefined)).status).toBe(400);
    expect((await post(undefined, TRIP, DATE, "not json")).status).toBe(400);
  });

  it("finds nothing for a deleted trip, an ownerless one, or a date outside the trip", async () => {
    const cases: Array<Trip | null> = [
      null,
      { id: TRIP, user_id: null, share_token: SHARE, visibility: "shared", start_date: "2026-10-14", end_date: "2026-10-18" },
      { id: TRIP, user_id: OWNER, share_token: SHARE, visibility: "shared", start_date: "2026-10-01", end_date: "2026-10-05" },
    ];
    for (const row of cases) {
      trip = row;
      ({ client, log } = fakeSupabase(answer));
      expect((await post(sendKey())).status).toBe(404);
      expect(updates()).toHaveLength(0);
    }
  });

  it("fails cleanly when the link can't be read or written", async () => {
    ensureShareToken.mockRejectedValueOnce(new Error("boom"));
    expect((await post(sendKey())).status).toBe(500);
    expect(afterTasks).toHaveLength(0);
  });
});
