# From Invisible to 176 Indexed Pages: What Actually Moved the Needle for My AI Side Project

---

Hey IH! I've been building [MonkeyTravel](https://monkeytravel.app) — a free AI travel planner — for the past few months. You drop a destination, Gemini AI generates a full day-by-day itinerary with restaurants, activities, hotels, and a budget breakdown. It works in 3 languages (EN, ES, IT).

This isn't a launch post. It's a "here's what I learned about the stuff nobody warned me about" post.

I want to share the real numbers, the real mistakes, and the things that actually moved the needle — because I spent a lot of time doing things that didn't.

## The "Nobody Can Find My App" Phase

328 commits in. Three language versions. 230+ pages. The app was genuinely good — people who tried it loved it.

The problem: I had zero organic traffic. None. Google hadn't indexed a single page.

I opened Search Console for the first time and saw a flat line. My entire product was invisible.

## What I Tried (And What Actually Worked)

I'm going to be brutally honest about what moved the needle and what was a waste of time.

### Waste of Time

**Obsessing over PageSpeed scores.** I spent hours shaving milliseconds off Largest Contentful Paint — removing animation libraries from the critical path, deferring analytics scripts, optimizing images. My score went from 68 to 94. Whether it affected anything? I genuinely cannot tell. The site was already fast enough. This was procrastination disguised as productivity.

**Writing perfect code before fixing discoverability.** I was adding features to an app nobody could find. Every sprint I spent on a new feature was a sprint I didn't spend on the foundation that would let people discover those features.

**Waiting for Google to "figure it out."** My initial strategy was literally: do nothing, Google will find me eventually. I waited weeks. It didn't.

### Actually Moved the Needle

**1. The boring stuff (Sitemap + Canonical + Search Console)**

This is embarrassingly basic, but I had none of it. No sitemap. No canonical tags. The default robots.txt from create-next-app. I spent a weekend adding everything, submitted to Search Console, and Google discovered all my URLs within 48 hours.

Not indexed — discovered. There's a big difference. But you can't get indexed without being discovered first.

**2. Content — but not the way I expected**

Google had almost nothing to index on my site. The app was behind auth. The public site was a landing page and two legal pages. That's it.

I created 50 blog posts (real travel content — itinerary guides, budget tips, destination deep-dives), 20 destination landing pages, and 5 intent-targeted pages. Each in 3 languages = ~230 pages total.

But here's the insight: **the content quality mattered less than the content structure.**

**3. Internal linking was the single biggest driver**

This surprised me the most. Pages with 3+ internal links pointing at them indexed in days. Orphan pages (accessible only through the sitemap) sat in the queue for weeks.

When I added "Related Destinations" sections to blog posts and "From the Blog" sections to destination pages — basically cross-linking everything that was related — the indexing rate visibly accelerated.

The data was clear: internal links > content quality for indexing speed.

**4. Finding (and fixing) the silent bug**

This was the big one.

Google Search Console flagged my homepage as "Duplicate without user-selected canonical" — meaning Google chose `www.monkeytravel.app` as the canonical URL instead of `monkeytravel.app`. Despite my code having the correct canonical tag. Despite 301 redirects. Despite the sitemap being correct.

The cause: Next.js 15.2+ streams metadata asynchronously by default. The canonical tag was in my code, but it was being streamed to the browser as part of React's rendering pipeline. Browsers handle streaming fine. Googlebot reads the initial HTML payload and moves on — it never saw the tag.

The fix was one line:

```
htmlLimitedBots: /Googlebot|Bingbot|Yandex/i
```

This tells Next.js to send complete HTML to crawlers instead of streaming it. Everything else — my code, my tests, my manual checks — showed the tag was there. Only Googlebot couldn't see it.

After deploying this fix: 176 pages indexed within days.

## The Real Numbers

| | Week 0 | Week 1 | Week 2 | Week 3 |
|---|---|---|---|---|
| Pages indexed | 0 | 12 | 78 | 176 |
| Total pages | ~10 | ~50 | ~225 | ~230 |
| Organic traffic | 0 | 0 | Trickle | Small but real |

129 pages are still in Google's queue. The trajectory is positive.

## The $66/Day API Disaster

While we're being honest about mistakes — early in the project, I had Google Places API calls running on every page load. Autocomplete, photo lookups, place details.

One `useEffect` hook without proper dependency management was firing on every re-render. At $0.005 per call, those re-renders were costing me **$66 per day** with maybe 20 users.

I spent two weeks building an API gateway with caching, kill switches, and cost tracking. I replaced Google Distance Matrix with local Haversine calculations. I swapped Places API photos for free Pexels images.

Lesson: the cost model of your external APIs is part of your architecture. Especially when you're not charging for your product yet.

## The i18n Decision

MonkeyTravel supports English, Spanish, and Italian. I added i18n after the fact, which was painful — hundreds of hardcoded strings scattered across components, config objects, error messages.

But the more interesting problem was the AI layer. When a Spanish-speaking user asks for a trip plan, the AI needs to respond in Spanish. My first approach was translating the English prompts.

The output was flat. Technically correct, culturally empty.

What worked: writing separate prompts per locale. Not translating "recommend a good budget restaurant" to Spanish — instead, writing a prompt that accounts for Spanish dining culture (later dinners, different tipping norms, tapas vs. sit-down).

The AI-generated Italian itineraries now feel Italian, not like translated English. It's a meaningful difference.

## What I'd Do Differently

1. **Set up SEO foundations on day one.** Sitemap, canonical tags, Search Console. Before writing a single feature. Every week I delayed was a week of lost crawling.

2. **Build i18n from the start, not retrofit it.** Extracting 300+ hardcoded strings into translation files took longer than building several features from scratch.

3. **Track API costs from the first API call.** Not after the billing dashboard shows a surprise.

4. **Focus on making the free version excellent, then think about monetization.** I'm still in this phase. The product needs to prove value before I can charge for it.

## What's Next

The indexing battle is mostly won. Now comes the harder challenge: actually ranking for competitive keywords. I'm watching real search data come in for the first time — actual people finding MonkeyTravel through Google searches. Small numbers, but organic.

I'm also thinking about how to open-source the prompt library. The locale-specific prompts for AI travel content could be useful to other people building multilingual AI products.

Happy to answer questions about any of this — the Next.js streaming bug, the API cost management, the i18n approach, or the SEO timeline.

---

*[MonkeyTravel](https://monkeytravel.app) is free — plan a trip in about 30 seconds.*

---

## Indie Hackers Posting Tips

**Timing:**
- Post on Thursday (2x more top-50 posts vs Tuesday on IH)
- Morning US time (9-11 AM EST)

**Title:**
- Lead with the result, not the product name
- "From Invisible to 176 Indexed Pages: What Actually Moved the Needle for My AI Side Project"
- Alternative: "What I Learned Getting 176 Pages Indexed After Months of Zero Organic Traffic"

**Format:**
- IH readers love real numbers — include them
- Honest "what I got wrong" sections perform very well
- Frame as lessons/story, never as an announcement
- End with a genuine question to invite discussion

**Engagement:**
- Reply to every comment within a few hours
- When someone shares their own experience, ask follow-up questions
- Don't redirect to the app unless directly asked
- If someone challenges your approach ("why not X?"), give genuine reasoning, never get defensive
- Post a follow-up comment with "Milestone Update" if the post does well — IH audience loves build-in-public continuity

**Discussion prompts to include in a first comment:**
> Happy to go deep on any of this. A few things I'm still figuring out:
> - When to start charging (and how much)
> - Whether to open-source the prompt library
> - How to handle content at scale in 3 languages without sacrificing quality
>
> Would love to hear from anyone who's navigated similar challenges.

**Prepare for common IH questions:**
- "What's your MRR?" → "Zero — still free. Focused on proving value before monetization."
- "What's the tech stack?" → "Next.js, Supabase, Gemini AI, Vercel. Total hosting cost ~$20/month excluding AI API."
- "Why free?" → "I want to understand what users actually value before I charge for it. The patterns in how people use the free version will inform the paid tier."
- "Will you open-source?" → "Considering open-sourcing the prompt library — the locale-specific prompt engineering for travel content could be broadly useful."
