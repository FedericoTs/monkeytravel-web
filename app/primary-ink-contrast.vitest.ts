import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards --primary-ink against being "brightened back to the brand coral".
 *
 * The brand coral #FF6B6B is a 2.68:1 contrast on our cream background and
 * 2.78:1 under white. That fails WCAG AA for normal text (4.5:1) AND for large
 * text (3:1), so it cannot legibly carry text at any size, nor sit behind a
 * white button label. --primary-ink is the same hue taken dark enough to clear
 * AA in both directions.
 *
 * This is pure colour maths on the token values, so it needs no browser. It
 * cannot prove the whole page is accessible — only that the token everything
 * was migrated onto still does its job. The rendered sweep that found the
 * original 46 coral-text and 7 white-on-coral failures lives outside CI.
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

/** Every light surface --primary-ink is painted onto somewhere in the app. */
const LIGHT_SURFACES: Record<string, string> = {
  "--background (cream)": "background",
  "--background-alt (white)": "background-alt",
  "--background-warm": "background-warm",
  "--background-cream (pink tint)": "background-cream",
};

describe("--primary-ink stays legible", () => {
  const ink = token("primary-ink");

  for (const [label, tokenName] of Object.entries(LIGHT_SURFACES)) {
    it(`clears AA as text on ${label}`, () => {
      const surface = token(tokenName);
      const ratio = contrast(ink, surface);
      expect(
        ratio >= AA_NORMAL,
        `--primary-ink (${ink}) on ${label} (${surface}) is ${ratio.toFixed(2)}:1, ` +
          `below the ${AA_NORMAL}:1 AA minimum for normal text. Darken --primary-ink; ` +
          `do NOT relax this threshold.`,
      ).toBe(true);
    });
  }

  it("clears AA as a button fill under a white label", () => {
    const ratio = contrast(WHITE, ink);
    expect(
      ratio >= AA_NORMAL,
      `white on --primary-ink (${ink}) is ${ratio.toFixed(2)}:1, below ${AA_NORMAL}:1. ` +
        `Solid primary buttons put white text on this token.`,
    ).toBe(true);
  });

  it("is meaningfully darker than the decorative coral it replaced", () => {
    // Sanity check that someone has not quietly aliased ink back to --primary.
    const primary = token("primary");
    expect(ink).not.toBe(primary);
    expect(
      relativeLuminance(ink) < relativeLuminance(primary),
      `--primary-ink (${ink}) is not darker than --primary (${primary}).`,
    ).toBe(true);
  });

  it("documents that the decorative coral itself still fails text contrast", () => {
    // Not a regression to fix — it records WHY the ink token exists, and fails
    // loudly if someone "fixes" --primary instead, which would make the split
    // pointless and should be a deliberate, reviewed change.
    const primary = token("primary");
    const onCream = contrast(primary, token("background"));
    expect(onCream).toBeLessThan(AA_NORMAL);
  });
});
