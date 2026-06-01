# MonkeyTravel — Mobile Screenshot Library (for ad production)

Captured at **true iPhone-13 mobile emulation** (390×844, DPR 3) from the live
site `monkeytravel.app`, anonymous (public surfaces). Each route has a
`-screen.png` (above-the-fold phone view) and `-full.png` (full scroll).
Plus real **product** screens reused from `public/screenshots/`.

Regenerate: `node scripts/capture-mobile-shots.cjs`

## Captured public surfaces

| File | Screen | What it shows | Ad role |
|---|---|---|---|
| `01-landing-*` | Landing hero | "Plan Trips With Friends **in 30 Seconds**", trust chips (100% Free · Up to 8 Friends · 30 Seconds), gold CTA | **Hook / payoff card**, brand bookend |
| `02-free-ai-planner-*` | Free planner | "The Free AI Trip Planner **That Actually Works**" — 60s, real venues, real prices, free | Hook ("free + actually works") |
| `03-ai-itinerary-generator-*` | Generator | "Plans **Like a Pro**" — real venues, current prices, optimized time blocks, 30s | Feature: AI quality |
| `04-explore-*` | Explore | Filter chips (Backpacker; Budget/Balanced/Premium; Weekend/Week/10+; Foodie/Adventure/Cultural…) + real shared trips (Santorini) | Feature: personalization / social proof |
| `05-destinations-*` | Destinations | Top destinations grid | B-roll / inspiration |
| `06-templates-*` | Curated Escapes | Beautiful destination cards — **Paris/Eiffel**, Tokyo, Barcelona (Featured · 7 days · €€ · Explore Itinerary) + bottom tab bar | **Eye-candy / inspiration**, sample-clip source |
| `07-group-trip-planner-*` | Group planner | "**Keeps Everyone Happy**" — vote on activities, builds consensus, "Stop drowning in group chats" | **Relatable pain → solution** (voting) |
| `08-budget-trip-planner-*` | Budget angle | "Travel More, Spend Less" | Niche hook (budget) |
| `09-weekend-trip-planner-*` | Weekend angle | "AI-Powered 2-3 Day Getaways" | Niche hook (weekend) |
| `10-from-chatgpt-*` | ChatGPT switch | Positioned against ChatGPT trip planning | Hot-take / comparison hook |

## Real product screens (from `public/screenshots/`, on disk, ready for Higgsfield)

| File | What it shows | Ad role |
|---|---|---|
| `trip-barcelona-itinerary.png` | **THE money shot** — Day-by-day plan: "Day 1 · Gothic Quarter", timed cards (09:00 Barcelona Cathedral · 180 min · $10 · Maps/Verify/Website), **walking times** between stops (~2 min · 153 m), Booking badges, prices | **Core differentiator reveal** |
| `trip-barcelona-activities.png` | Activity detail list | Feature close-up |
| `trip-barcelona-hero.png` / `trip-lisbon-hero.png` / `trip-porto-hero.png` | Trip hero headers w/ destination imagery | Transitions / destination beats |
| `final-hero.png`, `landing-phones-section.png` | Phone-mockup marketing frames | Composited app-in-hand shots |

> ⚠️ Production note: AI video models warp dense UI **text**. Use photo-forward
> screens (`06`, destination heroes) for generative motion; keep text-critical
> screens (`trip-barcelona-itinerary`) as **low-motion / locked** shots or
> composite them as crisp static layers over generated backgrounds. See
> AD_PLAN.md → "UI-fidelity technique".
