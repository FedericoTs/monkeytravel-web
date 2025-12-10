# MonkeyTravel Virality Features Design Document

## Executive Summary

This document outlines the design for three interconnected virality features:
1. **Referral Program** - "Give 1 Trip, Get 1 Trip" reward system
2. **Trending Trips Gallery** - Public discovery of popular trip itineraries
3. **Video Generation** - Instagram Reels/TikTok-style trip preview videos

These features work together to create a viral loop:
```
User Creates Trip → Shares Video/Link → Friend Views → Signs Up → Creates Trip → Loop Repeats
```

---

## Part 1: Referral Program

### 1.1 Value Proposition

**For Referrer (existing user):**
- Get 1 free AI-generated trip for each friend who signs up and creates their first trip
- Track referral status in dashboard

**For Referee (new user):**
- Get 1 free AI-generated trip upon signup via referral link
- Both parties win = higher conversion

### 1.2 User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  REFERRER FLOW                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. User clicks "Invite Friends" button (in navbar dropdown or profile)     │
│  2. Modal opens with:                                                       │
│     - Unique referral link: monkeytravel.app/join/ABC123                   │
│     - Social share buttons (Twitter, WhatsApp, Email, Copy)                │
│     - Stats: "2 friends joined · 1 trip earned"                            │
│  3. User shares link via preferred channel                                  │
│  4. When friend completes first trip, referrer gets notification + reward  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  REFEREE FLOW                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Friend clicks referral link: monkeytravel.app/join/ABC123              │
│  2. Landing page shows:                                                     │
│     - "Sarah invited you to MonkeyTravel!"                                 │
│     - "Get 1 FREE AI-generated trip when you sign up"                      │
│     - Sign up button                                                        │
│  3. Friend signs up (referral_code stored in session/cookie)               │
│  4. After creating first trip:                                              │
│     - Referee's free_trips_remaining += 1                                  │
│     - Referrer's free_trips_remaining += 1                                 │
│     - Both get toast notification                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Database Schema

```sql
-- New table: referral_codes
CREATE TABLE referral_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(8) UNIQUE NOT NULL, -- e.g., "ABC123"
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Stats (denormalized for quick access)
  total_clicks INTEGER DEFAULT 0,
  total_signups INTEGER DEFAULT 0,
  total_conversions INTEGER DEFAULT 0, -- completed first trip

  UNIQUE(user_id) -- One code per user
);

-- New table: referral_events
CREATE TABLE referral_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referral_code_id UUID NOT NULL REFERENCES referral_codes(id),
  referee_id UUID REFERENCES users(id), -- NULL until signup

  -- Event tracking
  event_type VARCHAR(20) NOT NULL, -- 'click', 'signup', 'conversion'
  event_at TIMESTAMPTZ DEFAULT NOW(),

  -- Attribution metadata
  ip_hash VARCHAR(64), -- For fraud detection (hashed)
  user_agent TEXT,
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),

  -- Reward tracking
  reward_granted_at TIMESTAMPTZ, -- When both parties got reward
  reward_amount INTEGER DEFAULT 1 -- Number of free trips
);

-- Index for quick lookups
CREATE INDEX idx_referral_codes_code ON referral_codes(code);
CREATE INDEX idx_referral_events_referee ON referral_events(referee_id);
CREATE INDEX idx_referral_events_code ON referral_events(referral_code_id);

-- Add referred_by to users table
ALTER TABLE users ADD COLUMN referred_by_code VARCHAR(8);
ALTER TABLE users ADD COLUMN referral_completed_at TIMESTAMPTZ;
```

### 1.4 API Endpoints

```typescript
// GET /api/referral/code
// Returns user's referral code (creates one if doesn't exist)
// Response: { code: "ABC123", stats: { clicks: 10, signups: 3, conversions: 2 } }

// POST /api/referral/click
// Tracks referral link click (called on landing page load)
// Body: { code: "ABC123", utm_source?, utm_medium?, utm_campaign? }
// Response: { success: true, referrer_name: "Sarah" }

// POST /api/referral/complete
// Called when referee creates their first trip
// Grants rewards to both parties
// Response: { success: true, referrer_rewarded: true, referee_rewarded: true }

// GET /api/referral/history
// Returns referral history for current user
// Response: { referrals: [...], total_earned: 5 }
```

### 1.5 Component Structure

```
components/
├── referral/
│   ├── ReferralModal.tsx        # Share referral link modal
│   ├── ReferralBanner.tsx       # "Invite friends, get free trips" banner
│   ├── ReferralStats.tsx        # Dashboard stats widget
│   ├── ReferralLandingHero.tsx  # /join/[code] page hero
│   └── ReferralRewardToast.tsx  # Celebration toast when reward earned

app/
├── join/
│   └── [code]/
│       └── page.tsx             # Referral landing page
├── api/
│   └── referral/
│       ├── code/route.ts
│       ├── click/route.ts
│       ├── complete/route.ts
│       └── history/route.ts
```

### 1.6 UX Design Specifications

**ReferralModal** (triggered from navbar "Invite Friends"):
- Width: 448px max
- Header: Gift icon + "Invite Friends, Get Free Trips"
- Subheader: "Give 1 trip, get 1 trip when they create their first itinerary"
- Input: Referral URL (read-only) with copy button
- Share buttons: Twitter, WhatsApp, Email, Instagram, Copy Link
- Stats section: "3 friends joined · 2 trips earned"
- Close: X button top-right

**Referral Landing Page** (/join/[code]):
- Hero: "[Referrer]'s invitation" with avatar
- Value prop: "Get 1 FREE AI trip when you sign up"
- CTA: "Start Planning" → /auth/signup?ref=[code]
- Trust badges: "Join 28+ travelers · AI-powered · Free to start"

---

## Part 2: Trending Trips Gallery

### 2.1 Value Proposition

- **Discovery**: Users can browse popular trip itineraries for inspiration
- **Social Proof**: Shows active community and quality content
- **Conversion**: Non-users see value before signing up
- **SEO**: Public pages indexed by Google

### 2.2 User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BROWSE FLOW                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. User visits /explore (linked from navbar, footer, homepage)             │
│  2. Gallery shows:                                                          │
│     - Hero: "Discover Amazing Trips"                                        │
│     - Filters: Destination, Duration, Budget, Tags                          │
│     - Grid of trip cards sorted by popularity                               │
│  3. User clicks trip card                                                   │
│  4. Opens trip detail (same as /shared/[token] but with trending context)  │
│  5. CTA: "Use this itinerary" → SaveTripModal                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  SUBMIT TO TRENDING FLOW                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. User on trip detail page clicks "Share" → ShareModal                    │
│  2. New option: "Submit to Trending" toggle                                 │
│  3. If enabled:                                                             │
│     - Trip visibility = 'public'                                            │
│     - Appears in /explore gallery                                           │
│     - User earns "Trendsetter" badge after 10 copies                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Database Changes

```sql
-- Add trending-related columns to trips table
ALTER TABLE trips ADD COLUMN trending_score INTEGER DEFAULT 0;
ALTER TABLE trips ADD COLUMN submitted_to_trending_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN trending_approved BOOLEAN DEFAULT FALSE;

-- Trending score calculation (updated via cron/trigger):
-- trending_score = (copy_count * 10) + (view_count * 1) + (recency_bonus)
-- recency_bonus = MAX(0, 100 - days_since_shared)

-- New table: trip_views (for analytics)
CREATE TABLE trip_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES users(id), -- NULL for anonymous
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(50), -- 'trending', 'shared_link', 'search', 'direct'
  session_id VARCHAR(64), -- For deduplication

  UNIQUE(trip_id, session_id) -- One view per session per trip
);

CREATE INDEX idx_trip_views_trip ON trip_views(trip_id);
CREATE INDEX idx_trip_views_date ON trip_views(viewed_at);

-- Function to update trending score (called by cron)
CREATE OR REPLACE FUNCTION update_trending_scores()
RETURNS void AS $$
BEGIN
  UPDATE trips
  SET trending_score = COALESCE(template_copy_count, 0) * 10
    + (SELECT COUNT(*) FROM trip_views WHERE trip_id = trips.id) * 1
    + GREATEST(0, 100 - EXTRACT(DAY FROM NOW() - shared_at)::int)
  WHERE visibility = 'public'
    AND share_token IS NOT NULL
    AND submitted_to_trending_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql;
```

### 2.4 API Endpoints

```typescript
// GET /api/explore/trips
// Returns trending trips with filters
// Query: ?destination=tokyo&duration=3-5&budget=budget&tags=food,culture&page=1
// Response: { trips: [...], total: 42, page: 1, perPage: 12 }

// POST /api/trips/[id]/submit-trending
// Submits trip to trending gallery
// Response: { success: true, trending_score: 45 }

// POST /api/trips/[id]/view
// Records a view (called on page load)
// Body: { source: 'trending' }
// Response: { success: true }
```

### 2.5 Component Structure

```
components/
├── explore/
│   ├── ExploreHero.tsx          # Hero with search/filters
│   ├── TripGrid.tsx             # Responsive grid of trip cards
│   ├── TripCard.tsx             # Card with image, title, stats
│   ├── FilterBar.tsx            # Destination, duration, budget filters
│   ├── TrendingBadge.tsx        # "Trending" / "Popular" badge
│   └── EmptyState.tsx           # No trips found state

app/
├── explore/
│   └── page.tsx                 # Main explore page
├── api/
│   └── explore/
│       └── trips/route.ts
```

### 2.6 UX Design Specifications

**Explore Page** (/explore):
- Hero: Gradient background with "Discover Amazing Trips" headline
- Search: Destination autocomplete (Google Places)
- Filters: Duration chips (1-3, 4-7, 8-14, 15+ days), Budget (Budget, Balanced, Luxury)
- Grid: 3 columns desktop, 2 tablet, 1 mobile
- Cards: 16:9 cover image, destination flag, title, duration, copy count
- Infinite scroll with skeleton loading

**TripCard**:
- Cover image from first activity (Pexels) or destination (Places)
- Overlay gradient for text readability
- Flag emoji + Destination name
- Trip title (truncated to 2 lines)
- Stats: "5 days · 234 copies · Balanced budget"
- Hover: Subtle scale + shadow increase
- Click: Navigate to /shared/[token]?source=trending

---

## Part 3: Video Generation

### 3.1 Value Proposition

- **Viral Content**: Short-form video performs best on social media
- **Engagement**: Videos get 10x more shares than static content
- **Brand Exposure**: MonkeyTravel watermark on every video
- **Zero Cost**: Uses existing Pexels images (free API)

### 3.2 Video Specifications

```
Format: MP4 (H.264)
Dimensions: 1080x1920 (9:16 vertical for Reels/TikTok)
Duration: 15-30 seconds
FPS: 30
Audio: Optional background music (royalty-free)

Structure:
[0-2s]   Intro: Destination name + flag with zoom animation
[2-12s]  Day-by-day highlights (2s per day, max 5 days shown)
[12-14s] Outro: "Plan your trip at monkeytravel.app"
[14-15s] CTA: QR code or share URL
```

### 3.3 User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  VIDEO GENERATION FLOW                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. User on trip detail page clicks "Share" → ShareModal                    │
│  2. New tab: "Create Video" with preview                                    │
│  3. Options:                                                                │
│     - Style: "Energetic" / "Relaxed" / "Cinematic"                         │
│     - Music: Toggle on/off + select track                                   │
│     - Text: Edit captions for each slide                                   │
│  4. Click "Generate Video"                                                  │
│  5. Loading state with progress bar (10-30 seconds)                         │
│  6. Preview plays automatically                                             │
│  7. Download button + Share directly to Instagram/TikTok                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Technical Architecture

```
Client (Browser)                    Server (Edge Function)
┌─────────────────┐                ┌─────────────────────────┐
│ ShareModal      │                │ /api/video/generate     │
│ - Select style  │───Request──▶  │                         │
│ - Preview       │                │ 1. Fetch trip data      │
│                 │                │ 2. Get Pexels images    │
│                 │                │ 3. Generate FFmpeg cmd  │
│                 │◀──Progress───  │ 4. Execute via Remotion │
│                 │                │    or FFmpeg            │
│                 │◀──Video URL──  │ 5. Upload to R2/S3      │
│ - Download      │                │ 6. Return signed URL    │
└─────────────────┘                └─────────────────────────┘
```

### 3.5 Implementation Options

**Option A: Remotion (Recommended)**
- React-based video generation
- Runs on serverless (Lambda/Vercel)
- Pro: TypeScript, React components, animations
- Con: Requires @remotion/lambda setup

**Option B: FFmpeg via Edge Function**
- Use @ffmpeg/ffmpeg (WASM) in browser
- Pro: No server needed, free
- Con: Limited to browser capabilities, slower

**Option C: External Service**
- Use Creatomate, Shotstack, or similar
- Pro: Professional quality, fast
- Con: Cost per video ($0.05-0.20)

**Recommendation**: Start with Option B (browser FFmpeg) for MVP, migrate to Remotion for production.

### 3.6 API Design

```typescript
// POST /api/video/generate
// Generates a video for a trip
// Body: { tripId: string, style: 'energetic'|'relaxed'|'cinematic', includeMusic: boolean }
// Response: { jobId: string }

// GET /api/video/status/[jobId]
// Checks video generation status
// Response: { status: 'processing'|'complete'|'error', progress: 75, videoUrl?: string }

// For browser-based generation, no API needed - all client-side
```

### 3.7 Component Structure

```
components/
├── video/
│   ├── VideoGeneratorModal.tsx  # Main modal with options
│   ├── VideoPreview.tsx         # Preview player
│   ├── VideoStyleSelector.tsx   # Style options
│   ├── VideoProgress.tsx        # Generation progress bar
│   └── VideoShareButtons.tsx    # Download + social share

lib/
├── video/
│   ├── generator.ts             # FFmpeg commands
│   ├── templates/               # Video templates per style
│   └── music/                   # Royalty-free audio tracks
```

### 3.8 Video Template Structure

```typescript
interface VideoSlide {
  type: 'intro' | 'day' | 'activity' | 'outro' | 'cta';
  duration: number; // seconds
  image: string; // Pexels URL
  text: string;
  subtext?: string;
  animation: 'zoom-in' | 'pan-left' | 'fade' | 'ken-burns';
}

const energeticTemplate: VideoSlide[] = [
  { type: 'intro', duration: 2, animation: 'zoom-in', text: '🇯🇵 Tokyo Adventure', image: '...' },
  { type: 'day', duration: 2, animation: 'pan-left', text: 'Day 1: Shibuya', image: '...' },
  // ... more days
  { type: 'outro', duration: 2, animation: 'fade', text: 'monkeytravel.app', image: 'logo' },
];
```

---

## Part 4: Integration & Viral Loop

### 4.1 Complete Viral Flow

```
                    ┌──────────────────┐
                    │   User Creates   │
                    │      Trip        │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌────────────┐ ┌────────────┐ ┌────────────┐
       │   Share    │ │  Submit to │ │  Generate  │
       │   Link     │ │  Trending  │ │   Video    │
       └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
             │              │              │
             ▼              ▼              ▼
       ┌────────────┐ ┌────────────┐ ┌────────────┐
       │  Friend    │ │  Browser   │ │  Instagram │
       │  Clicks    │ │  Explores  │ │  TikTok    │
       └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                    ┌──────────────────┐
                    │   Views Trip     │
                    │  (Public Page)   │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
       ┌────────────────┐          ┌────────────────┐
       │  Save to My    │          │    Sign Up     │
       │     Trips      │          │  (via referral)│
       └────────┬───────┘          └────────┬───────┘
               │                            │
               │ ◀───── Existing User ─────▶│ New User
               │                            │
               ▼                            ▼
       ┌────────────────┐          ┌────────────────┐
       │  Creates Own   │          │  Creates First │
       │     Trip       │          │     Trip       │
       └────────┬───────┘          └────────┬───────┘
               │                            │
               │                            ▼
               │                   ┌────────────────┐
               │                   │ Referral       │
               │                   │ Reward Given   │
               └──────────┬────────┴────────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │   Loop Repeats  │
                 └─────────────────┘
```

### 4.2 Analytics Events

```typescript
// Referral events
trackReferralLinkGenerated({ userId, code });
trackReferralLinkClicked({ code, source });
trackReferralSignup({ code, refereeId });
trackReferralConversion({ code, referrerId, refereeId });
trackReferralRewardGranted({ userId, amount, source: 'referrer'|'referee' });

// Trending events
trackTrendingSubmitted({ tripId, userId });
trackTrendingViewed({ tripId, source });
trackTrendingCopied({ tripId, userId, newTripId });

// Video events
trackVideoGenerationStarted({ tripId, style });
trackVideoGenerationCompleted({ tripId, durationSeconds });
trackVideoDownloaded({ tripId });
trackVideoShared({ tripId, platform: 'instagram'|'tiktok'|'other' });
```

### 4.3 Gamification Elements

**Badges** (stored in users.stats.badges):
- "Early Adopter" - Joined during beta
- "Trendsetter" - Trip copied 10+ times
- "Influencer" - Referred 5+ friends
- "Globetrotter" - Created trips to 5+ countries
- "Content Creator" - Generated 3+ videos

**Leaderboard** (optional future feature):
- Top referrers of the month
- Most popular trips this week
- Rising creators

---

## Part 5: Implementation Roadmap

### Phase 1: Referral System (Priority: HIGH)
1. Database migration (referral_codes, referral_events tables)
2. API endpoints (code, click, complete, history)
3. ReferralModal component
4. /join/[code] landing page
5. Integration with auth callback
6. Reward distribution logic
7. Analytics events

### Phase 2: Trending Gallery (Priority: HIGH)
1. Database migration (trending columns, trip_views table)
2. API endpoint (explore/trips)
3. /explore page with filters
4. TripCard and TripGrid components
5. "Submit to Trending" in ShareModal
6. View tracking
7. Trending score calculation

### Phase 3: Video Generation (Priority: MEDIUM)
1. Video template system
2. FFmpeg integration (browser-side)
3. VideoGeneratorModal component
4. Style and music selection
5. Progress tracking
6. Download and share functionality
7. Analytics events

---

## Part 6: Success Metrics

| Metric | Target (30 days) | Measurement |
|--------|-----------------|-------------|
| Referral links created | 100+ | referral_codes count |
| Referral signups | 50+ | referral_events signup count |
| Referral conversion rate | 30%+ | conversions / signups |
| Trending trips submitted | 20+ | submitted_to_trending_at count |
| Trending gallery views | 1000+ | trip_views from 'trending' |
| Trip copies from trending | 100+ | template_copy_count sum |
| Videos generated | 50+ | video generation events |
| Videos shared | 25+ | video share events |

---

## Appendix A: UI Mockups Reference

### ReferralModal
```
┌─────────────────────────────────────────────────────┐
│ ✕                                                   │
│                                                     │
│     🎁  Invite Friends, Get Free Trips             │
│                                                     │
│     Give 1 trip, get 1 trip when they              │
│     create their first itinerary                    │
│                                                     │
│  ┌─────────────────────────────────────┬────────┐  │
│  │ monkeytravel.app/join/ABC123        │  Copy  │  │
│  └─────────────────────────────────────┴────────┘  │
│                                                     │
│     Share via                                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │ Twitter │ │WhatsApp │ │  Email  │ │  More   │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│                                                     │
│     ──────────────────────────────────────          │
│                                                     │
│     📊 3 friends joined · 2 trips earned           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### TripCard
```
┌─────────────────────────────────────┐
│                                     │
│     [Pexels Image: Tokyo]           │
│                                     │
│  ┌──────────────────────────────┐   │
│  │ 🔥 Trending                  │   │
│  └──────────────────────────────┘   │
│                                     │
├─────────────────────────────────────┤
│ 🇯🇵 Tokyo                           │
│ 7-Day Cultural Adventure            │
│                                     │
│ 5 days · 234 copies · Balanced      │
└─────────────────────────────────────┘
```

### VideoGeneratorModal
```
┌─────────────────────────────────────────────────────┐
│ ✕                        Create Video               │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │                                             │   │
│  │         [Video Preview 9:16]                │   │
│  │                                             │   │
│  │              ▶ Play                         │   │
│  │                                             │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Style                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │Energetic │ │ Relaxed  │ │Cinematic │           │
│  │    ✓     │ │          │ │          │           │
│  └──────────┘ └──────────┘ └──────────┘           │
│                                                     │
│  🎵 Background Music   [Toggle: ON]                │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │        Generate Video (15 seconds)          │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```
