/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The owner's email when someone going adds must-dos: to the trip's owner, at most one a trip a day, never for
 * the owner's own picks, and never failing the request that saved them.
 */

let trip: Record<string, unknown> | null = null;
let owner: Record<string, unknown> | null = null;
let readError: { table: string; message: string } | null = null;
let log: FakeQuery[] = [];
const sends: Array<Record<string, unknown>> = [];
let sendThrows = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase((q) => {
      if (readError?.table === q.table) return { data: null, error: { message: readError.message } };
      if (q.table === "trips") return { data: trip, error: null };
      if (q.table === "users") return { data: owner, error: null };
      return { data: null, error: null };
    });
    log = fake.log;
    return fake.client;
  },
}));
vi.mock("@/lib/email/send", () => ({
  dispatchEmail: async (options: Record<string, unknown>) => {
    if (sendThrows) throw new Error("resend down");
    sends.push(options);
    return { ok: true, status: "sent" };
  },
}));

const { sendPicksEmail, picksEmailKey } = await import("./picks-email");

const PICKS = { tripId: "trip-1", participantId: "row-1", guestUserId: null, guestName: "Bo", picks: ["Belém Tower", "Time Out Market"] };

beforeEach(() => {
  trip = { user_id: "owner-1", title: "Lisbon in May", trip_meta: { destination: "Lisbon, Portugal" } };
  owner = { email: "owner@example.com" };
  readError = null;
  sends.length = 0;
  sendThrows = false;
  vi.useRealTimers();
});

describe("sendPicksEmail", () => {
  it("emails the trip's owner who added what, with the trip opened on its card", async () => {
    await sendPicksEmail(PICKS);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      recipientEmail: "owner@example.com",
      recipientUserId: "owner-1",
      template: {
        id: "picks_added",
        props: {
          guestName: "Bo",
          picks: ["Belém Tower", "Time Out Market"],
          tripTitle: "Lisbon in May",
          tripDestination: "Lisbon, Portugal",
          tripUrl: expect.stringMatching(/\/trips\/trip-1\?open=who$/),
        },
      },
      metadata: { trip_id: "trip-1", participant_id: "row-1", picks: 2 },
    });
    // The trip is read without a deleted one, and the owner by the trip's own owner.
    const tripRead = log.find((q) => q.table === "trips");
    expect(eqOf(tripRead!, "id")).toBe("trip-1");
    expect(tripRead!.filters).toContainEqual(["is", "deleted_at", null]);
    expect(eqOf(log.find((q) => q.table === "users")!, "id")).toBe("owner-1");
  });

  it("is one a trip a day: the key is the trip and the day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T23:59:00Z"));
    await sendPicksEmail(PICKS);
    await sendPicksEmail({ ...PICKS, participantId: "row-2", guestName: "Ana", picks: ["Pastéis de Belém"] });
    vi.setSystemTime(new Date("2026-11-25T00:01:00Z"));
    await sendPicksEmail(PICKS);
    expect(sends.map((s) => s.idempotencyKey)).toEqual([
      "picks:trip-1:2026-11-24",
      "picks:trip-1:2026-11-24",
      "picks:trip-1:2026-11-25",
    ]);
    expect(picksEmailKey("trip-9", new Date("2026-01-02T10:00:00Z"))).toBe("picks:trip-9:2026-01-02");
  });

  it("never emails the owner about their own picks", async () => {
    await sendPicksEmail({ ...PICKS, guestUserId: "owner-1" });
    expect(sends).toEqual([]);
    // Someone else signed in still counts.
    await sendPicksEmail({ ...PICKS, guestUserId: "friend-1" });
    expect(sends).toHaveLength(1);
  });

  it("sends nothing for a trip that is gone, or an owner with no address", async () => {
    trip = null;
    await sendPicksEmail(PICKS);
    trip = { user_id: "owner-1", title: "Lisbon in May", trip_meta: {} };
    owner = { email: null };
    await sendPicksEmail(PICKS);
    owner = null;
    await sendPicksEmail(PICKS);
    expect(sends).toEqual([]);
  });

  it("names the destination from the title when the trip keeps none", async () => {
    trip = { user_id: "owner-1", title: "", trip_meta: {} };
    await sendPicksEmail(PICKS);
    expect((sends[0].template as { props: Record<string, unknown> }).props).toMatchObject({ tripTitle: "", tripDestination: "Unknown" });
  });

  it("stops quietly when a read fails or the send throws: the picks are saved either way", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    readError = { table: "trips", message: "timeout" };
    await expect(sendPicksEmail(PICKS)).resolves.toBeUndefined();
    readError = { table: "users", message: "timeout" };
    await expect(sendPicksEmail(PICKS)).resolves.toBeUndefined();
    expect(sends).toEqual([]);
    readError = null;
    sendThrows = true;
    await expect(sendPicksEmail(PICKS)).resolves.toBeUndefined();
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});
