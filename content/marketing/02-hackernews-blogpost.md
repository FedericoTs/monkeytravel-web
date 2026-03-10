# What Building an AI Travel App Taught Me About the Invisible Parts of the Web

*Suggested HN title: "What building an AI travel app taught me about the invisible parts of the web"*
*Publish this on your own blog (monkeytravel.app/blog/invisible-parts-of-the-web), then submit the URL to HN*

---

There's a version of software engineering where you build something, deploy it, and users show up. I believed in that version for longer than I'd like to admit.

Over the past few months I built [MonkeyTravel](https://monkeytravel.app), a free AI travel planner. You drop a destination, and Gemini generates a personalized day-by-day itinerary — restaurants, activities, hotels, budget breakdown. It supports three languages. 328 commits. The app worked beautifully.

Nobody knew it existed.

This is a post about the things I learned that aren't about code, but about how the web actually works once you step outside localhost.

## The Cost of Not Understanding Your Platform

When I first deployed, I had Google Places API calls running on every page load. Autocomplete, place details, photos — the whole suite. I didn't think about it because on localhost, API calls are free abstractions.

Then I checked the billing dashboard.

**$66 per day.** For an app with maybe 20 users.

A single rogue client-side geocoding call, running in a `useEffect` without proper dependency management, was firing on every re-render. At $0.005 per call, those re-renders added up to $100+ per day at peak.

I spent the next two weeks building an API gateway with cost tracking, caching layers, and kill switches. I replaced Google Distance Matrix API calls with local Haversine calculations. I moved from Places API photo lookups to free Pexels images for activity cards.

The lesson wasn't "be careful with APIs." It was that **the cost model of your dependencies is part of your architecture**, and I'd treated it as someone else's problem.

## The Streaming Metadata Problem

This is the most interesting technical thing I encountered, and I haven't seen it discussed much.

Next.js 15.2+ uses React's streaming architecture by default. When you use `generateMetadata()` in a page component, the metadata tags (`<link rel="canonical">`, `<meta>` tags, hreflang attributes) are streamed asynchronously. The browser handles this fine — it progressively renders the `<head>` as chunks arrive.

Googlebot does not.

Googlebot parses the initial HTML payload, sees no canonical tag, and concludes there isn't one. Google Search Console reports "User-declared canonical: None" even though `curl` shows the tag in the complete response.

The result for me was Google choosing `www.monkeytravel.app` as the canonical URL for my site instead of `monkeytravel.app`. Despite having explicit 301 redirects from www to non-www. Despite having the correct canonical tag in my code. Google simply never saw it.

The fix:

```typescript
// next.config.ts
htmlLimitedBots: /Googlebot|Bingbot|Yandex|Baiduspider/i,
```

This tells Next.js to disable streaming for matching user agents and send the complete HTML synchronously. One configuration option that fixes an entire category of SEO problems.

I find this fascinating because it's a case where **a framework optimization (streaming) creates an invisible incompatibility with a consumer (crawlers) that you'd never discover through normal testing.** Your browser works. Your `curl` tests pass. Your end-to-end tests pass. Only Googlebot fails, and it fails silently.

## What I Learned About Internationalization and AI

MonkeyTravel supports English, Spanish, and Italian. I initially built it in English and figured I'd "add translations later."

If you're building a multilingual app, this is the single worst decision you can make. Here's why.

When you add i18n after the fact, you end up with hundreds of hardcoded strings scattered across components. Finding them all is archaeological work. I had strings in JSX, in config objects, in error messages, in email templates, in structured data. The process of extracting them into translation files took longer than building several features from scratch.

But the more interesting challenge was the AI layer. MonkeyTravel uses Gemini to generate itineraries. When a Spanish-speaking user asks for a trip plan, the AI needs to respond in Spanish. But it's not just translation — it's localization.

A "budget hotel" means different things in different cultures. A restaurant recommendation for an Italian user should account for different dining patterns (later dinners, aperitivo culture, different tipping norms). The AI needs cultural context, not just language switching.

My approach: separate prompt instructions per locale, not translations of English prompts.

```typescript
// Not this:
const prompt = translate(englishPrompt, targetLanguage);

// This:
const prompt = localePrompts[locale]; // Each written natively
```

The result was noticeably better. AI-generated Italian itineraries feel Italian, not like translated English.

## The SEO Timeline Nobody Talks About

After fixing the technical foundations — sitemap, canonical tags, hreflang, structured data, the streaming fix — here's what actually happened:

- **Day 1-3:** Google discovered all URLs from the sitemap. "Discovered — currently not indexed."
- **Day 4-7:** 12 pages indexed. All high-priority pages (homepage, main landing pages).
- **Day 8-14:** 78 pages indexed. Blog posts and destination pages started appearing.
- **Day 15-21:** 176 pages indexed. The curve accelerated as Google built trust.

**129 pages are still waiting.** Google doesn't index everything immediately, especially for young domains. This is normal, but nobody tells you it's normal when you're watching the Search Console dashboard refresh.

What accelerated indexing the most? Internal linking. Pages that were cross-referenced from multiple other pages indexed significantly faster than isolated pages. I added "Related Blog Posts" sections to destination pages and "Explore Destinations" sections to blog posts. The effect was measurable within days.

## Things I Wish Someone Had Told Me

**Your robots.txt probably blocks things you want indexed.** The default Next.js one is fine, but check it. I had API routes and admin pages correctly blocked, but hadn't explicitly allowed my public routes.

**Structured data doesn't directly improve ranking, but it changes how your pages appear in search results.** My Article schema means blog posts show publication dates and author info in search results. My SoftwareApplication schema means MonkeyTravel shows as an app with ratings.

**PageSpeed matters, but not where you think.** I spent hours shaving milliseconds off LCP by removing Framer Motion from the critical path and deferring analytics scripts. The PageSpeed score improved from 68 to 94. Whether this affected indexing speed, I honestly can't tell. But it was the right thing to do regardless.

**The `www` vs `non-www` decision must be consistent everywhere.** Sitemap, canonical tags, structured data, Open Graph URLs, robots.txt — if even one reference uses the wrong variant, you're sending mixed signals.

## The Broader Lesson

The invisible parts of the web — how crawlers see your site, how streaming interacts with indexing, how cost models compound, how i18n affects AI output — are where the interesting engineering problems live. They're not glamorous. They won't make your app look better in a demo. But they're the difference between a project that exists and a project that's found.

I spent months building features. I should have spent the first week making sure the foundations were right. The features don't matter if nobody can find them.

---

*MonkeyTravel is free at [monkeytravel.app](https://monkeytravel.app). You can plan a trip in about 30 seconds.*

---

## 📌 HN Submission Tips

**Timing:** Submit on Sunday between 11:00-11:30 AM EST (lower competition, full day of engagement ahead)

**Title:** Use exactly: `What building an AI travel app taught me about the invisible parts of the web`
- Don't mention MonkeyTravel in the title
- Don't use "Show HN" — this is a blog post, not a product demo
- No caps, no exclamation marks, no hype

**First comment (post immediately after submission):**

> Author here. Built MonkeyTravel as a side project to plan trips with friends. The streaming metadata bug was the most surprising thing I encountered — everything passes normal testing but silently breaks for crawlers. Happy to go deeper on the Next.js specifics, the API cost disasters, or the i18n approach if anyone's interested.

**Engagement rules:**
- Monitor every 15 minutes for the first 3 hours
- Answer EVERY technical question in depth
- When criticized, agree with valid points: "That's fair — I should have caught that earlier"
- Never get defensive. Never say "but actually..."
- If someone asks "why not X instead of Y?", give a genuine answer about your decision process
- Don't mention the app again in comments unless directly asked

**Prepare answers for likely questions:**
- "Why Gemini over GPT?" → Cost, creative quality for travel, multi-language performance
- "How does this compare to Google Trips / Wanderlog?" → Focus on the 30-second generation vs. manual planning
- "Why free?" → Learning what users want before monetizing
- "Will you open-source it?" → Considering open-sourcing the prompt library
