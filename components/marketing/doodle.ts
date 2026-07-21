/**
 * Doodle rebrand flag + shared "pen-drawn ink" style tokens.
 *
 * Server-side env const, mirroring the MULTI_CITY_ENABLED pattern (NewTripWizard.tsx).
 * NEXT_PUBLIC_ so the same build-time value is inlined on server and client — no
 * cookie/PostHog evaluation, no hydration mismatch. Flip in Vercel env to launch.
 *
 * The ink style is the brand language approved on the hero preview: every button/pill
 * carries a 2px foreground border like the illustration outlines; primary CTAs add a
 * hard 3px offset shadow (hand-drawn sticker look).
 */
export const HERO_DOODLE_ENABLED = process.env.NEXT_PUBLIC_HERO_DOODLE_ENABLED === "true";

export const INK = {
  /** 2px charcoal outline for pills, badges, inputs, secondary buttons */
  border: "border-2 border-[var(--foreground)]",
  /** primary CTA: outline + hard offset shadow */
  btnPrimary: "border-2 border-[var(--foreground)] shadow-[3px_3px_0_var(--foreground)]",
  /** floating info cards: solid white with the ink outline (replaces glassmorphism) */
  card: "bg-white border-2 border-[var(--foreground)] rounded-2xl",
} as const;
