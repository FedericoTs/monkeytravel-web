# MonkeyTravel AI Agent - Proof of Concept Plan

## Executive Summary

Build a **minimal but functional** AI-powered travel planning web app that demonstrates the core value proposition: users describe their trip, and Gemini 3 Pro generates personalized day-by-day itineraries with real destination data.

**Scope**: POC for testing, NOT production-ready booking system.

---

## 1. Existing Infrastructure Analysis

### Database (Supabase) - Already Built

The database is **comprehensive and production-ready**:

| Table | Rows | Purpose | POC Usage |
|-------|------|---------|-----------|
| `users` | 0 | User profiles with preferences JSONB | **Core** |
| `destinations` | 0 | Places with Gemini enrichment fields | **Core** |
| `destination_activities` | 0 | Activities with types, pricing | **Core** |
| `trips` | 0 | Trip management with itinerary JSONB | **Core** |
| `itinerary_days` | 0 | Day-by-day planning | **Core** |
| `planned_activities` | 0 | Scheduled activities per day | **Core** |
| `trip_budgets` | 0 | Budget tracking | Optional |
| `google_places_cache` | 0 | API cost savings ($966/mo!) | **Critical** |
| `api_request_logs` | 0 | Cost monitoring | **Critical** |
| `email_subscribers` | 4 | Waitlist | Exists |

**Key Discovery**: Database already has `gemini_tokens_used` and `enrichment_source` fields - Gemini integration was planned!

### Frontend (Next.js 16) - Landing Page Ready

- Premium design system with CSS variables
- Component library (Button, Badge, Cards, etc.)
- Email subscription working
- No authentication UI yet
- No trip planning UI yet

---

## 2. POC Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MONKEYTRAVEL POC                                │
│                     (Next.js 16 + Supabase)                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │   AUTH      │ │  TRIP       │ │    AI       │
            │   LAYER     │ │  PLANNING   │ │  AGENT      │
            │             │ │             │ │             │
            │ • Demo mode │ │ • Create    │ │ • Gemini 3  │
            │ • Email     │ │ • View      │ │ • Prompts   │
            │ • Session   │ │ • Edit      │ │ • Safety    │
            └─────────────┘ └─────────────┘ └─────────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
            ┌─────────────────────────────────────────────┐
            │              SUPABASE                        │
            │  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
            │  │ users   │ │ trips   │ │ cache   │       │
            │  │         │ │ days    │ │ logs    │       │
            │  └─────────┘ └─────────┘ └─────────┘       │
            └─────────────────────────────────────────────┘
```

### User Flow (Simplified for POC)

```
1. LANDING PAGE
   │
   ▼
2. "Try Demo" or "Sign Up"
   │
   ├─► Demo Mode (no auth, limited features)
   │   └─► Create 1 trip, 3 days max
   │
   └─► Sign Up (email/password)
       └─► Full features, 5 trips
           │
           ▼
3. TRIP CREATION WIZARD
   │
   ├─► Step 1: Where? (destination search)
   ├─► Step 2: When? (dates, 1-7 days)
   ├─► Step 3: Style? (budget tier, pace, interests)
   │
   ▼
4. AI GENERATION
   │
   ├─► Loading state with progress
   ├─► Gemini 3 Pro generates itinerary
   ├─► Save to database
   │
   ▼
5. ITINERARY VIEW
   │
   ├─► Day-by-day timeline
   ├─► Activity cards with details
   ├─► Edit/customize options
   └─► Share link (public URL)
```

---

## 3. AI Agent Design

### Gemini 3 Pro Configuration

```typescript
// Configuration for POC
const GEMINI_CONFIG = {
  model: "gemini-3-pro-preview",
  thinking_level: "high",  // For complex itinerary planning
  temperature: 1.0,        // Required for Gemini 3
  max_output_tokens: 8192, // Sufficient for 7-day itinerary

  // Safety settings
  safety_settings: [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  ]
};
```

### Prompt Engineering Strategy

**System Prompt** (stored in skill):
```
You are MonkeyTravel AI, an expert travel planner. Generate personalized
day-by-day itineraries based on user preferences.

RULES:
1. Always suggest real, verifiable places (no fictional locations)
2. Consider practical factors: opening hours, travel time, meal times
3. Balance activities with rest - don't over-schedule
4. Match budget tier: Budget (<$100/day), Balanced ($100-250/day), Premium ($250+/day)
5. Include local gems, not just tourist traps
6. Consider weather and seasonality
7. Group nearby activities to minimize travel

OUTPUT FORMAT: Strict JSON schema (see below)
```

**User Prompt Template**:
```
Plan a {duration}-day trip to {destination}.

Traveler Profile:
- Budget Tier: {budget_tier}
- Travel Pace: {pace} (relaxed/moderate/active)
- Interests: {interests}
- Special Requirements: {requirements}

Travel Dates: {start_date} to {end_date}

Generate a complete day-by-day itinerary with:
- Morning, afternoon, and evening activities
- Restaurant recommendations for each meal
- Estimated costs per activity
- Practical tips and notes
```

### Output Schema (Structured Output)

```typescript
interface GeneratedItinerary {
  destination: {
    name: string;
    country: string;
    description: string;
    best_for: string[];
    weather_note: string;
  };

  days: Array<{
    day_number: number;
    date: string;
    theme: string;  // e.g., "Historic Old Town"

    activities: Array<{
      time_slot: "morning" | "afternoon" | "evening";
      start_time: string;  // "09:00"
      duration_minutes: number;

      name: string;
      type: "attraction" | "restaurant" | "activity" | "transport";
      description: string;
      location: string;

      estimated_cost: {
        amount: number;
        currency: string;
        tier: "free" | "budget" | "moderate" | "expensive";
      };

      tips: string[];
      booking_required: boolean;
    }>;

    daily_budget: {
      total: number;
      breakdown: {
        activities: number;
        food: number;
        transport: number;
      };
    };
  }>;

  trip_summary: {
    total_estimated_cost: number;
    currency: string;
    highlights: string[];
    packing_suggestions: string[];
  };

  metadata: {
    generated_at: string;
    model: string;
    tokens_used: number;
  };
}
```

---

## 4. Security & Rate Limiting

### API Security

```typescript
// Rate limiting configuration
const RATE_LIMITS = {
  // Per-user limits
  demo_user: {
    trips_per_day: 1,
    generations_per_trip: 2,  // Allow 1 regeneration
    max_days: 3,
  },

  authenticated_user: {
    trips_per_day: 5,
    generations_per_trip: 5,
    max_days: 7,
  },

  // Global limits (cost protection)
  global: {
    generations_per_hour: 100,
    max_tokens_per_request: 10000,
    max_cost_per_day_usd: 50,  // ~2500 requests at $0.02 avg
  }
};
```

### Input Validation & Sanitization

```typescript
// Validation rules
const VALIDATION = {
  destination: {
    max_length: 100,
    allowed_chars: /^[a-zA-Z0-9\s,.-]+$/,
    blacklist: ["<script>", "javascript:", "eval(", "SELECT", "DROP"],
  },

  dates: {
    min_days: 1,
    max_days: 7,  // POC limit
    max_future_days: 365,
    no_past_dates: true,
  },

  interests: {
    max_items: 10,
    max_length_each: 50,
    allowed_values: [
      "culture", "food", "nature", "adventure", "relaxation",
      "nightlife", "shopping", "history", "art", "photography"
    ],
  },
};
```

### Prompt Injection Prevention

```typescript
// Sanitization middleware
function sanitizeUserInput(input: string): string {
  // Remove potential prompt injection patterns
  const dangerous_patterns = [
    /ignore previous instructions/gi,
    /disregard all prior/gi,
    /you are now/gi,
    /pretend to be/gi,
    /system prompt/gi,
    /\[INST\]/gi,
    /<<SYS>>/gi,
  ];

  let sanitized = input;
  dangerous_patterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, "[FILTERED]");
  });

  return sanitized.slice(0, 1000);  // Max input length
}
```

### Cost Monitoring

```typescript
// Log every AI request
async function logAIRequest(params: {
  user_id: string | null;
  endpoint: string;
  tokens_used: number;
  cost_usd: number;
  cache_hit: boolean;
  response_time_ms: number;
}) {
  await supabase.from('api_request_logs').insert({
    api_name: 'gemini',
    ...params,
    timestamp: new Date().toISOString(),
  });
}

// Cost calculation (Gemini 3 Pro pricing)
function calculateCost(input_tokens: number, output_tokens: number): number {
  const INPUT_COST_PER_1M = 4;   // $4 per 1M input tokens (>200k)
  const OUTPUT_COST_PER_1M = 18; // $18 per 1M output tokens

  return (
    (input_tokens / 1_000_000) * INPUT_COST_PER_1M +
    (output_tokens / 1_000_000) * OUTPUT_COST_PER_1M
  );
}
```

---

## 5. API Routes Structure

```
app/api/
├── auth/
│   ├── demo/route.ts       # Create demo session
│   ├── signup/route.ts     # Email/password signup
│   ├── login/route.ts      # Login
│   └── logout/route.ts     # Logout
│
├── trips/
│   ├── route.ts            # GET (list), POST (create)
│   └── [id]/
│       ├── route.ts        # GET, PUT, DELETE
│       └── share/route.ts  # Generate share link
│
├── ai/
│   ├── generate/route.ts   # Generate itinerary (main AI endpoint)
│   ├── enhance/route.ts    # Enhance single activity
│   └── suggest/route.ts    # Quick suggestions
│
├── destinations/
│   └── search/route.ts     # Search destinations (autocomplete)
│
└── admin/
    └── stats/route.ts      # Usage statistics (protected)
```

---

## 6. Frontend Pages & Components

### Page Structure

```
app/
├── page.tsx                    # Landing page (exists)
├── demo/
│   └── page.tsx               # Demo mode entry
├── auth/
│   ├── login/page.tsx         # Login form
│   └── signup/page.tsx        # Signup form
├── trips/
│   ├── page.tsx               # Trip dashboard
│   ├── new/page.tsx           # Trip creation wizard
│   └── [id]/
│       ├── page.tsx           # Itinerary view
│       └── edit/page.tsx      # Edit itinerary
├── share/
│   └── [shareId]/page.tsx     # Public shared view
└── privacy/page.tsx           # (exists)
└── terms/page.tsx             # (exists)
```

### New Components Needed

```
components/
├── auth/
│   ├── LoginForm.tsx
│   ├── SignupForm.tsx
│   └── AuthProvider.tsx       # Context provider
│
├── trips/
│   ├── TripCard.tsx           # Trip list item
│   ├── TripWizard/
│   │   ├── DestinationStep.tsx
│   │   ├── DatesStep.tsx
│   │   ├── PreferencesStep.tsx
│   │   └── WizardProgress.tsx
│   │
│   ├── ItineraryView/
│   │   ├── DayTimeline.tsx
│   │   ├── ActivityCard.tsx
│   │   ├── DaySummary.tsx
│   │   └── BudgetBreakdown.tsx
│   │
│   └── ShareTrip.tsx
│
├── ai/
│   ├── GenerationLoader.tsx   # Animated loading state
│   └── AIDisclaimer.tsx       # "AI-generated content" notice
│
└── common/
    ├── DestinationSearch.tsx  # Autocomplete input
    ├── DateRangePicker.tsx
    ├── BudgetSelector.tsx
    └── InterestTags.tsx
```

---

## 7. UI/UX Design Specifications

### Design Principles

1. **Premium but Simple** - Existing brand colors, clean layouts
2. **Mobile-First** - 60%+ traffic expected from mobile
3. **Progressive Disclosure** - Don't overwhelm, reveal complexity gradually
4. **Instant Feedback** - Loading states, optimistic updates
5. **Trust Signals** - AI disclaimer, "real places" guarantee

### Key UI Patterns

**Trip Creation Wizard**:
```
┌────────────────────────────────────────────────────┐
│  [1]───[2]───[3]  Progress indicator               │
├────────────────────────────────────────────────────┤
│                                                    │
│  Where do you want to go?                          │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ 🔍 Search destinations...                    │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  Popular destinations:                             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│  │Paris │ │Tokyo │ │Bali  │ │Rome  │            │
│  └──────┘ └──────┘ └──────┘ └──────┘            │
│                                                    │
│                              [Next →]              │
└────────────────────────────────────────────────────┘
```

**Itinerary View**:
```
┌────────────────────────────────────────────────────┐
│  ← Back    Paris, France    [Share] [Edit]         │
├────────────────────────────────────────────────────┤
│  Dec 15-17, 2025  •  3 days  •  $450 est.         │
│                                                    │
│  [Day 1] [Day 2] [Day 3]  ← Tab navigation        │
├────────────────────────────────────────────────────┤
│                                                    │
│  ☀️ MORNING                                        │
│  ┌────────────────────────────────────────────┐   │
│  │ 🗼 Eiffel Tower                             │   │
│  │ 09:00 - 11:00  •  2h  •  €26               │   │
│  │ Book skip-the-line tickets in advance      │   │
│  └────────────────────────────────────────────┘   │
│                                                    │
│  🍽️ LUNCH                                         │
│  ┌────────────────────────────────────────────┐   │
│  │ 🥐 Café de Flore                           │   │
│  │ 12:00 - 13:30  •  1.5h  •  €35             │   │
│  │ Historic café - try the croque monsieur    │   │
│  └────────────────────────────────────────────┘   │
│                                                    │
│  🌅 AFTERNOON                                      │
│  ...                                               │
└────────────────────────────────────────────────────┘
```

**Generation Loading State**:
```
┌────────────────────────────────────────────────────┐
│                                                    │
│         🧠 Creating your perfect trip...           │
│                                                    │
│         ━━━━━━━━━━━━━━━━━━━━━  75%                │
│                                                    │
│         ✓ Analyzing destination                    │
│         ✓ Finding best activities                  │
│         → Optimizing your schedule                 │
│         ○ Adding local recommendations             │
│                                                    │
│         This usually takes 10-20 seconds           │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## 8. Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Set up Gemini API integration
- [ ] Create AI generation endpoint with safety measures
- [ ] Implement demo mode (no auth required)
- [ ] Build trip creation wizard UI
- [ ] Create basic itinerary view

### Phase 2: Core Features (Week 2)
- [ ] Add authentication (Supabase Auth)
- [ ] Implement trip CRUD operations
- [ ] Add rate limiting and cost tracking
- [ ] Build trip dashboard
- [ ] Polish loading states and error handling

### Phase 3: Enhancement (Week 3)
- [ ] Add share functionality
- [ ] Implement destination search with caching
- [ ] Add edit/customize itinerary
- [ ] Mobile responsive refinements
- [ ] Usage analytics dashboard

### Phase 4: Testing & Launch (Week 4)
- [ ] End-to-end testing
- [ ] Load testing (100 concurrent users)
- [ ] Security audit
- [ ] Deploy to production
- [ ] Monitor and iterate

---

## 9. Environment Variables

```bash
# .env.local

# Supabase (exists)
NEXT_PUBLIC_SUPABASE_URL=https://sevfbahwmlbdlnbhqwyi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...

# Gemini AI (NEW - required)
GOOGLE_AI_API_KEY=your-gemini-api-key

# Rate Limiting (NEW)
RATE_LIMIT_DEMO_TRIPS_PER_DAY=1
RATE_LIMIT_AUTH_TRIPS_PER_DAY=5
RATE_LIMIT_GLOBAL_PER_HOUR=100

# Cost Control (NEW)
MAX_DAILY_AI_COST_USD=50
ALERT_EMAIL=admin@monkeytravel.app

# Feature Flags (NEW)
ENABLE_DEMO_MODE=true
ENABLE_SHARING=true
MAX_TRIP_DAYS=7
```

---

## 10. Cost Projections

### Gemini 3 Pro Pricing

| Metric | Value |
|--------|-------|
| Input (≤200k tokens) | $2/1M tokens |
| Input (>200k tokens) | $4/1M tokens |
| Output | $12-18/1M tokens |

### Estimated Costs Per Request

| Request Type | Input Tokens | Output Tokens | Est. Cost |
|--------------|--------------|---------------|-----------|
| 3-day itinerary | ~2,000 | ~3,000 | ~$0.06 |
| 7-day itinerary | ~3,000 | ~7,000 | ~$0.14 |
| Activity enhance | ~500 | ~500 | ~$0.01 |

### Monthly Projections (POC)

| Scenario | Daily Requests | Monthly Cost |
|----------|----------------|--------------|
| Light (100 users) | 50 | ~$90 |
| Medium (500 users) | 200 | ~$360 |
| Heavy (2000 users) | 800 | ~$1,440 |

**Budget Cap**: $50/day = ~$1,500/month maximum

---

## 11. Success Metrics

### POC Goals

1. **Functional**: Users can generate itineraries end-to-end
2. **Fast**: Generation < 30 seconds
3. **Quality**: 80%+ users rate itinerary as "useful"
4. **Stable**: < 1% error rate
5. **Secure**: No prompt injections or data leaks

### Tracking

```typescript
// Key metrics to track
const METRICS = {
  // Usage
  trips_created: "Total trips created",
  generations_completed: "Successful AI generations",
  generation_failures: "Failed generations",

  // Performance
  avg_generation_time_ms: "Average generation time",
  p95_generation_time_ms: "95th percentile time",

  // Quality
  user_satisfaction: "Post-generation rating (1-5)",
  itinerary_edits: "Manual edits after generation",

  // Cost
  total_tokens_used: "Total Gemini tokens",
  total_cost_usd: "Total AI cost",
  cost_per_trip: "Average cost per trip",

  // Engagement
  return_users: "Users creating 2+ trips",
  shared_trips: "Trips shared publicly",
};
```

---

## 12. Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| **High AI costs** | Financial | Hard daily cap ($50), rate limits |
| **Prompt injection** | Security | Input sanitization, blocklist |
| **Hallucinated places** | Trust | Disclaimer, feedback button |
| **API downtime** | UX | Graceful error handling, retry logic |
| **Abuse/spam** | Cost | Rate limits, demo restrictions |
| **Low quality output** | Trust | Structured output, validation |

---

## 13. Booking Strategy (MVP)

### Why Links, Not Direct Booking

For the MVP, we display booking options with **affiliate links** rather than handling transactions:

| Approach | MVP (Links) | Full Booking |
|----------|-------------|--------------|
| Complexity | Low | Very High |
| PCI Compliance | Not needed | Required |
| API Contracts | None | Formal agreements |
| Revenue Model | Affiliate commissions | Transaction fees |
| Liability | None | Full responsibility |
| Time to Launch | Days | Months |

### Implementation Pattern

```tsx
// components/itinerary/BookingLinks.tsx

interface BookingLinksProps {
  destination: string;
  dates: { start: string; end: string };
  type: "flight" | "hotel";
}

const AFFILIATE_LINKS = {
  flight: [
    { name: "Skyscanner", urlTemplate: "https://www.skyscanner.com/transport/flights/{origin}/{dest}/{date}" },
    { name: "Kayak", urlTemplate: "https://www.kayak.com/flights/{origin}-{dest}/{date}" },
    { name: "Google Flights", urlTemplate: "https://www.google.com/travel/flights?q=flights+to+{dest}" },
  ],
  hotel: [
    { name: "Booking.com", urlTemplate: "https://www.booking.com/searchresults.html?ss={dest}&checkin={checkin}&checkout={checkout}" },
    { name: "Hotels.com", urlTemplate: "https://www.hotels.com/search.do?destination={dest}" },
    { name: "Airbnb", urlTemplate: "https://www.airbnb.com/s/{dest}/homes?checkin={checkin}&checkout={checkout}" },
  ],
};

export function BookingLinks({ destination, dates, type }: BookingLinksProps) {
  const links = AFFILIATE_LINKS[type];

  return (
    <div className="bg-slate-50 rounded-lg p-4 mt-4">
      <h4 className="text-sm font-medium text-slate-700 mb-3">
        {type === "flight" ? "✈️ Book your flight" : "🏨 Find accommodation"}
      </h4>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.name}
            href={buildUrl(link.urlTemplate, destination, dates)}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-full text-sm text-slate-700 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
          >
            {link.name} →
          </a>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-2">
        We help you plan, you book directly for the best price
      </p>
    </div>
  );
}
```

### Optional: Price Comparison Display

If we want to show prices without handling bookings, we can use:
- **Skyscanner Affiliate API** (free, shows prices)
- **Google Flights API** (if available)
- **Web scraping** (risky, not recommended)

For MVP, we skip price display and let users compare on booking sites.

---

## 14. Future Enhancements (Post-MVP)

1. **Affiliate Price Display** - Show prices from Skyscanner/Kayak APIs
2. **Real-time Collaboration** - Multiple users editing same trip
3. **Booking Widget Integration** - Embed Booking.com/Expedia widgets
4. **Mobile App** - React Native version
5. **Offline Mode** - Download itinerary for travel
6. **AI Chat** - Conversational trip modifications
7. **Photo Integration** - Add photos to memories
8. **Full Booking** (if scale justifies) - Direct Amadeus integration

---

## Appendix: Database Schema Reference

### Core Tables for POC

```sql
-- Already exists, use as-is
SELECT * FROM users;
SELECT * FROM trips;
SELECT * FROM itinerary_days;
SELECT * FROM planned_activities;
SELECT * FROM destinations;
SELECT * FROM google_places_cache;
SELECT * FROM api_request_logs;
```

### New Table Needed: AI Generations Log

```sql
CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID REFERENCES trips(id),
  user_id UUID REFERENCES users(id),

  prompt_hash TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd NUMERIC(10, 4) NOT NULL,

  model TEXT DEFAULT 'gemini-3-pro-preview',
  thinking_level TEXT DEFAULT 'high',
  generation_time_ms INTEGER,

  status TEXT CHECK (status IN ('success', 'error', 'timeout', 'filtered')),
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cost tracking
CREATE INDEX idx_ai_generations_created_at ON ai_generations(created_at);
CREATE INDEX idx_ai_generations_user_id ON ai_generations(user_id);
```

---

*Document Version: 1.0*
*Created: December 2025*
*Author: Claude Code + Human Collaboration*
