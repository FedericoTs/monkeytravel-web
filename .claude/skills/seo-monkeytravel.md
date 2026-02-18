---
name: seo-monkeytravel
description: |
  End-to-end SEO blog content engine for MonkeyTravel. Use this skill when:
  (1) Researching blog topics via Google Trends and keyword analysis,
  (2) Writing new SEO blog posts with proper frontmatter, structure, and translations,
  (3) Auditing existing blog content for SEO gaps,
  (4) Planning content calendars around trending travel queries,
  (5) Creating or updating blog posts across all 3 locales (EN/ES/IT).
---

# SEO Blog Engine — MonkeyTravel

Create high-ranking, multilingual blog content for MonkeyTravel's travel planning audience. Every post must be research-driven, brand-aligned, and ship-ready across EN/ES/IT.

---

## 1. Brand Voice & Tone

### Identity

MonkeyTravel is an **AI-powered travel planner** that creates personalized day-by-day itineraries with real venues, real prices, and smart routing. The brand is for practical travelers who want to plan better, not just dream.

### Tone Rules

| Attribute | Do | Don't |
|-----------|----|----- |
| **Honest** | "AI gets this wrong 15% of the time" | "AI is perfect for every trip!" |
| **Practical** | "Here's the step-by-step" | "Imagine the possibilities..." |
| **Data-backed** | "42% of travelers used AI in 2025" | "Everyone is using AI now" |
| **Conversational** | "You've read that article. Probably twelve times." | "In this article, we will explore..." |
| **Anti-hype** | "No hype, just facts" | "Revolutionary breakthrough!" |
| **Direct** | Short paragraphs. Active voice. Get to the point. | Long academic paragraphs. Passive voice. Throat-clearing intros. |

### Writing Style

- **Opening hook**: Skip generic intros. Start with a stat, a contrarian take, or a scenario the reader lives.
- **Paragraphs**: 2-3 sentences max. Walls of text kill scroll depth.
- **Subheadings**: Use H2 for major sections, H3 for sub-topics. Every H2 should be a potential Google "jump-to" link.
- **Lists**: Use numbered lists for steps/rankings, bullets for features/options.
- **Data**: Cite real studies, real numbers. Link to sources at the bottom.
- **CTA pattern**: Soft pitch in context (not pushy). Always end with a clear CTA linking to `https://monkeytravel.app`.
- **Word count**: Target 1,500-2,500 words. Enough depth for SEO, not so long it loses the reader.
- **Reading time**: 5-8 minutes optimal for travel blog SEO.

### Absolute Rules

1. **"AI" is never translated.** Use "AI" in all locales (EN, ES, IT). Never write "IA" even in Spanish/Italian.
2. **Author is always** `"MonkeyTravel Team"`.
3. **No corporate speak.** No "leverage", "synergy", "utilize". Write like a smart friend who travels a lot.
4. **No fluff paragraphs.** Every section must teach something or make a point. If a paragraph doesn't earn its place, cut it.
5. **Sources required.** Every factual claim needs a real source. Add a sources section at the bottom of the post using markdown links.

---

## 2. Google Trends Research Workflow

Before writing any post, validate demand using Google Trends. The goal is to find **rising queries** in the travel space that MonkeyTravel can rank for.

### Step 1: Identify Seed Topics

Use WebSearch to research current trending travel queries:

```
WebSearch: "Google Trends travel planning 2026"
WebSearch: "trending travel searches [current month] [current year]"
WebSearch: "most searched travel destinations [current year]"
```

### Step 2: Validate with Google Trends

Use WebFetch on Google Trends explore pages to check interest:

```
WebFetch: https://trends.google.com/trends/explore?q=ai+trip+planner&geo=US
WebFetch: https://trends.google.com/trends/explore?q=ai+trip+planner,travel+agent&geo=US
```

**What to look for:**
- **Rising queries** (breakout = massive opportunity)
- **Related queries** at the bottom (expand your topic list)
- **Seasonal patterns** (time your publishing)
- **Geographic interest** (match to our locale markets: US/UK for EN, Spain/LATAM for ES, Italy for IT)

### Step 3: Cross-Reference Keyword Volumes

Search for keyword difficulty and volume estimates:

```
WebSearch: "[keyword phrase]" search volume difficulty 2026
WebSearch: "[keyword phrase]" SEO keyword analysis
```

**Prioritize queries that are:**
- Medium difficulty (not dominated by TripAdvisor/Lonely Planet on page 1)
- 1,000+ monthly searches (worth the investment)
- Rising trend (not declining)
- Relevant to MonkeyTravel's features (AI planning, group trips, budget trips, specific destinations)

### Step 4: Competitor Gap Analysis

Check what top travel blogs are covering and find gaps:

```
WebSearch: site:nomadicmatt.com "[topic]"
WebSearch: site:thebrokebackpacker.com "[topic]"
WebSearch: "[target keyword]" blog 2026
```

Look for:
- Topics with outdated content (pre-2025 articles ranking)
- Questions on Reddit/Quora with no good blog answer
- "People Also Ask" boxes in Google with weak answers

### Step 5: Build the Content Brief

For each approved topic, document:

| Field | Example |
|-------|---------|
| Primary keyword | "ai trip planner vs travel agent" |
| Secondary keywords | "is ai better than travel agent", "ai vs human travel planning" |
| Search intent | Comparison / Decision-making |
| Target word count | 2,000 |
| Angle | Side-by-side test with real data (honest, not biased) |
| MonkeyTravel tie-in | AI planner used in the test |
| Competitor weakness | Existing articles are opinions, not real comparisons |

---

## 3. Blog Post Technical Structure

### File System

```
content/blog/
├── {slug}.md                     # English (default)
├── es/{slug}.md                  # Spanish variant
└── it/{slug}.md                  # Italian variant

messages/
├── en/blog.json                  # EN titles, descriptions, categories
├── es/blog.json                  # ES translations
└── it/blog.json                  # IT translations

public/images/blog/
└── {slug-related-name}.jpg       # Hero image (1200x630px, optimized)
```

### Frontmatter Schema (YAML)

Every blog post `.md` file must include this exact frontmatter:

```yaml
---
title: "Full Title With Target Keyword Near the Start"
slug: "hyphenated-url-slug"
description: "150-160 char description. Hook + benefit. Include primary keyword."
author: "MonkeyTravel Team"
publishedAt: "YYYY-MM-DD"
updatedAt: "YYYY-MM-DD"
category: "AI Travel"          # Options: AI Travel, Destination Guides, Trip Planning, Budget Travel
tags: ["primary keyword", "secondary keyword", "related term", "long tail", "topic"]
image: "/images/blog/descriptive-name.jpg"
imageAlt: "Descriptive alt text for accessibility and image SEO"
readingTime: 5                  # Integer, minutes
seo:
  title: "SEO Title (50-60 chars) | MonkeyTravel"
  description: "SEO description (under 155 chars). More keyword-focused than main description."
  keywords: ["primary keyword", "secondary keyword", "long-tail variation", "related query", "modifier keyword"]
schema: "Article"
---
```

### Required Content Sections

Every blog post must follow this structure:

```markdown
# Title (H1 — matches frontmatter title)

[Opening hook paragraph — stat, question, or contrarian take]

[Context paragraph — why this matters now]

## First Major Section (H2)

[Content with H3 sub-sections as needed]

### Sub-topic (H3)

[Detailed content]

## [More H2 sections as needed]

[...]

## [Soft CTA Section — ties to MonkeyTravel naturally]

[1-2 paragraphs connecting the topic to MonkeyTravel's features]

[Plan My Trip — Free](https://monkeytravel.app)

---

## FAQ

### [Question 1]?

[Answer — 2-3 sentences, direct]

### [Question 2]?

[Answer]

### [Question 3]?

[Answer]

### [Question 4]?

[Answer]

---

*Sources: [Source Name](url), [Source Name](url), ...*
```

**FAQ Rules:**
- 3-5 questions per post
- Target "People Also Ask" questions from Google
- Answers must be concise (2-3 sentences) — Google pulls these into PAA boxes
- Use the exact question phrasing people search for

### Hero Images

- **Size**: 1200 x 630px (matches OG image requirements)
- **Format**: JPG, optimized (under 200KB)
- **Naming**: `/images/blog/{descriptive-name}.jpg`
- **Alt text**: Always descriptive, include keyword naturally

---

## 4. Translation Requirements

Every blog post ships in all 3 locales simultaneously.

### File Creation Checklist

For a new post with slug `my-new-post`:

1. **`content/blog/my-new-post.md`** — English (full article)
2. **`content/blog/es/my-new-post.md`** — Spanish (full article, culturally adapted)
3. **`content/blog/it/my-new-post.md`** — Italian (full article, culturally adapted)
4. **`messages/en/blog.json`** — Add `posts.my-new-post.title` and `posts.my-new-post.description`
5. **`messages/es/blog.json`** — Add translated title and description
6. **`messages/it/blog.json`** — Add translated title and description
7. **`public/images/blog/*.jpg`** — Hero image (shared across locales)

### Translation JSON Structure

Add to each locale's `messages/{locale}/blog.json` inside the `"posts"` object:

```json
{
  "posts": {
    "my-new-post": {
      "title": "Full Translated Title",
      "description": "Translated meta description under 160 chars."
    }
  }
}
```

### Translation Rules

| Rule | Detail |
|------|--------|
| **"AI" stays "AI"** | Never use "IA" in any locale. Brand rule. |
| **Adapt, don't translate** | Rephrase for natural flow in each language |
| **Localize examples** | Use local currency (EUR for ES/IT), local destination names, local context |
| **SEO keywords differ** | Use locale-specific keywords (see reference), not literal translations |
| **Meta descriptions** | Must be under 160 characters in every locale |
| **Category keys** | Use English keys in frontmatter (`"AI Travel"`), translations are in `blog.json > categories` |
| **Dates** | Use ISO format in frontmatter (`YYYY-MM-DD`), display is locale-formatted by code |

### Spanish Adaptation Notes

- Use informal "tu" (target audience is young/mid travelers)
- "planificador de viajes con AI" not "planificador de viajes con IA"
- Prices in EUR where relevant
- Reference Spanish/LATAM destinations when adapting examples

### Italian Adaptation Notes

- Use informal "tu" for B2C travel content
- "pianificatore di viaggi con AI" not "pianificatore di viaggi con IA"
- Prices in EUR
- Reference Italian destinations when adapting examples

---

## 5. Categories & Pillar Content Strategy

### Active Categories

| Category Key | EN | ES | IT | Purpose |
|-------------|----|----|-----|---------|
| `AI Travel` | AI Travel | Viajes con AI | Viaggi e AI | Product-adjacent, AI travel tools |
| `Destination Guides` | Destination Guides | Guías de Destinos | Guide alle Destinazioni | Specific city/country guides |
| `Trip Planning` | Trip Planning | Planificación de Viajes | Pianificazione Viaggi | How-to planning content |
| `Budget Travel` | Budget Travel | Viajes Económicos | Viaggi Low Cost | Budget tips, cost breakdowns |

### Content Pillars (Topic Clusters)

**Pillar 1: AI Travel Planning** (drives product awareness)
- How AI trip planners work
- AI vs traditional planning methods
- Best AI travel tools reviews/comparisons
- Future of travel technology

**Pillar 2: Destination Guides** (captures search traffic)
- "First trip to [City]" guides
- "[City] on a budget" guides
- "[City] itinerary [N] days" guides
- Seasonal destination guides

**Pillar 3: Trip Planning How-Tos** (builds authority)
- Group trip planning
- Solo travel planning
- Packing guides
- Travel booking strategies

**Pillar 4: Budget Travel** (high-volume keywords)
- Budget breakdowns by destination
- Money-saving travel hacks
- Free activities in popular cities
- Cheap flight/hotel strategies

### Internal Linking

Every post should link to:
- 1-2 related posts (uses the related posts component automatically)
- The MonkeyTravel homepage CTA (end of article)
- Relevant destination pages (`/destinations/{slug}`) when mentioning cities we cover

---

## 6. SEO Optimization Checklist

Run this checklist before publishing every post:

### Content Quality
- [ ] Title includes primary keyword within first 60 characters
- [ ] H1 matches the title and appears once
- [ ] At least 4 H2 sections (for ToC and jump links)
- [ ] FAQ section with 3-5 "People Also Ask" questions
- [ ] Sources cited with real URLs
- [ ] Word count: 1,500-2,500 words
- [ ] Reading time: 5-8 minutes

### Technical SEO
- [ ] `seo.title` under 60 characters, includes primary keyword
- [ ] `seo.description` under 155 characters, compelling
- [ ] `seo.keywords` array has 5 keywords (primary + secondary + long-tail)
- [ ] `description` (frontmatter) under 160 characters
- [ ] `slug` is short, descriptive, hyphenated, all lowercase
- [ ] `image` path exists and image is 1200x630px
- [ ] `imageAlt` is descriptive and includes keyword naturally
- [ ] `tags` array has 5 relevant terms

### Translations
- [ ] All 3 locale files created (EN, ES, IT)
- [ ] `messages/{en,es,it}/blog.json` updated with title + description
- [ ] All descriptions under 160 characters
- [ ] "AI" used (never "IA") in all locales
- [ ] ES/IT content is adapted (not machine-translated)
- [ ] Local examples and currency used where appropriate

### Schema & Metadata
- [ ] `schema: "Article"` set in frontmatter
- [ ] Article schema auto-includes: wordCount, articleSection, keywords, inLanguage
- [ ] Breadcrumb schema auto-generated
- [ ] FAQ schema auto-extracted from `## FAQ` section with `### Question` / `<p>Answer</p>` format

---

## 7. Google Trends Topic Discovery Templates

Use these search templates to find content opportunities. Replace `{year}` with current year.

### Trending Travel Queries
```
WebSearch: google trends travel planning {year}
WebSearch: most searched travel destinations {year}
WebSearch: rising travel search queries {year}
WebSearch: travel industry trends {year}
```

### Destination-Specific Opportunities
```
WebSearch: "first trip to [city]" guide {year}
WebSearch: "[city] itinerary [N] days" {year}
WebSearch: "[city] on a budget" travel {year}
WebSearch: "best time to visit [city]" {year}
```

### AI Travel Queries (Product-Adjacent)
```
WebSearch: "ai trip planner" vs {year}
WebSearch: "best ai travel app" {year}
WebSearch: "chatgpt travel planning" problems {year}
WebSearch: "ai itinerary" review {year}
```

### Comparison & Decision Queries (High Conversion)
```
WebSearch: "[tool A] vs [tool B]" travel planning {year}
WebSearch: "is it worth using" ai trip planner
WebSearch: "travel agent vs" online planning {year}
WebSearch: "best way to plan" [trip type] {year}
```

### Seasonal & Event-Based
```
WebSearch: google trends "[season] vacation" {year}
WebSearch: "where to go in [month]" {year}
WebSearch: "[holiday] trip" planning guide {year}
```

### Reddit/Forum Gap Mining
```
WebSearch: site:reddit.com "trip planning" advice {year}
WebSearch: site:reddit.com "ai travel planner" experience
WebSearch: site:reddit.com "[destination]" itinerary help
```

---

## 8. Post-Publish Workflow

After the post is live:

1. **Verify build**: `npm run build` passes with 0 errors
2. **Check live pages**: Visit `/blog/{slug}`, `/es/blog/{slug}`, `/it/blog/{slug}`
3. **Validate structured data**: Use Google Rich Results Test on the live URL
4. **Test social cards**: Check OG/Twitter cards render correctly (use Facebook Sharing Debugger)
5. **Submit to Search Console**: Request indexing for the new URL
6. **Monitor**: Check Search Console after 1-2 weeks for impressions, clicks, and indexed status

---

## 9. Existing Blog Posts Inventory

| Slug | Category | Keywords Focus |
|------|----------|---------------|
| `how-ai-is-changing-travel-planning` | AI Travel | ai travel planning, ai trip planner 2026 |
| `ai-trip-planner-vs-travel-agent` | AI Travel | ai trip planner vs travel agent |
| `first-trip-to-japan-what-you-need-to-know` | Destination Guides | first trip to japan, japan travel guide |
| `how-to-plan-a-group-trip` | Trip Planning | group trip planning, plan trip with friends |
| `how-to-plan-trip-to-italy-on-a-budget` | Budget Travel | italy trip budget, italy travel cheap |

### Coverage Gaps to Fill

**Destination Guides** (high volume, all 20 destination pages can have companion blog posts):
- Paris, Barcelona, Tokyo, London, New York, Bali, etc.

**AI Travel** (product awareness):
- "Best AI Travel Apps Compared"
- "How to Use AI to Plan a Honeymoon"
- "AI Travel Planning Mistakes to Avoid"

**Trip Planning** (authority building):
- "Solo Trip Planning Guide"
- "How to Plan a Multi-City Europe Trip"
- "Weekend Trip Planning in Under 10 Minutes"

**Budget Travel** (high-volume seasonal):
- "Europe on $50/Day" guides
- "Cheapest Destinations in [Season] [Year]"
- "How to Find Cheap Flights [Year]"

---

## Reference Files

- **references/google-trends-playbook.md** — Detailed Trends analysis methodology
- See also: `~/.claude/skills/seo-localization-expert/` — Locale-specific SEO, power words, keyword databases
- See also: `~/.claude/skills/seo-sem/` — Technical SEO, structured data, Core Web Vitals
