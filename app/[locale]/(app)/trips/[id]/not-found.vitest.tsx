// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * /trips/[id] answers "not found" to a signed-in visitor who is not on the
 * trip. A signed-out one was sent to sign in first, so the page has to say
 * what happened and who can let them in, not just "page not found".
 */

const s = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalog = JSON.parse(readFileSync(join(process.cwd(), "messages", s.locale, "trips.json"), "utf8"));
    const messages = namespace.split(".").slice(1).reduce((node, key) => node[key], catalog);
    return (key: string) => messages[key];
  },
}));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import TripUnavailable from "./not-found";

async function page(locale: string) {
  s.locale = locale;
  return renderToStaticMarkup(await TripUnavailable());
}

describe("the trip page's not-found", () => {
  it("says the trip is not open to this account and who can invite them", async () => {
    const html = await page("en");
    expect(html).toContain("This trip isn’t open to you");
    expect(html).toContain("ask them to invite you with the Share button on the trip");
  });

  it("leads to My Trips and to planning a trip", async () => {
    const html = await page("en");
    expect(html).toMatch(/<a href="\/trips"[^>]*>My Trips<\/a>/);
    expect(html).toMatch(/<a href="\/trips\/new"[^>]*>Plan your own trip<\/a>/);
  });

  it("names the Share button as each language's trip page does", async () => {
    for (const [locale, share] of [["it", "Condividi"], ["es", "Compartir"], ["pt", "Compartilhar"]]) {
      const common = JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8"));
      expect(common.buttons.share).toBe(share);
      expect(await page(locale)).toContain(share);
    }
  });
});
