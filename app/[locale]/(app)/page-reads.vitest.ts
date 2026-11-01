// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * A page whose main read the database refused goes to the locale error page,
 * not to "not found", which tells a visitor (and a search engine) the page is
 * gone. A row that isn't there, or a malformed id, is still not found.
 */

const TRIP = "11111111-2222-4333-8444-555555555555";
const REFUSED = { code: "57014", message: "canceling statement due to statement timeout" };
const MALFORMED_ID = { code: "22P02", message: "invalid input syntax for type uuid" };
let answer: { data: unknown; error: unknown };
const db = () => fakeSupabase(() => answer).client;

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...db(), auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async () => (key: string) => key,
  getFormatter: async () => ({ dateTime: () => "Monday" }),
}));
vi.mock("@/lib/trips/day-link", () => ({ verifyDayLink: () => ({ ok: true }), tripDayNumber: () => 1 }));
vi.mock("@/lib/places/refreshItineraryPhotos", () => ({ refreshItineraryPhotos: async (days: unknown) => days }));
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/Footer", () => ({ default: () => null }));
vi.mock("@/components/ui/MobileBottomNav", () => ({ default: () => null }));
vi.mock("@/components/creator/CreatorProfile", () => ({ default: () => null }));
vi.mock("@/components/ActivityCard", () => ({ default: () => null }));
vi.mock("@/components/trip/SendDayToGroup", () => ({ default: () => null }));
vi.mock("./trips/template/[id]/TemplatePreviewClient", () => ({ default: () => null }));

const { default: CreatorPage } = await import("./creator/[username]/page");
const { default: TripDayPage } = await import("./day/[tripId]/[date]/page");
const { default: TemplatePage } = await import("./trips/template/[id]/page");

const creator = (username: string) => CreatorPage({ params: Promise.resolve({ locale: "en", username }) });
const day = (tripId: string) =>
  TripDayPage({ params: Promise.resolve({ locale: "en", tripId, date: "2026-11-02" }), searchParams: Promise.resolve({ k: "key" }) });
const template = (id: string) => TemplatePage({ params: Promise.resolve({ locale: "en", id }) });

beforeEach(() => {
  answer = { data: null, error: null };
});

describe("a page whose read the database refused", () => {
  it("is the error page for a creator profile", async () => {
    answer = { data: null, error: REFUSED };
    await expect(creator("refused-ana")).rejects.toMatchObject({ code: "57014" });
  });

  it("is the error page for a day of a trip", async () => {
    answer = { data: null, error: REFUSED };
    await expect(day(TRIP)).rejects.toMatchObject({ code: "57014" });
  });

  it("is the error page for a template", async () => {
    answer = { data: null, error: REFUSED };
    await expect(template(TRIP)).rejects.toMatchObject({ code: "57014" });
  });
});

describe("a page with nothing to show", () => {
  it("is still not found for a creator who doesn't exist", async () => {
    await expect(creator("nobody-here")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("still shows the day page's notice for a malformed trip id", async () => {
    answer = { data: null, error: MALFORMED_ID };
    await expect(day("not-a-uuid")).resolves.toBeTruthy();
  });

  it("is still not found for a malformed template id", async () => {
    answer = { data: null, error: MALFORMED_ID };
    await expect(template("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
