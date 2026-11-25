import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
  useLocale: () => "en",
}));
vi.mock("@/lib/locale", () => ({
  useLocale: () => ({ preferences: { temperatureUnit: "celsius" } }),
  formatTemperatureRange: () => "",
}));
vi.mock("@/lib/observability/sentry", () => ({ sentryException: vi.fn() }));

import SeasonalContextCard from "./SeasonalContextCard";

/**
 * The season card on step 1 tells the season, the crowds and the holidays of the trip's dates. Styles are
 * suggested on step 2 only: the card used to suggest the season's, several of which step 2 doesn't offer.
 */
describe("the season card", () => {
  it("shows the trip's season and suggests no styles", () => {
    const { container } = render(<SeasonalContextCard destination="Vienna, Austria" startDate="2026-12-18" endDate="2026-12-22" />);
    expect(screen.getByText(/trips\.seasonalContext\.seasonLabel/)).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toContain("suggestedVibes");
    expect(text).not.toContain("vibesHint");
    expect(text).not.toContain("vibes.types");
    expect(text).not.toContain("vibeReasons");
  });
});
