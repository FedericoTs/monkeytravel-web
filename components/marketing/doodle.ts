/**
 * Doodle rebrand flag + shared "pen-drawn ink" style tokens.
 *
 * SERVER-ONLY MODULE — every importer is a server component (the marketing pages).
 * Do not import this into a "use client" file: `HERO_DOODLE_ENABLED` is read from the
 * server runtime and would be `false` in the browser. Client components take the value
 * as a prop instead (see HeroTripInput's `ink`).
 *
 * Two env names are accepted, checked in this order:
 *   1. HERO_DOODLE_ENABLED         — runtime value, read per cold start. Changing it in
 *                                    Vercel + redeploying picks it up even from build cache.
 *   2. NEXT_PUBLIC_HERO_DOODLE_ENABLED — inlined at BUILD time. Setting it only takes
 *                                    effect on builds started afterwards, and only for
 *                                    the environment (Preview/Production) it is scoped to.
 * Prefer (1); (2) is kept so an already-configured env var keeps working.
 *
 * The flag drives two things and nothing else:
 *   - which decorative layer the marketing heroes render (art vs. gradient orbs)
 *   - the `data-brand="doodle"` attribute on <html> in app/layout.tsx
 * All visual styling — ink outlines on buttons/fields/pills, solid cards, the flat
 * hero surface — lives in the `[data-brand="doodle"]` block at the end of
 * app/globals.css, so it reaches every component and page without per-component
 * classes. Opt an element out with data-ink="off".
 */
export const HERO_DOODLE_ENABLED =
  (process.env.HERO_DOODLE_ENABLED ?? process.env.NEXT_PUBLIC_HERO_DOODLE_ENABLED) === "true";
