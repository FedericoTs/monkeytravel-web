# LinkedIn Post: The Invisible Infrastructure of the Web

*Format: Long-form LinkedIn post (not an article — posts get 5-10x more reach than LinkedIn articles)*

---

I spent 6 months building an AI travel app.

328 commits. Three languages. 230+ pages.

Google couldn't find a single one.

Here's what I learned about the parts of software engineering nobody teaches you:

---

I'm a developer. I build things. "SEO" was always something I'd figure out later.

So I built MonkeyTravel — a free AI trip planner that generates personalized itineraries in seconds. I was proud of the engineering. Clean architecture. Good performance. Solid user experience.

Then I opened Google Search Console.

Zero impressions. Zero clicks. Zero indexed pages.

My product was invisible.

---

Over the next 3 weeks, I went from 0 to 176 indexed pages. Here's what I learned:

**1. The basics matter more than the features.**

No sitemap. No canonical tags. No meta descriptions on half my pages. I'd built a complete product but forgotten to make it discoverable. Every week I spent adding features was a week I should have spent on foundations.

**2. The most dangerous bugs are the ones you can't see.**

I discovered that Next.js streams metadata asynchronously. My canonical tags — the tags that tell Google "this is the official URL" — existed in my code, passed every test, and showed up correctly when I checked manually.

But they were invisible to Googlebot.

The framework was streaming HTML, and Googlebot reads the initial payload before streaming completes. My tags literally didn't exist at the moment Google looked.

The fix? One configuration line. But finding it took hours of debugging something that looked correct everywhere I checked.

**3. Cost is architecture.**

Early on, I had Google APIs running on every page load. One mismanaged hook was firing on every re-render.

$66 per day. For 20 users.

I learned that the cost model of your dependencies isn't a finance problem — it's an engineering problem. You design for it the same way you design for performance.

**4. Translation is not localization.**

MonkeyTravel works in English, Spanish, and Italian. When I first connected the AI for multilingual itineraries, I just translated the English prompts.

The output was technically correct but culturally flat. When I rewrote prompts natively for each locale — accounting for different dining cultures, budget expectations, and cultural context — the quality improved dramatically.

A budget restaurant in Rome is not the same concept as a budget restaurant in New York.

---

**The bigger lesson:**

There's a version of software engineering that stops at "it works on my machine." And then there's the part where your code meets the real world — crawlers that parse HTML differently, APIs that charge per re-render, users who expect cultural fluency, not just language switching.

The second part isn't glamorous. It won't impress anyone in a demo. But it's the difference between a project that exists and one that's found.

---

MonkeyTravel is free at monkeytravel.app — drop a destination and get a personalized AI itinerary in 30 seconds.

What's the most expensive "invisible" bug you've encountered?

---

## LinkedIn Posting Tips

**Format:**
- This is a POST, not a LinkedIn Article. Posts get dramatically more reach.
- Use the line breaks as shown — LinkedIn's algorithm favors "dwell time" and short paragraphs encourage scrolling
- The `---` separators won't render on LinkedIn; use blank lines instead
- The "hook" (first 2-3 lines before "see more") is critical — "I spent 6 months building an AI travel app. 328 commits. Three languages. 230+ pages. Google couldn't find a single one." is designed to trigger the click

**Timing:**
- Tuesday, Wednesday, or Thursday
- 7:30-8:30 AM in your timezone (people check LinkedIn during morning commute)
- Avoid Mondays and Fridays

**Engagement strategy:**
- End with a question (already included: "What's the most expensive invisible bug you've encountered?")
- Reply to every comment within the first 2 hours — LinkedIn's algorithm heavily weights early engagement velocity
- When someone shares their own story, ask a follow-up question (keeps the thread active)
- Tag 2-3 people who might find it relevant (but only people you actually know — LinkedIn penalizes random tagging)
- Don't include the link in the main post — LinkedIn deprioritizes posts with external links. Add the link in the FIRST COMMENT instead: "Link to MonkeyTravel for anyone curious: monkeytravel.app"

**Hashtags (add at the bottom of the post):**
- #WebDevelopment #SEO #NextJS #BuildInPublic #SoftwareEngineering
- 3-5 hashtags max — more looks spammy on LinkedIn

**Follow-up posts (schedule for the following week):**
- "The real cost of Google APIs when you're bootstrapping" — expand the $66/day story
- "Why I chose to build in 3 languages from day one (and what I got wrong)" — the i18n story
- Each post should be standalone but reference the previous one casually
