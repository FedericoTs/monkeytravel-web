import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getPostBySlug } from "./api";
import { placeOf, withPlacePlanLinks } from "./place-plan-links";

/**
 * A month's guide ranks its places as "N. Place — why", one section each. Under
 * each heading the reader gets a link that opens the planner on that place, in
 * that month.
 */

describe("placeOf", () => {
  it("reads the place a ranked section is about", () => {
    expect(placeOf("1. Japan — Cherry Blossom, Timed Carefully")).toBe("Japan");
    expect(placeOf("12. Nepal — Spring Trekking Opens")).toBe("Nepal");
    expect(placeOf("3. Marrakech & the Atlas Mountains, Morocco — The Heat Finally Lets Go")).toBe(
      "Marrakech & the Atlas Mountains, Morocco",
    );
  });

  it("reads it in every language, with either dash", () => {
    expect(placeOf("10. El centro de Vietnam — Llega la estación seca")).toBe("El centro de Vietnam");
    expect(placeOf("2. Rajasthan e India del nord — Holi e le ultime settimane comode")).toBe("Rajasthan e India del nord");
    expect(placeOf("4. Patagônia – O fim calmo do verão")).toBe("Patagônia");
  });

  it("straightens a typographic apostrophe, which a destination may not hold", () => {
    expect(placeOf("10. Vietnam’s Centre — The Dry Season Arrives")).toBe("Vietnam's Centre");
  });

  it("is null for headings that aren't a ranked place", () => {
    expect(placeOf("Quick-Pick Comparison: 12 March Destinations")).toBeNull();
    expect(placeOf("Practical Tips for March Travel")).toBeNull();
    expect(placeOf("1. Japan")).toBeNull();
    expect(placeOf("Japan — Cherry Blossom")).toBeNull();
    // A hyphen joins words; only a dash separates the place from its reason.
    expect(placeOf("1. Guinea-Bissau - the coast")).toBeNull();
  });

  it("is null for a place the planner would read as a request", () => {
    expect(placeOf("1. Somewhere warm by the sea — Anywhere goes")).toBeNull();
    expect(placeOf("1. Japan: <b>bold</b> — Why")).toBeNull();
    expect(placeOf("12. Las ciudades del norte de Europa — Nunca están más baratas")).toBeNull();
  });

  it("drops the article of a name too long for a place with it", () => {
    expect(placeOf("7. El Pacífico de Costa Rica — Estación seca")).toBe("Pacífico de Costa Rica");
    expect(placeOf("6. Las Tierras Altas de Escocia — Los últimos brezos")).toBe("Tierras Altas de Escocia");
    expect(placeOf("10. I parchi nazionali dello Utah, USA — Il caldo si spezza")).toBe("Parchi nazionali dello Utah, USA");
  });

  it("keeps the article of a name that fits with it", () => {
    expect(placeOf("3. Las Vegas — The Strip in the cool")).toBe("Las Vegas");
    expect(placeOf("4. La Paz — Altitude, slowly")).toBe("La Paz");
    expect(placeOf("10. El centro de Vietnam — Llega la estación seca")).toBe("El centro de Vietnam");
  });
});

describe("withPlacePlanLinks", () => {
  const html = [
    '<h2 id="quick-pick">Quick-Pick Comparison</h2>',
    "<p>Table</p>",
    '<h2 id="1-japan">1. Japan — Cherry Blossom</h2>',
    "<p>Kyoto opens late in the month.</p>",
    '<h3 id="2-not-a-section">2. Kyoto — A sub-heading</h3>',
    '<h2 id="2-rajasthan">2. Rajasthan &#x26; North India — Holi</h2>',
    "<p>Holi falls on the 22nd.</p>",
  ].join("\n");

  const linked = withPlacePlanLinks(html, { month: 3, localePrefix: "", label: "Plan this trip for March" });

  it("puts a link under each ranked place, and nowhere else", () => {
    expect(linked.match(/class="plan-place"/g)).toHaveLength(2);
    expect(linked).toContain(
      '<h2 id="1-japan">1. Japan — Cherry Blossom</h2>\n<p class="plan-place"><a href="/trips/new?destination=Japan&amp;month=3&amp;from=place" rel="nofollow" data-plan-place="Japan">Plan this trip for March</a></p>',
    );
    expect(linked).not.toContain('Quick-Pick Comparison</h2>\n<p class="plan-place">');
    expect(linked).not.toContain('A sub-heading</h3>\n<p class="plan-place">');
  });

  it("sends the place as the reader saw it, escaped for the address and the page", () => {
    const href = /<a href="([^"]+)"[^>]*data-plan-place="Rajasthan &amp; North India"/.exec(linked)?.[1];
    expect(href).toBeDefined();
    const query = new URLSearchParams(href!.replace(/&amp;/g, "&").split("?")[1]);
    expect(query.get("destination")).toBe("Rajasthan & North India");
    expect(query.get("month")).toBe("3");
    expect(query.get("from")).toBe("place");
  });

  it("opens the planner in the page's language", () => {
    const es = withPlacePlanLinks(html, { month: 3, localePrefix: "/es", label: "Planifica este viaje para marzo" });
    expect(es).toContain('<a href="/es/trips/new?destination=Japan&amp;month=3&amp;from=place"');
    expect(es).toContain(">Planifica este viaje para marzo</a>");
  });

  it("links the place alone in a list with no month: the planner asks when", () => {
    const anyTime = withPlacePlanLinks(html, { month: null, localePrefix: "/it", label: "Organizza questo viaggio" });
    expect(anyTime).toContain(
      '<h2 id="1-japan">1. Japan — Cherry Blossom</h2>\n<p class="plan-place"><a href="/it/trips/new?destination=Japan&amp;from=place" rel="nofollow" data-plan-place="Japan">Organizza questo viaggio</a></p>',
    );
    expect(anyTime).not.toContain("month=");
  });

  it("escapes the label", () => {
    expect(withPlacePlanLinks(html, { month: 3, localePrefix: "", label: "Plan <it>" })).toContain(">Plan &lt;it&gt;</a>");
  });

  it("links every place in a real month's guide, in each language", async () => {
    for (const locale of ["en", "es", "it", "pt"]) {
      const post = await getPostBySlug("where-to-go-in-march", locale);
      const out = withPlacePlanLinks(post!.html, { month: 3, localePrefix: "", label: "x" });
      expect(out.match(/class="plan-place"/g), locale).toHaveLength(12);
    }
  });

  it("links every place of a real list with no month, in each language", async () => {
    for (const locale of ["en", "es", "it", "pt"]) {
      const post = await getPostBySlug("where-to-spend-christmas", locale);
      const out = withPlacePlanLinks(post!.html, { month: null, localePrefix: "", label: "x" });
      const links = [...out.matchAll(/<p class="plan-place"><a href="([^"]+)"/g)].map((m) => m[1]);
      expect(links.length, locale).toBeGreaterThanOrEqual(13);
      // The article's own planner links may name a month; the place links don't.
      expect(links.filter((href) => href.includes("month=")), locale).toEqual([]);
    }
  });

  // The guides' markdown itself: rendering all 48 pages made this the file's slowest test.
  it("leaves almost no ranked place in the month guides without its link, and none in English", () => {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const unlinked: string[] = [];
    let ranked = 0;
    for (const month of months) {
      for (const locale of ["en", "es", "it", "pt"]) {
        const dir = locale === "en" ? "" : locale;
        const markdown = readFileSync(join(process.cwd(), "content", "blog", dir, `where-to-go-in-${month}.md`), "utf8");
        const places = markdown.split(/\r?\n/).filter((line) => /^## \d{1,2}\.\s.+\s[—–]\s/.test(line));
        ranked += places.length;
        for (const line of places) {
          if (placeOf(line.slice(3)) === null) unlinked.push(`${locale}/${month}: ${line}`);
        }
      }
    }
    expect(ranked).toBeGreaterThan(500);
    expect(unlinked.filter((line) => line.startsWith("en/"))).toEqual([]);
    // Long names in es/it/pt ("La costa sur de Sri Lanka") the planner would
    // read as a request: their readers still have the article's other links.
    expect(unlinked.length).toBeLessThanOrEqual(ranked * 0.03);
  });
});
