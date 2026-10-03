/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { VISA_DATA_AS_OF, visaDataAsOfLabel } from "./dataset";

/**
 * The visa checker used to print the render date as the data's "last
 * updated" date, while the upstream data had not changed in months.
 */
describe("visa data date", () => {
  it("is a real date, not in the future", () => {
    expect(VISA_DATA_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(VISA_DATA_AS_OF <= new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it("reads as a long date in each locale", () => {
    const label = visaDataAsOfLabel("en");
    expect(label).toContain(VISA_DATA_AS_OF.slice(0, 4));
    expect(label).not.toContain("-");
  });

  it("is what the visa checker shows, not the render date", () => {
    const page = readFileSync(join(__dirname, "../../app/[locale]/tools/visa-checker/page.tsx"), "utf8");
    expect(page).toContain("visaDataAsOfLabel(locale)");
    expect(page).not.toMatch(/refreshedDate = new Date\(\)/);
  });
});
