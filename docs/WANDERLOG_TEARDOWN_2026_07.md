# Wanderlog Competitive Teardown — 2026-07-03

> Research: web-verified (sources at bottom). Purpose: roadmap input for MonkeyTravel.
> One-line: Wanderlog is a beloved MANUAL notebook with an AI sticker on the cover;
> MonkeyTravel is the AI copilot with a crew around it — steal their DISTRIBUTION
> engine, not their product.

## Who they are
YC W19, $1.5M seed, ~$1M ARR (Dec 2024, +120% YoY), cash-flow positive, tiny team.
**7.9M monthly web visits (~46% organic)**. iOS 4.9★/33K, Apple Editors' Choice.
Model: free manual planner + UGC-itinerary SEO machine → Pro ($39.99–59.99/yr) + affiliates.

## Verified mechanics
- **Manual-first + signup-gated**: account required before ANY trip; hands-on test = 3–4 HOURS to plan 10 days (40+ places added one by one).
- **"Wanderlog AI" = ChatGPT chat sidecar**, suggest-only, tap-to-add. Free tier = 5 messages/trip. Reviewers: "bolted on."
- **Collaboration = crown jewel**: true real-time co-editing, email/link invites, Can Edit/View Only, visibility levels. **BUT: no polls, no voting, no threaded comments** (verified absence).
- **Imports**: forward-confirmation-email per trip (free) / Gmail auto-scan (Pro). Brittle: wonky hotel parsing, fails non-English emails. Flight alerts still "experimental" (TripIt owns this).
- **Budget**: free Splitwise-style ledger.
- **Pro paywall resentment = #1 complaint cluster**: offline, route optimization, unlimited AI, Gmail scan, even DARK MODE. Pro doesn't extend to tripmates. Billing bugs.
- **No trip duplication/fork** (founder-confirmed gap, 2024).
- **Growth engine**: millions of indexable UGC trip/guide pages + programmatic /tp/ destination pages. "Invested heavily in SEO from day one."
- Just shipped: **Trip Journal** (post-trip photo log → shareable) — watch, don't build yet.

## Feature matrix (condensed — them vs us)
- They win: real-time co-presence, manual drag-drop depth, unlimited multi-city, booking-email import, offline (Pro), native apps (4.9★), UGC/SEO machine, monetization, post-trip journal.
- We win: 30s AI generation (vs 3–4h manual), no-signup try (vs account wall), WRITE-capable AI agent (confirm-first edits, add-day, paste-draft bulk — they have nothing), anonymous per-activity VOTING (they have none), fork/templates (they can't even duplicate), iCal export, free dark mode, es/it/pt (they're English-centric incl. their parser), visa checker.

## Top 5 to adopt (ranked for Weekly Active Crews + AI-first fit)
1. **Indexable UGC trip pages + creator profiles** (their whole growth engine; our binding constraint is traffic ~40 visits/day; we're one step from it via /explore + ItemList schema). AI twist: denser AI-summarized pages for the AI-Overviews era. **M**
2. **Forward-your-confirmations import, LLM-parsed** (their weakest strong feature: brittle + English-only; Gemini parsing + es/it/pt = our turf; converts plans into the LIVE operational home of the trip → weekly crew activity). Skip Gmail OAuth initially. **M**
3. **Real-time co-presence** (their most-praised trait; Supabase Realtime tractable; presence-lite first: live vote counters + viewer avatars = M, full co-editing = L).
4. **Travel-time chips + free "AI, optimize my day"** (they paywall route optimization at $40/yr; our agent does it free — direct counter-position). **S–M**
5. **Offline trip access in the Capacitor app** (top-3 Wanderlog resentment is offline-behind-Pro; free offline = review-bait at mobile launch). **M**

## Positioning ammunition
"Plan in 30 seconds, not 3 hours. No account to try. The AI actually edits your trip.
Your crew votes without signing up. Route optimization, offline and dark mode — free.
No $40 paywall."

## Skip
Flight-status tracking (TripIt's turf), direct bookings (our deliberate non-goal for now),
full manual drag-drop editor rebuild (fighting on their terrain), unlimited-stops road-trip depth.

## Sources
wanderlog.com (+ /trip-plan-assistant, /blog/faq, /guides, budget page) · App Store listing
(IAPs, ratings, Trip Journal notes) · YC + TechCrunch (funding) · startupfounderstories
($1M ARR) · Similarweb (7.9M visits) · monkeyeatingmango pricing 2026 · wandrly + tripstone +
theprocesshacker + travelaihub + aitravel.tools reviews · marlvel sentiment report ·
Rick Steves forums (imports, no-duplication) · weplanify/tripprof (voting absence).
Confidence notes: UGC-organic % + affiliate growth figures from a single secondary source
(directional); voting absence inferred from consistent third-party comparisons + zero
mention in their own help center.
