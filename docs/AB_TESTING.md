# A/B Testing with PostHog Feature Flags

Lightweight scaffolding so any "I think this helps conversion" claim becomes
testable instead of shipped-and-forgotten. PostHog is already wired (see
`instrumentation-client.ts` + `lib/posthog/`), so this doc only covers the
experimentation layer.

## 1. Define a flag in PostHog

PostHog dashboard → **Feature flags** → **New feature flag**.

- **Key:** kebab-case, scoped to surface + intent. Examples below.
- **Type:** *Multiple variants* (so we keep `control` + `variant_a` + … as
  named strings, not booleans). Even a single-treatment test should use
  `control` / `variant_a` — booleans paint us into a corner later.
- **Rollout:** 50/50 between `control` and `variant_a` for a clean read. Bump
  to 33/33/33 if you add `variant_b`.
- **Release conditions:** start broad (100% of users matching `properties.$device_type ∈ ['Mobile', 'Desktop']`).
  Narrow only when you have a reason — geo, locale, plan tier.
- **Persistence:** *Persist flag across authentication* — ON. So an anon user
  who later signs up sees the same variant. Otherwise we contaminate the
  comparison every time someone converts.

## 2. Consume on the client

```tsx
import { useExperiment } from "@/lib/experiments/useExperiment";

export function WizardCTA() {
  const variant = useExperiment("wizard-cta-copy");
  const label = variant === "variant_a" ? "Plan free" : "Start free trip";
  return <button>{label}</button>;
}
```

Notes:
- Returns `"control"` until PostHog hydrates → safe default for SSR / first
  paint. No flicker on subsequent renders (the value is cached in state).
- Never branch on `variant !== "control"` *for the experience itself* — always
  branch on the explicit named variant. Future you will add `variant_b` and
  the "everything that isn't control" path will silently include it.

## 3. Consume on the server (RSC)

```tsx
import { cookies } from "next/headers";
import { getExperimentFromCookies } from "@/lib/experiments/useExperiment";

export default async function HomePage() {
  const c = await cookies();
  const variant = getExperimentFromCookies(c, "homepage-hero-variant");
  return variant === "variant_a" ? <HeroA /> : <HeroControl />;
}
```

Requires `NEXT_PUBLIC_POSTHOG_BOOTSTRAP_FLAGS=1` so PostHog mirrors flag
values into `ph_<flag-key>` cookies on first response. Without that, the
server path always returns `control` (safe fallback, not broken).

## 4. Naming convention

`<surface>-<thing>-<dimension>`, kebab-case, lowercase, no plural noise.

- `wizard-cta-copy`
- `homepage-hero-variant`
- `save-modal-headline`
- `pricing-anchor-position`
- `paywall-timing` (e.g. `control` = at-save, `variant_a` = at-generate)

Avoid:
- Verbs in the name (`try-new-button` → use `button-style`).
- Dates (`hero-2026-q2` → flags outlive quarters; use PostHog's archive flow).
- Component file names (`HomeHero-v2` → couples the flag to one file; the flag
  should describe the *user-visible* difference).

## 5. Tracking conversion alongside the variant

PostHog auto-attributes every event fired while a variant is active to that
variant — no extra plumbing. As long as you're already firing your existing
events (`trip_generated`, `trip_saved`, `signup_completed`, etc.) the
experiment dashboard shows the per-variant conversion rate out of the box.

Two rules:

1. **Identify the user before the conversion event fires.** Anonymous-to-known
   stitching is reliable in PostHog *only if* `posthog.identify()` runs before
   the conversion. We already do this at auth entry points (task #207). For
   experiments that span the anon→known boundary, the "Persist flag across
   authentication" flag setting above is what keeps the attribution clean.
2. **Set a primary metric in PostHog's experiment UI.** It picks the
   statistical comparison and warns you when the test is underpowered. Don't
   eyeball percentages off the events tab.

If you need to tag a custom event with the variant (rare — only when the
event fires from a context where PostHog can't auto-attribute, e.g. a webhook
handler), pass it as a property:

```ts
captureEvent("trip_generated", {
  experiment_wizard_cta_copy: variant,
  // ...other props
});
```

## 6. Three tests worth running first

1. **`wizard-cta-copy`** — `control` "Start free trip" vs `variant_a` "Plan
   free" vs `variant_b` "Build my trip". Primary metric: `trip_generated`.
   Cheapest possible test, biggest funnel surface area.
2. **`save-modal-headline`** — `control` "Save your trip" vs `variant_a` "Save
   so you don't lose it" (loss aversion framing). Primary metric:
   `trip_saved` after auth. Tests whether the auth wall converts better when
   we name the cost of dropping off.
3. **`homepage-hero-variant`** — `control` static hero image vs `variant_a`
   the phone-mockup animation we shipped in task #80. Primary metric: clicks
   on the primary CTA → `wizard_started`. Settles "does the animation
   actually move conversion or is it just nicer-looking".

## 7. When to retire a flag

- Winner declared by PostHog's significance test (typically 7–14 days of
  traffic at our volume).
- Ship the winning variant as the new `control`. Don't leave the flag in
  perpetual 50/50 — it caps your conversion ceiling at the average of the
  two arms.
- Delete the flag from PostHog *and* from the codebase in the same PR.
  Orphaned flags accrete fast.
