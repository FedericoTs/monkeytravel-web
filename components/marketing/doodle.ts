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
 * The ink style is the brand language approved on the hero preview: every button/pill
 * carries a 2px foreground border like the illustration outlines; primary CTAs add a
 * hard 3px offset shadow (hand-drawn sticker look).
 */
export const HERO_DOODLE_ENABLED =
  (process.env.HERO_DOODLE_ENABLED ?? process.env.NEXT_PUBLIC_HERO_DOODLE_ENABLED) === "true";

export const INK = {
  /** 2px charcoal outline for pills, badges, inputs, secondary buttons */
  border: "border-2 border-[var(--foreground)]",
  /** primary CTA: outline + hard offset shadow */
  btnPrimary: "border-2 border-[var(--foreground)] shadow-[3px_3px_0_var(--foreground)]",
  /** floating info cards: solid white with the ink outline (replaces glassmorphism) */
  card: "bg-white border-2 border-[var(--foreground)] rounded-2xl",
} as const;
