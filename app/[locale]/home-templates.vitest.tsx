/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";

/** The home page's Curated escapes section shows only while templates are on. */

vi.mock("next-intl/server", () => {
  const t = Object.assign((key: string) => key, { raw: () => [], rich: (key: string) => key, has: () => true });
  return { getTranslations: async () => t, setRequestLocale: () => {} };
});
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/Footer", () => ({ default: () => null }));
vi.mock("@/components/PhoneMockup", () => ({ default: () => null }));
vi.mock("@/components/templates/CuratedEscapes", () => ({ default: () => null }));
vi.mock("@/components/home/HeroTripInput", () => ({ default: () => null }));
vi.mock("@/components/home/DestinationLeaderboard", () => ({ default: () => null }));
vi.mock("@/lib/leaderboard/destinations", () => ({ getDestinationLeaderboard: async () => [] }));
vi.mock("@/components/marketing/HeroDoodleBackground", () => ({ default: () => null }));
vi.mock("@/components/destinations", () => ({ DestinationCard: () => null }));
vi.mock("@/lib/i18n/routing", () => ({ Link: () => null }));

const { default: Home } = await import("./page");
const { default: CuratedEscapes } = await import("@/components/templates/CuratedEscapes");

/** Whether an element of `type` is anywhere in the tree the page returned. */
function contains(node: unknown, type: unknown): boolean {
  if (Array.isArray(node)) return node.some((child) => contains(child, type));
  if (!isValidElement(node)) return false;
  if (node.type === type) return true;
  return contains((node.props as { children?: unknown }).children, type);
}

afterEach(() => vi.unstubAllEnvs());

describe("the home page and the curated templates", () => {
  it.each(["en", "es"])("leaves them out with templates switched off (%s)", async (locale) => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "false");
    expect(contains(await Home({ params: Promise.resolve({ locale }) }), CuratedEscapes)).toBe(false);
  });

  it("shows them with templates on", async () => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "true");
    expect(contains(await Home({ params: Promise.resolve({ locale: "en" }) }), CuratedEscapes)).toBe(true);
  });
});
