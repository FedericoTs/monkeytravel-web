/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import CountdownHero from "./CountdownHero";

/**
 * CountdownHero sits below the trip's hero and shows the same cover photo. It
 * must not preload it from <head>: that copy then competes with the hero's,
 * the page's LCP image, for the first bytes.
 */
describe("CountdownHero cover", () => {
  const html = () =>
    renderToString(
      <CountdownHero
        destination="Lisbon"
        startDate={new Date("2030-01-01T00:00:00Z")}
        tripDays={3}
        activitiesCount={5}
        coverImageUrl="/api/places/photo?name=places%2Fabc%2Fphotos%2Fxyz&w=1920&h=1200"
      />,
    );

  it("does not preload the photo", () => {
    expect(html()).not.toMatch(/rel="preload"/);
  });

  it("loads it lazily, sized to the content column", () => {
    const img = html().match(/<img[^>]*>/)?.[0] ?? "";
    expect(img).toMatch(/loading="lazy"/);
    expect(img).toContain('sizes="(min-width: 1152px) 1120px, 100vw"');
  });
});
