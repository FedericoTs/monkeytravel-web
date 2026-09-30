/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import DestinationHero from "./DestinationHero";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${values.count} activities`,
}));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, currency: string) => ({ formatted: `${amount} ${currency}` }) }),
}));

const hero = (counts: { days?: number; nights?: number; activitiesCount?: number }) =>
  render(<DestinationHero destination="Lisbon, Portugal" title="Lisbon Trip" disableApiCalls {...counts} />).container;

/** The stat chips print counts; a zero must print nothing, not a stray "0". */
describe("DestinationHero counts", () => {
  it("shows a one-day trip as 1D, with no nights", () => {
    const text = hero({ days: 1, nights: 0, activitiesCount: 2 }).textContent;
    expect(text).toContain("1D");
    expect(text).not.toContain("1D0");
    expect(text).toContain("2 activities");
  });

  it("joins days and nights when both are set", () => {
    expect(hero({ days: 3, nights: 2 }).textContent).toContain("3D · 2N");
  });

  it("prints nothing for zero days, nights and activities", () => {
    expect(hero({ days: 0, nights: 0, activitiesCount: 0 }).textContent).not.toMatch(/\d/);
  });
});
