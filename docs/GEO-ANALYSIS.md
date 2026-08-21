# GEO Analysis — /free-ai-trip-planner

**URL:** https://monkeytravel.app/free-ai-trip-planner
**Date:** 2026-08-21
**Tooling:** claude-seo 2.2.4 (`fetch_page.py`, `parse_html.py`, `content_quality.py`, `agent_ux_check.py`) + live crawler-UA probes

## GEO Readiness Score: 61/100

| Criterion | Weight | Score | Basis |
|---|---|---|---|
| Citability | 25% | 55 | 0 of 20 sections in the 134–167 word citation band |
| Structural readability | 20% | 78 | Clean H1→H2→H3, but only 1 question-form heading |
| Multi-modal | 15% | 50 | 11 of 13 images lack alt; no video/chart |
| Authority & brand | 20% | 40 | No dates anywhere; `sameAs` has 1 stale profile |
| Technical accessibility | 20% | 82 | Excellent SSR; self-inflicted Gemini/Apple block |

## What is already right

Technical accessibility is genuinely strong, and it is the thing most sites fail.

- **SSR is real.** 808 words of visible prose, 48 anchors, and the complete FAQ answer text are all present in the raw HTTP response. AI crawlers do not execute JavaScript; this page does not need them to.
- **TTFB 0.51s**, total 0.81s, HTTP 200, zero redirects, self-referential canonical, `index, follow`, 5 hreflang alternates (en/es/it/pt/x-default).
- **Search-agent readiness 100/100** (`agent_ux_check.py`): 5 real `<button>`s, 48 real `<a>`s, 0 `div onclick` widgets, 10 semantic landmarks.
- **Content quality 93/100** on extracted prose — 0 filler, 0 AI-slop patterns, information density 0.894.
- **Live crawler probes return 200** for GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot.

## Findings

### 1. HIGH — Zero passages sit in the citation band

Measured every section between headings. The distribution is bimodal and misses the target entirely:

| Section | Words |
|---|---|
| Feature blurbs (×9) | 19–28 |
| Hero | 63 |
| Why vs. ChatGPT | 73 |
| Featured Articles | 91 |
| Frequently Asked Questions | 218 |

**0 of 20 sections fall in 134–167 words.** Feature blurbs are too thin to be extracted as standalone answers; the FAQ is one 218-word lump rather than six individually-citable blocks.

The page also never states a definition. There is no "An AI trip planner is…" sentence in the first 60 words — the opening is a benefit claim ("Drop a destination, get a personalized day-by-day itinerary in under 60 seconds"), which reads well to humans but gives an extraction model nothing to lift for a *what is* query.

**Falsifiable check:** if this is right, the page earns citations for "monkeytravel vs chatgpt" (73-word self-contained comparison + table) but not for generic "what is an ai trip planner". Check AI-referral landing queries.

### 2. HIGH — No date signals anywhere on the page

`datePublished`, `dateModified`, and any visible "last updated" are all absent. Grep hits for "updated" resolve to i18n UI strings, not content dates.

Per the SE Ranking 1.3M-citation study, content under 3 months old is ~3x more likely to be cited, and pages left stale 6+ months lose citation eligibility. With no date emitted at all, the page cannot signal freshness in either direction.

### 3. MEDIUM — Byte-identical duplicate `SoftwareApplication` schema, on 10 pages

The page emits the same `SoftwareApplication` JSON-LD block twice, verbatim.

Root cause is structural, not local to this page:

- `app/layout.tsx:211` — emits `generateSoftwareApplicationSchema()` sitewide
- `app/[locale]/free-ai-trip-planner/page.tsx:215` — emits it again

Nine further landing pages repeat the pattern (`ai-itinerary-generator`, `budget-`, `family-`, `group-`, `multi-city-`, `solo-`, `weekend-trip-planner`, `backpacker`, `compare/[competitor]`). Fix once by dropping the per-page call, since the layout already covers every route.

### 4. MEDIUM — Entity graph is under-linked and partly stale

`Organization.sameAs` contains exactly one entry: `https://twitter.com/monkeytravel`.

The page footer links three live profiles the schema never claims: `x.com/monkeytravel`, `instagram.com/monkeytravel.app`, `linkedin.com/company/monkeytravel`. So the machine-readable entity graph is both incomplete and pointing at the pre-rebrand domain.

This matters disproportionately for GEO: brand mentions correlate ~3x more strongly with AI citation than backlinks (Ahrefs, 75k brands), and LinkedIn presence is a moderate-strength signal that is currently invisible to parsers.

Source: `lib/seo/structured-data.ts:40-43` (comment already says "Add more social profiles as they're created").

### 5. MEDIUM — Google-Extended and Applebot-Extended are hard-blocked at the edge

Both `robots.txt` and a Vercel-layer rule reject these agents — live probes return **403** with `X-Robots-Tag: noindex, nofollow`, versus 200 for Googlebot and a plain curl UA.

**This is a deliberate, already-reasoned choice, and it does not affect AI Overviews or AI Mode** — those are served by Googlebot and governed by standard preview directives (`nosnippet`, `max-snippet`, `noindex`), not by `Google-Extended`.

Enforcement lives in `middleware.ts:39-53` (`BLOCKED_BOT_PATTERNS`), and the comment block above it records the reasoning. The 2026-08-11 revision already unblocked GPTBot and ClaudeBot on precisely the right grounds — that both had stopped being training-only and now build the retrieval indexes behind ChatGPT Search and Claude web search, so blocking them was keeping the site out of those indexes. `robots.txt` is generated consistently from `app/robots.ts`. Nothing to fix here.

**The one gap in that reasoning:** `Google-Extended` is annotated `// Google AI training (separate from googlebot)`, but it is not training-only. It is also the gate for **Gemini app grounding** and Vertex AI grounding. The same retrieval-vs-training test that was applied to GPTBot and ClaudeBot therefore applies to it in part — the block buys training opt-out and simultaneously costs grounding on a consumer surface with 1B+ monthly users. `Applebot-Extended` sits in the same position for Apple Intelligence.

That does not mean it should be unblocked; the training opt-out may well be worth the grounding loss, and that is a policy call, not an SEO one. It does mean the tradeoff is larger than the code comment implies. The remaining entries (`anthropic-ai`, `CCBot`, `Bytespider`, `Amazonbot`, `FacebookBot`, `Meta-ExternalAgent`, `Diffbot`, `SemrushBot`, `AhrefsBot`, `MJ12bot`, `DotBot`) are training or SEO-tool crawlers and cost no citation surface.

### 6. LOW — 11 of 13 images have empty alt

The 11 are decorative hero layers (`sun-rays.webp`, `cloud-2.webp`, …), where empty alt is technically correct. But content with multi-modal elements sees ~156% higher selection rates, and this page has no substantive content image, chart, or video at all — the images are all chrome.

### 7. INFO — `FAQPage` schema present

Google retired FAQ rich results for all sites on 2026-05-07; there is no SERP feature behind this markup anymore. **No action needed — do not remove it.** It is harmless, and the underlying FAQ *text* is the valuable part (it is correctly server-rendered). Just do not expect SERP real estate from it, and do not add `FAQPage` to new pages for Google benefit.

### 8. INFO — `/llms.txt` present and well-formed

200, `text/plain`, 2,793 bytes, correct format with core pages and destination guides. Google explicitly ignores it (`ai-optimization-guide`, updated 2026-06-29) and Mueller called the discovery use case "a dead end." Keep it for non-Google AI services; assign it no Google citation weight.

## Top 5 highest-impact changes

1. **Restructure the FAQ into six 134–167 word blocks**, each with its question as an `<h3>`. This converts one 218-word lump into six individually-extractable answers *and* fixes the question-heading gap in one edit. (Unblocks nothing; blocked by nothing — do it first.)
2. **Add a 40–60 word definitional opener** — "An AI trip planner is…" — above the current benefit hero. Retain the hero copy; prepend the definition. Targets *what is* queries the page currently cannot answer.
3. **Emit `dateModified`** (and a visible "Last updated") on this page and the other nine landing pages. Cheapest fix on the list; without it no freshness play is measurable.
4. **Delete the per-page `generateSoftwareApplicationSchema()` call** in all 10 pages; keep the sitewide one in `app/layout.tsx`.
5. **Expand `Organization.sameAs`** to x.com, Instagram, and LinkedIn, and drop the stale `twitter.com` URL.

## Leading indicators to watch (no re-audit needed)

- AI-referral sessions segmented by landing query — does *what is* traffic appear after change 2?
- GSC average position for "ai trip planner" (AI Overviews correlate strongly with classic rank).
- Duplicate-schema warnings clearing in the Rich Results / Search Console structured-data report.

## How this could be wrong

The citability and freshness findings rest on third-party correlational studies (SE Ranking, Ahrefs), not on Google primary sources. Google's own position is that GEO is "still SEO" and that no AI-specific optimization is required. If that is the truer model, changes 1–2 will still help (they are ordinary content-structure wins) but change 3 would show no citation lift — which is exactly what the leading indicators above would reveal.
