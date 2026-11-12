import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Coral (--primary, --primary-ink) is decoration: as text it reads at about
 * 2.7:1, under the 4.5:1 small text needs (DESIGN.md). The top bar sits on
 * every marketing page, so its words, hovered or not, use the text colours.
 * The one exception is the MonkeyTravel wordmark: a logotype has no contrast
 * minimum.
 */

const read = (file: string) => readFileSync(join(__dirname, file), "utf-8");
const CORAL_TEXT = /(?:[a-z-]+:)*text-\[var\(--primary(?:-ink)?\)\]/g;
const WORDMARK = /<span className="[^"]*">MonkeyTravel<\/span>/;

describe("the top bar's words", () => {
  it("are never coral, apart from the wordmark", () => {
    const server = read("Navbar.tsx");
    expect(server).toMatch(WORDMARK);
    expect(server.replace(WORDMARK, "").match(CORAL_TEXT) ?? []).toEqual([]);
    expect(read("NavbarClient.tsx").match(CORAL_TEXT) ?? []).toEqual([]);
  });
});
