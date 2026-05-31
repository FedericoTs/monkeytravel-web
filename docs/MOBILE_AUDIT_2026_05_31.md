# Mobile-Spotless Audit — 2026-05-31

Workflow `wf_00b326d2-4fb` · 64 agents · 5.75M tokens · ~16 minutes.

**13 workflows audited · 51 findings raised · 42 confirmed · 9 refuted**

| Severity | Count |
|---|---|
| P0 blockers | 0 |
| P1 major | 18 (~14 unique) |
| P2 polish | 11 |
| P3 cosmetic | 13 |

Methodology: each user workflow got a dedicated auditor (code-reading + live UI driving at 375x812 + DB inspection); every finding then went through an adversarial verifier with a `default-refuted` posture — only reproducible/pinpointable bugs survived.

---

## P1 — must-fix before mobile delivery

### Theme 1: iOS Capacitor WebView — `window.open(_blank)` + `target="_blank"` silently swallowed

This is the same root cause across multiple surfaces. Task #175 was marked complete but only `components/booking/PartnerButton.tsx` and ~6 booking helpers actually migrated. Several high-value surfaces were missed.

| Surface | File | Lines | Impact |
|---|---|---|---|
| Booking provider grid (Booking.com, Expedia, Hotels.com) | `components/trip/TripBookingLinks.tsx` | 133 | Affiliate revenue dead on iOS |
| Per-hotel dropdowns (Google Hotels / Booking / Hotels.com / Expedia) | `components/trip/HotelRecommendations.tsx` | 308, 327, 341, 355 | Same |
| Paid Hostelworld affiliate CTA | `components/trip/BackpackerHostelCta.tsx` | 87 | Paid placement dead |
| Activity Google Maps / Search / website links | `components/ActivityCard.tsx` | 402, 413, 425 | Map/search links dead |
| Twitter/WhatsApp share buttons (Share modal) | `components/trip/ShareAndInviteModal.tsx` | 183, 189 | Viral share dead |
| Twitter/WhatsApp share buttons (Referral modal) | `components/referral/ReferralModal.tsx` | 77, 82 | Viral share dead |
| Google Calendar export | `components/trip/ExportMenu.tsx` | 127 | Visible Esporta entry no-ops |
| Visa-checker FCDO + GOV.UK + iVisa affiliate links | `app/[locale]/tools/visa-checker/page.tsx` | 242, 261, 273 | iVisa = only revenue surface on tool |

**Fix shape:** import `openExternal` from `@/lib/native/external-link` and replace each call. For server components (visa-checker), wrap the anchors in a small client component.

### Theme 2: Referral economics — dead reward columns + missed conversion site + race

| # | Finding | File | Why |
|---|---|---|---|
| P1 | `users.free_trips_remaining` granted but never read by `checkUsageLimit` | `lib/early-access/index.ts:297` + `lib/usage-limits/check.ts` | `decrementFreeTrips()` is hardcoded `return 999`. The "+1 free trip" promise on /join/[code] is meaningless. |
| P1 | Same dead column for referrer's +1 reward | `lib/referral/completion.ts:142-148` | Both sides see the misleading "earned 1 free trip" message; only the tier-based banana bonus (3+ conversions) is functional. |
| P1 | `/api/trips/[id]/fork` never calls `completeReferralIfEligible` | `app/api/trips/[id]/fork/route.ts` | Referee whose first trip is a Fork from /explore → no conversion, no referrer credit. |
| P1 | `completeReferralIfEligible` non-atomic — concurrent saves can double-credit | `lib/referral/completion.ts:82-180` | No row lock, no UNIQUE on `referral_events(referee_id,event_type)`, bananas double-credited, tier-unlock fires twice. |

**Fix path:** either consume `free_trips_remaining` in `checkUsageLimit` OR delete the column + soften the promise messaging. Add `await completeReferralIfEligible` to fork route. Build `increment_referral_conversions` RPC matching the 2026-05-24 atomic-counters pattern.

### Theme 3: Critical regressions in the just-fixed surfaces

| # | Finding | File | Why |
|---|---|---|---|
| P1 | Wizard skips JSON fallback when streaming endpoint emits `event:error` mid-stream | `app/[locale]/trips/new/NewTripWizard.tsx:881` | `if (streamError) throw` runs BEFORE the JSON fallback at line 893 — every Gemini hiccup = hard generation failure for anon users. |
| P1 | `SaveTripModal` outer container has no scroll/dvh/safe-area (Task #302) | `components/ui/SaveTripModal.tsx:240` | Verified: at 375x380 viewport, close button clipped 52px off-screen, no scroll recovery. iOS date picker triggers exactly this. |
| P1 | `ShareAndInviteModal`: Invite tab email input loses focus on every keystroke | `components/trip/ShareAndInviteModal.tsx:341, 392` | `TabButtons` and `ModalContent` are defined inside the parent's render body — every state change creates a new function reference → React unmounts the inner subtree → focus lost + iOS keyboard dismisses repeatedly. |
| P1 | Share modal: Owner cannot manage collaborators | `components/trip/ShareAndInviteModal.tsx:94` | `fetch("/api/auth/session")` returns 404 — endpoint doesn't exist. `currentUserId` stays null, `canManage` is always false, role dropdown + remove button never render. |
| P1 | `/api/admin/growth` has the same RLS bug we just fixed in `/api/admin/stats` | `app/api/admin/growth/route.ts:162` | Uses user-context (RLS-gated) supabase for cross-user counts. Sean Ellis retention, lifecycle, funnel, referral, collaboration, bananas-economy metrics all silently under-report. One-line fix matching commit `8acd2eb`. |

### Theme 4: Mobile auth UX — App Store reviewer's first stop

| # | Finding | File | Why |
|---|---|---|---|
| P1 | Auth forms missing `autoComplete` attributes | `app/[locale]/auth/{login,signup,reset-password,forgot-password}/page.tsx` | iOS Keychain / Passwords app won't autofill or offer to save. Every input verified empty `autocomplete=""`. Recommended values listed in the report. |

### Theme 5: i18n + onboarding instrumentation

| # | Finding | File | Why |
|---|---|---|---|
| P1 | `ExploreFilters` English on /it and /es (regression of #163/#164 sweep) | `components/explore/ExploreFilters.tsx` | All chip labels, section headers, search placeholder hardcoded. Verified live on prod. |
| P1 | `first_trip_saved` PostHog event never fires for organic (non-referred) users | `lib/referral/client.ts:118` | Wrapped in `if (wasReferred && refereeRewarded)`. Activation funnels dark for ~95%+ of cohort. |
| P1 | Welcome page not actually deleted — email signup still routes through `/welcome` | `app/[locale]/auth/signup/page.tsx:298-303` | OAuth correctly bypasses (callback line 281), email signup still hits the beta-code/waitlist gate Task #11 was meant to delete. |

---

## P2 — polish/edge-case

1. **Streaming endpoint leaks raw Gemini error text** (`app/api/ai/generate/stream/route.ts:457`) — exposes Google API URL, model ID, "key was reported as leaked" verbatim to browser. Inconsistent with sibling JSON route.
2. **JSON `/api/ai/generate` returns opaque 500** (`app/api/ai/generate/route.ts:420`) — no error classification, blocks any client retry-with-backoff policy.
3. **Auth pages lack `pb-safe` + `dvh`** — submit links cramped against iOS home-indicator on iPhone X+.
4. **Auth-token migration race** (`lib/supabase/client.ts:11`) — `migrateAuthStorageOnce()` not awaited; pre-#173 cold-launch users may sign out once.
5. **`referral_codes.total_conversions` increment is racy** — opposite pattern to the 2026-05-24 atomic-counters fix.
6. **EngagementBar like/save/fork** missing haptic feedback (Task #271 gap).
7. **Push token never registered on in-session signin** — only on cold launch.
8. **VotingBottomSheet** fires no haptic on vote — sibling `ProposalVoteButtons` does.
9. **"Anonymous traveler"** hardcoded English in `/api/explore/trips` response.
10. **`SaveTripModal` date range** hardcoded `toLocaleDateString("en-US")`.
11. **`BookingDrawer` formatDateRange** same — hardcoded `en-US`.

---

## P3 — cosmetic

1. `ShareButton` always shows text label — contributes to action-bar crowding (Task #303).
2. `TripConciergeChat` modal lacks `max-h-[80dvh]` — extra scroll friction on long answers (flag is OFF currently).
3. Gamification only on `OngoingTripView` (active trips) — planning trips can't check off activities (by-design but worth confirming).
4. Transaction history shows fallback 🍌 for 3 of 4 new reward types.
5. Activities on "Full Plan" tab can't be marked complete — only "Today" tab.
6. View Mode (Cards/Timeline) tabs hidden on mobile with no alternative entry.
7. OAuth redirect param dropped when `?redirect=` contains `&` (latent — no current caller).
8. Dead `getLocaleUrl` helper in 3 auth pages (cleanup).
9. No first-trip onboarding celebration on trip detail post-save.
10. Service worker registrations not unregistered for pre-#174 cohorts (defense-in-depth).
11. Deep-link hash comparison drops hash → spurious re-nav (no current caller).
12. `/api/admin/cache-stats` permanently broken — checks non-existent `users.is_admin` column. Dead endpoint, no UI caller.
13. `FlightCard` hardcodes `en-US` time/date locale.

---

## Refuted for record (9)

These were raised by auditors but the adversarial verifier blocked them:

- BottomSheet `touch-action: none` blocks vertical scroll → framer-motion overrides the explicit style with `pan-x`; mechanism described doesn't happen.
- Mobile/desktop modal flicker → modal returns null pre-open, no SSR mismatch.
- Concierge pill eats vertical space → flag is OFF, doesn't render.
- Google OAuth button missing aria-label → visible text label is sibling of spinner, accessible name works.
- No `session_id` cookie → exists as httpOnly `mt_session_id` cookie (auditor used `document.cookie` which can't see it).
- /explore hreflang missing → was case-sensitive grep, Next.js emits `hrefLang` (HTML attr names are case-insensitive).
- Push soft-prompt flags use raw localStorage → by-design per `lib/platform/storage.ts:29-32`.
- `TripInfoCards` hardcoded en-US → component is dead code, zero importers.
- `SwipeableActivityCard` formatPrice dead-code → defined but never called.
