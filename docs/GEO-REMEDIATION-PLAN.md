# GEO Remediation Plan — Landing Pages

**Scope:** `/free-ai-trip-planner` and the 9 sibling landing pages
**Source audit:** `docs/GEO-ANALYSIS.md` (2026-08-21, GEO score 61/100)
**Status:** proposed — nothing in here has been applied

---

## The one thing to read if you read nothing else

While building this plan I found something the automated audit did not catch, and it outranks everything in the original report:

> **Portuguese is fully shipped, and the site tells every crawler it isn't.**

`lib/i18n/routing.ts:6` lists `["en", "es", "it", "pt"]`. `messages/pt/` has all 20 namespace files. `https://monkeytravel.app/pt/free-ai-trip-planner` returns **200**. `robots.txt` allows every `/pt/` path. The page emits `hreflang="pt"`.

And yet, in at least six places, the copy says the product supports three languages:

| File | Line | Claim |
|---|---|---|
| `app/[locale]/free-ai-trip-planner/page.tsx` | 29 | meta description — "Works in English, Spanish & Italian" |
| `messages/en/freeTripPlanner.json` | 117 | FAQ answer — "fully available in English, Spanish, and Italian" |
| `messages/en/freeTripPlanner.json` | 40 | feature card — "works in English, Spanish, and Italian" |
| `messages/en/groupTripPlanner.json` | 66 | "MonkeyTravel works in English, Spanish, and Italian" |
| `public/llms.txt` | 3 | "Available in English, Spanish, and Italian" |
| `app/admin/translations/page.tsx` | 19 | internal, cosmetic |

The meta description is the one Google renders in the SERP. The FAQ answer is inside `FAQPage` JSON-LD, so it is machine-read as a factual claim about the product. `llms.txt` is the file you publish *specifically* for AI crawlers.

You cannot rank or be cited for Portuguese-intent queries while your own structured data asserts you do not serve Portuguese. This is a content-accuracy bug with direct GEO and SEO cost, it is cheap to fix, and it should jump the queue ahead of every citability item below.

---

## Consolidated findings

| # | Finding | Severity | Type | Wave |
|---|---|---|---|---|
| 0 | Portuguese shipped but disclaimed in copy + schema | **High** | Content accuracy | 1 |
| 1 | 0 of 20 sections in the 134–167 word citation band | High | Content structure | 3 |
| 2 | No `dateModified` / `datePublished` anywhere | High | Schema | 2 |
| 3 | Duplicate `SoftwareApplication` JSON-LD on 10 pages | Medium | Schema | 2 |
| 4 | `Organization.sameAs` has 1 stale entry | Medium | Entity graph | 2 |
| 5 | FAQ questions are `<span>`, not headings | Medium | Semantics | 3 |
| 6 | `Google-Extended` rationale incomplete in code comment | Low | Policy | 5 |
| 7 | 11/13 images decorative; no substantive content image | Low | Multi-modal | 4 |
| 8 | `FAQPage` schema present post-retirement | Info | None — leave it | — |
| 9 | `/llms.txt` present, Google ignores it | Info | Keep, no weight | — |

---

## Wave 1 — Content accuracy (do first, ~1 hour)

**Why first:** it is the only finding where the site is currently making a false statement about itself. Everything else is an optimization; this is a correction.

### 1.1 Fix the Portuguese claim everywhere

Change the pattern "English, Spanish, and Italian" → "English, Spanish, Italian, and Portuguese" in:

- `messages/{en,es,it,pt}/freeTripPlanner.json` → `faq.items.languages.answer`
- `messages/{en,es,it,pt}/freeTripPlanner.json` → the feature-card description at key path `.description` (line ~40 in en)
- `messages/{en,es,it,pt}/groupTripPlanner.json` → line ~66 equivalent
- `app/[locale]/free-ai-trip-planner/page.tsx:29` → meta description fallback
- `public/llms.txt:3`

Then sweep for stragglers:

```bash
grep -rn "Spanish, and Italian\|Spanish & Italian\|Spanish and Italian" \
  messages/ lib/ app/ public/ --include=*.json --include=*.ts --include=*.tsx --include=*.txt
```

**Per CLAUDE.md i18n rules:** all four locale files must change together. The `pt` file must say this in Portuguese — do not leave the English string in `messages/pt/`.

**Verification:**
```bash
curl -sL -A "$UA" https://monkeytravel.app/free-ai-trip-planner \
  | grep -o 'meta name="description" content="[^"]*"'
# must name Portuguese
```

**How this could fail:** if Portuguese AI-itinerary *generation* is not actually wired in `lib/gemini.ts` (only the UI is translated), then claiming full Portuguese support would be a *new* false claim. **Check `getLanguageInstruction()` accepts `pt` before shipping this.** If it does not, the honest copy is "interface in Portuguese, itineraries in English" — and that becomes its own backlog item.

---

## Wave 2 — Mechanical schema fixes (no copy, no i18n, ~1 hour)

These are the cheapest wins on the list. None require translation review.

### 2.1 Delete the duplicate `SoftwareApplication` (10 files)

`app/layout.tsx:211` already emits `generateSoftwareApplicationSchema()` on every route. Ten landing pages emit a byte-identical second copy.

Remove the `generateSoftwareApplicationSchema(),` line and its now-unused import from each of:

```
app/[locale]/free-ai-trip-planner/page.tsx:215
app/[locale]/ai-itinerary-generator/page.tsx
app/[locale]/budget-trip-planner/page.tsx
app/[locale]/family-trip-planner/page.tsx
app/[locale]/group-trip-planner/page.tsx
app/[locale]/multi-city-trip-planner/page.tsx
app/[locale]/solo-trip-planner/page.tsx
app/[locale]/weekend-trip-planner/page.tsx
app/[locale]/backpacker/page.tsx
app/[locale]/compare/[competitor]/page.tsx
```

**Verification:**
```bash
curl -sL -A "$UA" https://monkeytravel.app/free-ai-trip-planner \
  | grep -o '"@type":"SoftwareApplication"' | wc -l    # expect 1, currently 2
```

**Falsifiable check:** if the layout does *not* in fact cover a given route (e.g. `compare/[competitor]` sits under a different layout), that page will drop to zero `SoftwareApplication` blocks. Re-run the count on all ten paths, not just this one.

### 2.2 Expand `Organization.sameAs`

`lib/seo/structured-data.ts:40-43` currently:

```ts
sameAs: [
  "https://twitter.com/monkeytravel",
  // Add more social profiles as they're created
],
```

The footer already links three live profiles the schema never claims. Replace with:

```ts
sameAs: [
  "https://x.com/monkeytravel",
  "https://instagram.com/monkeytravel.app",
  "https://linkedin.com/company/monkeytravel",
],
```

Drop the `twitter.com` URL — it is the pre-rebrand domain. Only list profiles that resolve; a `sameAs` pointing at a 404 is worse than a short list.

**Why this matters for GEO specifically:** brand mentions correlate ~3x more strongly with AI citation than backlinks (Ahrefs, 75k brands). LinkedIn presence is a moderate-strength signal that is currently invisible to any parser reading your structured data.

### 2.3 Emit `dateModified`

There is no `WebPage` generator today — `generateArticleSchema` (`structured-data.ts:491`) has `datePublished`/`dateModified`, but nothing for landing pages.

Add to `lib/seo/structured-data.ts`:

```ts
export interface WebPageSchemaInput {
  name: string;
  description: string;
  url: string;
  dateModified: string;   // ISO 8601
  datePublished?: string;
}

export function generateWebPageSchema(input: WebPageSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.name,
    description: input.description,
    url: input.url,
    dateModified: input.dateModified,
    ...(input.datePublished && { datePublished: input.datePublished }),
    isPartOf: { "@type": "WebSite", url: SITE_URL },
  };
}
```

**Do not use `new Date()`.** Your own `CLAUDE.md` Trap 9 documents exactly why: a date that changes every build tells Google the whole site churns constantly and teaches it to ignore your `lastmod` signal entirely. Use a per-page constant, bumped by hand when the copy actually changes:

```ts
// app/[locale]/free-ai-trip-planner/page.tsx
const CONTENT_UPDATED = "2026-08-21";   // bump when copy changes
```

Add a visible "Last updated" line near the footer of the page body too — the schema date is for machines, the visible date is a human trust signal and an E-E-A-T input.

**Leading indicator:** content under 3 months old is ~3x more likely to be cited (SE Ranking, 1.3M citations). With no date at all the page cannot signal freshness in *either* direction, so this is a precondition for any freshness play, not a win by itself.

---

## Wave 3 — Citability (the real work, ~1 day + translation)

This is where the 61/100 actually comes from, and it is the only wave that needs your voice.

### The measurement

Every section between headings, measured:

| Section | Words | |
|---|---|---|
| 9 × feature blurbs | 19–28 | too thin to extract |
| Hero | 63 | |
| Why vs. ChatGPT | 73 | best asset on the page |
| Featured Articles | 91 | |
| **FAQ (all six, as one block)** | **218** | one lump, not six answers |

**0 of 20 sections land in the 134–167 word band.**

Individual FAQ answers are 23–45 words (en), 26–45 (it), 27–44 (es), 28–42 (pt).

### 3.1 Add a definitional opener — highest single-item impact

The page never defines its own category. The hero opens with a benefit claim ("Drop a destination, get a personalized day-by-day itinerary in under 60 seconds"), which is good persuasion and useless extraction. There is no "An AI trip planner is…" sentence anywhere.

Add a ~150-word block, immediately below the hero, structured as:

- `<h2>` in question form: "What is an AI trip planner?"
- First sentence in `X is…` form, self-contained, no pronouns referring outside the block
- 2–3 specific facts with numbers (30s generation, 3 budget tiers, real venue data from Google Places)
- One sentence distinguishing it from a general chatbot — you already have this argument, it's your strongest

Target 134–167 words. New keys in all four `messages/*/freeTripPlanner.json`.

**Falsifiable check:** if this works, the page starts appearing for *what is / how does* queries in AI-referral data. If after 8 weeks the AI-referral query mix is unchanged, the definitional-passage theory is wrong for this page and Wave 3 should stop here rather than continuing into 3.3.

### 3.2 Promote FAQ questions to real headings — mechanical, do it regardless

`app/[locale]/free-ai-trip-planner/page.tsx:486-489` renders each question as:

```tsx
<summary ...>
  <span className="font-semibold text-[var(--foreground)] pr-4">
    {t(`faq.items.${key}.question`)}
  </span>
```

A `<span>` inside `<summary>` carries no document-outline weight. This is why the audit found only 5 `<h2>` and 14 `<h3>` and **zero** question-form headings despite six questions being on the page.

Change to:

```tsx
<summary ...>
  <h3 className="font-semibold text-[var(--foreground)] pr-4 text-base">
    {t(`faq.items.${key}.question`)}
  </h3>
```

`<h3>` inside `<summary>` is valid HTML. Keep the `<details>` interaction — it does not hide content from crawlers, and the answer text is already confirmed present in the raw SSR response.

Zero copy change, zero i18n change, six new question-form headings. Best effort-to-value ratio in Wave 3.

### 3.3 Expand FAQ answers — selectively, not uniformly

**Do not pad all six to 134 words.** Your prose currently scores 93/100 with **zero filler** and **zero AI-slop patterns**. Inflating "Is MonkeyTravel really free?" (a genuinely 30-word answer) to 140 words would trade a real quality score for a speculative citability score. That is a bad trade.

Expand only the three with real substance to add:

| Key | Now | Target | What to add |
|---|---|---|---|
| `howAccurate` | 35 w | ~150 w | How venue data is sourced/refreshed, what "verified" means, known limits |
| `groupTrips` | 30 w | ~150 w | How voting works, consensus mechanics, what invitees see |
| `destinations` | 30 w | ~150 w | What "enriched data" means vs. generic coverage, which 20+, refresh cadence |

Leave `isFree`, `needAccount`, `languages` short. A crisp 30-word answer is a better answer.

Note `destinations` currently says "20+ popular destinations" while the hero stat block says "180+ Destinations". Not strictly contradictory — enriched vs. supported — but a reader cannot tell. Make the distinction explicit in the expanded answer.

**All expansions × 4 locales.** Per CLAUDE.md, keys land in `en`, `es`, `it`, `pt` before any UI text ships.

---

## Wave 4 — Multi-modal (~half day, lowest confidence)

All 13 images are chrome: 11 decorative hero layers with correctly-empty alt, plus a 36×36 logo. No diagram, no chart, no screenshot of an actual itinerary, no video.

Content with multi-modal elements sees ~156% higher selection rates in AI answers. The obvious asset you do not have: **an annotated screenshot of a real generated itinerary**, with descriptive alt text, placed next to the definitional block from 3.1.

You already have capture tooling in `marketing/scripts/` — `capture-screens.mjs` and friends — so the asset cost here is low.

Lowest-confidence item on the list. The 156% figure is correlational and multi-modal pages differ from text-only pages in many ways besides having images.

---

## Wave 5 — A decision, not a code change

`middleware.ts:39-53` blocks `Google-Extended` and `Applebot-Extended`, annotated:

```ts
/Google-Extended/i, // Google AI training (separate from googlebot)
```

**The annotation is incomplete.** `Google-Extended` is not training-only — it also gates **Gemini app grounding** and Vertex AI grounding. The 2026-08-11 revision above it already made exactly the right call for GPTBot and ClaudeBot, unblocking them because they had stopped being training-only and had become retrieval indexes. The same test applies here and reaches a less obvious answer.

To be explicit about what this does and does not cost:

- **Does NOT affect** AI Overviews or AI Mode. Those are Googlebot-served and governed by `nosnippet` / `max-snippet` / `noindex`. Your AI Overviews eligibility is untouched.
- **Does cost** grounding in the Gemini consumer app, and Apple Intelligence via `Applebot-Extended`.

Keeping the block may well be correct — training opt-out has real value and this is a policy call, not an SEO one. The action item is one line: **update the code comment so the next person sees the full tradeoff.** The other eleven blocked patterns (`CCBot`, `Bytespider`, `SemrushBot`, `AhrefsBot`, `Diffbot`, `MJ12bot`, `DotBot`, `FacebookBot`, `Meta-ExternalAgent`, `Amazonbot`, `anthropic-ai`) cost no citation surface and should stay.

---

## Explicitly not doing

- **Removing `FAQPage` schema.** Google retired FAQ rich results 2026-05-07, so it earns no SERP feature — but it is harmless, and the underlying FAQ *text* is the valuable part. Do not add it to new pages expecting Google benefit; do not strip it from existing ones.
- **Investing in `/llms.txt` as a ranking lever.** It is well-formed (200, `text/plain`, 2,793 bytes) and Google explicitly ignores it. Keep it current for non-Google AI services — which means it needs the Portuguese fix from 1.1 — but assign it no Google weight.
- **Adding alt text to the 11 decorative hero layers.** Empty alt is correct for decorative images. Do not "fix" this.

---

## Sequencing and effort

```
Wave 1  Content accuracy      ~1h     ← blocks nothing, but it's a live falsehood
Wave 2  Mechanical schema     ~1h     ← independent, parallelizable
Wave 3  Citability            ~1d     ← 3.2 is free; 3.1/3.3 need copy + 4 locales
Wave 4  Multi-modal           ~4h     ← depends on 3.1 (image sits beside it)
Wave 5  Comment fix           ~5m     ← independent
```

Waves 1 and 2 have no dependency on each other and touch disjoint files — they can ship as one PR today. Wave 3.2 can ride along. Waves 3.1/3.3 need translation review and should be their own PR.

## Verification protocol

Per CLAUDE.md, after every push run `./scripts/verify-deploy.sh` and do not declare shipped until exit 0. Vercel serves the last successful build on failure, so there is no runtime signal that your change didn't land.

Then re-run the crawler-visible checks:

```bash
UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
curl -sL --compressed -A "$UA" https://monkeytravel.app/free-ai-trip-planner -o /tmp/p.html

grep -o '"@type":"SoftwareApplication"' /tmp/p.html | wc -l   # 1  (was 2)
grep -o '"dateModified"' /tmp/p.html | wc -l                  # ≥1 (was 0)
grep -oE '<h3[^>]*>' /tmp/p.html | wc -l                      # ≥20 (was 14)
grep -o 'Portuguese' /tmp/p.html | wc -l                      # ≥1 (was 0)
```

Note `grep -oc` counts *lines*, not matches — on minified HTML it will report `1` no matter what. Use `grep -o ... | wc -l`. The recipe in CLAUDE.md has this bug and is worth correcting there too.

## Leading indicators (no re-audit needed)

- AI-referral sessions segmented by landing query — does *what is* traffic appear after 3.1?
- GSC impressions on `/pt/*` routes — currently suppressed by the false language claim
- GSC average position for "ai trip planner"
- Rich Results duplicate-schema warnings clearing after 2.1

## How this plan could be wrong

The citability and freshness items rest on third-party correlational studies (SE Ranking, Ahrefs), not Google primary sources. Google's own position is that GEO is "still SEO" and no AI-specific optimization is required.

If Google is right and the studies are noise: Waves 1 and 2 still pay (a false product claim and duplicate schema are defects under any model), 3.2 still pays (semantic headings are ordinary good HTML), and 3.1 still pays (a definition helps human readers). The items that would prove worthless are 2.3's freshness theory and 3.3's answer expansion — which is precisely why the leading indicators above are worth wiring before doing 3.3, not after.
