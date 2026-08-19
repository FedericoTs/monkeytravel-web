/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  landingPagesForPost,
  landingPageForTag,
  CONCEPT_TO_LANDING,
  GENERIC,
} from "./landing-page-links";
import { POSTS, CONCEPTS, LOCALES, tagsFor, type Locale } from "./tag-taxonomy";
import { slugifyTag } from "./tags";

/**
 * The keyword-based cross-links this replaced put /free-ai-trip-planner on 80 of
 * 84 posts (its keyword list contained "travel" and "trip"), /ai-itinerary-
 * generator on 53, and left /multi-city-trip-planner and /family-trip-planner
 * with none. It also matched ~20% worse on it/es/pt, because the keywords are
 * English and tags are localized.
 *
 * These tests pin the properties that make the replacement worth having:
 * specific pages actually get links, the primary link is topical rather than
 * generic, and every locale gets the same set.
 */

const SLUGS = Object.keys(POSTS);

/** How many posts list each landing page, and how many list it FIRST. */
function distribution() {
  const total = new Map<string, number>();
  const primary = new Map<string, number>();
  for (const slug of SLUGS) {
    const lps = landingPagesForPost(slug, 3);
    lps.forEach((lp, i) => {
      total.set(lp.path, (total.get(lp.path) ?? 0) + 1);
      if (i === 0) primary.set(lp.path, (primary.get(lp.path) ?? 0) + 1);
    });
  }
  return { total, primary };
}

describe("link targets are real", () => {
  it("every mapped path is a page that exists in the app", () => {
    for (const [concept, lp] of Object.entries(CONCEPT_TO_LANDING)) {
      const routeDir = join(process.cwd(), "app", "[locale]", ...lp.path.split("/").filter(Boolean));
      expect(existsSync(join(routeDir, "page.tsx")), `${concept} -> ${lp.path}`).toBe(true);
    }
  });

  it("every concept key in the map is a real taxonomy concept", () => {
    // Guards a rename in tag-taxonomy.ts silently unlinking a planner page.
    for (const concept of Object.keys(CONCEPT_TO_LANDING)) {
      expect(CONCEPTS[concept], `unknown concept "${concept}"`).toBeDefined();
    }
  });

  it.each(LOCALES)("%s: every labelKey has a translation", (locale) => {
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), "messages", locale, "blog.json"), "utf8")
    );
    const labels = messages.detail?.relatedToolsLabels ?? {};
    for (const lp of Object.values(CONCEPT_TO_LANDING)) {
      expect(labels[lp.labelKey], `${locale}: ${lp.labelKey}`).toBeTruthy();
    }
    expect(messages.tag?.ctaHeading, `${locale}: tag.ctaHeading`).toBeTruthy();
  });
});

describe("distribution is no longer degenerate", () => {
  it("no page is the PRIMARY link on more than half the posts", () => {
    // The old shape: /free-ai-trip-planner on 95% of posts, carrying no signal.
    const { primary } = distribution();
    for (const [path, n] of primary) {
      expect(n, `${path} is primary on ${n}/${SLUGS.length} posts`).toBeLessThanOrEqual(
        Math.ceil(SLUGS.length * 0.5)
      );
    }
  });

  it("every specific planner page gets real links", () => {
    // Previously: group 9, budget 9, solo 4, weekend 5, multi-city 0.
    const { total } = distribution();
    for (const lp of Object.values(CONCEPT_TO_LANDING)) {
      if (GENERIC.has(lp.path)) continue;
      expect(total.get(lp.path) ?? 0, `${lp.path} has no inbound links`).toBeGreaterThan(0);
    }
  });

  it("multi-city-trip-planner is no longer orphaned", () => {
    const { total } = distribution();
    expect(total.get("/multi-city-trip-planner") ?? 0).toBeGreaterThan(0);
  });

  it("a specific page outranks a generic one when both apply", () => {
    // group-trip-itinerary-template is group-travel + itinerary + trip-planning:
    // the group planner must come before the generic itinerary generator.
    const lps = landingPagesForPost("group-trip-itinerary-template", 3).map((l) => l.path);
    expect(lps[0]).toBe("/group-trip-planner");
    expect(lps).toContain("/ai-itinerary-generator");
  });

  it("every post still offers a way into the product", () => {
    // The fallback exists so tightening relevance never leaves a post with no
    // CTA — blog traffic converts at ~2%, and 0% would be worse.
    for (const slug of SLUGS) {
      expect(landingPagesForPost(slug, 3).length, slug).toBeGreaterThan(0);
    }
  });

  it("returns at most the requested number of links", () => {
    for (const slug of SLUGS) {
      expect(landingPagesForPost(slug, 3).length).toBeLessThanOrEqual(3);
      expect(landingPagesForPost(slug, 1).length).toBeLessThanOrEqual(1);
    }
  });

  it("never repeats the same page twice on one post", () => {
    for (const slug of SLUGS) {
      const paths = landingPagesForPost(slug, 3).map((l) => l.path);
      expect(new Set(paths).size, slug).toBe(paths.length);
    }
  });
});

describe("tag archives point at their planner", () => {
  it("resolves the specific page for a concept archive, in every locale", () => {
    // The hub -> commercial signal, and it must be identical across locales
    // even though the slugs differ (group-travel / viaggi-di-gruppo / …).
    for (const locale of LOCALES) {
      const slug = slugifyTag(CONCEPTS["group-travel"][locale as Locale]);
      expect(landingPageForTag(slug, locale)?.path, `${locale}/${slug}`).toBe(
        "/group-trip-planner"
      );
    }
  });

  it("returns null for generic and unmapped archives", () => {
    // A generic link on every archive would recreate the dilution.
    expect(landingPageForTag("itinerary", "en")).toBeNull();
    expect(landingPageForTag("ai-trip-planner", "en")).toBeNull();
    expect(landingPageForTag("europe", "en")).toBeNull();
    expect(landingPageForTag("not-a-real-tag", "en")).toBeNull();
  });

  it("only ever points at a page the archive's own posts are about", () => {
    // Every archive that shows a planner link must have at least one post
    // carrying the concept that produced it.
    for (const locale of LOCALES) {
      for (const [concept, lp] of Object.entries(CONCEPT_TO_LANDING)) {
        if (GENERIC.has(lp.path)) continue;
        const slug = slugifyTag(CONCEPTS[concept][locale as Locale]);
        if (!landingPageForTag(slug, locale)) continue;
        const postsWithConcept = SLUGS.filter((s) => POSTS[s].c.includes(concept));
        expect(postsWithConcept.length, `${locale}/${slug}`).toBeGreaterThan(0);
        // and the archive's tag really is on those posts
        const tag = CONCEPTS[concept][locale as Locale];
        expect(tagsFor(postsWithConcept[0], locale as Locale)).toContain(tag);
      }
    }
  });
});
