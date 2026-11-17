/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FOOTER_PLANNERS, PLANNER_PAGES } from "@/lib/seo/planner-pages";

/**
 * The footer is on every page, so what it links gets found. The translations are
 * the real ones; only the framework around them is faked.
 */

const common = (locale: string) => JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8"));
let locale = "en";

type Tree = { [key: string]: Tree | string };
const walk = (tree: Tree, path: string) =>
  path.split(".").reduce<Tree | string | undefined>((node, key) => (typeof node === "object" ? node[key] : undefined), tree);

vi.mock("next-intl/server", () => ({
  getLocale: async () => locale,
  getTranslations: async (namespace: string) => {
    const root = walk({ common: common(locale) }, namespace) as Tree;
    return (key: string) => (walk(root, key) as string | undefined) ?? `MISSING ${key}`;
  },
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/consent", () => ({ CookieSettingsButton: () => null }));
vi.mock("@/lib/blog/api", () => ({ getAllFrontmatter: () => [] }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { default: Footer } = await import("./Footer");

async function show(inLocale: string) {
  cleanup();
  locale = inLocale;
  render(await Footer());
}

describe("the footer's planner pages", () => {
  it("links every planner page for a search the home page doesn't answer", async () => {
    await show("en");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const path of ["/group-trip-planner", "/family-trip-planner", "/solo-trip-planner", "/weekend-trip-planner", "/budget-trip-planner", "/multi-city-trip-planner", "/backpacker"]) {
      expect(hrefs).toContain(path);
    }
  });

  it.each(["en", "es", "it", "pt"])("gives the home page its own words in %s, not another page", async (language) => {
    await show(language);
    const words = common(language).footer.planners;
    const list = screen.getByRole("heading", { name: words.title }).parentElement!;
    const home = within(list).getByRole("link", { name: words.freeAi });
    expect(home.getAttribute("href")).toBe("/");
  });

  it("sends no planner search of the home page's to another page", async () => {
    await show("en");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/free-ai-trip-planner");
    expect(hrefs).not.toContain("/ai-itinerary-generator");
  });

  it.each(["en", "es", "it", "pt"])("names them in %s, each with its own label under a heading", async (language) => {
    await show(language);
    const words = common(language).footer.planners;
    const list = screen.getByRole("heading", { name: words.title }).parentElement!;
    const labels = within(list).getAllByRole("link").map((a) => a.textContent);
    expect(labels).toEqual(FOOTER_PLANNERS.map(({ label }) => words[label]));
    expect(new Set(labels).size).toBe(FOOTER_PLANNERS.length);
  });

  it("no longer offers a waitlist that doesn't exist", async () => {
    await show("en");
    expect(screen.queryByRole("link", { name: /waitlist/i })).toBeNull();
  });
});

describe("the sitemap", () => {
  it("still lists every planner page, the two the footer leaves out included", () => {
    const source = readFileSync(join(process.cwd(), "app", "sitemap.ts"), "utf8");
    expect(source).toContain("PLANNER_PAGES.map(");
    expect(PLANNER_PAGES.map(({ path }) => path)).toEqual(expect.arrayContaining(["/free-ai-trip-planner", "/ai-itinerary-generator"]));
    expect(source).not.toMatch(/\/group-trip-planner/);
  });
});
