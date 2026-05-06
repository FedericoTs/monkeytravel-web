# Content Quality Audit — MonkeyTravel Blog

**Date:** 2026-05-06  •  **Posts audited:** 79 (English locale; ES/IT mirror the same set, so impact is ×3)

## TL;DR

Content quality per post is **better than the indexing data suggested**. Real prices, comparison tables, study citations, structured data. The bottleneck for the 511 "Discovered – currently not indexed" pages isn't writing quality — it's **site-wide signals** Google uses to assess trust before allocating crawl budget.

The single highest-leverage move: **replace the "MonkeyTravel Team" byline on all 79 posts with named authors + bios**. That alone is likely worth more than rewriting any 5 individual posts.

## Categorization

| Action | Count | Effort | Indexing impact |
|---|---:|---|---|
| **CUT** (delete + 410-gone) | 3 | Low | Removes drag, signals quality control |
| **MERGE** (consolidate cluster) | 17 | Medium | Eliminates self-cannibalization |
| **DEEPEN** (E-E-A-T + voice work) | 54 | Medium-High (batchable) | Lifts site-wide quality classifier |
| **KEEP** (already strong) | 5 | None | Reference baseline for the rewrites |

## Site-wide leverage moves — do FIRST (touches all posts)

### 1. Named authors + bios (the biggest E-E-A-T lever)

Every post is by `MonkeyTravel Team`. Google's helpful-content classifier explicitly weights named authors with credentials. Even pseudonymous bylines beat "Team."

- Create 2-4 author personas (e.g., one Europe specialist, one Asia specialist, one AI/tech). Real names if possible.
- Add `/about/authors/{slug}` pages with bio, photo, countries-visited count, credentials.
- Wire `Author` schema.org markup in [lib/seo/structured-data.ts](lib/seo/structured-data.ts) and reference from each post.
- Assign one author per post by topic. Update frontmatter `author: "Name"`.

### 2. Consolidate cannibalizing clusters

The biggest source of indexing friction.

- **Monthly listicles (12 posts → 1 pillar + 4 quarterly):** the 12 `where-to-go-in-{month}` posts each rank for nearly the same intent ("best places to visit in X month"). Consolidate into one pillar `/blog/2026-travel-calendar` with anchor links per month + 4 quarterly seasonal deep-dives. 301 the 12 monthly URLs to the relevant anchor.
- **Summer-season trio (3 → 1):** `best-summer-destinations-2026` + `spring-break-destinations-2026` + `coolcation-destinations-2026` → one pillar with sections per traveller type.
- **Honeymoon dupes (2 → 1):** `best-honeymoon-destinations-2026` + `honeymoon-on-a-budget-2026` → one pillar with budget tier sections.

### 3. De-2026 the slugs that aren't actually time-locked

18 posts have `2026` in the slug. Real time-locked content (FIFA 2026, ETIAS 2026, US tariffs 2026) keeps the year. Generic listicles dressed up as 2026 (best food, best honeymoon, best digital nomad, best wellness, etc.): rename to evergreen slugs and use a `Last updated` date instead. Avoids the Q3 2026 cliff where Google starts demoting them as stale.

### 4. Add comparison tables to every comparison post

Currently most comparison posts open with prose only. Tables are heavily used by AI Overviews and featured snippets. `paris-vs-rome` and `bali-vs-thailand` already have tables; the others should match. Cheap win.

### 5. Original media (lower priority but compounding)

All hero images are at `/images/blog/{slug}.jpg` — likely stock or AI. One annotated MonkeyTravel screenshot per post (the actual itinerary the post describes, with annotations) signals first-hand experience AND ties the blog to the product.

## Cluster consolidation map

```
Monthly listicles (12) ──┐
                         ├──→ /blog/2026-travel-calendar (pillar)
Quarterly seasonal (4)   ┘     + 4 quarterly seasonal posts

best-summer-destinations-2026  ──┐
spring-break-destinations-2026   ├──→ /blog/spring-summer-travel-guide
coolcation-destinations-2026     ┘

best-honeymoon-destinations-2026 ──┐
honeymoon-on-a-budget-2026         ┴──→ /blog/honeymoon-planning-guide
```

Net: **17 URLs collapsed into 6 stronger pillars.** All deletions get 301'd to the new canonical.

## Per-post scorecard

Score 0-10 = composite of data density, depth, internal linking, voice, minus templating + time-decay penalties.

### CUT (3)

| Slug | Score | Reason |
|---|---:|---|
| `pianificatore-viaggio-ai-2026` | 0.5 | **Bug:** Italian slug, English content. Dupes `/blog/how-to-plan-a-trip-with-ai`. Either delete or rename + move to `/it/` as proper translation. |
| `us-tariffs-impact-travel-costs-2026` | 1.5 | 2026-pegged news topic. Half-life ~6 months. Replace with evergreen "how trade policy affects travel" if topic matters. |
| `trending-destinations-may-2026` | 2.0 | Designed as monthly recurring series ("first installment of MonkeyTravel's monthly trending destinations report"). Not being updated → stale by design. Either commit to monthly cadence or cut. |

### MERGE (17)

| Slug | Pattern | Score | Target pillar |
|---|---|---:|---|
| `coolcation-destinations-2026` | other | 3.5 | `/blog/spring-summer-travel-guide` |
| `best-honeymoon-destinations-2026` | best-listicle-2026 | 5.0 | `/blog/honeymoon-planning-guide` |
| `best-summer-destinations-2026` | best-listicle-2026 | 5.0 | `/blog/spring-summer-travel-guide` |
| `honeymoon-on-a-budget-2026` | other | 6.0 | `/blog/honeymoon-planning-guide` |
| `spring-break-destinations-2026` | other | 6.0 | `/blog/spring-summer-travel-guide` |
| `where-to-go-in-january` | monthly-listicle | 6.5 | `/blog/2026-travel-calendar` |
| `where-to-go-in-february` | monthly-listicle | 6.5 | `/blog/2026-travel-calendar` |
| `where-to-go-in-march` | monthly-listicle | 6.0 | `/blog/2026-travel-calendar` |
| `where-to-go-in-april` | monthly-listicle | 6.5 | `/blog/2026-travel-calendar` |
| `where-to-go-in-may` | monthly-listicle | 6.0 | `/blog/2026-travel-calendar` |
| `where-to-go-in-june` | monthly-listicle | 6.0 | `/blog/2026-travel-calendar` |
| `where-to-go-in-july` | monthly-listicle | 6.5 | `/blog/2026-travel-calendar` |
| `where-to-go-in-august` | monthly-listicle | 6.5 | `/blog/2026-travel-calendar` |
| `where-to-go-in-september` | monthly-listicle | 6.5 | `/blog/2026-travel-calendar` |
| `where-to-go-in-october` | monthly-listicle | 6.5 | `/blog/2026-travel-calendar` |
| `where-to-go-in-november` | monthly-listicle | 6.5 | `/blog/2026-travel-calendar` |
| `where-to-go-in-december` | monthly-listicle | 7.0 | `/blog/2026-travel-calendar` |

The monthly-listicle scores are all 6.0-7.0 — content quality is fine. The merge isn't because they're bad; it's because together they cannibalize each other for the same intent ("best travel destinations"). The pillar inherits all of their content via anchored sections.

### DEEPEN (54) — sorted by score ascending (weakest first)

| Slug | Pattern | Words | Prices | Tables | First-person | Internal links | Score |
|---|---|---:|---:|:-:|---:|---:|---:|
| `how-to-plan-a-group-trip` | howto | 1393 | 6 | — | 1 | 3 | 1.5 |
| `chatgpt-vs-ai-trip-planners` | comparison | 1740 | 2 | ✓ | 3 | 2 | 2.0 |
| `best-food-destinations-2026` | best-listicle-2026 | 3451 | 24 | — | 1 | 5 | 2.5 |
| `group-travel-mistakes-to-avoid` | other | 2159 | 7 | — | 0 | 3 | 2.5 |
| `how-ai-is-changing-travel-planning` | other | 1559 | 3 | — | 2 | 5 | 2.5 |
| `travel-planning-stress-how-ai-helps` | other | 2294 | 1 | — | 5 | 4 | 2.5 |
| `best-ai-trip-planners-2026-compared` | other | 2261 | 4 | ✓ | 2 | 6 | 3.0 |
| `can-you-trust-ai-travel-itinerary` | itinerary | 2667 | 3 | — | 3 | 4 | 3.0 |
| `etias-europe-travel-authorization-2026` | other | 2443 | 12 | ✓ | 2 | 1 | 3.0 |
| `fifa-world-cup-2026-travel-guide` | other | 2277 | 27 | — | 0 | 0 | 3.0 |
| `itinerario-puglia-5-giorni` | italian-original-slug | 2212 | 39 | ✓ | 0 | 1 | 3.0 |
| `itinerario-sardegna-7-giorni` | italian-original-slug | 2239 | 48 | ✓ | 0 | 1 | 3.0 |
| `solo-female-travel-safety-guide-2026` | other | 3576 | 24 | — | 0 | 2 | 3.0 |
| `ai-trip-planner-vs-travel-agent` | comparison | 1353 | 25 | ✓ | 1 | 4 | 3.5 |
| `best-group-trip-destinations-2026` | best-listicle-2026 | 1922 | 86 | — | 0 | 3 | 3.5 |
| `first-trip-to-japan-what-you-need-to-know` | other | 1496 | 24 | — | 1 | 3 | 3.5 |
| `group-trip-budget-how-to-split-costs` | other | 2215 | 21 | — | 1 | 3 | 3.5 |
| `passport-power-index-2026` | other | 3238 | 7 | ✓ | 0 | 1 | 3.5 |
| `travel-packing-checklist` | other | 3159 | 3 | ✓ | 5 | 0 | 3.5 |
| `group-trip-itinerary-template` | other | 2188 | 2 | ✓ | 0 | 3 | 4.0 |
| `how-to-plan-a-bachelorette-trip` | howto | 2215 | 22 | — | 0 | 3 | 4.0 |
| `how-to-plan-a-trip-with-ai` | howto | 3009 | 7 | — | 4 | 5 | 4.0 |
| `international-travel-checklist` | other | 4052 | 13 | — | 6 | 0 | 4.0 |
| `plan-weekend-getaway-with-ai` | other | 2783 | 6 | — | 3 | 8 | 4.0 |
| `visa-free-destinations-by-passport` | other | 2722 | 18 | ✓ | 3 | 1 | 4.0 |
| `3-day-paris-itinerary` | itinerary | 1922 | 55 | ✓ | 2 | 0 | 4.5 |
| `great-migration-africa-when-and-where` | other | 2170 | 38 | ✓ | 2 | 0 | 4.5 |
| `midnight-sun-best-destinations` | other | 2804 | 29 | ✓ | 1 | 0 | 4.5 |
| `monsoon-season-where-to-go-and-avoid` | other | 2290 | 23 | ✓ | 2 | 1 | 4.5 |
| `sustainable-travel-guide-2026` | other | 3029 | 14 | — | 1 | 6 | 4.5 |
| `best-digital-nomad-destinations-2026` | best-listicle-2026 | 3451 | 50 | ✓ | 1 | 8 | 5.0 |
| `best-fall-foliage-destinations` | best-evergreen | 3173 | 57 | ✓ | 2 | 0 | 5.0 |
| `best-places-to-see-northern-lights` | best-evergreen | 3249 | 43 | ✓ | 2 | 1 | 5.0 |
| `best-wellness-retreats-2026` | best-listicle-2026 | 3989 | 48 | ✓ | 0 | 3 | 5.0 |
| `cheapest-european-cities-for-food-2026` | best-evergreen | 3867 | 134 | ✓ | 3 | 1 | 5.0 |
| `is-it-safe-to-travel-to-the-us-2026` | other | 3818 | 22 | ✓ | 3 | 2 | 5.0 |
| `istanbul-3-day-itinerary` | itinerary | 3688 | 51 | ✓ | 0 | 0 | 5.0 |
| `paris-vs-barcelona` | comparison | 2221 | 68 | ✓ | 1 | 2 | 5.0 |
| `solo-travel-planning-with-ai` | other | 2991 | 14 | — | 3 | 4 | 5.0 |
| `cheapest-flights-2026-when-and-where-to-book` | best-evergreen | 2390 | 47 | ✓ | 2 | 4 | 5.5 |
| `how-to-plan-trip-to-italy-on-a-budget` | howto | 1366 | 63 | ✓ | 1 | 3 | 5.5 |
| `japan-cherry-blossom-season-guide` | other | 2807 | 37 | ✓ | 2 | 0 | 5.5 |
| `lisbon-vs-porto` | comparison | 2748 | 73 | ✓ | 3 | 2 | 5.5 |
| `paris-vs-rome` | comparison | 3405 | 107 | ✓ | 2 | 2 | 5.5 |
| `tokyo-4-day-itinerary` | itinerary | 2935 | 140 | ✓ | 1 | 0 | 5.5 |
| `tokyo-vs-seoul` | comparison | 3117 | 90 | ✓ | 2 | 2 | 5.5 |
| `visa-requirements-us-citizens` | other | 3366 | 65 | ✓ | 1 | 0 | 5.5 |
| `5-day-italy-itinerary` | itinerary | 3512 | 109 | ✓ | 1 | 0 | 6.0 |
| `bali-7-day-itinerary` | itinerary | 3322 | 103 | ✓ | 1 | 2 | 6.0 |
| `bali-vs-thailand` | comparison | 4167 | 70 | ✓ | 2 | 0 | 6.0 |
| `cheapest-destinations-in-asia` | best-evergreen | 4167 | 212 | ✓ | 1 | 2 | 6.0 |
| `cheapest-destinations-in-europe` | best-evergreen | 4391 | 323 | ✓ | 3 | 1 | 6.0 |
| `lisbon-3-day-itinerary` | itinerary | 3833 | 89 | ✓ | 1 | 0 | 6.0 |
| `london-4-day-itinerary` | itinerary | 3806 | 101 | ✓ | 1 | 0 | 6.0 |

**Skim the bottom 10 first.** Specifically, deep-read these to decide DEEPEN vs CUT manually — the score is just structural and may be misleading on a few:

- `how-to-plan-a-group-trip` (1393 words — under-developed)
- `chatgpt-vs-ai-trip-planners` (you nudged this one for indexing today; deep-read it confirmed it's actually decent — the low score is the comparison-pattern penalty bias)
- `best-food-destinations-2026` (you also nudged this; deep-read showed it's solid)
- `travel-planning-stress-how-ai-helps`
- `how-ai-is-changing-travel-planning`

### KEEP (5)

| Slug | Pattern | Score | Why it's strong |
|---|---|---:|---|
| `bangkok-5-day-itinerary` | itinerary | 6.5 | 232 prices, full transit detail (BTS lines, MRT routes), table for budget. Reference quality. |
| `barcelona-3-day-itinerary` | itinerary | 6.5 | Strong voice (4 first-person markers), specific data, table. |
| `first-trip-to-vietnam-2026` | other | 6.5 | Strong internal linking (6), good price density. |
| `new-york-5-day-itinerary` | itinerary | 6.5 | 117 prices, table, structured day-by-day. |
| `seoul-5-day-itinerary` | itinerary | 7.5 | Top score. 98 prices, table, 5 internal links — the model post. |

The KEEP set is dominated by the city itinerary cluster — that's MonkeyTravel's actual strength.

## Sequencing — what to do, in order

**Week 1 (highest leverage, low effort):**
1. Create 2-4 author personas + `/about/authors/` bio pages. Add `Author` schema. Update frontmatter on all 79 posts.
2. Cut the 3 CUT posts — delete the .md files; respond 410 (Gone) instead of 404 so Google removes them faster (one-line middleware addition).

**Week 2 (medium effort, removes self-cannibalization):**
3. Write the 3 consolidation pillars (`/blog/2026-travel-calendar`, `/blog/spring-summer-travel-guide`, `/blog/honeymoon-planning-guide`). 301 the 17 merged URLs to anchor sections.
4. Update sitemap; resubmit in Search Console.

**Week 3-4 (per-post deepening — batchable):**
5. For DEEPEN posts: add comparison table where missing, inject one named-author first-person paragraph ("When I planned my own X trip…"), update internal links to ≥5 per post.
6. Add author photo to each post hero.

**Week 5+ (compounding plays):**
7. Replace stock images with annotated MonkeyTravel screenshots for the 5-10 most-trafficked posts.
8. Pitch 3-5 of the strongest authors for HARO / podcasts to build off-site E-E-A-T signals (linked-from authoritative sources is heavily weighted).

## Where this audit could be wrong

- **Scoring is structural** — relies on regex for first-person markers, prices, etc. A genuinely AI-generated post that happens to include prices and a few "we found" phrases will score as DEEPEN when it's really CUT. Skim the bottom 10 DEEPEN posts before any batch-edit.
- **Templating penalty assumes monthly listicles cannibalize.** If GSC analytics show each ranks for distinct long-tail queries ("best places visit october" etc.) with non-overlapping impressions, the merge case weakens. Worth checking the Performance > Pages report before consolidating.
- **The E-E-A-T author lever is consensus SEO advice, not measured.** It's the highest-confidence move available without rewriting content, but actual indexing recovery depends on Google reassessing the site once the signals change. Expect 4-8 weeks before the impact is visible in indexed-page count.
- **The audit reads English only.** The Spanish/Italian translations look genuinely localized (different prose, different tags), but a per-locale audit could surface different prioritization (e.g., the Italian `itinerario-puglia` is a good native-Italian post but scored low in EN audit because it's an English-fallback duplicate).

---

*Generated 2026-05-06 from `.audit/blog-scorecard.json`. Re-run via the audit script to refresh.*
