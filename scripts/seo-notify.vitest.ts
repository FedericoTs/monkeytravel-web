import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { messageUrls, pickForInspection, report } from "./seo-notify.mjs";

/**
 * The deploy job must send pages whose title or description changed only in
 * messages/, and the scheduled check must reach every updated page before it
 * leaves the window without going over its per-run quota.
 */

const O = "https://monkeytravel.app";
const DAY = 864e5;

type Page = { loc: string; lastmod: string; t: number };
type Seen = { lastmod: string; checked: string; coverage: string | null; crawled: string | null };

const pageAt = (path: string, lastmod: string): Page => ({ loc: `${O}${path}`, lastmod, t: Date.parse(lastmod) });

function edited<T>(doc: T, change: (copy: T) => void): T {
  const copy = JSON.parse(JSON.stringify(doc)) as T;
  change(copy);
  return copy;
}

const LIVE = [
  O,
  `${O}/es`,
  `${O}/blog`,
  `${O}/es/blog`,
  `${O}/blog/where-to-go-in-january`,
  `${O}/es/blog/where-to-go-in-january`,
  `${O}/it/blog/where-to-go-in-january`,
  `${O}/blog/travel-packing-checklist`,
  `${O}/es/blog/travel-packing-checklist`,
  `${O}/blog/best-ai-trip-planners-compared`,
  `${O}/blog/tag/budget-travel`,
  `${O}/es/blog/tag/presupuesto`,
  `${O}/es/blog/tag/europa`,
  `${O}/destinations`,
  `${O}/es/destinations`,
  `${O}/destinations/paris`,
  `${O}/es/destinations/paris`,
  `${O}/es/destinations/rome`,
  `${O}/es/destinations/style/romantic`,
  `${O}/es/destinations/style/foodie`,
  `${O}/free-ai-trip-planner`,
  `${O}/it/free-ai-trip-planner`,
];

const BLOG = {
  meta: { title: "Travel Blog", description: "Guides and itineraries" },
  detail: { relatedPosts: "Related posts" },
  tag: { eyebrow: "Topic", metaTitle: "{tag} travel guides", metaDescription: "Every {tag} guide" },
  posts: {
    "where-to-go-in-january": { title: "Where to Go in January 2027: 12 Destinations", description: "The cheapest month up north." },
    "travel-packing-checklist": { title: "La Lista Definitiva para Hacer la Maleta", description: "La unica lista que necesitas." },
    "best-ai-trip-planners-compared": { title: "Best AI Trip Planners", description: "Compared." },
  },
};

describe("messageUrls: blog.json", () => {
  it("sends a post retitled only in messages, in that locale", () => {
    const after = edited(BLOG, (b) => {
      b.posts["travel-packing-checklist"].title = "Lista de viaje: qué llevar en la maleta";
    });
    expect(messageUrls("messages/es/blog.json", BLOG, after, LIVE)).toEqual([`${O}/es/blog/travel-packing-checklist`]);
  });

  it("uses no locale prefix for English", () => {
    const after = edited(BLOG, (b) => {
      b.posts["where-to-go-in-january"].description = "The cheapest month up north, and the four cheapest picks.";
    });
    expect(messageUrls("messages/en/blog.json", BLOG, after, LIVE)).toEqual([`${O}/blog/where-to-go-in-january`]);
  });

  it("maps each changed slug to its own URL", () => {
    const after = edited(BLOG, (b) => {
      b.posts["where-to-go-in-january"].title = "Dónde viajar en enero de 2027";
      b.posts["travel-packing-checklist"].description = "La única lista.";
    });
    expect(messageUrls("messages/es/blog.json", BLOG, after, LIVE)).toEqual([
      `${O}/es/blog/where-to-go-in-january`,
      `${O}/es/blog/travel-packing-checklist`,
    ]);
    expect(messageUrls("messages/it/blog.json", BLOG, after, LIVE)).toEqual([`${O}/it/blog/where-to-go-in-january`]);
  });

  it("skips a post that has no page in that locale", () => {
    const after = edited(BLOG, (b) => {
      b.posts["best-ai-trip-planners-compared"].title = "Los mejores planificadores con IA";
    });
    expect(messageUrls("messages/es/blog.json", BLOG, after, LIVE)).toEqual([]);
  });

  it("compares parsed JSON, so moving keys around sends nothing", () => {
    const reordered = { posts: BLOG.posts, tag: BLOG.tag, detail: BLOG.detail, meta: BLOG.meta };
    expect(messageUrls("messages/es/blog.json", BLOG, JSON.parse(JSON.stringify(reordered, null, 4)), LIVE)).toEqual([]);
  });

  it("ignores strings that every post or tag page shares", () => {
    const after = edited(BLOG, (b) => {
      b.detail.relatedPosts = "Keep reading";
      b.tag.eyebrow = "Theme";
    });
    expect(messageUrls("messages/es/blog.json", BLOG, after, LIVE)).toEqual([]);
  });

  it("sends the blog index for its title, and every tag page of the locale for the tag title", () => {
    const after = edited(BLOG, (b) => {
      b.meta.title = "Blog de viajes";
      b.tag.metaTitle = "Guías de {tag}";
    });
    expect(messageUrls("messages/es/blog.json", BLOG, after, LIVE)).toEqual([
      `${O}/es/blog`,
      `${O}/es/blog/tag/presupuesto`,
      `${O}/es/blog/tag/europa`,
    ]);
  });
});

describe("messageUrls: other files", () => {
  const DESTINATIONS = {
    meta: { titleIndex: "Destinations", descriptionIndex: "Explore", titleDetail: "{city} Travel Guide", descriptionDetail: "Plan {city}" },
    style: { metaTitle: "{tag} Destinations", heading: "{tag} destinations", content: { romantic: { intro: "Slow evenings." } } },
    tags: { romantic: "Romántico", foodie: "Gastronómico" },
  };

  it("destinations: the detail template moves every destination page of that locale, and nothing else", () => {
    const after = edited(DESTINATIONS, (d) => {
      d.meta.titleDetail = "Guía de {city}";
      d.style.heading = "Destinos {tag}";
    });
    expect(messageUrls("messages/es/destinations.json", DESTINATIONS, after, LIVE)).toEqual([
      `${O}/es/destinations/paris`,
      `${O}/es/destinations/rome`,
    ]);
  });

  it("destinations: a style page's own copy, and the tag label in its title, move that page", () => {
    const after = edited(DESTINATIONS, (d) => {
      d.style.content.romantic.intro = "Tardes lentas.";
      d.tags.foodie = "Para comer bien";
    });
    expect(messageUrls("messages/es/destinations.json", DESTINATIONS, after, LIVE)).toEqual([
      `${O}/es/destinations/style/romantic`,
      `${O}/es/destinations/style/foodie`,
    ]);
  });

  it("a landing page's own file moves that page, and landing.json the homepage", () => {
    expect(messageUrls("messages/it/freeTripPlanner.json", { hero: { title: "A" } }, { hero: { title: "B" } }, LIVE)).toEqual([
      `${O}/it/free-ai-trip-planner`,
    ]);
    expect(messageUrls("messages/es/landing.json", { hero: "A" }, { hero: "B" }, LIVE)).toEqual([`${O}/es`]);
    expect(messageUrls("messages/en/landing.json", { hero: "A" }, { hero: "B" }, LIVE)).toEqual([O]);
  });

  it("files that feed many pages without a title of their own send nothing", () => {
    expect(messageUrls("messages/es/common.json", { a: "x" }, { a: "y" }, LIVE)).toEqual([]);
  });
});

describe("pickForInspection", () => {
  it("takes pages not inspected since their update first, oldest first, then re-checks, and skips finished pages", () => {
    const now = Date.parse("2026-10-12T06:23:00Z");
    const pages = [
      pageAt("/a", "2026-10-05"),
      pageAt("/b", "2026-09-28"),
      pageAt("/c", "2026-10-03"),
      pageAt("/d", "2026-10-03"),
      pageAt("/e", "2026-10-04"),
    ];
    const state: Record<string, Seen> = {
      [`${O}/c`]: { lastmod: "2026-10-03", checked: "2026-10-08T06:30:00Z", coverage: "Discovered - currently not indexed", crawled: null },
      [`${O}/d`]: { lastmod: "2026-10-03", checked: "2026-10-08T06:30:00Z", coverage: "Submitted and indexed", crawled: "2026-10-06T09:00:00Z" },
      // Inspected before its latest update, so it counts as not inspected.
      [`${O}/e`]: { lastmod: "2026-09-21", checked: "2026-09-28T06:30:00Z", coverage: "Submitted and indexed", crawled: "2026-09-25T09:00:00Z" },
    };
    const picked = (limit: number) => pickForInspection(pages, state, limit, now).map((p: Page) => p.loc.slice(O.length));
    expect(picked(150)).toEqual(["/b", "/e", "/a", "/c"]);
    expect(picked(2)).toEqual(["/b", "/e"]);
  });

  // A wave of updates larger than one run's quota. The schedule comes from the
  // workflow, so trimming it below what the window needs fails here.
  const WAVE: Record<string, number> = {
    "2026-09-21": 8, "2026-09-28": 124, "2026-09-30": 41, "2026-10-01": 8,
    "2026-10-02": 24, "2026-10-03": 222, "2026-10-04": 17, "2026-10-05": 80,
  };
  const workflow = readFileSync(join(__dirname, "../.github/workflows/seo-notify.yml"), "utf8");
  const [, minute, hour, weekdays] = workflow.match(/cron: "(\d+) (\d+) \* \* ([\d,]+)"/) ?? [];

  it("inspects every updated page before it leaves the window, at most 150 a run", () => {
    expect(weekdays, "the check's cron line in seo-notify.yml").toBeTruthy();
    const pages = Object.entries(WAVE).flatMap(([day, n]) => Array.from({ length: n }, (_, i) => pageAt(`/p/${day}/${i}`, day)));
    const state: Record<string, Seen> = {};
    const inspected = new Set<string>();
    let biggest = 0;
    for (let d = Date.parse("2026-09-21"); d <= Date.parse("2026-11-02"); d += DAY) {
      if (!weekdays.split(",").map(Number).includes(new Date(d).getUTCDay())) continue;
      const now = d + (Number(hour) * 60 + Number(minute)) * 60e3;
      const window = pages.filter((p) => p.t >= now - 21 * DAY && p.t <= now - 4 * DAY).sort((a, b) => b.t - a.t);
      const batch: Page[] = pickForInspection(window, state, 150, now);
      biggest = Math.max(biggest, batch.length);
      batch.forEach((p, i) => {
        inspected.add(p.loc);
        // Some stay unindexed, so re-checks compete with first inspections.
        const indexed = i % 3 > 0;
        const at = new Date(now).toISOString();
        state[p.loc] = { lastmod: p.lastmod, checked: at, coverage: indexed ? "Submitted and indexed" : "Discovered - currently not indexed", crawled: indexed ? at : null };
      });
    }
    expect(biggest).toBeLessThanOrEqual(150);
    expect(pages.filter((p) => !inspected.has(p.loc)).map((p) => p.loc)).toEqual([]);
  });
});

describe("report", () => {
  const opts = { now: Date.parse("2026-10-12T06:23:00Z"), days: 21, minAge: 4, inspected: 1 };

  it("keeps listing what an earlier run found, and stays open while pages are not inspected", () => {
    const pages = [pageAt("/new", "2026-10-05"), pageAt("/old", "2026-10-03")];
    const state: Record<string, Seen> = {
      [`${O}/old`]: { lastmod: "2026-10-03", checked: "2026-10-08T06:31:00Z", coverage: "Discovered - currently not indexed", crawled: null },
    };
    const { lines, open } = report(pages, state, opts);
    expect(lines).toContain(`- \`${O}/old\` (Discovered - currently not indexed, updated 2026-10-03, checked 2026-10-08)`);
    expect(lines[0]).toContain("The next run starts with the 1 not inspected since their update.");
    expect(open).toBe(2);
  });

  it("lists at most 100 waiting pages, so the issue body stays small enough to save", () => {
    const pages = Array.from({ length: 120 }, (_, i) => pageAt(`/w/${i}`, "2026-10-03"));
    const state: Record<string, Seen> = Object.fromEntries(pages.map((p) => [
      p.loc,
      { lastmod: p.lastmod, checked: "2026-10-08T06:31:00Z", coverage: "Discovered - currently not indexed", crawled: null },
    ]));
    const { lines, open } = report(pages, state, opts);
    expect(lines.filter((l: string) => l.startsWith("- `"))).toHaveLength(100);
    expect(lines).toContain("- …and 20 more");
    expect(open).toBe(120);
  });

  it("closes only once every page was inspected and indexed since its update", () => {
    const pages = [pageAt("/a", "2026-10-03")];
    const state: Record<string, Seen> = {
      [`${O}/a`]: { lastmod: "2026-10-03", checked: "2026-10-08T06:31:00Z", coverage: "Submitted and indexed", crawled: "2026-10-06T10:00:00Z" },
    };
    expect(report(pages, state, opts).open).toBe(0);
  });
});
