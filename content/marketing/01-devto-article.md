# The Next.js SEO Bug That Made Google Ignore My Entire Site (And How I Found It)

*Tags: `nextjs`, `seo`, `webdev`, `buildinpublic`*

---

I shipped a full-featured AI travel planner. 328 commits. Three languages. 230+ pages. Google couldn't find a single one.

This is the story of how I went from zero indexed pages to 176 in three weeks — and the one Next.js configuration line that changed everything.

## Some Context

I'm a developer. I like building things. SEO was always that thing I'd "figure out later." Famous last words.

The app is called [MonkeyTravel](https://monkeytravel.app). It uses Gemini AI to generate personalized travel itineraries — day-by-day plans with activities, restaurants, hotels, budget breakdowns. It works in English, Spanish, and Italian. I built it because planning group trips with friends was always chaos, and I wanted something smarter.

The app itself worked great. People who found it loved it.

The problem? Nobody could find it.

## Phase 1: "Why Isn't Google Showing My Site?"

I'll be honest — when I first checked Google Search Console, I expected to see... something. I'd been live for weeks. Instead: a flat line. Zero impressions. Zero clicks. Zero indexed pages.

My first instinct was to blame Google. "It takes time," I told myself. So I waited another week. Still zero.

That's when I actually looked at my setup:

- ❌ No sitemap
- ❌ No canonical tags
- ❌ No hreflang tags (despite 3 languages)
- ❌ No structured data
- ❌ Default robots.txt from `create-next-app`
- ❌ No meta descriptions on half the pages

Basically, I'd built a beautiful house and forgotten to put a number on the door.

## Phase 2: The Foundations (Boring but Necessary)

I spent a weekend adding the basics. Nothing revolutionary — just what every site needs:

**Sitemap:** Next.js makes this easy with `app/sitemap.ts`. Mine generates URLs for all static pages, blog posts, and destination pages across all 3 locales. Dynamic content from Supabase gets included too.

```typescript
// Simplified version of my sitemap
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://monkeytravel.app";
  const locales = ["en", "es", "it"];

  // Blog posts × 3 languages
  const blogSlugs = getAllSlugs();
  const blogPages = blogSlugs.flatMap(slug =>
    locales.map(locale => ({
      url: locale === "en"
        ? `${baseUrl}/blog/${slug}`
        : `${baseUrl}/${locale}/blog/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }))
  );

  return [...staticPages, ...blogPages, ...destinationPages];
}
```

**Canonical + Hreflang:** This is where multilingual sites get tricky. Every page needs to say "I'm the official URL" AND "here are my other language versions." I used `generateMetadata()` in each page:

```typescript
alternates: {
  canonical: locale === "en"
    ? `${BASE_URL}/${slug}`
    : `${BASE_URL}/${locale}/${slug}`,
  languages: {
    en: `${BASE_URL}/${slug}`,
    es: `${BASE_URL}/es/${slug}`,
    it: `${BASE_URL}/it/${slug}`,
    "x-default": `${BASE_URL}/${slug}`,
  },
},
```

**Structured Data:** JSON-LD schemas for Organization, WebSite, SoftwareApplication, Article, and TouristDestination. I built a small utility for this:

```typescript
export function jsonLdScriptProps(data: object) {
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(data),
    },
  };
}
```

**Result:** After submitting the sitemap, Google discovered all my URLs within 48 hours. But "discovered" ≠ "indexed." Most pages sat in the "Discovered — currently not indexed" queue.

After a week: **12 pages indexed.** Progress, but painfully slow.

## Phase 3: Content That Google Actually Wants

I realized my site was mostly an app behind a login wall. Google had very little public content to index. So I went aggressive on content:

**50 blog posts** covering real travel topics — itinerary guides, destination comparisons, budget travel tips, seasonal recommendations. Each one in 3 languages = 150 blog pages.

**20 destination landing pages** (Paris, Tokyo, Bali, Barcelona, etc.) with climate data, AI itinerary previews, and cross-links to blog posts. × 3 languages = 60 pages.

**5 SEO landing pages** targeting specific search intents: `/free-ai-trip-planner`, `/group-trip-planner`, `/budget-trip-planner`, etc.

But here's the thing that surprised me: **internal linking mattered more than the content itself.** Pages that were cross-linked from multiple other pages got indexed WAY faster than orphan pages. I added:

- "From the Blog" sections on every landing page
- "Related destinations" on every destination page
- Blog → destination links and destination → blog links
- A region filter on the blog index (Europe, Asia, Americas, Africa)

After two weeks: **78 pages indexed.** The curve was accelerating.

## Phase 4: The Bug That Almost Ruined Everything

Then Google Search Console showed a new error on my homepage:

> **"Duplicate without user-selected canonical"**

Google was rejecting my homepage. It was choosing `www.monkeytravel.app` as canonical instead of `monkeytravel.app`. Despite having:

- 301 redirects from www → non-www (in both middleware AND Vercel config)
- Correct canonical tags in the HTML
- All URLs in the sitemap using non-www

I checked everything twice. The redirects worked. The HTML had the right tags. I verified with curl:

```bash
$ curl -s https://monkeytravel.app/ | grep canonical
<link rel="canonical" href="https://monkeytravel.app"/>
```

The tag was right there. So why was Google saying "User-declared canonical: **None**"?

## The Discovery

I stared at this for hours before it clicked. The key was in how I verified it.

`curl` waits for the complete response. Googlebot doesn't.

In Next.js 15.2+, `generateMetadata()` streams metadata asynchronously. The `<head>` tags aren't in the initial HTML payload — they're injected via the stream after the body starts rendering. When Googlebot parses the initial response, **the canonical tag literally doesn't exist yet.**

I confirmed by looking at the raw initial HTML before streaming completes — no `<link rel="canonical">` anywhere.

## The Fix: One Config Option

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  htmlLimitedBots: /Googlebot|Google-InspectionTool|Bingbot|Yandex/i,
  trailingSlash: false,
};
```

`htmlLimitedBots` tells Next.js: "When a crawler visits, disable streaming. Send the full HTML with all metadata synchronously."

That's it. One regex. Fixed the entire problem.

I also changed my root layout canonical from `"/"` to `"./"` so every page gets a self-referencing canonical instead of all pages pointing to the homepage (a subtle but important distinction).

Deployed. Requested re-indexing. Within days: **176 pages indexed.**

## The Numbers

| Metric | Week 0 | Week 1 | Week 2 | Week 3 |
|--------|--------|--------|--------|--------|
| Pages indexed | 0 | 12 | 78 | 176 |
| Total pages in sitemap | 0 | ~50 | ~225 | ~230 |
| Blog posts (per language) | 0 | 1 | 15 | 50 |
| Structured data schemas | 0 | 3 | 5 | 5 |

## What I Got Wrong (So You Don't Have To)

**1. I didn't set up `htmlLimitedBots` from day one.** This should be in every Next.js project that cares about SEO. The metadata streaming issue is completely silent — everything looks fine when you check manually. Only crawlers are affected.

**2. I treated SEO as a "later" problem.** Every week I delayed the sitemap and canonical tags was a week of potential crawling wasted. Google's queue doesn't move faster just because you're impatient.

**3. I underestimated internal linking.** Cross-linked pages got indexed 3-4x faster than isolated pages. If you have related content, link it. Google follows links.

**4. I built multilingual support but forgot hreflang.** Having 3 language versions without hreflang means Google might treat them as duplicate content instead of translations. Costly mistake.

## AI Tricks That Helped

A few things that saved me time during this sprint:

- **AI-assisted blog content:** I used AI to draft blog post structures, then edited and localized them. For 50 posts × 3 languages, doing everything manually would have taken months.

- **Automated cross-linking:** I wrote a script that analyzed blog post topics and destination pages, then generated internal link suggestions. Much better than trying to mentally map 200+ pages.

- **Prompt engineering for i18n:** Instead of translating English content, I had the AI generate locale-native content. "Write about Paris for an Italian audience" produces much better content than "translate this Paris article to Italian."

## What I'd Tell Past Me

Start with these on day one, before you write a single feature:

1. `htmlLimitedBots` in next.config.ts
2. Sitemap generation
3. Canonical tags on every page
4. Submit to Google Search Console

Everything else — blog posts, structured data, internal linking — matters, but these four things are the foundation. Skip them and nothing else works.

129 pages are still in Google's queue. Based on the trajectory, they'll be indexed within a couple weeks. Then the real game starts: actually ranking for competitive keywords.

---

*[MonkeyTravel](https://monkeytravel.app) is free to use — drop a destination, get a personalized AI itinerary in seconds. Built with Next.js, Supabase, and Gemini AI.*

---

## 📌 Engagement Tips for Dev.to

**Before publishing:**
- Post on Tuesday or Wednesday morning (peak Dev.to traffic)
- Use exactly 4-5 tags: `nextjs`, `seo`, `webdev`, `buildinpublic`, `tutorial`

**After publishing:**
- Reply to every comment within 24 hours
- If someone shares their own SEO experience, ask follow-up questions
- Pin a comment with "Happy to answer any Next.js SEO questions"
- Cross-share on Twitter with the #DevCommunity hashtag
- Don't edit the article for engagement metrics — Dev.to's algorithm surfaces articles based on initial engagement velocity
