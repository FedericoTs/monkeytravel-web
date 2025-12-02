# MonkeyTravel Agentic Architecture

## Research Summary

Based on extensive research of Google's latest AI travel features (December 2025):

### Google AI Mode Canvas
- **Canvas** is a workspace in AI Mode for building travel plans
- Pulls real-time data from Google Flights, Maps, reviews
- Users describe trip, AI builds complete itinerary in side panel
- Available on desktop in US for AI Mode experiment users

### Agentic Booking Status
| Category | Status | Partners |
|----------|--------|----------|
| Restaurants | **LIVE** | OpenTable, Resy, Tock |
| Events | **LIVE** | Ticketmaster, StubHub, SeatGeek |
| Beauty/Wellness | **LIVE** | Various |
| Flights | **COMING** | Expedia, Booking.com |
| Hotels | **COMING** | Marriott, Wyndham, Booking.com |

**For MVP**: Stick with affiliate links until Google's flight/hotel booking is available via API.

### Gemini Models Available
| Model | Code | Best For |
|-------|------|----------|
| Gemini 3 Pro | `gemini-3-pro-preview` | Most intelligent, best agentic |
| Gemini 2.5 Pro | `gemini-2.5-pro` | Advanced thinking/reasoning |
| Gemini 2.5 Flash | `gemini-2.5-flash` | Price/performance balance |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` | High throughput, cost-efficient |

**Recommendation**: Start with `gemini-2.5-flash` for cost efficiency, upgrade to 3 Pro for complex planning.

---

## Existing Database Schema (Already Built!)

Your Supabase database is **production-ready** for travel planning:

### Core Tables Available

```
users                    → User profiles (linked to auth.users)
├── preferences (JSONB)  → Travel preferences
├── privacy_settings     → Privacy controls
└── notification_settings

trips                    → Trip records
├── itinerary (JSONB)    → Daily itinerary items (TripDay[] model)
├── budget (JSONB)       → TripBudget model
├── packing_list (JSONB) → PackingItem[] model
└── emergency_contacts   → EmergencyContact[] model

destinations             → Places to visit
├── activities (JSONB)   → Activity objects array
├── transport_options    → Transport options array
├── gemini_tokens_used   → AI cost tracking (already!)
└── enrichment_source    → AI enrichment tracking

itinerary_days           → Day-by-day planning
└── accommodation (JSONB)

planned_activities       → Scheduled activities per day
├── start_time
├── duration_minutes
└── estimated_cost

trip_budgets             → Budget tracking per trip
└── category_budgets (JSONB)

expenses                 → Expense tracking
google_places_cache      → API cost savings ($966/mo potential)
api_request_logs         → Cost monitoring
```

### Key Insight: Gemini Fields Already Exist!

The database was designed with AI integration in mind:
- `destinations.gemini_tokens_used` - Token tracking
- `destinations.enrichment_source` - Source tracking
- `destinations.enriched_at` - Timestamp
- `api_request_logs` - Cost monitoring table

---

## Agentic Architecture Options

### Option 1: Simple Function Calling (Recommended for MVP)

Use Gemini's native function calling without a separate agent framework:

```typescript
// Direct Gemini function calling
const tools = [
  {
    name: "generate_itinerary",
    description: "Generate a day-by-day travel itinerary",
    parameters: {
      type: "object",
      properties: {
        destination: { type: "string" },
        start_date: { type: "string", format: "date" },
        end_date: { type: "string", format: "date" },
        budget_tier: { type: "string", enum: ["budget", "balanced", "premium"] },
        interests: { type: "array", items: { type: "string" } }
      },
      required: ["destination", "start_date", "end_date"]
    }
  },
  {
    name: "search_destination",
    description: "Search for destination information",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        type: { type: "string", enum: ["city", "country", "region"] }
      }
    }
  },
  {
    name: "get_activities",
    description: "Get activities for a destination",
    parameters: {
      type: "object",
      properties: {
        destination_id: { type: "string" },
        activity_type: { type: "string" }
      }
    }
  }
];
```

**Pros**: Simple, no extra dependencies, works with Gemini API directly
**Cons**: Limited orchestration for complex multi-step tasks

### Option 2: Google ADK Multi-Agent (Future Enhancement)

Use ADK for sophisticated multi-agent orchestration:

```python
# Multi-agent travel system with ADK
from google.adk.agents import Agent

# Specialist agents
flight_agent = Agent(
    name="flight_agent",
    model="gemini-2.5-flash",
    instruction="You are a flight search specialist.",
    tools=[search_flights_tool]
)

hotel_agent = Agent(
    name="hotel_agent",
    model="gemini-2.5-flash",
    instruction="You are a hotel booking specialist.",
    tools=[search_hotels_tool]
)

itinerary_agent = Agent(
    name="itinerary_agent",
    model="gemini-2.5-flash",
    instruction="You are an itinerary planning specialist.",
    tools=[generate_itinerary_tool]
)

# Root orchestrator
travel_concierge = Agent(
    name="travel_concierge",
    model="gemini-3-pro-preview",
    instruction="You are a travel concierge. Delegate to specialists.",
    sub_agents=[flight_agent, hotel_agent, itinerary_agent]
)
```

**Pros**: Sophisticated orchestration, specialist agents, scales well
**Cons**: Python-based, requires ADK infrastructure, overkill for MVP

### Recommendation: Start with Option 1, Evolve to Option 2

---

## MVP Architecture (Simplified)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MONKEYTRAVEL MVP                                │
│                  (Next.js 16 + Supabase + Gemini)                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│   SUPABASE    │          │    GEMINI     │          │   EXTERNAL    │
│     AUTH      │          │      AI       │          │    LINKS      │
│               │          │               │          │               │
│ • Existing!   │          │ • 2.5 Flash   │          │ • Skyscanner  │
│ • Same as     │          │ • Function    │          │ • Kayak       │
│   mobile app  │          │   calling     │          │ • Booking.com │
│ • RLS enabled │          │ • Structured  │          │ • Airbnb      │
└───────────────┘          │   output      │          └───────────────┘
        │                  └───────────────┘                   │
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │      EXISTING DATABASE        │
                    │                               │
                    │  users (with auth.users FK)   │
                    │  trips (with itinerary JSONB) │
                    │  destinations                 │
                    │  itinerary_days               │
                    │  planned_activities           │
                    │  google_places_cache          │
                    │  api_request_logs             │
                    │                               │
                    └───────────────────────────────┘
```

---

## Supabase Auth Integration

### Existing Setup
Your database already has:
- `users.id` → `auth.users.id` foreign key
- RLS (Row Level Security) enabled on all user tables
- Privacy and notification settings

### Next.js Integration

```typescript
// lib/supabase-auth.ts
import { createClient } from '@supabase/supabase-js';
import { createClientComponentClient, createServerComponentClient } from '@supabase/auth-helpers-nextjs';

// For client components
export const createClientSupabase = () => createClientComponentClient();

// For server components
export const createServerSupabase = (cookies: () => any) =>
  createServerComponentClient({ cookies });

// Middleware for protected routes
// middleware.ts
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const { data: { session } } = await supabase.auth.getSession();

  // Protected routes
  if (req.nextUrl.pathname.startsWith('/trips') && !session) {
    return NextResponse.redirect(new URL('/auth/login', req.url));
  }

  return res;
}
```

### Sharing Auth with Mobile App

Since the mobile app already uses Supabase Auth:
- Same `auth.users` table
- Same user profiles in `public.users`
- Sessions are app-specific (mobile vs web)
- User data syncs automatically

---

## Canvas-Like Experience for Web

Inspired by Google AI Mode Canvas, build a similar experience:

```typescript
// Canvas-like itinerary builder
interface CanvasState {
  destination: Destination | null;
  dates: { start: Date; end: Date } | null;
  days: ItineraryDay[];
  isGenerating: boolean;
  generationProgress: number;
}

// Real-time collaborative editing (future)
// Uses Supabase Realtime for live updates
const channel = supabase
  .channel('trip-canvas')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'trips',
    filter: `id=eq.${tripId}`
  }, (payload) => {
    // Update local state with remote changes
    updateTripState(payload.new);
  })
  .subscribe();
```

### Canvas UI Features

1. **Side Panel Workspace**
   - Persistent itinerary that builds over conversation
   - Drag-and-drop day/activity reordering
   - Real-time cost estimates

2. **AI Conversation**
   - Natural language refinements
   - "Add a museum visit on day 2"
   - "Find a cheaper hotel option"
   - "What if we stay one more day?"

3. **Data Integration**
   - Pull from Google Places (cached in `google_places_cache`)
   - Show photos, reviews, ratings
   - Estimated costs by category

---

## Implementation Priority

### Phase 1: Connect & Generate (Week 1)
1. ✅ Database already exists and is comprehensive
2. Connect Next.js to same Supabase instance
3. Set up Supabase Auth helpers for Next.js
4. Create Gemini generation endpoint with function calling
5. Basic trip creation wizard

### Phase 2: Canvas Experience (Week 2)
1. Build side-panel Canvas-style UI
2. Day-by-day timeline view
3. Activity cards with details
4. AI conversation for refinements

### Phase 3: Integration & Polish (Week 3)
1. Booking links to Skyscanner/Kayak/Booking.com
2. Share functionality
3. Mobile-responsive polish
4. Cost monitoring dashboard

---

## Environment Variables Required

```env
# Already configured
NEXT_PUBLIC_SUPABASE_URL=https://sevfbahwmlbdlnbhqwyi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...

# NEW - Add Gemini
GOOGLE_AI_API_KEY=your-gemini-api-key

# Optional - For enhanced features
GOOGLE_MAPS_API_KEY=your-maps-key  # For place autocomplete
```

---

## Cost Projections (Updated)

### Gemini 2.5 Flash (Recommended for MVP)

| Request Type | Input | Output | Cost |
|--------------|-------|--------|------|
| 3-day itinerary | ~2K tokens | ~3K tokens | ~$0.003 |
| 7-day itinerary | ~3K tokens | ~7K tokens | ~$0.008 |
| Activity detail | ~500 tokens | ~500 tokens | ~$0.001 |

**Monthly estimate (1000 trips)**: ~$8-15

### Gemini 3 Pro (Premium option)

| Request Type | Input | Output | Cost |
|--------------|-------|--------|------|
| 3-day itinerary | ~2K tokens | ~3K tokens | ~$0.06 |
| 7-day itinerary | ~3K tokens | ~7K tokens | ~$0.14 |

**Monthly estimate (1000 trips)**: ~$100-150

---

## Sources

- [Google AI Mode Travel Planning](https://blog.google/products/search/agentic-plans-booking-travel-canvas-ai-mode/)
- [Google AI Mode Canvas Features](https://9to5google.com/2025/11/17/google-ai-mode-travel/)
- [Gemini API Models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Google ADK Documentation](https://google.github.io/adk-docs/)
- [ADK Travel Agent Codelab](https://codelabs.developers.google.com/travel-agent-mcp-toolbox-adk)
- [Building Agents with Gemini](https://developers.googleblog.com/en/building-agents-google-gemini-open-source-frameworks/)
- [Skift: Google Agentic Travel Booking](https://skift.com/2025/11/17/google-is-building-agentic-travel-booking-plus-other-travel-ai-updates/)

---

*Document Version: 2.0*
*Updated: December 2025*
*Research-backed architecture for MonkeyTravel MVP*
