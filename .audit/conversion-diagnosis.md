# Conversion Diagnosis — MonkeyTravel

**Date:** 2026-05-23 · **Audited by:** PostHog SQL + GSC + 3 parallel codebase audits + Sentry

## TL;DR — the conversion math

Last 30 days of PostHog events:

| Stage | Unique users | Drop from previous |
|---|---:|---|
| Pageview | 81 | — |
| `/trips/new` opened (EN+IT+ES) | ~28 | -53 (visitors fail to reach the wizard) |
| `trip_wizard_step_viewed` | **32** | (40% of visitors enter the wizard) |
| `trip_wizard_field_interacted` | **15** | **53% bounce on wizard load** |
| `trip_wizard_step_completed` | 11 | — |
| `trip_generation_started` | **8** | — |
| **`trip_created`** | **2** | **75% of generators never save a trip** |

**2 trips created from 81 unique users in 30 days = 2.5% end-to-end conversion.** Industry bar for AI trip planners is 10-20%. The product is converting at roughly **1/5 of competitive baseline**.

GSC complements this: total clicks have been flat at ~24/day for 2 months with brand search ("monkey travel") growing while non-brand long-tail declined post-consolidation. Brand search means a small loyal cohort already finds value — the problem is *new visitors* don't get to that value.

## Root cause (one sentence)

**The product is engineered around "users will sign up because we ask them to," while modern AI trip planners (Layla, Mindtrip, Roam Around, Wonderplan) are engineered around "users will sign up because they got value first" — and MonkeyTravel's auth wall fires precisely at the moment the user is most engaged (clicking Generate), behind a marketing promise of "No Signup, No Card, Unlimited Plans" that the product immediately breaks.**

## The ranked conversion blockers

### Tier 1 — Critical (fix this week or nothing else matters)

**1. The auth wall fires before generation, after the marketing promised "no signup."**
- `/free-ai-trip-planner` landing page literally says "No Signup, No Card, Unlimited Plans" ([app/[locale]/free-ai-trip-planner/page.tsx](app/[locale]/free-ai-trip-planner/page.tsx))
- The wizard's `handleGenerate` at [app/[locale]/trips/new/page.tsx:627-646](app/[locale]/trips/new/page.tsx) intercepts unauthenticated users with `setShowAuthModal(true)` after they've filled 3 fields
- Server-side [app/api/ai/generate/route.ts:214](app/api/ai/generate/route.ts) double-locks with `getAuthenticatedUser()` — there is **zero** anonymous generation path
- PostHog confirms: of 8 users who triggered generation, **6 never reached `trip_created`** — likely bouncing at the signup wall

**2. The closed-beta gate is a dead-end with no escape.**
- After free trips are exhausted (2 for OAuth users, 1 for email-signup-completed-onboarding, 0 for partial onboarding), [lib/early-access/index.ts:115-199](lib/early-access/index.ts) blocks generation
- There is **no `/pricing` page, no Stripe checkout, no webhook handler** — the schema knows about `subscription_tier='premium'` but the upgrade path doesn't exist
- A user who loves the product and wants to pay you... literally cannot
- This is a launched product running on closed-beta plumbing

**3. The homepage CTA jumps straight to signup, bypassing the wizard entirely.**
- `TOUR_ENABLED = false` in [components/tour/tour-flag.ts](components/tour/tour-flag.ts) → `TourTrigger.handleOpenTour` does `router.push("/auth/signup")` directly
- So clicking "Plan your trip" on the hero never even shows the user what the product looks like
- The one good escape hatch (`/trips/new` accessible anonymously) only appears via SEO landing pages

### Tier 2 — Major (kills the iteration loop, which is the actual product)

**4. The result page on `/trips/new` is READ-ONLY. All the "make day 2 cheaper" tools live behind Save+Auth.**
- After generation, the user sees a beautiful trip with only `Save Trip / Regenerate-whole / Start Over`
- The AI chat assistant, drag-and-drop reorder, per-activity regen, add custom activity, route optimization — **all of it lives on `/trips/[id]`**, accessible only after the user signs up AND saves
- This breaks the natural iteration loop ("I love it but day 2 is too pricey") at the worst possible moment
- The product has every primitive a competitive AI trip planner has — they're just sequestered behind the wall

**5. The AI Assistant (the killer feature) is hidden behind a small floating pill.**
- [components/ai/AIAssistant.tsx](components/ai/AIAssistant.tsx) has `optimizeBudget`, `addRestaurant`, `localTips`, `alternatives` quick prompts
- Backed by `/api/ai/assistant/route.ts` + `/apply` + `/undo`
- Rendered as a tiny bottom-left pill in [TripDetailClient.tsx:1970](app/[locale]/trips/[id]/TripDetailClient.tsx)
- This is the entire point of an AI trip planner in 2026 (Layla and Mindtrip foreground this from word one) — here it's a secondary affordance

**6. Whole-trip regenerate only, no per-day, no streaming.**
- `handleRegenerate` at [trips/new/page.tsx:546](app/[locale]/trips/new/page.tsx) clears the entire itinerary
- 30-40s blocking JSON response — no streaming, the UI blocks on a fun-facts animation
- A user who likes 4 of 5 days but wants Day 3 redone has to nuke the whole thing

### Tier 3 — Major (kills collaboration, which is the marketing differentiator)

**7. Friends invited to "vote and reach consensus" hit a signup wall before any participation.**
- `/invite/[token]` route requires auth before the invitee can do anything
- Voting requires `auth.users.id` — no anonymous votes
- `/shared/[token]` is read-only (no edit, no vote, no comment)
- Wonderplan and Wanderlog allow anonymous voting via a shareable link — the entire MonkeyTravel collaboration story dies on the first invite

**8. No email-invite delivery, no notifications, no presence.**
- The invite flow is: owner generates link → copies → opens WhatsApp → pastes. ~5-6 clicks plus app-switch
- Default `maxUses: 1` on invite links (most generated links die after one person)
- No email service in `package.json` (no Resend/SendGrid/Postmark)
- No notification when a collaborator votes, comments, or joins
- No presence/cursors — two users on the same trip don't know the other is there

### Tier 4 — Strategic (compounds the above)

**9. Email signup has 3 serial gates that OAuth signup skips.**
- OAuth: 1 click → `/trips/new` with 2 free generations, `onboarding_completed: true`
- Email: signup form → email verification → welcome page (beta code prompt + waitlist) → onboarding (4 questions) → `/trips/new` with 1 free trip
- **Your conversion depends on which signup button the user picks**, and the form visually treats them as equal

**10. Onboarding survey is "skippable" but functionally semi-mandatory.**
- 4 steps (travel styles, dietary, accessibility, hours) at [app/[locale]/onboarding/page.tsx](app/[locale]/onboarding/page.tsx)
- The "free trip" is only granted if completed — pure carrot-and-stick
- 4 mandatory-feeling questions BEFORE the user has seen value is a classic activation killer

---

## Proposed rework (in priority order)

### Phase 1 — Stop the bleeding (1-2 days of engineering)

**A. Remove the auth wall from generation. Add it at save.**
- `/api/ai/generate` accepts anonymous requests (rate-limited by IP + httpOnly cookie, e.g. 2 generations / 24h)
- Generated trip stored in localStorage with a UUID
- `/trips/new` result page renders the FULL edit experience (AI chat, per-activity regen, drag-reorder, add custom) operating on the localStorage copy
- The Save button → opens auth modal → after auth, the localStorage trip is upserted to the DB

This is the single biggest move. It matches every competitor and aligns the product with what its own marketing claims.

**B. Kill the closed-beta gate OR ship the Stripe paywall this week.**
- Decision: are you in private beta or are you launched? Pick one
- If launched: delete the early-access check, give every user the `free` tier limits (3 generations/month per [config.ts:17-49](lib/usage-limits/config.ts))
- If still beta: hide the homepage and SEO landings behind a waitlist (don't lie to visitors)
- Ship a `/pricing` page with Stripe checkout for users who hit the free-tier limit

**C. Fix the homepage CTA to land on `/trips/new`, not `/auth/signup`.**
- Flip `TOUR_ENABLED = true` OR replace the TourTrigger with a direct link to the wizard
- The hero button should be "Try it free" → wizard → generate → THEN signup
- 5-line change in [components/tour/tour-flag.ts](components/tour/tour-flag.ts) + [TourTrigger.tsx](components/tour/TourTrigger.tsx)

### Phase 2 — Lift the iteration loop (3-5 days)

**D. Foreground the AI Assistant on the result page.**
- On `/trips/new` (post-generation, pre-save) and `/trips/[id]`, surface the AI chat as a persistent side panel or a prominent header CTA, not a floating pill
- The opening message: "Tell me what to change — make Day 2 cheaper, swap the seafood for vegetarian, add a museum on Day 4"
- This becomes the primary interaction model after the first generation

**E. Add per-day regeneration.**
- `/api/ai/regenerate-day` (similar pattern to existing `regenerate-activity`)
- A "Regenerate Day N" button on each day section
- Removes the "love 4 of 5 days, have to nuke everything" trap

**F. Stream the generation response.**
- Switch `/api/ai/generate` to SSE / `ReadableStream`
- Render days as they arrive — Day 1 appears in 5s instead of waiting 40s for everything
- Removes the "did it freeze?" moment that drops users

### Phase 3 — Unblock collaboration (3-5 days)

**G. Make `/shared/[token]` collaborative.**
- Anonymous voters can thumbs-up/down activities (rate-limited by IP+cookie)
- Anonymous comments on days (with a name they type in, no auth)
- "Save a copy" still requires auth (that's the conversion event)

**H. Send invites via email.**
- Add Resend or Postmark
- Invite flow: enter friend's email + optional message → email sent with magic invite link
- Default `maxUses: unlimited` (with a cap of 20 collaborators per trip)

**I. Add a notification system.**
- Email digest when collaborators vote/comment (daily batched, opt-out)
- In-app bell with `notifications` table

### Phase 4 — Simplify onboarding (1-2 days)

**J. Move the onboarding survey to POST first trip.**
- Remove the `free_trips_remaining` reward gating
- Show 4-step survey only AFTER the user saves their first trip ("help us personalize your next one")
- Or fold the questions into the existing wizard vibe step

**K. Delete the welcome page for email signups.**
- Mirror the OAuth callback path: signup → directly to `/trips/new` with free trips granted
- The welcome page framing ("redeem beta code / join waitlist") makes the product feel exclusive in a bad way

**L. Visually emphasize Google SSO over email/password.**
- Make Google the big button, email/password a small "Continue with email" link below
- Email signup users have measurably worse conversion (3 serial gates vs 1) — push them away from it

---

## What I'd ship this week, in order

1. **Monday**: TOUR_ENABLED flip + homepage CTA → wizard (Phase 1C, 1 hour)
2. **Tuesday**: Anonymous generation via IP+cookie rate limit (Phase 1A, 1 day — most of the work is moving the auth check from generation to save)
3. **Wednesday**: Decision on beta vs launched. If launched: delete early-access gate + ship /pricing + Stripe (Phase 1B, 1-2 days)
4. **Thursday-Friday**: Foreground AI assistant on result page (Phase 2D, 1 day)

That's the floor. With those 4 shipped, the wizard→generation→iterate loop matches the competitive baseline. Subsequent phases unlock the next layer of conversion (collaboration, simpler onboarding).

---

## Why this diagnosis is high-confidence

- **PostHog data** quantifies the drop-off precisely. The 8 → 2 cliff at trip_created cannot be explained by anything except a post-generation block (auth wall or save-then-iterate barrier).
- **3 parallel codebase audits** independently surfaced the same auth-wall pattern from different angles (trip flow, auth gates, collaboration). The agents weren't told what to find — they found the same wall.
- **The marketing-product mismatch is verifiable in code**: the SEO landing page literally says "No Signup" while the route literally throws 401 without auth. This isn't a hypothesis, it's two file paths to read.
- **Competitive evidence**: Layla, Mindtrip, Roam Around, Wonderplan all allow anonymous generation. Your `chatgpt-vs-ai-trip-planners.md` blog post even highlights this as a competitive dimension.

## What I'd watch over 2 weeks after Phase 1 ships

- `trip_generation_started` events from anonymous distinct_ids (should rise sharply)
- `trip_created` per generation (should rise from ~25% toward 60%+ as save becomes the natural follow-through to a result the user already iterated on)
- Signup conversion rate from "Save Trip" modal (this becomes the new top-of-funnel signup event)
- New event to add: `ai_assistant_message_sent` (this is your new product-engagement metric)
