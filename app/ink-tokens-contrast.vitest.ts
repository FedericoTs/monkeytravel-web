import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the *-ink tokens against being "brightened back to the brand colour".
 *
 * Both brand hues fail WCAG AA as text at every size:
 *   --primary   #FF6B6B  2.68:1 on cream, 2.78:1 under white
 *   --secondary #00B4A6  2.51:1 on cream, 2.60:1 under white
 * and in the teal's case even --secondary-dark, already the dark end of the
 * ramp, only reaches 4.20:1 on white. So each family got an ink sibling that
 * carries text and button fills, while the bright value stays for decoration.
 *
 * Pure colour maths on the token values — no browser needed. This cannot prove
 * a page is accessible; it proves the tokens everything was migrated onto still
 * do their job. The rendered sweep that found the original failures lives
 * outside CI.
 */

const CSS = readFileSync(join(__dirname, "globals.css"), "utf-8");

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS);
  if (!m) throw new Error(`token --${name} not found in globals.css`);
  return m[1].toLowerCase();
}

function relativeLuminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = v.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const AA_NORMAL = 4.5;
const WHITE = "#ffffff";

/**
 * Light surfaces each ink token is painted onto. `background-cream` is the
 * tightest one for the coral and `#E5F7F6` for the teal — both are why the
 * first candidate for each token was not dark enough.
 */
const SURFACES = ["background", "background-alt", "background-warm", "background-cream"];

const INKS = [
  { ink: "primary-ink", bright: "primary", label: "coral" },
  { ink: "secondary-ink", bright: "secondary", label: "teal" },
];

describe.each(INKS)("--$ink stays legible", ({ ink, bright, label }) => {
  it.each(SURFACES)(`clears AA as ${label} text on --%s`, (surface) => {
    const ratio = contrast(token(ink), token(surface));
    expect(
      ratio >= AA_NORMAL,
      `--${ink} (${token(ink)}) on --${surface} (${token(surface)}) is ` +
        `${ratio.toFixed(2)}:1, below the ${AA_NORMAL}:1 AA minimum for normal text. ` +
        `Darken --${ink}; do NOT relax this threshold.`,
    ).toBe(true);
  });

  it("clears AA as a fill under a white label", () => {
    // Only --secondary-ink is actually used as a button fill. Primary buttons
    // were rolled back to the brand coral (see the ACCEPTED EXCEPTION note in
    // globals.css), so for the coral this asserts a property we are holding in
    // reserve rather than one the UI relies on today.
    const ratio = contrast(WHITE, token(ink));
    expect(
      ratio >= AA_NORMAL,
      `white on --${ink} (${token(ink)}) is ${ratio.toFixed(2)}:1, below ${AA_NORMAL}:1. ` +
        `Solid ${label} buttons put white text on this token.`,
    ).toBe(true);
  });

  it("is darker than the decorative brand value it replaced", () => {
    // Catches someone quietly aliasing the ink back to the bright brand colour.
    expect(token(ink)).not.toBe(token(bright));
    expect(
      relativeLuminance(token(ink)) < relativeLuminance(token(bright)),
      `--${ink} (${token(ink)}) is not darker than --${bright} (${token(bright)}).`,
    ).toBe(true);
  });

  it("records that the bright value itself still fails text contrast", () => {
    // Not a regression to fix. It documents WHY the split exists, and fails
    // loudly if someone "fixes" the brand colour instead — which would make the
    // split pointless and should be a deliberate, reviewed change.
    expect(contrast(token(bright), token("background"))).toBeLessThan(AA_NORMAL);
  });
});

describe("the bright brand values stay usable on dark sections", () => {
  // The reason neither swap could be blanket-applied: on navy the BRIGHT value
  // passes and the ink does not. Anything moved onto a dark surface must move
  // back to the bright token.
  const NAVY = "navy";
  it.each(INKS)("--$bright still passes on --navy", ({ bright }) => {
    expect(contrast(token(bright), token(NAVY))).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe("accepted exception: coral primary buttons", () => {
  /**
   * Primary buttons are `bg-[var(--primary)]` + `text-white`, which is 2.78:1
   * and fails AA. That is a deliberate product decision, not an oversight —
   * see the ACCEPTED EXCEPTION note in globals.css.
   *
   * This test pins the exception rather than hiding it: if someone later
   * darkens --primary to "fix" the button, this fails and forces the
   * conversation, because darkening --primary would also change every
   * gradient, border and glow that deliberately kept the bright brand colour.
   */
  it("is still an exception, and its cost is still what we think it is", () => {
    const onCoral = contrast(WHITE, token("primary"));
    expect(onCoral).toBeLessThan(AA_NORMAL);
    expect(onCoral).toBeCloseTo(2.78, 1);
  });

  it("has a documented remedy that keeps the coral: a charcoal label", () => {
    // If we ever want these buttons to pass, this is the move — change the
    // label, not the fill.
    expect(contrast(token("foreground"), token("primary"))).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
