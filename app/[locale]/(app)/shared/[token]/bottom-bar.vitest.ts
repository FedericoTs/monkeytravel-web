import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The shared page's fixed bottom bars sit on top of the mobile nav. At
 * bottom-0 the nav covered the owner's "sign up to keep it" link, and a tap
 * there opened "new trip" instead.
 */
describe("shared page fixed bars", () => {
  const source = readFileSync(
    join(process.cwd(), "app", "[locale]", "(app)", "shared", "[token]", "SharedTripView.tsx"),
    "utf8",
  );

  it("are offset by the mobile nav's published height", () => {
    const bars = [...source.matchAll(/data-testid="trip-bottom-bar"\s+className="([^"]*)"/g)].map((m) => m[1]);
    expect(bars.length).toBe(2);
    for (const bar of bars) {
      expect(bar).not.toContain("bottom-0");
      expect(bar).toContain("bottom-[var(--mt-nav-h,0px)]");
    }
  });
});
