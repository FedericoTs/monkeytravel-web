// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * The profile page hands the settings form what it read, and the form saves
 * whole settings objects. A profile that can't be read goes to the error page
 * instead of offering defaults to save over the stored settings.
 */

const REFUSED = { code: "57014", message: "canceling statement due to statement timeout" };
let refusing: string | null;
let profileRow: Record<string, unknown> | null;

const db = () => ({
  ...fakeSupabase((q) => {
    if (q.table === refusing) return { data: null, error: REFUSED };
    if (q.table === "users") return profileRow ? { data: profileRow, error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
    if (q.table === "trips") {
      return { data: [{ id: "trip-1", start_date: "2026-05-01", end_date: "2026-05-03", status: "planning", itinerary: null }], error: null };
    }
    return { data: null, error: null };
  }).client,
  auth: {
    getUser: async () => ({
      data: { user: { id: "user-1", email: "ana@example.com", created_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "email" } } },
    }),
  },
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("./ProfileClient", () => ({ default: () => null }));

const { default: ProfilePage } = await import("./page");
type Props = { profile: { notification_settings: Record<string, unknown> }; stats: { totalTrips: number } };
const props = async () => ((await ProfilePage()) as { props: Props }).props;

beforeEach(() => {
  refusing = null;
  profileRow = { id: "user-1", display_name: "Ana", notification_settings: { marketingNotifications: false } };
});

describe("the profile page", () => {
  it("hands the form the stored settings", async () => {
    const { profile, stats } = await props();
    expect(profile.notification_settings).toEqual({ marketingNotifications: false });
    expect(stats.totalTrips).toBe(1);
  });

  it("goes to the error page when the profile can't be read, instead of offering defaults to save", async () => {
    refusing = "users";
    await expect(props()).rejects.toMatchObject({ code: "57014" });
  });

  it("still shows the defaults for an account with no profile row", async () => {
    profileRow = null;
    expect((await props()).profile.notification_settings).toMatchObject({ marketingNotifications: true });
  });

  it("shows no trip stats when the trips can't be read, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    refusing = "trips";
    expect((await props()).stats.totalTrips).toBe(0);
    expect(logged).toHaveBeenCalledWith("[profile: trips] read failed:", REFUSED.message);
    logged.mockRestore();
  });
});
