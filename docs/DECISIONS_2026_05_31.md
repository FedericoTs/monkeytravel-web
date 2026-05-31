# Pending decisions — closed 2026-05-31

Both items are now ratified + already implemented in code. Documenting the rationale so the next contributor doesn't re-litigate.

---

## #280 — /shared/ noindex strategy → **CONFIRMED: noindex**

**Decision:** `/shared/*` (private trip share URLs) stays excluded from Google's index.

**Currently implemented at:** `app/robots.ts` line 28 — `"/shared/", // private trip shares — noindexed per cycle-3 finding`. Plus per-page `<meta robots="noindex,follow">` on the `/shared/[token]` route.

**Why noindex (not viral SEO):**

1. **Privacy expectation.** A user generating a share token expects "anyone with the link can view" — not "anyone Googling 'Tokyo trip itinerary 2026'." The semantic difference matters: shared = consensually accessible to people I gave the link to; indexed = surfaced to strangers.

2. **Token leakage risk.** Share tokens are 16-char URL-safe IDs (not designed as secrets, but not designed as public IDs either). Letting Google index them invites scraper exposure + cached snippets that survive even after the user revokes sharing.

3. **/explore is the viral surface.** When a user explicitly opts in to public discoverability via PublishTripModal, the trip lands at `/explore/*` (or `/trips/[id]` with `visibility='public'`) — that path IS indexed and IS the SEO bet. We have a clean two-tier model: `/shared/` for "link-sharing within my circle", `/explore/` for "publish to the world". Don't conflate them.

4. **Quality signal.** Most shared trips are personal drafts (varying quality). Indexing them dilutes the brand and feeds Google low-engagement landing pages that hurt site-wide ranking signals via "thin content" / "low dwell time" penalties.

**Quantified:** at current scale (~150 users) blocking /shared/ costs at most 30-40 indexable pages. The /explore + /blog + /destinations indexable surface area is already in the hundreds. Negligible SEO cost, real privacy + brand-quality gain.

---

## #282 — Google-Extended + Applebot-Extended → **CONFIRMED: block**

**Decision:** Both AI training crawlers blocked at robots.txt and edge-middleware level.

**Currently implemented at:**
- `app/robots.ts` lines 64-65 — `BLOCKED_AI_AGENTS` includes both. Each gets its own `userAgent: <name>; disallow: /` rule.
- `middleware.ts` `BLOCKED_BOT_PATTERNS` — hard 403 at the edge for these user-agents. Polite robots.txt + hard block, defense in depth.

**Why block (despite the "drive AI assistant citations" counter-argument):**

1. **Data asymmetry.** Google-Extended scrapes content for Gemini training; in return we get… nothing measurable. Google's products don't reliably cite source URLs in responses, don't drive measurable referral traffic, and don't compensate for content used. Allowing it is a one-way gift to Google's AI products that compete with our own AI generation feature.

2. **Direct competitor.** MonkeyTravel's core product IS an AI travel planner powered by Gemini. Letting Gemini train on our destination content, blog posts, and trip outputs accelerates a competitor's quality at our expense. Same logic for Applebot-Extended → Apple Intelligence (rumored travel features).

3. **Opt-in cost is zero.** We can flip this on later via a single line in robots.ts if the calculus changes (e.g. if Google ships citation transparency). The reverse — un-training a model — is impossible.

4. **Search ranking unaffected.** `Googlebot` (search crawler) is explicitly NOT in the blocklist; it remains fully welcomed. The `*-Extended` agents are exclusively AI-training scrapers — Google's own documentation confirms blocking them does not impact Google Search indexing or ranking.

5. **Hard-block + polite-protocol.** The double layer (robots.txt for polite crawlers + edge middleware 403 for non-compliant ones) closes the trust gap. Even if a future Google-Extended variant ignores robots.txt, the middleware catches it.

**Tradeoffs accepted:**
- Lose: hypothetical citation traffic from "best places to visit in April 2026" AI-assistant queries.
- Keep: training-data competitive moat, brand control, ability to license content commercially later.

**Reversibility:** Flip is two lines (delete `"Google-Extended"` from `BLOCKED_AI_AGENTS` + `BLOCKED_BOT_PATTERNS`). Document the decision shift in this file if the call ever reverses.
