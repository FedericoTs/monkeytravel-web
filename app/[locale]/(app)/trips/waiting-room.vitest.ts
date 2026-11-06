// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * My Trips reads the home's trip on the server: only the one trip, only when
 * there is one, and not for the holdout. A failed read leaves the countdown bare.
 */

const NEXT = { id: "trip-next", title: "Lisbon Trip", start_date: "2099-12-01", end_date: "2099-12-05", status: "planning", is_archived: false };
const PAST = { id: "trip-past", title: "Rome", start_date: "2001-01-01", end_date: "2001-01-05", status: "planning", is_archived: false };
let trips: unknown[];
let holdout: boolean;
let readFails: boolean;
let queries: FakeQuery[];

vi.mock("@/lib/supabase/server", () => ({
  createClientWithViewer: async () => {
    const fake = fakeSupabase((q) => {
      if (q.table === "trips" && q.end === "maybeSingle") {
        return readFails ? { data: null, error: { code: "57014", message: "timeout" } } : { data: { highlights: ["Tram 28"], packing: [], pencilled: null, day1: null }, error: null };
      }
      if (q.table === "trips") return { data: trips, error: null };
      if (q.table === "users") return { data: { display_name: "Ana" }, error: null };
      return { data: [], error: null };
    });
    queries = fake.log;
    return { supabase: fake.client, claimedId: "user-1", verified: Promise.resolve({ id: "user-1", email: "ana@example.com" }) };
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/components/trips/TripsPageClient", () => ({ default: () => null }));
vi.mock("@/lib/blog/api", () => ({ getAllFrontmatter: () => [], tOr: (_t: unknown, _key: string, fallback: string) => fallback }));
vi.mock("@/lib/trips/waiting-room", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trips/waiting-room")>()),
  inWaitingRoom: () => !holdout,
}));

const { default: TripsPage } = await import("./page");

type WaitingRoomProp = { trip: { id: string; highlights: string[] }; holdout: boolean } | null;
const open = async () => {
  const page = await TripsPage({ params: Promise.resolve({ locale: "en" }) });
  return (page as { props: { waitingRoom: WaitingRoomProp } }).props.waitingRoom;
};
const tripReads = () => queries.filter((q) => q.table === "trips" && q.end === "maybeSingle");

beforeEach(() => {
  trips = [NEXT, PAST];
  holdout = false;
  readFails = false;
});
afterEach(() => vi.unstubAllEnvs());

describe("the home's trip", () => {
  it("is read on its own, for that trip", async () => {
    const room = await open();
    expect(room).toMatchObject({ holdout: false, trip: { id: "trip-next", title: "Lisbon", highlights: ["Tram 28"] } });
    expect(tripReads()).toHaveLength(1);
    expect(tripReads()[0].filters).toContainEqual(["eq", "id", "trip-next"]);
  });

  it("isn't there with no trip coming, and nothing more is read", async () => {
    trips = [PAST];
    expect(await open()).toBeNull();
    expect(tripReads()).toEqual([]);
  });

  it("costs the holdout no read", async () => {
    holdout = true;
    expect(await open()).toMatchObject({ holdout: true, trip: { id: "trip-next", highlights: [] } });
    expect(tripReads()).toEqual([]);
  });

  it("still counts down when its details can't be read", async () => {
    readFails = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await open()).toMatchObject({ trip: { id: "trip-next", highlights: [] } });
  });

  it("is off with its switch", async () => {
    vi.stubEnv("WAITING_ROOM", "off");
    expect(await open()).toBeNull();
    expect(tripReads()).toEqual([]);
  });
});
