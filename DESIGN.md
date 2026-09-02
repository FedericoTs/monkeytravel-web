# Design System — MonkeyTravel

This file records the system that **already exists** in `app/globals.css` and
`app/layout.tsx`, plus the direction decided for the signed-in home. It is not a
redesign. Where this file and the code disagree, the code is the truth and this
file is the bug.

Written 2026-08-25 via `/design-consultation`.

## Product Context

- **What this is:** a free AI trip planner. You describe a trip, it generates a
  day-by-day itinerary in about 30 seconds, no account required to see it.
- **Who it's for:** people planning a specific trip they intend to take, not
  people browsing destinations. That distinction drives most of what follows.
- **Space:** Wanderlog, TripIt, Layla, Mindtrip, Wonderplan.
- **Project type:** web app (Next.js 16 App Router) with a Capacitor shell, plus a
  large marketing/blog surface. Locales: en, es, it, pt.

## Aesthetic Direction

- **Direction:** warm editorial. A serif display against a cream ground, not the
  cool blue-grey SaaS default the category converges on.
- **Decoration level:** intentional — coral rules, edges and illustration carry the
  warmth; typography does the rest.
- **Mood:** anticipation. The product's subject is a trip you have not taken yet,
  and the interface should feel closer to that than to a dashboard.

## Typography

Loaded via `next/font/google` in `app/layout.tsx` — self-hosted, no CDN request.

- **Display:** **Fraunces** (`--font-display`), variable, weights 400/500/600/700.
  Warm, high-contrast, optical sizing. Used for all headings and for the countdown
  numeral. Fallback `Georgia, serif`.
- **Body / UI:** **Source Sans 3** (`--font-source-sans`), weights 400/500/600.
  Fallback `system-ui, sans-serif`.
- **Mono:** **Geist Mono** (`--font-geist-mono`), code blocks only.
- **Numerals:** anywhere digits align in a column or count down, set
  `font-variant-numeric: tabular-nums`.

## Color

The palette lives in `:root` in `app/globals.css`. Names below are the real token
names — use the token, never the hex.

### The rule that shapes everything

**`--primary` (`#FF6B6B`) is decoration only.** It is 2.68:1 on our cream ground
and 2.78:1 under white. That fails WCAG AA for normal text (4.5:1) **and** for
large text (3:1), so the brand coral cannot legibly carry text at any size, and
cannot back a white label. The same is true of `--secondary` (`#00B4A6`) at
2.60:1, and of `--secondary-dark`, which is already the dark end of its ramp and
still only reaches 4.20:1.

Each family therefore has an **ink** sibling — same hue, dark enough to clear AA
in both directions:

| token | hex | role |
|---|---|---|
| `--primary` | `#FF6B6B` | decoration: gradients, borders, focus rings, glows, illustration |
| `--primary-ink` | `#FF6B6B` | coral text — **decorative only** since 2026-08-26 (see correction below); text that must be read uses `--foreground` / `--foreground-muted` |
| `--secondary` | `#00B4A6` | decoration |
| `--secondary-ink` | `#00786F` | all teal text and teal fills |
| `--accent` | `#FFD93D` | gold fills — **charcoal text only**, never red, never white |

**Correction (2026-09-02).** The paragraph this replaced described `--primary-ink`
as `#C93232` at 4.94:1. That value was folded back to the brand coral (`#FF6B6B`)
on 2026-08-26 in `f939625`, and `app/ink-tokens-contrast.vitest.ts` now **pins
`--primary-ink === --primary`** at ~2.68:1 on `--background` as an accepted
exception. So coral text is decoration at every size, exactly like coral fills:
anything a person must read is set in `--foreground` or `--foreground-muted`,
and a new surface must not reach for `text-[var(--primary-ink)]` to carry
meaning. `--secondary-ink` was not part of that change; check `app/globals.css`
for its current value before relying on the teal ratios.

### The dark-surface trap

On `--navy` the relationship **inverts**: `--primary` is 4.57:1 and passes, while
`--primary-ink` is 2.59:1 and fails. Teal behaves the same way (4.88 vs 2.36), as
does `slate-400` (4.82 vs 2.66). **Never blanket-swap a colour token without first
checking whether any instance sits on a dark surface.** The check that made the
2026-08-25 migration safe: zero elements paired a dark background with a bright
brand text colour in the same class list.

### Accepted exception — primary buttons

`bg-[var(--primary)]` + `text-white` is **2.78:1 and fails AA**. This is carried
deliberately: the coral primary action is the most recognisable surface in the
product, and a brick-red button reads as a different brand. Do not "fix" it by
darkening `--primary` — that decision has been made once, and darkening the token
would also drag every gradient, border and glow that deliberately kept the bright
value.

If we ever want those buttons to pass, **change the label, not the fill**:
`--foreground` on `--primary` is 4.57:1. Both the exception and its remedy are
pinned by `app/ink-tokens-contrast.vitest.ts`.

### Neutrals and surfaces

Warm, biased toward the coral — not neutral grey.

`--background` `#FFFAF5` · `--background-warm` `#FFF5EB` · `--background-cream`
`#FFF0F0` · `--background-alt` `#FFFFFF` · `--background-dark` `#2D3436`
`--foreground` `#2D3436` · `--foreground-muted` `#636E72` · `--foreground-light` `#B2BEC3`

Tailwind `slate-400` is **not** a body-text colour (2.63:1 on white). Use
`slate-500` or darker.

## Spacing & Layout

- **Radius scale:** `--radius-sm` 8 · `md` 12 · `lg` 16 · `xl` 24 · `2xl` 32 ·
  `3xl` 40 · `full` 9999. Pick by element size; do not put one radius on everything.
- **Touch targets:** interactive controls are **at least 44px** tall. Use
  `min-h-[44px]` plus `inline-flex items-center` rather than stacking vertical
  padding, so the target survives a font-size change. That spelling is the
  convention here (16+ uses); do not introduce `min-h-11`.
- **Layout:** grid-disciplined for app surfaces, more editorial for marketing and
  blog. Wide content (tables, code) scrolls inside its own container.

## Motion

Minimal-functional. Transitions that aid comprehension; nothing decorative.
Respect `prefers-reduced-motion`.

## The signed-in home (decided, not yet built)

Preview: **The Waiting Room** — https://claude.ai/code/artifact/46971aec-cfb4-4e10-9a52-f8a7aeff876b

**The problem.** 145 trips are booked and not taken, across 115 people — a quarter
of everyone who has signed up. The median gap between planning a trip and leaving
is **31 days**, and the product currently says nothing during it. Meanwhile only
14 users are on a trip at any moment, which is the population the approved mobile
wedges serve.

**The decision: the home branches on one question — does this person have a trip
coming?** The two answers want opposite things and one feed cannot serve both.

- **Trip coming (115 people).** The trip is the hero, with a countdown, and one
  card beneath it that changes with distance from departure:
  **far out (30d+)** culture and context · **weeks out (30–7d)** weather, packing,
  what is cheaper to fix early · **days out (<7d)** logistics only ·
  **in trip** hands over to the Concierge (Wedge 1, approved 2026-06-29).
- **No trip.** One honest line and a way to start planning. Deliberately minimal:
  the blog is 46% of sessions and ~2% of trips generated, so content does not
  manufacture a reason to return. This state earns more only if the other half works.

**Why no points, streaks or badges.** Between-trip engagement needs an invented
reason to open the app, which is what gamification supplies. Pre-trip does not —
the trip is the reason. A score here would decorate a motivation that already exists.

**Deliberately not taken.** Wanderlog and TripIt both let you forward a
confirmation email so real bookings land in the trip; it is the mechanic their
users praise unprompted. It is also inbound email parsing, a new data model and a
serious privacy ask with no revenue model behind it. Revisit if pre-trip works.

**Shipping.** Flag it at **90/10**, not 50/50 — the 10% is a holdout and a kill
switch, not an experiment. A powered A/B is not available at this volume: ~96 new
trip-holders a month means ~4 months to detect a +13pp lift and over a year for
+7pp. Judge it within a week on whether the countdown state is opened and the timed
card clicked, then read retention against the existing monthly curve
(0 → 1.3 → 2.7 → 5.6% D1–D7 action retention). **Put a review date on the flag** —
the front-door experiment ran from 1 July with nobody watching for six weeks.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-25 | `--primary-ink` / `--secondary-ink` split off | Brand hues fail AA as text at every size; darkening the brand itself would need `#EA0000`, which is not coral |
| 2026-08-25 | Coral primary buttons keep white labels despite 2.78:1 | Product decision: the coral CTA is brand identity. Remedy if reversed is a charcoal label, not a darker fill |
| 2026-08-25 | Gold chips take charcoal labels | Red on `#FFD93D` tops out at 3.82:1 at any shade; charcoal is 9.21:1 |
| 2026-08-25 | Signed-in home branches on "trip coming?" | 115 pre-trip users vs 14 in-trip; the two cohorts have opposite needs |
| 2026-08-25 | Destination content is time-released, not a feed | Blog is 46% of sessions and ~2% of generations — a library does not drive returns |
| 2026-08-25 | Booking-email ingestion not taken | Category's proven hook, but a large build and a privacy ask with no revenue behind it |
