# Feature Discoverability Audit & Plan

**Date:** 2026-07-01 · **Status:** audited + code-verified; plan pending execution.
**Context:** Continuation of the product/UX repositioning that started with the decision-first wizard (`DECISION_FRONT_DOOR_PLAN.md`). Goal now: **make every built tool/feature discoverable, reachable, and dead-simple to use.**

**Method:** 3 parallel read-only audits (global nav surfaces · full route/feature inventory · trip-itinerary surface), then a 14-claim *adversarial* verification pass (each verifier tried to refute its claim before confirming, every verdict backed by `file:line`). 43 user-facing routes + 40+ in-trip features exist.

---

## The finding, in one line
Very little is *badly built*. The discoverability problem is **three cheap-to-fix root causes**: (1) finished features are **dark behind prod feature-flags**, (2) built pages have **no in-app link**, (3) high-value in-trip actions are **visually buried** — and the **anonymous result view is feature-poor** vs. the saved trip page.

---

## Root cause 1 — Finished features dark behind prod flags (config, zero-eng)
Fully-built, wired features that render **nothing** unless an env/flag is set. Highest bang-for-buck: flipping a flag in Vercel Production, no code.

| Feature | Flag (default) | State | Evidence |
|---|---|---|---|
| **Expense Ledger + Settle-up** | `NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED` (unset→off) | Fully wired incl. `SettleUpView` modal; returns `null` unless `"true"` | `ExpenseLedger.tsx:97-99,369-377,393-397`; `SettleUpView.tsx:63-256`; `TripDetailClient.tsx:1900` |
| **Concierge history pill** (read-only past Q&A) | `NEXT_PUBLIC_CONCIERGE_ENABLED` (unset→off) | Gated to `null`. NOTE: the main **AI Assistant** floating button is **already live** (not gated) | `TripConciergeChat.tsx:39`; `TripDetailClient.tsx:1625,2408-2471` |
| **One-tap iCal button** | `NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED` (unset→off) | Standalone `DownloadIcsButton` returns `null`. (iCal *is* otherwise available inside the Export dropdown.) | `DownloadIcsButton.tsx:46`; `TripDetailClient.tsx:1731` |
| **Enhanced booking panel** | PostHog `enhanced-booking-panel` (default false) | Falls back to basic `BookingPanel` | `flags.ts:107,266`; `TripDetailClient.tsx:358,1875-1894` |
| **Multi-city (in wizard)** | `NEXT_PUBLIC_MULTI_CITY_ENABLED` (unset→off) | Wired into `/trips/new` (toggle → route builder → per-city gen + save). **Set true in prod on 2026-06-30 — confirm still set.** | `NewTripWizard.tsx:40,2772,2800,1100-1119` |

**Action:** verify each feature is prod-ready, then flip the ready flags in Vercel Production. (User-side — sandboxed shells can't reach the Vercel CLI.)

---

## Root cause 2 — Built pages/features with no in-app link
| Item | Verdict | Current reachability | Fix |
|---|---|---|---|
| **`/templates`** | buried | No nav/footer link. Only via the "See All" card on the homepage + dashboard Curated Escapes carousels, and a gated in-wizard "Browse Templates" link (limit-reached state only). | Add "Templates" to `Navbar.tsx` navLinks + `Footer.tsx` product column (same de-orphan pattern used for `/explore`, `/tools`). `CuratedEscapes.tsx:212`, `CuratedEscapesClient.tsx:205`, `NewTripWizard.tsx:2356` |
| **`/backpacker`** | orphaned | **Zero** in-app entry (not in nav/footer/home/bottom-nav/blog cross-links). Reachable only by direct URL / sitemap. It's a Hostelworld "cold-open" SEO asset, but has no organic path. | Add to `Footer.tsx:24-44` product column + `lib/cross-links.ts:76-89` (backpacking/hostel keywords) — or consciously keep it SEO-only. |
| **Standalone `/multi-city`** | orphaned | Save-less "Preview" page, **zero inbound links**. The real multi-city entry is the wizard (RC1). | ✅ DONE (2026-07-01): now a server redirect → `/trips/new` (reusable JourneyRibbon/MultiCityRouteBuilder kept). |
| **`/welcome`** | dead code | Retired stub that `redirect("/trips/new")`; `WelcomeClient.tsx` imported nowhere; residual `router.push("/welcome")` in login. | ✅ DONE (2026-07-01): deleted orphaned `WelcomeClient.tsx`; repointed login + profile refs to `/trips/new`. **Kept** the `page.tsx` redirect stub on purpose — it's a defensive catch for cached links / stale push notifications (deleting it would 404 them). |
| **`FlightSearch` / `HotelSearch`** | dead code | Never rendered (imports commented at `TripDetailClient.tsx:82-83`). Live booking = `BookingPanel`/`EnhancedBookingPanel`. | Delete the dead components (Amadeus search routes still exist if we ever wire it back). |
| Stale strings | cleanup | `completion.ts:296` points to non-existent `/bananas` (real dashboard = `/profile`); `StartAnywhereSection.tsx:11` claims a `FLAG_START_ANYWHERE` that doesn't exist. | One-line fixes. |

---

## Root cause 3 — Buried / asymmetric in-trip actions
| Item | Verdict | Detail | Fix |
|---|---|---|---|
| **Per-day regenerate** | buried | Owner-only, **icon-only** (RefreshCw, no label), easy to miss. | Add visible "Regenerate day" label (mirror the sibling "Optimize Route" button). `TripDetailClient.tsx:1964-1981,1983-1998` |
| **Per-activity regenerate** | buried | Only appears in **edit mode**; no-op in view mode. | Surface a lightweight regenerate affordance in view mode. `EditableActivityCard.tsx:227,277-285` |
| **Export (PDF/iCal)** | buried | Hidden inside a dropdown; on mobile the trigger is icon-only. No JSON export exists (claim was wrong). | Promote PDF/.ics to visible actions. `ExportMenu.tsx:114-160` |
| **Anonymous result view is feature-poor** | confirmed | The generation result (`NewTripWizard` `generatedItinerary` return, `:1611-2259`) has **no AI Assistant/Concierge, no export/iCal, no edit, no per-day regen** — only Save / Regenerate / Start Over. All the AI power is locked behind save+auth on the trip-detail page. | **Strategic:** add the AI Assistant (in-memory edits) + export to the anon result. Concierge currently hard-requires auth + persisted `tripId` (`api/ai/concierge/route.ts:185-207`) — needs an unauth, payload-based path. |

**Why RC3's anon gap matters:** this is the exact surface the live decision-first front-door experiment is funneling into. Every generated trip lands here; hiding the AI killer features at peak intent is the biggest UX leak.

---

## Verified non-issues (refuted — do NOT touch)
- **`/saved` on mobile** — present in the mobile hamburger (`NavbarClient.tsx:228-237`) + footer. Fine.
- **Start Anywhere** — renders unconditionally near the *top* of wizard step 1, above the destination field; no flag. (Just a stale docstring to delete.)
- **Bananas** — fully wired (earn via `OngoingTripView` → `/api/bananas/award`; balance shown in `/profile`). Fine.
- **Tools on mobile** — in the hamburger + footer + homepage; only absent from the 5-tab bottom bar (minor).
- **Wedge SEO pages** — healthy by design (out of nav on purpose, linked from blog cross-links, CTA → `/trips/new`).

---

## Prioritized plan
- **Tier 0 — flip dark flags (config, user-side):** verify readiness, then set the ready flags in Vercel prod. Biggest immediate unlock, zero eng.
- **Tier 1 — de-orphan built pages (small edits):** Templates + Backpacker nav/footer links; remove dead code (`/welcome`, `FlightSearch`/`HotelSearch`, standalone `/multi-city`); fix stale strings.
- **Tier 2 — surface buried actions (UI edits):** labels on per-day/per-activity regen; promote export actions.
- **Tier 3 — strategic:** enrich the anonymous result view with the AI Assistant + export (front-door-aligned; largest build).
- **Tier 4 — nav IA polish:** bottom-nav Tools parity; unified discovery surface.
