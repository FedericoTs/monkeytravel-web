// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * A saved trip's card links to its public page by slug. It used to fall back
 * to /shared/<token>, the trip's private group page, which lets whoever holds
 * the link join the group, vote and add shared expenses: a saver is not a
 * member. The page is rendered with the real TripCard and the HTML searched.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
const SLUG = "lisbon-trip-abc123";

// A stored row, share token included.
const ROW = {
  id: "trip-1",
  title: "Lisbon Trip",
  description: "Three days of trams and tiles",
  public_slug: SLUG,
  share_token: TOKEN,
  cover_image_url: null,
  tags: [],
  start_date: "2026-10-09",
  end_date: "2026-10-11",
  shared_at: "2026-10-01T00:00:00Z",
  trending_score: 0,
  view_count: 0,
  template_copy_count: 0,
  like_count: 0,
  save_count: 1,
  fork_count: 0,
  author_display_name: "Ana",
  author_note: null,
  is_editors_pick: false,
  travel_style: "classic",
  trip_meta: { destination: "Lisbon" },
  visibility: "public",
  is_hidden: false,
};

const tripSelects: string[] = [];
const tripFilters: unknown[][] = [];
// The code ships before the migration: both worlds must hold.
let grantApplied = true;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, className }: { href: string; children?: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => true }));
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/Footer", () => ({ default: () => null }));
vi.mock("@/components/ui/MobileBottomNav", () => ({ default: () => null }));
vi.mock("@/components/ui/PullToRefreshWrapper", () => ({ PullToRefreshWrapper: () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "saver-1" } } }) },
    from: (table: string) => {
      let refused = false;
      const q = {
        select: (cols: string) => {
          if (table === "trips") {
            tripSelects.push(cols);
            // The column grant refuses share_token and "*" to this client.
            if (grantApplied && (cols === "*" || cols.includes("share_token"))) refused = true;
          }
          return q;
        },
        eq: (...args: unknown[]) => (table === "trips" && tripFilters.push(["eq", ...args]), q),
        in: () => q,
        not: (...args: unknown[]) => (table === "trips" && tripFilters.push(["not", ...args]), q),
        order: () => q,
        then: (resolve: (v: unknown) => void) =>
          resolve(
            table === "trip_saves"
              ? { data: [{ trip_id: ROW.id, created_at: "2026-10-02T00:00:00Z" }], error: null }
              : refused
                ? { data: null, error: { code: "42501", message: "permission denied for table trips" } }
                : { data: [{ ...ROW }], error: null },
          ),
      };
      return q;
    },
  }),
}));

const { default: SavedPage } = await import("./page");

async function savedHtml() {
  return renderToStaticMarkup(await SavedPage({ params: Promise.resolve({ locale: "en" }) }));
}

beforeEach(() => {
  tripSelects.length = 0;
  tripFilters.length = 0;
});

describe.each([true, false])("saved trip cards (column grant applied: %s)", (applied) => {
  beforeEach(() => {
    grantApplied = applied;
  });

  it("link to the trip's public page by slug", async () => {
    const html = await savedHtml();
    expect(html).toContain(`href="/trip/${SLUG}"`);
  });

  it("never carry the share link or its token", async () => {
    const html = await savedHtml();
    expect(html).not.toContain("/shared/");
    expect(html).not.toContain(TOKEN);
  });

  it("read the slug, not the token, and only for public trips that have a page", async () => {
    await savedHtml();
    expect(tripSelects).toHaveLength(1);
    expect(tripSelects[0]).toContain("public_slug");
    expect(tripSelects[0]).not.toContain("share_token");
    expect(tripFilters).toContainEqual(["eq", "visibility", "public"]);
    expect(tripFilters).toContainEqual(["not", "public_slug", "is", null]);
  });
});
