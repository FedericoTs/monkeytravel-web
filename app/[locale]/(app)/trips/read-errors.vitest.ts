// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * A list that can't be read isn't an empty one. When the trips can't be read My
 * Trips goes to the error page, which offers a retry, instead of telling someone
 * they have no trips. What only decorates the page can fail on its own.
 */

const REFUSED = { code: "57014", message: "canceling statement due to statement timeout" };
let refusing: string | null;

const db = () =>
  fakeSupabase((q) => {
    if (q.table === refusing) return { data: null, error: REFUSED };
    if (q.table === "trips") return { data: [{ id: "trip-1", title: "Rome" }], error: null };
    if (q.table === "users") return { data: { display_name: "Ana", lifetime_referral_conversions: 2 }, error: null };
    return { data: [], error: null };
  }).client;

vi.mock("@/lib/supabase/server", () => ({
  createClientWithViewer: async () => ({
    supabase: db(),
    claimedId: "user-1",
    verified: Promise.resolve({ id: "user-1", email: "ana@example.com" }),
  }),
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

const { default: TripsPage } = await import("./page");
type Props = { trips: unknown[]; sharedTrips: unknown[]; displayName: string; lifetimeConversions: number };
const props = async () =>
  ((await TripsPage({ params: Promise.resolve({ locale: "en" }) })) as { props: Props }).props;

beforeEach(() => {
  refusing = null;
});

describe("My Trips", () => {
  it("lists what it read", async () => {
    expect(await props()).toMatchObject({ trips: [{ id: "trip-1" }], displayName: "Ana", lifetimeConversions: 2 });
  });

  it("goes to the error page when the trips can't be read, instead of saying there are none", async () => {
    refusing = "trips";
    await expect(props()).rejects.toMatchObject({ code: "57014" });
  });

  it("still lists the trips when the profile can't be read, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    refusing = "users";
    expect(await props()).toMatchObject({ trips: [{ id: "trip-1" }], displayName: "ana", lifetimeConversions: 0 });
    expect(logged).toHaveBeenCalledWith("[my trips: profile] read failed:", REFUSED.message);
    logged.mockRestore();
  });

  it("still lists the trips when the shared ones can't be read, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    refusing = "trip_collaborators";
    expect(await props()).toMatchObject({ trips: [{ id: "trip-1" }], sharedTrips: [] });
    expect(logged).toHaveBeenCalledWith("[my trips: shared] read failed:", REFUSED.message);
    logged.mockRestore();
  });
});
