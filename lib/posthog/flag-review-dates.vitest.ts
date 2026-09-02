import { describe, expect, it } from "vitest";
import { FLAG_REVIEW_DATES } from "./flags";

/**
 * A rollout flag must be reviewed, not forgotten.
 *
 * The front-door experiment ran at 50/50 from 1 July 2026 with nobody
 * watching for six weeks, because nothing in the repo knew it had a deadline.
 * Every flag listed in FLAG_REVIEW_DATES now carries one, and this test turns
 * CI red once today is more than GRACE_DAYS past it — so the choice (ramp to
 * 100% and delete the old branch, or set 0% and revert) has to be made, and
 * the entry removed, before the tree goes green again.
 */
const GRACE_DAYS = 7;

describe("rollout flags are reviewed on time", () => {
  it("has at least the shape it guards", () => {
    for (const [key, iso] of Object.entries(FLAG_REVIEW_DATES)) {
      expect(key, "flag key").toMatch(/^[a-z0-9-]+$/);
      expect(iso, `${key} review date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  for (const [key, iso] of Object.entries(FLAG_REVIEW_DATES)) {
    it(`${key}: review by ${iso} (+${GRACE_DAYS} days grace)`, () => {
      const deadline = new Date(`${iso}T00:00:00Z`).getTime() + GRACE_DAYS * 86_400_000;
      const overdueDays = Math.floor((Date.now() - deadline) / 86_400_000);
      expect(
        overdueDays,
        `${key} is ${overdueDays} day(s) past its review grace period. Decide: ramp it to 100% and delete the classic branch, or set it to 0% and revert — then remove it from FLAG_REVIEW_DATES in lib/posthog/flags.ts.`
      ).toBeLessThan(0);
    });
  }
});
