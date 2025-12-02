# MonkeyTravel MVP - Implementation Roadmap

A step-by-step guide to building the AI-powered travel planning MVP.

---

## Quick Reference

| Aspect | Decision |
|--------|----------|
| AI Model | Gemini 2.0 Flash (upgrade to 3 Pro when available) |
| Booking | Links to Skyscanner/Kayak/Booking.com (no direct booking) |
| Auth | Demo mode + Supabase Auth |
| Database | Existing Supabase schema (ready to use) |
| Frontend | Next.js 16 + Tailwind CSS 4 |
| Deployment | Vercel (already configured) |

---

## Phase 1: AI Core (Foundation)

**Goal**: Get Gemini generating itineraries via API

### Step 1.1: Set Up Gemini Integration

```bash
npm install @google/generative-ai
```

Create files:
1. `lib/gemini.ts` - Client configuration
2. `lib/prompts.ts` - System/user prompt templates
3. `lib/security.ts` - Input validation & sanitization
4. `types/itinerary.ts` - TypeScript interfaces

### Step 1.2: Create AI Generation Endpoint

```
app/api/ai/generate/route.ts
```

- POST endpoint accepting trip parameters
- Validates input (destination, dates, preferences)
- Calls Gemini with structured prompts
- Returns JSON itinerary
- Logs request to `api_request_logs`

### Step 1.3: Test the Generation

```bash
curl -X POST http://localhost:3000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Paris, France",
    "startDate": "2025-02-01",
    "endDate": "2025-02-03",
    "budgetTier": "balanced",
    "pace": "moderate",
    "interests": ["culture", "food"]
  }'
```

Expected: JSON itinerary with days, activities, costs.

### Deliverables
- [ ] Gemini client configured
- [ ] `/api/ai/generate` endpoint working
- [ ] Input validation blocking bad requests
- [ ] Prompt injection prevention active
- [ ] API logs being written

---

## Phase 2: Demo Mode UI

**Goal**: Users can generate trips without signing up

### Step 2.1: Create Trip Creation Wizard

```
app/demo/page.tsx
app/demo/new/page.tsx
```

Components needed:
1. `DestinationSearch.tsx` - Autocomplete input
2. `DateRangePicker.tsx` - Calendar selection
3. `BudgetSelector.tsx` - Budget tier cards
4. `InterestTags.tsx` - Multi-select interests
5. `WizardProgress.tsx` - Step indicator

### Step 2.2: Generation Loading State

```
components/ai/GenerationLoader.tsx
```

- Animated progress indicator
- Step-by-step status updates
- 10-30 second wait time messaging

### Step 2.3: Itinerary Display

```
app/demo/trip/page.tsx
```

Components needed:
1. `DayTimeline.tsx` - Day-by-day view
2. `ActivityCard.tsx` - Individual activity display
3. `DaySummary.tsx` - Budget breakdown
4. `BookingLinks.tsx` - Links to booking sites

### Step 2.4: Demo Session Handling

```typescript
// Demo uses localStorage, no auth needed
const DEMO_SESSION_KEY = "monkeytravel_demo";

function createDemoSession() {
  const sessionId = `demo-${Date.now()}`;
  localStorage.setItem(DEMO_SESSION_KEY, sessionId);
  return sessionId;
}
```

Limits for demo:
- 1 trip per session
- 3 days maximum
- 2 regenerations allowed

### Deliverables
- [ ] 3-step wizard (destination → dates → preferences)
- [ ] Loading state with progress
- [ ] Itinerary displayed with timeline
- [ ] Booking links for flights/hotels
- [ ] Demo limits enforced

---

## Phase 3: Authentication & Persistence

**Goal**: Signed-up users can save and manage trips

### Step 3.1: Set Up Supabase Auth

```bash
# Already configured, just enable in dashboard
# Enable Email/Password provider
```

Create files:
1. `lib/auth.ts` - Auth helper functions
2. `components/auth/AuthProvider.tsx` - Context provider
3. `app/auth/login/page.tsx` - Login form
4. `app/auth/signup/page.tsx` - Signup form

### Step 3.2: Protected Routes

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const session = request.cookies.get("sb-session");
  const isProtected = request.nextUrl.pathname.startsWith("/trips");

  if (isProtected && !session) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
}
```

### Step 3.3: Trip CRUD Operations

```
app/api/trips/route.ts           # GET (list), POST (create)
app/api/trips/[id]/route.ts      # GET, PUT, DELETE
```

Save to existing database tables:
- `trips` - Main trip record
- `itinerary_days` - Day-by-day data
- `planned_activities` - Individual activities

### Step 3.4: User Dashboard

```
app/trips/page.tsx
```

- List of saved trips
- Trip cards with destination, dates, status
- "Create new trip" CTA

### Deliverables
- [ ] Email/password auth working
- [ ] Trips saved to database
- [ ] Dashboard showing all trips
- [ ] Trip CRUD operations
- [ ] Auth limits (5 trips/day)

---

## Phase 4: Polish & Launch

**Goal**: Production-ready MVP

### Step 4.1: Rate Limiting

```
lib/rate-limit.ts
```

Implement checks for:
- Per-user limits (demo vs auth)
- Global hourly limit (100 req/hour)
- Daily cost cap ($50)

### Step 4.2: Error Handling

- Friendly error messages
- Retry logic for transient failures
- Fallback UI states

### Step 4.3: Mobile Responsiveness

- Test all pages on mobile
- Fix any layout issues
- Optimize touch targets

### Step 4.4: Share Functionality

```
app/share/[shareId]/page.tsx
```

- Generate shareable URLs
- Public view (no auth required)
- Social meta tags for link previews

### Step 4.5: AI Disclaimer

```
components/ai/AIDisclaimer.tsx
```

Display on all AI-generated content:
> "This itinerary was generated by AI. Please verify opening hours and availability before your trip."

### Step 4.6: Analytics

Track via Supabase:
- Trips created
- Generation success/failure rate
- Average generation time
- Popular destinations

### Deliverables
- [ ] Rate limits enforced
- [ ] Error states handled gracefully
- [ ] Mobile experience polished
- [ ] Share links working
- [ ] AI disclaimer visible
- [ ] Basic analytics in place

---

## Environment Variables Checklist

```env
# Required before Phase 1
GOOGLE_AI_API_KEY=your-gemini-api-key

# Already configured
NEXT_PUBLIC_SUPABASE_URL=https://sevfbahwmlbdlnbhqwyi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...

# Add for rate limiting
RATE_LIMIT_DEMO_TRIPS_PER_DAY=1
RATE_LIMIT_AUTH_TRIPS_PER_DAY=5
MAX_DAILY_AI_COST_USD=50
```

---

## Database Migrations Needed

### 1. AI Generations Log

```sql
CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID REFERENCES trips(id),
  user_id UUID REFERENCES users(id),
  prompt_hash TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd NUMERIC(10, 4) NOT NULL,
  model TEXT DEFAULT 'gemini-2.0-flash',
  generation_time_ms INTEGER,
  status TEXT CHECK (status IN ('success', 'error', 'timeout', 'filtered')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_generations_created_at ON ai_generations(created_at);
CREATE INDEX idx_ai_generations_user_id ON ai_generations(user_id);
```

### 2. Shared Trips

```sql
ALTER TABLE trips ADD COLUMN share_id TEXT UNIQUE;
ALTER TABLE trips ADD COLUMN is_public BOOLEAN DEFAULT FALSE;

CREATE INDEX idx_trips_share_id ON trips(share_id);
```

---

## File Structure (Final)

```
travel-app-web/
├── app/
│   ├── api/
│   │   ├── ai/
│   │   │   └── generate/route.ts      # AI generation
│   │   ├── trips/
│   │   │   ├── route.ts               # List/create trips
│   │   │   └── [id]/route.ts          # Trip CRUD
│   │   ├── destinations/
│   │   │   └── search/route.ts        # Autocomplete
│   │   └── subscribe/route.ts         # (existing)
│   │
│   ├── auth/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   │
│   ├── demo/
│   │   ├── page.tsx                   # Demo landing
│   │   ├── new/page.tsx               # Trip wizard
│   │   └── trip/page.tsx              # View generated trip
│   │
│   ├── trips/
│   │   ├── page.tsx                   # Dashboard
│   │   ├── new/page.tsx               # Create (auth)
│   │   └── [id]/page.tsx              # View trip
│   │
│   ├── share/
│   │   └── [shareId]/page.tsx         # Public share view
│   │
│   ├── page.tsx                       # Landing (existing)
│   ├── privacy/page.tsx               # (existing)
│   └── terms/page.tsx                 # (existing)
│
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Card.tsx
│   │   └── Badge.tsx
│   │
│   ├── trips/
│   │   ├── DestinationSearch.tsx
│   │   ├── DateRangePicker.tsx
│   │   ├── BudgetSelector.tsx
│   │   ├── InterestTags.tsx
│   │   └── WizardProgress.tsx
│   │
│   ├── itinerary/
│   │   ├── DayTimeline.tsx
│   │   ├── ActivityCard.tsx
│   │   ├── DaySummary.tsx
│   │   └── BookingLinks.tsx
│   │
│   ├── ai/
│   │   ├── GenerationLoader.tsx
│   │   └── AIDisclaimer.tsx
│   │
│   └── auth/
│       ├── AuthProvider.tsx
│       ├── LoginForm.tsx
│       └── SignupForm.tsx
│
├── lib/
│   ├── gemini.ts                      # Gemini client
│   ├── prompts.ts                     # AI prompts
│   ├── security.ts                    # Validation
│   ├── rate-limit.ts                  # Rate limiting
│   ├── auth.ts                        # Auth helpers
│   ├── supabase.ts                    # (existing)
│   └── utils.ts                       # cn() helper
│
├── types/
│   └── itinerary.ts                   # TypeScript types
│
└── docs/
    ├── POC_PLAN.md                    # Full plan
    └── IMPLEMENTATION_ROADMAP.md      # This file
```

---

## Launch Checklist

### Before Launch
- [ ] Get Gemini API key from Google AI Studio
- [ ] Test generation with 10+ different destinations
- [ ] Verify rate limits work correctly
- [ ] Check mobile responsiveness
- [ ] Add AI disclaimer to all generated content
- [ ] Set up error monitoring (Sentry optional)
- [ ] Configure cost alerts in Google Cloud

### Launch Day
- [ ] Deploy to production on Vercel
- [ ] Monitor API costs in real-time
- [ ] Watch for errors in Vercel logs
- [ ] Test from multiple devices/locations

### Post-Launch
- [ ] Collect user feedback
- [ ] Monitor generation quality
- [ ] Adjust prompts based on output
- [ ] Consider adding price display if traction

---

## Cost Estimates (MVP)

| Item | Monthly Cost |
|------|--------------|
| Vercel (Hobby) | Free |
| Supabase (Free tier) | Free |
| Gemini API (500 trips) | ~$30 |
| Domain (monkeytravel.app) | ~$1 |
| **Total** | **~$31/month** |

With $50/day cap, maximum Gemini cost: ~$1,500/month

---

## Success Metrics

### Week 1
- [ ] 100+ demo trips created
- [ ] <5% generation error rate
- [ ] Average generation time <30s

### Month 1
- [ ] 50+ signed-up users
- [ ] 10+ shared trips
- [ ] Positive feedback from 80%+ users

---

*Last Updated: December 2025*
*Ready for Implementation*
