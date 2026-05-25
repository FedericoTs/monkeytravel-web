# `/explore` — UGC Trip Feed: Implementation Plan

**Status:** PLAN (not yet built)
**Owner:** TBD
**Target ship:** 3 weeks from start
**Drafted:** 2026-05-25

---

## 1. Goal + success metrics

**Goal:** turn monkeytravel.app from a one-shot generator into a *discovery surface* — a place users return to even when they aren't actively planning a trip, because there's a catalog of real-traveler itineraries to browse, save, and remix.

**Why this lever:** every public trip is a new SEO-indexable URL with rich Google Places content, and every "fork" mints another. The flywheel pays compounding interest in organic traffic.

**Success metrics (Day 90 post-launch):**
- ≥ **500 public trips** in the catalog (from existing user base + seeded curated trips)
- ≥ **30% of authenticated trips** made public (opt-in)
- ≥ **15% fork rate** on `/explore` visits (visit → fork another's trip)
- ≥ **20% returning-visitor rate** on `/explore` weekly (proxy: same anon-cookie returns in 7d)
- ≥ **10 new indexable URLs/day** added to the sitemap
- ≥ **1 trip per top-50 destination** within 30 days

**Anti-goals (explicit):**
- Not building a social network (no follows, no DMs, no comments-on-comments).
- Not building moderation tools beyond a "report" button + abuse queue. Curation is light-touch first.
- Not building user profiles in v1 — author attribution is `displayName` only, no public profile page.

---

## 2. User stories

### Anonymous visitor (the unauthenticated discovery user)
- **Browses** `/explore` and scrolls a feed of trip cards (Trending / Recent / By destination / By vibe).
- **Filters** by destination, vibe, duration band (weekend / week / 2+ weeks), budget tier, season.
- **Opens** any trip → lands on `/shared/{token}` (already exists).
- **Forks** ("Use this as my trip") → wizard pre-fills destination + dates + vibes from the source trip → generates a fresh personalized itinerary.
- **Saves** to a "for later" list via a cookie ID (no signup needed).

### Authenticated user
- After saving a trip, gets a one-time prompt: "Share your trip with the community?" with examples of what others have shared (social proof).
- Toggles trip privacy on `/trips/{id}` → "Public" → trip gets a `shared_at` timestamp and appears in `/explore`.
- Adds an optional `display_name` and ~280-char `author_note` ("Honeymoon in May, prioritized hidden gems") for context on the explore card.
- Can later un-publish — trip drops from explore but stays accessible via the existing `/shared/{token}` link.
- Sees `like_count` + `save_count` + `fork_count` on their own trip detail page.

### Trip owner who gets engagement
- Receives email after their trip gets first like / first fork / first 10 forks (configurable in notification preferences).
- "Your Paris trip has been forked 27 times" becomes a re-engagement signal we can use later for "creator" badges or paid features.

---

## 3. Surface area

### New routes
| Route | Type | Purpose |
|---|---|---|
| `/explore` | server component | Main feed. Filters in querystring. SSR with cache. |
| `/explore?destination=tokyo&vibe=foodie&duration=week` | same | Filtered feed. Each filter combination becomes its own canonical URL. |
| `/api/explore/trips` (extend existing) | API | Returns filtered trips with author + engagement. |
| `/api/trips/{id}/like` | API | POST = like, DELETE = unlike. Auth required. |
| `/api/trips/{id}/save` | API | POST = save to "for later". Works for anon (cookie-keyed) + auth. |
| `/api/trips/{id}/fork` | API | POST = duplicate trip into caller's account. Reuses template-copy pattern. |
| `/api/trips/{id}/publish` | API | POST = set visibility=public + submitted_to_trending_at. Owner only. |
| `/api/trips/{id}/report` | API | POST = flag for moderation. Rate-limited per IP. |
| `/saved` | server component | Anon + auth "for later" list. Cookie-keyed for anon, user-keyed for auth. |

### Modified routes
| Route | Change |
|---|---|
| `/trips/{id}` | New "Publish to explore" toggle + author_note input + engagement counters |
| `/shared/{token}` | Add "Fork this trip" CTA + like button |
| `/` and `/destinations/{slug}` | New "Trending trips" carousel block |
| `app/sitemap.ts` | Include public trip URLs (capped at top 500 by trending_score to avoid sitemap bloat) |
| Navbar | "Explore" link added to main nav |

### New components
- `<ExploreFeed />` — server-rendered grid, 24 cards/page
- `<ExploreFilters />` — destination + vibe + duration + budget + season chips (client, syncs to URL)
- `<TripCard />` — cover image + author + destination + vibe chips + like/save/fork counts + duration/budget
- `<PublishTripModal />` — confirms public-visibility flip with preview of how the card will look
- `<ForkTripButton />` — wrapped CTA on `/shared/{token}` and explore cards
- `<EngagementBar />` — like/save/fork actions on trip pages
- `<TrendingCarousel />` — homepage block of top 8 trending trips

---

## 4. Data model changes

### New tables

```sql
-- Authenticated likes (1 per user per trip)
CREATE TABLE trip_likes (
  trip_id    UUID REFERENCES trips(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);
CREATE INDEX idx_trip_likes_user ON trip_likes(user_id, created_at DESC);

-- Saves work for both anon (cookie) and auth (user_id). Mutually exclusive.
CREATE TABLE trip_saves (
  trip_id        UUID REFERENCES trips(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  saver_cookie_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL) <> (saver_cookie_id IS NOT NULL)),
  UNIQUE (trip_id, user_id),
  UNIQUE (trip_id, saver_cookie_id)
);
CREATE INDEX idx_trip_saves_user ON trip_saves(user_id, created_at DESC);
CREATE INDEX idx_trip_saves_cookie ON trip_saves(saver_cookie_id, created_at DESC);

-- Forks: every public trip clone records which trip it was forked from
-- (parent_trip_id on the new trip; child trips_count on the parent).
ALTER TABLE trips
  ADD COLUMN parent_trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN save_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN fork_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN author_display_name TEXT,
  ADD COLUMN author_note TEXT CHECK (length(author_note) <= 280),
  ADD COLUMN reported_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT false; -- moderator soft-delete

CREATE INDEX idx_trips_parent ON trips(parent_trip_id) WHERE parent_trip_id IS NOT NULL;

-- Reports queue (lightweight; processed by hand in week 1)
CREATE TABLE trip_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID REFERENCES trips(id) ON DELETE CASCADE,
  reporter_ip     TEXT,
  reporter_user_id UUID REFERENCES auth.users(id),
  reason          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES auth.users(id),
  action_taken    TEXT
);
```

### Atomic counter RPCs (follows existing `increment_template_copy_count` pattern)

```sql
CREATE OR REPLACE FUNCTION increment_trip_like_count(p_trip_id UUID) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE trips SET like_count = like_count + 1 WHERE id = p_trip_id RETURNING like_count INTO v_count;
  -- Also bump trending_score
  PERFORM update_trip_trending_score(p_trip_id);
  RETURN v_count;
END $$;

-- Mirror for decrement (unlike), increment_trip_save_count, increment_trip_fork_count.
```

### Trending score formula update

Current: `(template_copy_count * 10) + view_count + max(0, 100 - days_since_shared)`

New: include likes + saves + forks:
```
trending_score =
  (fork_count        * 10)
+ (like_count        *  3)
+ (save_count        *  1)
+  view_count
+ max(0, 100 - days_since_shared)
```

### RLS policies

```sql
-- Public trips visible to all (already exists pattern)
CREATE POLICY trips_public_read ON trips FOR SELECT
  USING (visibility = 'public' AND share_token IS NOT NULL AND NOT is_hidden);

-- Anyone can like (auth)
CREATE POLICY trip_likes_insert ON trip_likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY trip_likes_delete ON trip_likes FOR DELETE
  USING (auth.uid() = user_id);

-- Anyone can save (auth + anon via service role)
CREATE POLICY trip_saves_user_insert ON trip_saves FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- Anon saves go through the API with service role bypass (cookie-keyed).
```

---

## 5. API contract

### `GET /api/explore/trips`
```ts
QueryParams = {
  cursor?: string;                                   // opaque pagination
  sort?: "trending" | "recent" | "most-liked";       // default trending
  destination?: string;                              // city or country slug
  vibe?: TripVibe;                                   // single
  durationBand?: "weekend" | "week" | "longer";      // 1-3 | 4-9 | 10+
  budget?: "budget" | "balanced" | "premium";
  season?: "spring" | "summer" | "autumn" | "winter";
  locale?: "en" | "it" | "es";
};

Response = {
  trips: Array<{
    id: string;
    shareToken: string;
    title: string;
    destination: { name: string; country: string; slug: string };
    coverImageUrl: string | null;
    blurDataURL: string | null;          // tiny base64 placeholder
    author: { displayName: string; isVerified?: boolean };
    authorNote: string | null;
    durationDays: number;
    budgetTier: "budget" | "balanced" | "premium";
    vibes: TripVibe[];
    likeCount: number;
    saveCount: number;
    forkCount: number;
    viewCount: number;
    trendingScore: number;
    sharedAt: string;                    // ISO
  }>;
  nextCursor: string | null;
  totalApprox: number;                   // cached, refreshed hourly
};
```

### Other endpoints (sketches)
- `POST /api/trips/{id}/like` → `{ liked: true, count: 42 }`
- `DELETE /api/trips/{id}/like` → `{ liked: false, count: 41 }`
- `POST /api/trips/{id}/save` → `{ saved: true, count: 17 }` (sets `mt_saver_cookie` if anon)
- `POST /api/trips/{id}/fork` → `{ newTripId: "uuid", redirectTo: "/trips/uuid" }`
  - Internally: clone `trips` row + activities → mark `parent_trip_id` on new → keep new as `private` by default → increment `fork_count` on parent
- `POST /api/trips/{id}/publish` → `{ visibility: "public", explorePath: "/explore" }`
  - Sets `visibility='public'`, `shared_at=now()`, `submitted_to_trending_at=now()`
  - Validates: trip has cover image, has ≥ 1 day of activities, owner has ≥ 1 prior trip (anti-spam)
- `POST /api/trips/{id}/report` → `{ reported: true }`
  - Rate-limited to 3/IP/day; auto-hides if `reported_count >= 5` (review queue)

---

## 6. Privacy + moderation

### Opt-in only
- Default visibility stays `private` for new trips. Public is **always** an explicit user action.
- Publishing flow shows a clear "your trip will appear at `/explore` and `/shared/{token}` — anyone can see and copy it" disclosure.
- `author_display_name` defaults to "Anonymous traveler" if not set.
- No personal data ever surfaces (email, IP, exact addresses of activities only — no home location).

### Moderation v1 (manual)
- Single moderator email (`moderation@monkeytravel.app`) receives daily digest of new public trips + report queue.
- Auto-hide threshold: 5 reports = trip flipped to `is_hidden=true` automatically.
- Manual review SLA: 24h for reports.
- Slack webhook on every `trip_reports` insert (low volume in v1).

### Anti-spam
- Per-user rate limit: max 10 published trips per 7 days.
- Cannot publish a trip < 2 days old (gives time to edit).
- Trips with < 3 activities or duration > 30 days = cannot publish.

### Right-to-erasure
- Un-publish removes from explore immediately.
- Hard-delete cascades to likes, saves, fork pointers (parent_trip_id → NULL via ON DELETE SET NULL so forks survive).

---

## 7. SEO strategy

Each public trip is an indexable URL via the existing `/shared/{token}` route. The `/explore` page itself is *not* canonical for individual trips — it's a catalog.

### Sitemap
- `/explore` + per-locale variants → static, canonical to en.
- `/explore?destination={slug}` → top 30 most-trafficked filter combinations included as `<url>` entries.
- `/shared/{token}` for top 500 public trips by `trending_score` (cap to keep sitemap < 50MB).
- `/explore?vibe=foodie&destination=tokyo` style URLs use `rel=canonical` to the unfiltered `/explore` (avoids dilution).

### Structured data
- Each trip card gets `schema.org/TouristTrip` JSON-LD with author, duration, itinerary.
- Explore page itself gets `ItemList` schema with the 24 visible cards.

### Internal linking
- `/destinations/{slug}` adds a "Trending trips in {city}" block (top 6 public trips) → links into `/shared/{token}`.
- Blog posts that mention a destination get auto-linked trending trips.

---

## 8. Phased rollout

### Week 1 — DB + APIs (no UI yet)
- Migrations: `trip_likes`, `trip_saves`, `trips` ALTER, `trip_reports`, atomic RPCs, RLS.
- API routes: `/like`, `/save`, `/fork`, `/publish`, `/report` — all unit + integration tested.
- Extend `/api/explore/trips` response to include author + engagement counts.
- Seed: backfill `parent_trip_id` for trips already created from templates (so the parent's `fork_count` is non-zero from day 1).
- Behind feature flag `EXPLORE_UGC_ENABLED` = false. APIs return 404 if flag off.

### Week 2 — UI + publish flow
- `/explore` page with grid, filters, infinite-scroll pagination.
- `<PublishTripModal />` + toggle on `/trips/{id}`.
- `<EngagementBar />` on trip pages + `/shared/{token}`.
- Fork button on `/shared/{token}`.
- `/saved` page for anon + auth lists.
- Internal QA + Playwright specs.

### Week 3 — discovery surfaces + launch
- Homepage `<TrendingCarousel />` (top 8).
- `/destinations/{slug}` trending block.
- Email re-engagement: "Your trip is trending" + "Your trip got its first fork".
- Navbar "Explore" link.
- Open feature flag for 10% of traffic (PostHog `explore-ugc-rollout`).
- Day 4: 50% → Day 7: 100%.

### Seed catalog (parallel to Weeks 1-3)
- Internal team manually publishes 30 high-quality reference trips covering top 20 destinations × 4 vibes.
- Outreach to 10 travel creators with affiliate codes — offer revenue share if their published trips get forked.
- Day 1 of public launch: catalog already has ≥ 50 trips, never feels empty.

---

## 9. Risks + open questions

### Risks
| Risk | Mitigation |
|---|---|
| **Catalog cold-start** (empty feed kills first-time UX) | Seed 30 curated trips before launch; gate launch on catalog ≥ 50. |
| **Low-quality public trips dragging perception** | Featured-flag for editor's picks; trending sort surfaces engagement, not just recency. |
| **Spam / abuse** | Per-user rate limits + 5-report auto-hide + manual review SLA. |
| **Privacy leak** (user accidentally publishes with personal note) | 280-char `author_note` is the only free-text field; activity descriptions come from AI, not user input. |
| **Trending-score gaming** | Likes/saves rate-limited; same anon cookie can only like once; suspicious-velocity heuristic flags trips for review. |
| **Sitemap explosion** | Cap at 500 trips; trips drop off as new ones rise; older ones still accessible via direct URL. |
| **iVisa / Travelpayouts affiliate URL leakage in forked trips** | Fork strips the source's affiliate IDs and regenerates with the current site's IDs. |
| **GDPR right-to-erasure on a popular forked trip** | Delete source → forks survive (parent_trip_id → NULL) but lose attribution link; user accepts this in publish-disclosure copy. |

### Open questions for the user
1. Should `author_display_name` be tied to the auth account's profile (single source of truth) or per-trip (lets users be "Tokyo foodie" on one trip and "Family in France" on another)? **Recommendation: per-trip**, lower friction.
2. Editor's Picks / featured trips — manual flag, or algorithmic? **Recommendation: manual flag in v1**, algorithmic later.
3. Per-vibe explore pages (`/explore/foodie`)? Or only the filtered grid? **Recommendation: filter only in v1**, evaluate after seeing search demand.
4. Should public trips show the AI cost (✨ Gemini)? Hides the magic but builds trust. **Recommendation: no badge in v1**; revisit if users ask.
5. Likes — public counts vs private? **Recommendation: public count, anonymous likers** (we know who liked but don't show it).
6. Allow comments on trips? **Recommendation: NO in v1.** Doubles moderation burden. Only "like" + "save" + "fork".

---

## 10. Effort estimate

**Total: ~15 engineering days over 3 calendar weeks** (1 person, with QA spread across the timeline).

| Workstream | Days |
|---|---|
| Migrations + RPCs + RLS | 2 |
| API routes (like/save/fork/publish/report) + tests | 3 |
| `/explore` page + filters + pagination | 3 |
| `<PublishTripModal />` + toggle UX + engagement counters on trip pages | 2 |
| `/saved` page (anon + auth) | 1 |
| Homepage + destination-page trending blocks | 1 |
| Sitemap updates + SEO structured data | 1 |
| Email triggers (first-like, first-fork, 10-forks) | 1 |
| Moderation tooling (Slack webhook + report queue UI) | 1 |
| Playwright + vitest coverage | (folded into each workstream) |

**Critical path:** Migrations → APIs → `/explore` page → publish flow → launch. Trending blocks and email triggers can ship the week after if needed.

---

## Appendix A — What we're NOT building in v1

- User profiles (`/users/{id}`) — author name is per-trip
- Comments / threaded discussions
- Following / followers / DMs
- Algorithmic personalization beyond trending sort
- Paid creator tier
- Trip remixing (vs. simple fork) — the fork *is* the remix; further customization happens in the wizard
- AI-generated tags (use the vibe enum we already have)
- Cross-locale trip translation (a public IT trip stays IT — we may auto-translate the description later)
- "Verified" creator badges

These are all good follow-ups but each is a multi-week build. v1 ships the loop, follow-ups iterate.
