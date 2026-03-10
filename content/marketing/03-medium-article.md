# I Knew Nothing About SEO. Here's How I Got 176 Pages Indexed in 3 Weeks.

*Publication: Better Programming or The Startup (submit via their submission forms)*
*Tags: SEO, Next.js, Web Development, Startup, AI*

---

Six months ago, I couldn't have told you the difference between a canonical tag and a meta description. I'm a developer. I build things. SEO was that vague cloud of marketing concepts I'd "figure out later."

I built MonkeyTravel — a free AI travel planner that generates personalized itineraries using Google's Gemini. You type a destination, and in about 30 seconds you get a day-by-day plan with restaurants, activities, hotels, and a budget breakdown. It supports English, Spanish, and Italian. I poured months into it. 328 commits. The app was solid.

Then I opened Google Search Console for the first time.

Zero impressions. Zero clicks. Zero indexed pages. My site was invisible.

This is the story of how I went from knowing almost nothing about SEO to getting 176 pages indexed in three weeks — entirely through experimentation, reading documentation, and making every mistake you can imagine along the way.

## Starting From Zero (Literally)

I want to be honest about where I started. My mental model of SEO was essentially: "Google finds websites automatically, right?" I figured if I deployed to a good domain and the site was fast, Google would eventually show up.

That's not how any of this works.

When I finally looked at what I'd actually shipped, the checklist was brutal:

- No sitemap (Google didn't even know what pages existed)
- No canonical tags (Google didn't know which URL was "the real one")
- No hreflang tags (despite having 3 language versions)
- No structured data
- No meta descriptions on half the pages
- The default robots.txt from `create-next-app`

I'd essentially built a house without putting an address on it.

## The First Experiment: Just Add the Basics

I'm an engineer. When I don't know something, I read the docs. So I spent a weekend reading Google's own documentation — not blog posts, not "10 SEO tips" articles, but the actual Google Search Central docs.

What I learned was surprisingly straightforward. Google needs three things from you:

1. **Tell it what pages exist** (sitemap)
2. **Tell it which URL is the official version** (canonical)
3. **Tell it how your pages relate** (internal links, hreflang for languages)

Everything else is optimization. These three are table stakes.

I added a sitemap generator. Next.js makes this easy — you create a `sitemap.ts` file in your app directory, and it generates the XML automatically. Mine loops through all static pages, blog posts, and destination pages across all three languages.

I added canonical tags and hreflang attributes to every page. For a multilingual site, this is critical — without hreflang, Google might treat your Spanish and Italian pages as duplicate content instead of translations. That's the opposite of what you want.

I submitted the sitemap to Google Search Console.

**Result:** Within 48 hours, Google discovered all my URLs. But "discovered" doesn't mean "indexed." Most pages sat in a queue called "Discovered — currently not indexed."

After a full week: 12 pages indexed. Out of 230+.

## The Content Problem

Here's something I didn't expect: Google wasn't interested in my app. Not because it was bad, but because there was nothing for Google to index. The app lived behind authentication. The public-facing site was essentially a landing page and a couple of legal pages.

Google indexes content. No content, no index.

So I went all-in on content. Over two weeks, I created:

- **50 blog posts** covering real travel topics — itinerary guides, destination deep-dives, budget tips, seasonal guides. Each one in 3 languages, so 150 blog pages total.
- **20 destination landing pages** — Paris, Tokyo, Barcelona, Bali, and more — each with climate data, travel tips, and AI-generated itinerary previews.
- **5 intent-specific landing pages** — targeting searches like "free AI trip planner" and "group trip planner."

That brought my total to about 230 public pages.

But here's the thing that genuinely surprised me: **the content itself wasn't the main driver of indexing speed.** Internal linking was.

Pages that were cross-referenced from multiple other pages got indexed dramatically faster than isolated pages. When I added "Related Destinations" sections to blog posts and "From the Blog" sections to destination pages, the effect was measurable within days.

Google follows links. The more paths that lead to a page, the faster Google finds and trusts it.

**After two weeks: 78 pages indexed.** The acceleration was real.

## The Bug That Changed Everything

Then something strange happened. Google Search Console flagged my homepage with a new error:

> **"Duplicate without user-selected canonical"**

Google was saying: "We found your homepage, but we're choosing `www.monkeytravel.app` as the real URL, not `monkeytravel.app`."

This was wrong. I had 301 redirects from www to non-www. I had the correct canonical tag in my code. Every URL in my sitemap used the non-www version.

I verified with curl:

```
$ curl -s https://monkeytravel.app/ | grep canonical
<link rel="canonical" href="https://monkeytravel.app"/>
```

The tag was right there. So why was Google saying "User-declared canonical: None"?

I spent hours on this. I read every Stack Overflow answer, every Google support thread. Nothing matched my situation. Everything was correct. The tag existed. Google just... couldn't see it.

Then it clicked.

### How a Framework Feature Became an SEO Bug

I'm using Next.js, which since version 15.2 uses React's streaming architecture by default. When you define metadata using `generateMetadata()` — the standard Next.js way — those tags (`<link rel="canonical">`, `<meta>` descriptions, hreflang attributes) are streamed asynchronously as part of the React rendering pipeline.

Your browser handles this perfectly. It progressively renders the `<head>` as chunks arrive.

Googlebot does not.

Googlebot parses the initial HTML payload. If the canonical tag hasn't arrived in that initial chunk — because it's waiting to be streamed — Googlebot concludes there isn't one.

**The canonical tag existed in my code. It existed in the final rendered HTML. It just didn't exist at the moment Googlebot looked.**

This was invisible to every debugging method I had:

- Browser inspection: works (browser waits for stream)
- curl: works (curl gets the complete response)
- Lighthouse: works (runs in a full browser environment)
- End-to-end tests: work (same reason)

Only Googlebot failed. And it failed silently.

### The One-Line Fix

```typescript
// next.config.ts
htmlLimitedBots: /Googlebot|Google-InspectionTool|Bingbot|Yandex/i,
```

This tells Next.js: "When a crawler visits, don't stream. Send the complete HTML synchronously."

One config option. That's all it took.

I deployed, requested re-indexing of my homepage, and within days: **176 pages indexed.**

## What I Actually Learned

This wasn't really about SEO. It was about the gap between "my code works" and "my code works for every consumer."

We test in browsers. We test with curl. We test with automated tools. But the web has invisible consumers — crawlers, screen readers, social media previews, feed readers — that parse HTML differently. When a framework optimization like streaming creates an incompatibility with one of these consumers, the failure is completely silent.

Here are the specific things I'd tell my past self:

**Start with the infrastructure, not the features.** Sitemap, canonical tags, Google Search Console — set these up before you write a single feature. Every week you delay is a week of potential indexing wasted.

**Internal linking is more powerful than you think.** I've read this advice a hundred times and dismissed it. But watching the data — pages with 3+ internal links indexing in days while orphan pages sat in the queue for weeks — made it real.

**Your dependencies' cost model is part of your architecture.** Early in the project, I had Google Places API calls running on every page load. Autocomplete, place details, photos. One rogue `useEffect` without proper dependency management was firing API calls on every re-render. At $0.005 per call, those re-renders added up to $66 per day for an app with 20 users. I eventually replaced paid APIs with free alternatives where possible (Pexels for photos, Haversine formula for distance calculations). But the lesson wasn't "be careful with APIs." The lesson was that cost is a first-class architectural concern, not an afterthought.

**AI-generated content needs localization, not translation.** MonkeyTravel generates itineraries in three languages. My first approach was to translate English prompts to Spanish and Italian. The output was technically correct but culturally flat. When I rewrote prompts natively for each locale — accounting for different dining times, cultural references, budget expectations — the quality jumped noticeably. A "budget restaurant" means different things in Rome and in New York.

**The `www` vs `non-www` decision must be consistent across every layer.** Sitemap, canonical tags, structured data, Open Graph URLs, robots.txt, CDN configuration, redirect rules. If even one reference uses the wrong variant, you're sending mixed signals.

## The Numbers

| Week | Pages Indexed | Total Pages | Blog Posts |
|------|--------------|-------------|-----------|
| 0 | 0 | ~10 | 0 |
| 1 | 12 | ~50 | 1 |
| 2 | 78 | ~225 | 15 |
| 3 | 176 | ~230 | 50 |

129 pages are still in Google's queue. Based on the trajectory, they'll be indexed soon. But the waiting is the hardest part — Google doesn't move on your schedule.

## What's Next

I'm now watching real search data come in for the first time. Actual humans finding MonkeyTravel through Google. It's a small trickle, but it's organic — people searching for trip planning who land on my blog posts and destination pages.

The next challenge is ranking, not just indexing. But that's a different game entirely.

If you're a developer who's been ignoring SEO because it feels like marketing: it's not. It's infrastructure. The same way you'd set up monitoring or error handling, you should set up discoverability. Your app doesn't exist until someone can find it.

---

*[MonkeyTravel](https://monkeytravel.app) is free — drop a destination and get a personalized AI itinerary in about 30 seconds.*

---

## Publishing Tips for Medium

**Best publications to submit to:**
- **Better Programming** (700K+ followers) — submit via their form, focus on the technical learning angle
- **The Startup** (800K+ followers) — broader audience, emphasize the journey narrative
- **JavaScript in Plain English** — if rejected from above, strong fit for the Next.js specific content

**Formatting:**
- Add a compelling subtitle: "What happens when a developer who's never thought about SEO suddenly needs 230 pages indexed"
- Use Medium's built-in code blocks (triple backtick)
- Add 1-2 images: a Google Search Console screenshot showing the indexing curve, and optionally the "Duplicate without user-selected canonical" error
- Keep paragraphs short — Medium readers scan

**Timing:**
- Publish Tuesday or Wednesday morning (US time zones)
- Best hours: 7-9 AM EST

**Engagement:**
- Set canonical URL to your own blog (monkeytravel.app/blog/...) to get SEO credit
- Respond to every comment, especially technical questions
- If someone shares their own SEO story, ask follow-up questions — Medium's algorithm rewards active comment threads
- Share on Twitter with a thread summarizing the key insight (the streaming bug)
- Tag relevant accounts: @veraborea (former Hacker Noon editor), Next.js accounts

**Title alternatives (A/B test in your head):**
- "I Knew Nothing About SEO. Here's How I Got 176 Pages Indexed in 3 Weeks."
- "The Silent Bug That Made Google Ignore My Entire Next.js Site"
- "From Zero to 176 Indexed Pages: A Developer's SEO Journey"
